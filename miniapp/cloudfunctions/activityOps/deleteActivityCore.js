const DEFAULT_LIMIT = 100;

async function fetchAll(collection, query, limit = DEFAULT_LIMIT) {
  let all = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await collection.where(query).skip(skip).limit(limit).get();
    const data = res.data || [];
    all = all.concat(data);

    if (data.length < limit) {
      hasMore = false;
    } else {
      skip += limit;
    }
  }

  return all;
}

async function deleteManyByActivityId(db, collectionName, activityId, onRecordsDeleted) {
  const records = await fetchAll(db.collection(collectionName), { activityId });
  if (records.length === 0) {
    return 0;
  }

  await Promise.all(records.map(record => (
    db.collection(collectionName).doc(record._id).remove()
  )));

  if (onRecordsDeleted) await onRecordsDeleted(records);

  return records.length;
}

async function deleteActivityRecords(db, activityId, onBillsDeleted) {
  const deletedBills = await deleteManyByActivityId(db, 'bills', activityId, onBillsDeleted);
  const deletedRecharges = await deleteManyByActivityId(db, 'recharges', activityId);
  const deletedGroups = await deleteManyByActivityId(db, 'groups', activityId);

  await db.collection('activities').doc(activityId).remove();

  return {
    deletedBills,
    deletedRecharges,
    deletedGroups
  };
}

module.exports = {
  fetchAll,
  deleteManyByActivityId,
  deleteActivityRecords
};
