// utils/amountExpression.js

function computeAmountFromInput(input) {
  if (!input) return null;

  const rawInput = String(input);
  const hasEqual = rawInput.includes('=') || rawInput.includes('＝');
  const expr = normalizeAmountExpression(rawInput, hasEqual);
  if (!expr) return null;
  if (!shouldComputeExpression(expr, hasEqual)) return null;

  const result = evaluateAmountExpression(expr);
  if (result === null) return null;
  return formatAmountResult(result);
}

function normalizeAmountExpression(input, hasEqual) {
  const equalIndex = findFirstEqualIndex(input);
  const raw = hasEqual && equalIndex >= 0 ? input.slice(0, equalIndex) : input;
  const expr = raw
    .replace(/[＋]/g, '+')
    .replace(/[－]/g, '-')
    .replace(/[＊×]/g, '*')
    .replace(/[／÷]/g, '/')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[。]/g, '.')
    .replace(/\s+/g, '');

  if (!expr) return '';
  if (!/^[0-9+\-*/().]+$/.test(expr)) return '';
  if (/[+\-*/.]$/.test(expr)) return '';
  return expr;
}

function findFirstEqualIndex(input) {
  const half = input.indexOf('=');
  const full = input.indexOf('＝');
  if (half < 0) return full;
  if (full < 0) return half;
  return Math.min(half, full);
}

function shouldComputeExpression(expr, hasEqual) {
  if (hasEqual) return true;
  if (/^[0-9]*\.?[0-9]+$/.test(expr)) return false;
  const trimmed = expr.replace(/^\-/, '');
  return /[+\-*/]/.test(trimmed);
}

function evaluateAmountExpression(expr) {
  const parser = new ExpressionParser(expr);
  const result = parser.parseExpression();
  if (!parser.isAtEnd()) return null;
  if (typeof result !== 'number' || !Number.isFinite(result)) return null;
  return result;
}

class ExpressionParser {
  constructor(expr) {
    this.expr = expr;
    this.index = 0;
  }

  parseExpression() {
    let value = this.parseTerm();
    if (value === null) return null;

    while (!this.isAtEnd()) {
      const op = this.peek();
      if (op !== '+' && op !== '-') break;
      this.index += 1;
      const right = this.parseTerm();
      if (right === null) return null;
      value = op === '+' ? value + right : value - right;
    }

    return value;
  }

  parseTerm() {
    let value = this.parseFactor();
    if (value === null) return null;

    while (!this.isAtEnd()) {
      const op = this.peek();
      if (op !== '*' && op !== '/') break;
      this.index += 1;
      const right = this.parseFactor();
      if (right === null) return null;
      if (op === '/' && right === 0) return null;
      value = op === '*' ? value * right : value / right;
    }

    return value;
  }

  parseFactor() {
    const ch = this.peek();
    if (ch === '+' || ch === '-') {
      this.index += 1;
      const value = this.parseFactor();
      if (value === null) return null;
      return ch === '-' ? -value : value;
    }

    if (ch === '(') {
      this.index += 1;
      const value = this.parseExpression();
      if (value === null || this.peek() !== ')') return null;
      this.index += 1;
      return value;
    }

    return this.parseNumber();
  }

  parseNumber() {
    const start = this.index;
    let dotCount = 0;

    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === '.') {
        dotCount += 1;
        if (dotCount > 1) return null;
        this.index += 1;
        continue;
      }
      if (!/[0-9]/.test(ch)) break;
      this.index += 1;
    }

    if (start === this.index) return null;
    const raw = this.expr.slice(start, this.index);
    if (raw === '.') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  peek() {
    return this.expr[this.index];
  }

  isAtEnd() {
    return this.index >= this.expr.length;
  }
}

function formatAmountResult(value) {
  const fixed = value.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
}

module.exports = {
  computeAmountFromInput,
  normalizeAmountExpression,
  shouldComputeExpression,
  evaluateAmountExpression,
  formatAmountResult
};
