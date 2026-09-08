function getName(member) {
  return typeof member === 'string' ? member : member && member.name;
}

async function fetchAll(db, collectionName, query) {
  const result = [];
  let skip = 0;
  while (true) {
    const res = await db.collection(collectionName).where(query).skip(skip).limit(100).get();
    const batch = res.data || [];
    result.push(...batch);
    if (batch.length < 100) return result;
    skip += 100;
  }
}

async function hydrateMembers(db, activity) {
  const groupRes = await db.collection('groups').where({ activityId: activity._id }).limit(1).get();
  const members = groupRes.data && groupRes.data[0] ? (groupRes.data[0].members || []) : (activity.members || []);
  return { ...activity, members, memberNames: members.map(getName).filter(Boolean) };
}

function getTimestamp(record, field) {
  const value = record[field] || record.createdAt;
  return value && value.getTime ? value.getTime() : new Date(value || 0).getTime();
}

function sortLatestFirst(records, field) {
  return records.sort((a, b) => getTimestamp(b, field) - getTimestamp(a, field));
}

async function getParentActivityDetail(db, parentId, userName) {
  const parentDoc = await db.collection('activities').doc(parentId).get();
  if (!parentDoc.data || !parentDoc.data.isParent) return { success: false, error: '父活动不存在' };
  if (parentDoc.data.creator !== userName) {
    return { success: false, error: '仅父活动创建者可查看父活动' };
  }

  const children = await fetchAll(db, 'activities', { parentId });
  const hydratedChildren = await Promise.all(children.map(child => hydrateMembers(db, child)));
  const parent = await hydrateMembers(db, parentDoc.data);

  const details = await Promise.all(hydratedChildren.map(async child => ({
    activity: child,
    bills: sortLatestFirst(await fetchAll(db, 'bills', { activityId: child._id }), 'time'),
    recharges: child.isPrepaid
      ? sortLatestFirst(await fetchAll(db, 'recharges', { activityId: child._id }), 'date')
      : []
  })));

  return { success: true, activity: parent, children: details };
}

async function refreshParentMembers(db, parentId) {
  const parentDoc = await db.collection('activities').doc(parentId).get();
  if (!parentDoc.data || !parentDoc.data.isParent) return { success: false, error: '父活动不存在' };
  const children = await fetchAll(db, 'activities', { parentId });
  const names = [];
  children.forEach(child => (child.memberNames || (child.members || []).map(getName)).forEach(name => {
    if (name && !names.includes(name)) names.push(name);
  }));
  if (parentDoc.data.creator && !names.includes(parentDoc.data.creator)) names.unshift(parentDoc.data.creator);
  const members = names.map(name => ({ name, active: true }));
  await db.collection('activities').doc(parentId).update({ data: { members, memberNames: names, updatedAt: new Date() } });
  const groupRes = await db.collection('groups').where({ activityId: parentId }).limit(1).get();
  if (groupRes.data && groupRes.data[0]) {
    await db.collection('groups').doc(groupRes.data[0]._id).update({ data: { members, updatedAt: new Date() } });
  }
  return { success: true };
}

module.exports = { getParentActivityDetail, refreshParentMembers, fetchAll };
