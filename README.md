# Scientific Calculator

A self-contained scientific calculator built with plain HTML, CSS, and JavaScript — no build step, no dependencies.

## Run it

Just open `index.html` in any modern browser. For example:

```bash
xdg-open index.html      # Linux
open index.html          # macOS
start index.html         # Windows
```

Or serve it with any static HTTP server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Features

- **Arithmetic**: `+`, `−`, `×`, `÷`, parentheses, unary minus, sign toggle (±)
- **Powers & roots**: `xʸ`, `x²`, `√`
- **Logarithms**: `ln` (natural), `log` (base 10)
- **Trigonometry**: `sin`, `cos`, `tan` and their inverses, with **DEG / RAD** toggle
- **Constants**: `π`, `e`
- **Other**: factorial `x!`, percent `%`, scientific notation (`1.5e2`)
- **Live preview** of the result as you type
- **History** of recent calculations — click any entry to reuse its result
- **Full keyboard support**: digits, operators, `(`, `)`, `^`, `!`, `%`, `Enter` to evaluate, `Backspace` to delete, `Esc` to clear

## Implementation notes

The expression engine is a small hand-written tokenizer + recursive-descent parser (no `eval`), so operator precedence and edge cases behave predictably:

- Right-associative exponent: `2^3^2 = 512`
- Standard convention for unary minus and powers: `-2^2 = -4`, `(-2)^2 = 4`
- Domain errors (e.g. `sqrt(-1)`, `asin(2)`, `ln(0)`, division by zero) display `Error` rather than `NaN`/`Infinity`

## Files

- `index.html` — markup and key layout
- `styles.css` — visual styling (dark theme, responsive)
- `calculator.js` — tokenizer, parser, evaluator, UI controller, keyboard handler
