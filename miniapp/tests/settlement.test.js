const assert = require('assert');
const { calcBalances, computeMemberTotals } = require('../utils/settlement');

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

test('calcBalances: keeper is also a payer (self recharge)', () => {
  const members = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  const keeper = 'A';
  const recharges = [
    { payer: 'A', keeper: 'A', amount: 100 },
    { payer: 'B', keeper: 'A', amount: 50 }
  ];
  const bills = [
    {
      amount: 120,
      payer: 'A',
      participants: { A: 1, B: 1, C: 1 },
      splitDetail: { A: 40, B: 40, C: 40 }
    },
    {
      amount: 30,
      payer: 'A',
      participants: { A: 1, B: 1, C: 1 },
      splitDetail: { A: 10, B: 10, C: 10 }
    }
  ];

  const balances = calcBalances(members, bills, recharges, keeper);
  assert.deepStrictEqual(balances.A, { paid: 150, shouldPay: 150, balance: 0 });
  assert.deepStrictEqual(balances.B, { paid: 50, shouldPay: 50, balance: 0 });
  assert.deepStrictEqual(balances.C, { paid: 0, shouldPay: 50, balance: -50 });
});

test('computeMemberTotals: keeper totals in prepaid', () => {
  const totals = computeMemberTotals({
    memberName: 'A',
    isPrepaid: true,
    keeper: 'A',
    rawRecharges: [
      { payer: 'A', keeper: 'A', amount: 100 },
      { payer: 'B', keeper: 'A', amount: 50 }
    ],
    memberBills: [],
    memberPaidBills: [
      { totalAmount: '120' },
      { totalAmount: '30' }
    ]
  });

  assert.strictEqual(totals.incomeTotal, 150);
  assert.strictEqual(totals.expenseTotal, 150);
  assert.strictEqual(totals.balance, 0);
});

test('computeMemberTotals: non-keeper prepaid member', () => {
  const totals = computeMemberTotals({
    memberName: 'B',
    isPrepaid: true,
    keeper: 'A',
    rawRecharges: [
      { payer: 'A', keeper: 'A', amount: 100 },
      { payer: 'B', keeper: 'A', amount: 50 }
    ],
    memberBills: [
      { userAmount: '50' }
    ],
    memberPaidBills: []
  });

  assert.strictEqual(totals.incomeTotal, 50);
  assert.strictEqual(totals.expenseTotal, 50);
  assert.strictEqual(totals.balance, 0);
});

test('computeMemberTotals: non-prepaid', () => {
  const totals = computeMemberTotals({
    memberName: 'D',
    isPrepaid: false,
    keeper: '',
    rawRecharges: [],
    memberBills: [
      { userAmount: '20' },
      { userAmount: '30' }
    ],
    memberPaidBills: [
      { totalAmount: '10' }
    ]
  });

  assert.strictEqual(totals.incomeTotal, 50);
  assert.strictEqual(totals.expenseTotal, 10);
  assert.strictEqual(totals.balance, -40);
});

if (process.exitCode) {
  process.exit(1);
}
