(function () {
    'use strict';

    // ---------- State ----------
    const state = {
        expression: '',        // Raw expression in internal syntax (e.g. "sin(30)+2")
        display: '',           // Pretty version shown to user (e.g. "sin(30)+2")
        result: '0',
        justEvaluated: false,
        angleMode: 'DEG',
        history: []
    };

    // ---------- DOM ----------
    const $expression = document.getElementById('expression');
    const $result = document.getElementById('result');
    const $historyList = document.getElementById('history-list');
    const $clearHistory = document.getElementById('clear-history');
    const $degBtn = document.getElementById('deg-btn');
    const $radBtn = document.getElementById('rad-btn');

    // ---------- Display helpers ----------
    function prettify(expr) {
        return expr
            .replace(/\*/g, '×')
            .replace(/\//g, '÷')
            .replace(/-/g, '−')
            .replace(/\bpi\b/g, 'π')
            .replace(/\bsqrt\b/g, '√')
            .replace(/\basin\b/g, 'sin⁻¹')
            .replace(/\bacos\b/g, 'cos⁻¹')
            .replace(/\batan\b/g, 'tan⁻¹')
            .replace(/\^2/g, '²')
            .replace(/\^/g, '^');
    }

    function render() {
        $expression.textContent = prettify(state.expression);
        $result.textContent = state.result;
        $result.classList.toggle('error', state.result === 'Error');
    }

    function renderHistory() {
        $historyList.innerHTML = '';
        // Most recent first
        const items = state.history.slice().reverse();
        for (const item of items) {
            const li = document.createElement('li');
            const expr = document.createElement('span');
            expr.className = 'h-expr';
            expr.textContent = prettify(item.expr);
            const res = document.createElement('span');
            res.className = 'h-res';
            res.textContent = '= ' + item.result;
            li.appendChild(expr);
            li.appendChild(res);
            li.title = 'Click to reuse this result';
            li.addEventListener('click', () => {
                state.expression = item.result;
                state.result = item.result;
                state.justEvaluated = false;
                render();
            });
            $historyList.appendChild(li);
        }
    }

    // ---------- Tokenizer ----------
    // Token types: 'num', 'op' (+ - * / ^), 'lparen', 'rparen',
    // 'func' (sin, cos, ...), 'const' (pi, e), 'comma',
    // 'postfix' (!), 'percent' (%)
    function tokenize(input) {
        const tokens = [];
        let i = 0;
        const funcs = ['asin', 'acos', 'atan', 'sin', 'cos', 'tan', 'sqrt', 'ln', 'log'];
        const consts = { pi: Math.PI, e: Math.E };

        while (i < input.length) {
            const c = input[i];

            if (c === ' ') { i++; continue; }

            if ((c >= '0' && c <= '9') || c === '.') {
                let num = '';
                while (i < input.length && ((input[i] >= '0' && input[i] <= '9') || input[i] === '.')) {
                    num += input[i++];
                }
                // Scientific notation: 1e5 or 1.2e-3
                if (i < input.length && (input[i] === 'e' || input[i] === 'E')) {
                    // Only treat as exponent if followed by digit or sign+digit
                    const peek1 = input[i + 1];
                    const peek2 = input[i + 2];
                    const isExp = (peek1 >= '0' && peek1 <= '9') ||
                        ((peek1 === '+' || peek1 === '-') && peek2 >= '0' && peek2 <= '9');
                    if (isExp) {
                        num += input[i++];
                        if (input[i] === '+' || input[i] === '-') num += input[i++];
                        while (i < input.length && input[i] >= '0' && input[i] <= '9') {
                            num += input[i++];
                        }
                    }
                }
                if (num === '.' || num === '') throw new Error('Invalid number');
                tokens.push({ type: 'num', value: parseFloat(num) });
                continue;
            }

            if (/[a-zA-Z]/.test(c)) {
                let word = '';
                while (i < input.length && /[a-zA-Z]/.test(input[i])) {
                    word += input[i++];
                }
                const lower = word.toLowerCase();
                if (funcs.includes(lower)) {
                    tokens.push({ type: 'func', value: lower });
                } else if (lower in consts) {
                    tokens.push({ type: 'num', value: consts[lower] });
                } else {
                    throw new Error('Unknown identifier: ' + word);
                }
                continue;
            }

            if ('+-*/^'.includes(c)) {
                tokens.push({ type: 'op', value: c });
                i++; continue;
            }
            if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
            if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
            if (c === '!') { tokens.push({ type: 'postfix', value: '!' }); i++; continue; }
            if (c === '%') { tokens.push({ type: 'percent' }); i++; continue; }

            throw new Error('Unexpected character: ' + c);
        }

        return tokens;
    }

    // ---------- Parser / Evaluator (recursive descent) ----------
    // Grammar (precedence low to high):
    //   expr     := term (('+'|'-') term)*
    //   term     := unary (('*'|'/') unary)*
    //   unary    := ('+'|'-') unary | power
    //   power    := postfix ('^' unary)?           (right-associative; RHS allows unary minus)
    //   postfix  := primary ('!' | '%')*
    //   primary  := number | func '(' expr ')' | '(' expr ')'
    // With this layering, `-2^2` parses as `-(2^2) = -4`, matching standard math convention.
    function parse(tokens) {
        let pos = 0;

        function peek() { return tokens[pos]; }
        function consume(type, value) {
            const t = tokens[pos];
            if (!t || t.type !== type || (value !== undefined && t.value !== value)) {
                throw new Error('Syntax error');
            }
            pos++;
            return t;
        }

        function parseExpr() {
            let left = parseTerm();
            while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
                const op = tokens[pos++].value;
                const right = parseTerm();
                left = op === '+' ? left + right : left - right;
            }
            return left;
        }

        function parseTerm() {
            let left = parseUnary();
            while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
                const op = tokens[pos++].value;
                const right = parseUnary();
                if (op === '*') left = left * right;
                else {
                    if (right === 0) throw new Error('Division by zero');
                    left = left / right;
                }
            }
            return left;
        }

        function parseUnary() {
            if (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
                const sign = tokens[pos++].value;
                const v = parseUnary();
                return sign === '-' ? -v : v;
            }
            return parsePower();
        }

        function parsePower() {
            const base = parsePostfix();
            if (peek() && peek().type === 'op' && peek().value === '^') {
                pos++;
                const exp = parseUnary();
                return Math.pow(base, exp);
            }
            return base;
        }

        function parsePostfix() {
            let v = parsePrimary();
            while (peek() && (peek().type === 'postfix' || peek().type === 'percent')) {
                const t = tokens[pos++];
                if (t.type === 'postfix' && t.value === '!') {
                    v = factorial(v);
                } else if (t.type === 'percent') {
                    v = v / 100;
                }
            }
            return v;
        }

        function parsePrimary() {
            const t = peek();
            if (!t) throw new Error('Unexpected end of expression');
            if (t.type === 'num') { pos++; return t.value; }
            if (t.type === 'lparen') {
                pos++;
                const v = parseExpr();
                consume('rparen');
                return v;
            }
            if (t.type === 'func') {
                pos++;
                consume('lparen');
                const arg = parseExpr();
                consume('rparen');
                return applyFunction(t.value, arg);
            }
            throw new Error('Unexpected token');
        }

        const value = parseExpr();
        if (pos !== tokens.length) throw new Error('Unexpected trailing input');
        return value;
    }

    function factorial(n) {
        if (n < 0 || !Number.isFinite(n)) throw new Error('Invalid factorial');
        if (Math.abs(n - Math.round(n)) > 1e-12) throw new Error('Factorial requires integer');
        n = Math.round(n);
        if (n > 170) throw new Error('Factorial too large');
        let r = 1;
        for (let k = 2; k <= n; k++) r *= k;
        return r;
    }

    function toRadians(x) { return x * Math.PI / 180; }
    function fromRadians(x) { return x * 180 / Math.PI; }

    function applyFunction(name, x) {
        switch (name) {
            case 'sin': return Math.sin(state.angleMode === 'DEG' ? toRadians(x) : x);
            case 'cos': return Math.cos(state.angleMode === 'DEG' ? toRadians(x) : x);
            case 'tan': return Math.tan(state.angleMode === 'DEG' ? toRadians(x) : x);
            case 'asin': {
                if (x < -1 || x > 1) throw new Error('Domain error');
                const r = Math.asin(x);
                return state.angleMode === 'DEG' ? fromRadians(r) : r;
            }
            case 'acos': {
                if (x < -1 || x > 1) throw new Error('Domain error');
                const r = Math.acos(x);
                return state.angleMode === 'DEG' ? fromRadians(r) : r;
            }
            case 'atan': {
                const r = Math.atan(x);
                return state.angleMode === 'DEG' ? fromRadians(r) : r;
            }
            case 'sqrt':
                if (x < 0) throw new Error('Domain error');
                return Math.sqrt(x);
            case 'ln':
                if (x <= 0) throw new Error('Domain error');
                return Math.log(x);
            case 'log':
                if (x <= 0) throw new Error('Domain error');
                return Math.log10(x);
        }
        throw new Error('Unknown function: ' + name);
    }

    // ---------- Number formatting ----------
    function formatResult(n) {
        if (!Number.isFinite(n)) return 'Error';
        // Treat tiny floating-point noise as zero
        if (Math.abs(n) < 1e-12) n = 0;
        // Use exponential for very small/large
        if (n !== 0 && (Math.abs(n) >= 1e15 || Math.abs(n) < 1e-9)) {
            return n.toExponential(8).replace(/\.?0+e/, 'e');
        }
        // Up to 12 significant digits, trim trailing zeros
        let s = parseFloat(n.toPrecision(12)).toString();
        return s;
    }

    // ---------- Input handling ----------
    function appendToExpression(text) {
        if (state.justEvaluated) {
            // If next input is operator, continue from result; otherwise start fresh
            const startsWithOp = /^[+\-*/^!%)]/.test(text) || text === '^2';
            if (startsWithOp) {
                state.expression = state.result === 'Error' ? '' : state.result;
            } else {
                state.expression = '';
            }
            state.justEvaluated = false;
        }
        state.expression += text;
    }

    function handleAction(action, value) {
        switch (action) {
            case 'digit':
                appendToExpression(value);
                break;
            case 'literal':
                appendToExpression(value);
                break;
            case 'func':
                appendToExpression(value);
                break;
            case 'op':
                handleOp(value);
                break;
            case 'clear':
                state.expression = '';
                state.result = '0';
                state.justEvaluated = false;
                break;
            case 'delete':
                if (state.justEvaluated) {
                    state.expression = '';
                    state.result = '0';
                    state.justEvaluated = false;
                } else {
                    state.expression = state.expression.slice(0, -1);
                }
                break;
            case 'equals':
                evaluate();
                break;
        }
        livePreview();
        render();
    }

    function handleOp(op) {
        if (op === '+/-') {
            toggleSign();
            return;
        }
        if (op === '^2') {
            if (state.justEvaluated) {
                state.expression = state.result === 'Error' ? '' : state.result;
                state.justEvaluated = false;
            }
            state.expression += '^2';
            return;
        }
        // Standard infix or postfix
        if (state.justEvaluated) {
            state.expression = state.result === 'Error' ? '' : state.result;
            state.justEvaluated = false;
        }
        // Replace a trailing operator with the new one (except after '(' or empty for unary -)
        const last = state.expression.slice(-1);
        const isInfix = '+-*/^'.includes(op);
        if (isInfix && '+-*/^'.includes(last)) {
            state.expression = state.expression.slice(0, -1) + op;
        } else {
            state.expression += op;
        }
    }

    function toggleSign() {
        // Toggle sign of the last numeric/parenthesized literal in the expression
        const expr = state.expression;
        if (!expr) {
            state.expression = '-';
            return;
        }
        // Find the start of the last token
        let i = expr.length - 1;
        // If trailing ')', treat as group; find matching '('
        if (expr[i] === ')') {
            let depth = 0;
            while (i >= 0) {
                if (expr[i] === ')') depth++;
                else if (expr[i] === '(') {
                    depth--;
                    if (depth === 0) break;
                }
                i--;
            }
        } else {
            // Find start of number/identifier
            while (i > 0 && /[0-9a-zA-Z.]/.test(expr[i - 1])) i--;
        }
        const before = expr.slice(0, i);
        const tail = expr.slice(i);
        // If immediately preceded by '-', remove it (toggle off);
        // if preceded by '+', flip to '-'; otherwise insert '-'
        if (before.endsWith('-') && (before.length === 1 || /[+\-*/^(]/.test(before[before.length - 2]))) {
            state.expression = before.slice(0, -1) + tail;
        } else if (before.endsWith('+') && (before.length === 1 || /[+\-*/^(]/.test(before[before.length - 2]))) {
            state.expression = before.slice(0, -1) + '-' + tail;
        } else {
            state.expression = before + '(-' + tail + ')';
        }
    }

    function livePreview() {
        if (state.justEvaluated || !state.expression) return;
        try {
            const tokens = tokenize(state.expression);
            // Auto-close unmatched parens for preview only
            let depth = 0;
            for (const t of tokens) {
                if (t.type === 'lparen') depth++;
                else if (t.type === 'rparen') depth--;
            }
            const previewTokens = tokens.slice();
            while (depth-- > 0) previewTokens.push({ type: 'rparen' });
            const v = parse(previewTokens);
            const formatted = formatResult(v);
            if (formatted !== 'Error') state.result = formatted;
        } catch (_) {
            // Silent during incremental input
        }
    }

    function evaluate() {
        if (!state.expression) return;
        try {
            const tokens = tokenize(state.expression);
            const v = parse(tokens);
            const formatted = formatResult(v);
            if (formatted === 'Error') {
                state.result = 'Error';
            } else {
                state.history.push({ expr: state.expression, result: formatted });
                if (state.history.length > 50) state.history.shift();
                renderHistory();
                state.result = formatted;
            }
        } catch (e) {
            state.result = 'Error';
        }
        state.justEvaluated = true;
    }

    // ---------- Wire up keys ----------
    document.querySelectorAll('.key').forEach((btn) => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const value = btn.dataset.value;
            handleAction(action, value);
        });
    });

    $degBtn.addEventListener('click', () => setAngleMode('DEG'));
    $radBtn.addEventListener('click', () => setAngleMode('RAD'));
    $clearHistory.addEventListener('click', () => {
        state.history = [];
        renderHistory();
    });

    function setAngleMode(mode) {
        state.angleMode = mode;
        $degBtn.classList.toggle('active', mode === 'DEG');
        $radBtn.classList.toggle('active', mode === 'RAD');
        $degBtn.setAttribute('aria-pressed', mode === 'DEG');
        $radBtn.setAttribute('aria-pressed', mode === 'RAD');
        livePreview();
        render();
    }

    // ---------- Keyboard support ----------
    const keyMap = {
        '0': { action: 'digit', value: '0' },
        '1': { action: 'digit', value: '1' },
        '2': { action: 'digit', value: '2' },
        '3': { action: 'digit', value: '3' },
        '4': { action: 'digit', value: '4' },
        '5': { action: 'digit', value: '5' },
        '6': { action: 'digit', value: '6' },
        '7': { action: 'digit', value: '7' },
        '8': { action: 'digit', value: '8' },
        '9': { action: 'digit', value: '9' },
        '.': { action: 'literal', value: '.' },
        '(': { action: 'literal', value: '(' },
        ')': { action: 'literal', value: ')' },
        '+': { action: 'op', value: '+' },
        '-': { action: 'op', value: '-' },
        '*': { action: 'op', value: '*' },
        '/': { action: 'op', value: '/' },
        '^': { action: 'op', value: '^' },
        '!': { action: 'op', value: '!' },
        '%': { action: 'op', value: '%' }
    };

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        if (k === 'Enter' || k === '=') {
            e.preventDefault();
            flashKeyByAction('equals');
            handleAction('equals');
            return;
        }
        if (k === 'Backspace') {
            e.preventDefault();
            flashKeyByAction('delete');
            handleAction('delete');
            return;
        }
        if (k === 'Escape') {
            e.preventDefault();
            flashKeyByAction('clear');
            handleAction('clear');
            return;
        }
        if (keyMap[k]) {
            e.preventDefault();
            flashKeyByValue(keyMap[k].value);
            handleAction(keyMap[k].action, keyMap[k].value);
        }
    });

    function flashKeyByAction(action) {
        const btn = document.querySelector(`.key[data-action="${action}"]`);
        flash(btn);
    }
    function flashKeyByValue(value) {
        const btn = document.querySelector(`.key[data-value="${CSS.escape(value)}"]`);
        flash(btn);
    }
    function flash(btn) {
        if (!btn) return;
        btn.classList.add('pressed');
        setTimeout(() => btn.classList.remove('pressed'), 120);
    }

    // ---------- Init ----------
    renderHistory();
    render();
})();
