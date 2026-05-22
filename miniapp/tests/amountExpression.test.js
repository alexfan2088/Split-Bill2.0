const assert = require('assert');
const { computeAmountFromInput, evaluateAmountExpression } = require('../utils/amountExpression');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

test('computeAmountFromInput: equal sign computes formula', () => {
  assert.strictEqual(computeAmountFromInput('300+366='), '666');
  assert.strictEqual(computeAmountFromInput('100+88='), '188');
});

test('computeAmountFromInput: full-width operators compute formula', () => {
  assert.strictEqual(computeAmountFromInput('300＋366＝'), '666');
  assert.strictEqual(computeAmountFromInput('10×2＋5＝'), '25');
});

test('computeAmountFromInput: operator precedence and parentheses', () => {
  assert.strictEqual(computeAmountFromInput('1+2*3='), '7');
  assert.strictEqual(computeAmountFromInput('(1+2)*3='), '9');
  assert.strictEqual(computeAmountFromInput('10/4='), '2.5');
});

test('computeAmountFromInput: plain number is not rewritten', () => {
  assert.strictEqual(computeAmountFromInput('666'), null);
});

test('evaluateAmountExpression: invalid expressions return null', () => {
  assert.strictEqual(evaluateAmountExpression('1/0'), null);
  assert.strictEqual(evaluateAmountExpression('1+'), null);
  assert.strictEqual(evaluateAmountExpression('1..2+3'), null);
});

if (process.exitCode) {
  process.exit(1);
}
