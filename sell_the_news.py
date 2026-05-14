"""
Sell the News — empirical test of the post-earnings fade.

For every ticker supplied, this script:

1. Pulls the most recent earnings calendar from yfinance.
2. Filters for *positive* surprises by manually comparing
   ``Reported EPS`` to ``EPS Estimate`` (the ``Surprise`` column
   that yfinance returns is frequently NaN and unreliable).
3. Computes two reactions around each beat:

       Initial Pop %  = (Open_reaction - Close_prev)  / Close_prev
       3-Day Fade %   = (Close_reaction+3 - Open_reaction) / Open_reaction

   where *reaction day* is the next trading session on or after the
   reported earnings timestamp (located via ``method='bfill'`` so
   weekends and exchange holidays are skipped automatically).
4. Returns one tidy DataFrame and prints the average post-earnings
   fade across the universe — the headline number for the
   "Sell the News" hypothesis.

Run directly:

    python3 sell_the_news.py                    # uses default tickers
    python3 sell_the_news.py AAPL NVDA TSLA MSFT
"""

from __future__ import annotations

import sys
from typing import Iterable

import pandas as pd
import yfinance as yf


DEFAULT_TICKERS = ["AAPL", "NVDA", "TSLA"]


def _to_naive_dates(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Strip tz info and normalize to midnight so we can safely
    compare timestamps coming from different yfinance endpoints
    (earnings calendar is tz-aware, history is tz-aware in the
    exchange's local zone — mixing them raises ``TypeError``).
    """
    if index.tz is not None:
        index = index.tz_localize(None)
    return index.normalize()


def _reaction_calendar_date(ts: pd.Timestamp) -> pd.Timestamp:
    """Return the first calendar date on which the market can react
    to an earnings release.

    yfinance reports earnings timestamps in the exchange's local zone.
    A 16:00-or-later print is an after-the-close (AMC) release, so the
    reaction is the *next* calendar day; an early-morning print is a
    before-the-open (BMO) release that reacts the same day.
    """
    if ts.tzinfo is not None:
        local = ts.tz_convert("America/New_York")
    else:
        local = ts
    hour = local.hour + local.minute / 60.0
    base = pd.Timestamp(local.date())
    return base + pd.Timedelta(days=1) if hour >= 16.0 else base


def _fetch_beats(ticker: str, limit: int) -> pd.DataFrame:
    """Return rows from the earnings calendar where Reported EPS
    strictly exceeded the analyst estimate.
    """
    cal = yf.Ticker(ticker).get_earnings_dates(limit=limit)
    if cal is None or cal.empty:
        return pd.DataFrame()

    needed = {"Reported EPS", "EPS Estimate"}
    if not needed.issubset(cal.columns):
        return pd.DataFrame()

    cal = cal.dropna(subset=["Reported EPS", "EPS Estimate"])
    return cal[cal["Reported EPS"] > cal["EPS Estimate"]].copy()


def analyze_sell_the_news(
    tickers: Iterable[str],
    limit: int = 15,
) -> pd.DataFrame:
    """Build a per-event DataFrame of initial pops and 3-day fades
    for positive earnings surprises across ``tickers``.
    """
    records: list[dict] = []

    for ticker in tickers:
        try:
            print(f"[{ticker}] fetching earnings calendar...")
            beats = _fetch_beats(ticker, limit=limit)
            if beats.empty:
                print("  no qualifying EPS beats found, skipping.")
                continue

            # Pad the price window so we always have a prior close
            # and at least 3 sessions after the latest earnings event.
            start = (beats.index.min() - pd.Timedelta(days=10)).strftime("%Y-%m-%d")
            end = (beats.index.max() + pd.Timedelta(days=20)).strftime("%Y-%m-%d")

            hist = yf.Ticker(ticker).history(
                start=start, end=end, auto_adjust=False
            )
            if hist.empty:
                print("  no price history returned, skipping.")
                continue

            hist.index = _to_naive_dates(hist.index)

            # Fast lookup of the reaction trading day for any earnings ts.
            trading_days = hist.index

            for ts, row in beats.iterrows():
                # AMC vs BMO aware: shift AMC reports to the next day,
                # then bfill onto the trading-day calendar to skip
                # weekends and exchange holidays automatically.
                edate = _reaction_calendar_date(pd.Timestamp(ts))
                pos = trading_days.get_indexer([edate], method="bfill")[0]
                if pos == -1:
                    continue
                if pos == 0 or pos + 3 >= len(hist):
                    # Need both a previous close and 3 future closes.
                    continue

                prev_close = float(hist["Close"].iloc[pos - 1])
                reaction_open = float(hist["Open"].iloc[pos])
                close_3d = float(hist["Close"].iloc[pos + 3])

                if prev_close <= 0 or reaction_open <= 0:
                    continue

                initial_pop = (reaction_open - prev_close) / prev_close * 100.0
                fade = (close_3d - reaction_open) / reaction_open * 100.0

                records.append(
                    {
                        "Ticker": ticker,
                        "Date": trading_days[pos].date(),
                        "EPS Estimate": round(float(row["EPS Estimate"]), 4),
                        "Reported EPS": round(float(row["Reported EPS"]), 4),
                        "Initial Pop %": round(initial_pop, 2),
                        "Post-Earnings Fade %": round(fade, 2),
                    }
                )

        except Exception as exc:
            # One bad ticker should not torch the whole run.
            print(f"  ! error processing {ticker}: {exc}")
            continue

    df = pd.DataFrame.from_records(records)
    if not df.empty:
        df = df.sort_values(["Ticker", "Date"]).reset_index(drop=True)
    return df


def _print_report(df: pd.DataFrame) -> None:
    if df.empty:
        print("\nNo qualifying earnings beats produced any usable rows.")
        return

    print("\n=== Earnings Beats: Initial Pop vs. 3-Day Fade ===")
    with pd.option_context(
        "display.max_rows", None,
        "display.width", 120,
        "display.float_format", lambda v: f"{v:>8.2f}",
    ):
        print(df.to_string(index=False))

    avg_pop = df["Initial Pop %"].mean()
    avg_fade = df["Post-Earnings Fade %"].mean()
    n = len(df)

    print("\n--- Summary ---")
    print(f"Events analyzed             : {n}")
    print(f"Average initial pop  (Day 0): {avg_pop:+.2f}%")
    print(f"Average 3-day fade   (Day 3): {avg_fade:+.2f}%")

    verdict = (
        "supports 'Sell the News' (mean post-pop drift is negative)"
        if avg_fade < 0
        else "does NOT support 'Sell the News' (mean post-pop drift is positive)"
    )
    print(f"\nVerdict: the data {verdict}.")


def main(argv: list[str]) -> int:
    tickers = argv[1:] if len(argv) > 1 else DEFAULT_TICKERS
    print(f"Universe: {', '.join(tickers)}")
    df = analyze_sell_the_news(tickers, limit=15)
    _print_report(df)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
