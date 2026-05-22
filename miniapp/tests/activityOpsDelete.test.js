const assert = require('assert');
const { deleteActivityRecords } = require('../cloudfunctions/activityOps/deleteActivityCore');

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((e) => {
      console.error(`fail - ${name}`);
      console.error(e);
      process.exitCode = 1;
    });
}

function makeRecords(prefix, count, activityId) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `${prefix}-${index + 1}`,
    activityId
  }));
}

function createFakeDb(seed) {
  const data = {};
  Object.keys(seed).forEach((name) => {
    data[name] = seed[name].map(record => ({ ...record }));
  });

  return {
    data,
    collection(name) {
      return {
        where(query) {
          const matched = (data[name] || []).filter(record => (
            Object.keys(query).every(key => record[key] === query[key])
          ));
          let skipValue = 0;
          let limitValue = matched.length;

          return {
            skip(value) {
              skipValue = value;
              return this;
            },
            limit(value) {
              limitValue = value;
              return this;
            },
            async get() {
              return {
                data: matched.slice(skipValue, skipValue + limitValue)
              };
            }
          };
        },
        doc(id) {
          return {
            async remove() {
              data[name] = (data[name] || []).filter(record => record._id !== id);
            }
          };
        }
      };
    }
  };
}

test('deleteActivityRecords deletes bills, recharges, groups, and activity with pagination', async () => {
  const activityId = 'activity-1';
  const otherActivityId = 'activity-2';
  const fakeDb = createFakeDb({
    activities: [
      { _id: activityId },
      { _id: otherActivityId }
    ],
    bills: [
      ...makeRecords('bill', 125, activityId),
      ...makeRecords('other-bill', 3, otherActivityId)
    ],
    recharges: [
      ...makeRecords('recharge', 115, activityId),
      ...makeRecords('other-recharge', 2, otherActivityId)
    ],
    groups: [
      ...makeRecords('group', 101, activityId),
      ...makeRecords('other-group', 1, otherActivityId)
    ]
  });

  const result = await deleteActivityRecords(fakeDb, activityId);

  assert.deepStrictEqual(result, {
    deletedBills: 125,
    deletedRecharges: 115,
    deletedGroups: 101
  });
  assert.strictEqual(fakeDb.data.activities.some(record => record._id === activityId), false);
  assert.strictEqual(fakeDb.data.activities.some(record => record._id === otherActivityId), true);
  assert.strictEqual(fakeDb.data.bills.length, 3);
  assert.strictEqual(fakeDb.data.recharges.length, 2);
  assert.strictEqual(fakeDb.data.groups.length, 1);
});
