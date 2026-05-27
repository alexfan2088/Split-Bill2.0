function getMemberName(member) {
  return typeof member === 'string' ? member : member && member.name;
}

function canViewActivity(activity, userName) {
  if (!activity || !userName) {
    return false;
  }
  if (activity.creator === userName) {
    return true;
  }
  if ((activity.memberNames || []).includes(userName)) {
    return true;
  }
  return (activity.members || []).some(member => getMemberName(member) === userName);
}

async function fetchAll(db, collectionName, query) {
  const limit = 100;
  const records = [];
  let skip = 0;

  while (true) {
    const res = await db.collection(collectionName)
      .where(query)
      .skip(skip)
      .limit(limit)
      .get();
    const batch = res.data || [];
    records.push(...batch);
    if (batch.length < limit) {
      return records;
    }
    skip += limit;
  }
}

function timestamp(record, primaryField) {
  const raw = record[primaryField] || record.createdAt;
  if (!raw) {
    return 0;
  }
  return raw.getTime ? raw.getTime() : new Date(raw).getTime();
}

function sortLatestFirst(records, primaryField) {
  return records.sort((a, b) => timestamp(b, primaryField) - timestamp(a, primaryField));
}

async function getActivityDetail(db, activityId, userName) {
  if (!activityId) {
    return { success: false, error: '缺少活动ID' };
  }

  const activityDoc = await db.collection('activities').doc(activityId).get();
  if (!activityDoc.data) {
    return { success: false, error: '活动不存在' };
  }

  const activity = { ...activityDoc.data };
  const groupRes = await db.collection('groups')
    .where({ activityId })
    .limit(1)
    .get();
  if (groupRes.data && groupRes.data.length > 0) {
    activity.members = groupRes.data[0].members || [];
    activity.memberNames = activity.members.map(getMemberName).filter(Boolean);
  }

  if (!canViewActivity(activity, userName)) {
    return { success: false, error: '无权查看该活动' };
  }

  const [bills, recharges] = await Promise.all([
    fetchAll(db, 'bills', { activityId }),
    activity.isPrepaid ? fetchAll(db, 'recharges', { activityId }) : Promise.resolve([])
  ]);

  return {
    success: true,
    activity,
    bills: sortLatestFirst(bills, 'time'),
    recharges: sortLatestFirst(recharges, 'date')
  };
}

module.exports = {
  canViewActivity,
  getActivityDetail,
  sortLatestFirst
};
