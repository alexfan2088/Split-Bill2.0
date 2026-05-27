const assert = require('assert');
const { getActivityDetail } = require('../cloudfunctions/activityOps/getActivityDetailCore');

function createFakeDb(seed) {
  return {
    collection(name) {
      const records = seed[name] || [];
      return {
        doc(id) {
          return {
            async get() {
              return { data: records.find(record => record._id === id) };
            }
          };
        },
        where(query) {
          const matched = records.filter(record => (
            Object.keys(query).every(key => record[key] === query[key])
          ));
          let skip = 0;
          let limit = matched.length;
          return {
            skip(value) {
              skip = value;
              return this;
            },
            limit(value) {
              limit = value;
              return this;
            },
            async get() {
              return { data: matched.slice(skip, skip + limit) };
            }
          };
        }
      };
    }
  };
}

async function run() {
  const activityId = 'activity-1';
  const db = createFakeDb({
    activities: [{ _id: activityId, creator: 'owner', isPrepaid: true, members: [{ name: 'old' }] }],
    groups: [{ activityId, members: [{ name: 'owner' }, { name: 'member' }] }],
    bills: Array.from({ length: 115 }, (_, index) => ({
      _id: `bill-${index}`,
      activityId,
      time: new Date(2026, 0, index + 1)
    })),
    recharges: [
      { _id: 'older', activityId, date: new Date('2026-01-01') },
      { _id: 'newer', activityId, date: new Date('2026-02-01') }
    ]
  });

  const result = await getActivityDetail(db, activityId, 'member');
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.activity.memberNames, ['owner', 'member']);
  assert.strictEqual(result.bills.length, 115);
  assert.strictEqual(result.bills[0]._id, 'bill-114');
  assert.deepStrictEqual(result.recharges.map(record => record._id), ['newer', 'older']);

  const denied = await getActivityDetail(db, activityId, 'outside');
  assert.deepStrictEqual(denied, { success: false, error: '无权查看该活动' });
  console.log('ok - activity detail aggregates paged records and enforces membership');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
