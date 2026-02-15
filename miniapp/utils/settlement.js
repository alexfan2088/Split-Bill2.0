// utils/settlement.js

function calcBalances(members, bills, recharges = [], keeper = '') {
  const map = {};
  members.forEach(m => {
    map[m.name] = { paid: 0, shouldPay: 0, balance: 0 };
  });

  if (recharges.length > 0 && keeper) {
    // 1. 预存人的实付 = 充值金额（排除保管人给自己充值）
    recharges.forEach(r => {
      const amount = Number(r.amount || 0);
      const payer = r.payer;
      if (payer && map[payer] && payer !== keeper) {
        map[payer].paid += amount;
      }
    });

    // 2. 保管人的实付 = 账单付款金额
    bills.forEach(b => {
      const amount = Number(b.amount || 0);
      const billPayer = b.payer;
      if (billPayer && map[billPayer]) {
        map[billPayer].paid += amount;
      }
    });

    // 3. 保管人的应付 = 收到的充值金额总和
    let keeperRechargeTotal = 0;
    recharges.forEach(r => {
      const amount = Number(r.amount || 0);
      if (r.keeper === keeper) {
        keeperRechargeTotal += amount;
      }
    });
    if (map[keeper]) {
      map[keeper].shouldPay = keeperRechargeTotal;
    }

    // 4. 其他成员的应付按账单分摊计算（不包括保管人）
    bills.forEach(b => {
      if (b.splitDetail) {
        Object.keys(b.splitDetail).forEach(name => {
          if (!map[name] || name === keeper) return;
          if (b.participants && b.participants[name] > 0) {
            map[name].shouldPay += Number(b.splitDetail[name] || 0);
          }
        });
      }
    });
  } else {
    // 非预存活动
    bills.forEach(b => {
      const amount = Number(b.amount || 0);
      if (b.payer && map[b.payer]) {
        map[b.payer].paid += amount;
      }
    });

    bills.forEach(b => {
      if (b.splitDetail) {
        Object.keys(b.splitDetail).forEach(name => {
          if (!map[name]) return;
          if (b.participants && b.participants[name] > 0) {
            map[name].shouldPay += Number(b.splitDetail[name] || 0);
          }
        });
      }
    });
  }

  Object.keys(map).forEach(name => {
    const v = map[name];
    if (keeper && name === keeper) {
      v.balance = v.shouldPay - v.paid;
    } else {
      v.balance = v.paid - v.shouldPay;
    }
  });

  return map;
}

function computeMemberTotals({
  memberName,
  isPrepaid,
  keeper,
  rawRecharges = [],
  memberBills = [],
  memberPaidBills = []
}) {
  let incomeTotal = 0;
  if (isPrepaid && memberName === keeper) {
    rawRecharges.forEach(r => {
      const amount = Number(r.amount || 0);
      if (r.keeper === keeper) {
        incomeTotal += amount;
      }
    });
  } else {
    incomeTotal = memberBills.reduce((sum, bill) => {
      const amount = Number(bill.userAmount || 0);
      return sum + amount;
    }, 0);
  }

  let expenseTotal = 0;
  if (isPrepaid && memberName === keeper) {
    expenseTotal = memberPaidBills.reduce((sum, bill) => {
      const amount = Number(bill.totalAmount || 0);
      return sum + amount;
    }, 0);
  } else if (isPrepaid) {
    rawRecharges.forEach(r => {
      const amount = Number(r.amount || 0);
      if (r.payer === memberName) {
        expenseTotal += amount;
      }
    });
  } else {
    expenseTotal = memberPaidBills.reduce((sum, bill) => {
      const amount = Number(bill.totalAmount || 0);
      return sum + amount;
    }, 0);
  }

  const balance = (isPrepaid && memberName === keeper)
    ? (incomeTotal - expenseTotal)
    : (expenseTotal - incomeTotal);

  return { incomeTotal, expenseTotal, balance };
}

module.exports = {
  calcBalances,
  computeMemberTotals
};
