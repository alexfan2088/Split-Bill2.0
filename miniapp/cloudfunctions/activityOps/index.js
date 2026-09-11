// 云函数：处理活动更新/删除（跨设备，基于用户名+密码）
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const { deleteActivityRecords } = require('./deleteActivityCore');
const { deleteUnreferencedActivityAttachments } = require('./attachmentCleanupCore');
const { getActivityDetail } = require('./getActivityDetailCore');
const { getParentActivityDetail, refreshParentMembers } = require('./parentActivityCore');

// 密码哈希函数（与客户端保持一致）
function hashPassword(password) {
  try {
    const utf8Bytes = [];
    for (let i = 0; i < password.length; i++) {
      const charCode = password.charCodeAt(i);
      if (charCode < 0x80) {
        utf8Bytes.push(charCode);
      } else if (charCode < 0x800) {
        utf8Bytes.push(0xc0 | (charCode >> 6));
        utf8Bytes.push(0x80 | (charCode & 0x3f));
      } else {
        utf8Bytes.push(0xe0 | (charCode >> 12));
        utf8Bytes.push(0x80 | ((charCode >> 6) & 0x3f));
        utf8Bytes.push(0x80 | (charCode & 0x3f));
      }
    }

    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;

    while (i < utf8Bytes.length) {
      const a = utf8Bytes[i++];
      const b = i < utf8Bytes.length ? utf8Bytes[i++] : 0;
      const c = i < utf8Bytes.length ? utf8Bytes[i++] : 0;

      const bitmap = (a << 16) | (b << 8) | c;

      result += base64Chars.charAt((bitmap >> 18) & 63);
      result += base64Chars.charAt((bitmap >> 12) & 63);
      result += i - 2 < utf8Bytes.length ? base64Chars.charAt((bitmap >> 6) & 63) : '=';
      result += i - 1 < utf8Bytes.length ? base64Chars.charAt(bitmap & 63) : '=';
    }

    return result;
  } catch (e) {
    console.error('密码哈希失败:', e);
    return password;
  }
}

async function verifyUser(userName, passwordHash, passwordPlain) {
  if (!userName) {
    return { ok: false, error: '缺少用户名' };
  }

  const userRes = await db.collection('users')
    .where({ name: userName })
    .limit(1)
    .get();

  if (!userRes.data || userRes.data.length === 0) {
    return { ok: false, error: '用户不存在' };
  }

  const user = userRes.data[0];
  const finalHash = passwordHash || (passwordPlain ? hashPassword(passwordPlain) : '');
  if (!finalHash) {
    return { ok: false, error: '缺少密码' };
  }

  if (user.password !== finalHash) {
    return { ok: false, error: '密码错误' };
  }

  return { ok: true, user };
}

function buildRenameMap(originalMemberNames, newMemberNames) {
  const map = {};
  const len = Math.min(originalMemberNames.length, newMemberNames.length);
  for (let i = 0; i < len; i += 1) {
    const oldName = originalMemberNames[i];
    const newName = newMemberNames[i];
    if (oldName && newName && oldName !== newName) {
      map[oldName] = newName;
    }
  }
  return map;
}

function renameKeys(obj, renameMap) {
  const next = {};
  Object.keys(obj || {}).forEach((key) => {
    const newKey = renameMap[key] || key;
    next[newKey] = obj[key];
  });
  return next;
}

function renameMembersInList(members, renameMap) {
  return (members || []).map((m) => {
    if (typeof m === 'string') {
      return renameMap[m] || m;
    }
    const next = { ...m };
    if (next.name && renameMap[next.name]) {
      next.name = renameMap[next.name];
    }
    return next;
  });
}

async function applyRenameMapToActivity(activityId, renameMap, updateData) {
  // 更新 activities
  const actDoc = await db.collection('activities').doc(activityId).get();
  const activity = actDoc.data;
  if (!activity) {
    return { success: false, error: '活动不存在' };
  }

  const nextActivityData = updateData ? { ...updateData } : {};
  const updatedMembers = renameMembersInList(activity.members || [], renameMap);
  const updatedMemberNames = updatedMembers.map(m => (typeof m === 'string' ? m : m.name));

  if (!updateData) {
    nextActivityData.members = updatedMembers;
    nextActivityData.memberNames = updatedMemberNames;
    nextActivityData.updatedAt = new Date();
  } else {
    nextActivityData.members = renameMembersInList(updateData.members || updatedMembers, renameMap);
    nextActivityData.memberNames = (updateData.memberNames || updatedMemberNames).map(n => renameMap[n] || n);
  }

  if (nextActivityData.keeper && renameMap[nextActivityData.keeper]) {
    nextActivityData.keeper = renameMap[nextActivityData.keeper];
  }

  await db.collection('activities').doc(activityId).update({
    data: nextActivityData
  });

  // 更新 group 成员
  const groupRes = await db.collection('groups')
    .where({ activityId })
    .limit(1)
    .get();
  if (groupRes.data && groupRes.data.length > 0) {
    await db.collection('groups').doc(groupRes.data[0]._id).update({
      data: {
        members: renameMembersInList(groupRes.data[0].members || [], renameMap),
        updatedAt: new Date()
      }
    });
  }

  // 更新 bills
  const bills = await fetchAll(db.collection('bills'), { activityId });
  const billUpdates = bills.map((bill) => {
    const next = { ...bill };
    if (next.payer && renameMap[next.payer]) {
      next.payer = renameMap[next.payer];
    }
    if (next.recorder && renameMap[next.recorder]) {
      next.recorder = renameMap[next.recorder];
    }
    if (next.billshow && renameMap[next.billshow]) {
      next.billshow = renameMap[next.billshow];
    }
    if (next.originalPayer && renameMap[next.originalPayer]) {
      next.originalPayer = renameMap[next.originalPayer];
    }
    if (next.participants) {
      next.participants = renameKeys(next.participants, renameMap);
    }
    if (next.splitDetail) {
      next.splitDetail = renameKeys(next.splitDetail, renameMap);
    }
    return db.collection('bills').doc(bill._id).update({
      data: {
        payer: next.payer,
        recorder: next.recorder,
        billshow: next.billshow || null,
        originalPayer: next.originalPayer || null,
        participants: next.participants,
        splitDetail: next.splitDetail
      }
    });
  });
  await Promise.all(billUpdates);

  // 更新 recharges
  const recharges = await fetchAll(db.collection('recharges'), { activityId });
  const rechargeUpdates = recharges.map((r) => {
    const next = { ...r };
    if (next.payer && renameMap[next.payer]) {
      next.payer = renameMap[next.payer];
    }
    if (next.recorder && renameMap[next.recorder]) {
      next.recorder = renameMap[next.recorder];
    }
    if (next.creator && renameMap[next.creator]) {
      next.creator = renameMap[next.creator];
    }
    if (next.keeper && renameMap[next.keeper]) {
      next.keeper = renameMap[next.keeper];
    }

    return db.collection('recharges').doc(r._id).update({
      data: {
        payer: next.payer,
        recorder: next.recorder || null,
        creator: next.creator || null,
        keeper: next.keeper || null
      }
    });
  });
  await Promise.all(rechargeUpdates);

  return { success: true };
}

async function fetchAll(collection, query) {
  const MAX_LIMIT = 100;
  let all = [];
  let skip = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await collection.where(query).skip(skip).limit(MAX_LIMIT).get();
    const data = res.data || [];
    all = all.concat(data);
    if (data.length < MAX_LIMIT) {
      hasMore = false;
    } else {
      skip += MAX_LIMIT;
    }
  }
  return all;
}

async function hasMemberRecords(activityId, memberName) {
  const bills = await fetchAll(db.collection('bills'), { activityId });

  for (const b of bills) {
    const amount = Number(b.amount || 0);
    const splitValue = b.splitDetail && Object.prototype.hasOwnProperty.call(b.splitDetail, memberName)
      ? Number(b.splitDetail[memberName] || 0)
      : 0;
    const participantWeight = b.participants && Object.prototype.hasOwnProperty.call(b.participants, memberName)
      ? Number(b.participants[memberName] || 0)
      : 0;

    if (amount > 0 && (b.payer === memberName || b.billshow === memberName || b.originalPayer === memberName)) {
      return true;
    }
    if (participantWeight > 0) {
      return true;
    }
    if (splitValue > 0) {
      return true;
    }
  }

  const recharges = await fetchAll(db.collection('recharges'), { activityId });
  for (const r of recharges) {
    const amount = Number(r.amount || 0);
    if (amount > 0 && (r.payer === memberName || r.keeper === memberName)) {
      return true;
    }
  }

  return false;
}

exports.main = async (event) => {
  const { action } = event || {};

  try {
    if (action === 'getActivityDetail') {
      const { activityId, userName, passwordHash, password } = event;
      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) {
        return { success: false, error: auth.error };
      }

      return await getActivityDetail(db, activityId, userName);
    }

    if (action === 'getParentActivityDetail') {
      const { activityId, userName, passwordHash, password } = event;
      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) return { success: false, error: auth.error };
      return await getParentActivityDetail(db, activityId, userName);
    }

    if (action === 'refreshParentMembers') {
      const { parentId, userName, passwordHash, password } = event;
      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) return { success: false, error: auth.error };
      const parentDoc = await db.collection('activities').doc(parentId).get();
      if (!parentDoc.data || parentDoc.data.creator !== userName) return { success: false, error: '只有一级活动创建者可以更新成员' };
      return await refreshParentMembers(db, parentId);
    }

    if (action === 'deleteRecharge') {
      const { rechargeId, userName, passwordHash, password } = event;
      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) {
        return { success: false, error: auth.error };
      }
      if (!rechargeId) {
        return { success: false, error: '缺少充值记录ID' };
      }

      const rechargeDoc = await db.collection('recharges').doc(rechargeId).get();
      const recharge = rechargeDoc.data;
      if (!recharge) {
        return { success: false, error: '充值记录不存在' };
      }
      if (recharge.isAuto) {
        return { success: false, error: '自动生成的充值记录不可删除' };
      }
      if (recharge.creator !== userName) {
        return { success: false, error: '只有创建者可以删除' };
      }

      await db.collection('recharges').doc(rechargeId).remove();
      return { success: true };
    }

    if (action === 'updateActivity') {
      const {
        activityId,
        userName,
        passwordHash,
        password,
        updateData,
        originalMemberNames = [],
        newMemberNames = []
      } = event;

      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) {
        return { success: false, error: auth.error };
      }

      if (!activityId || !updateData) {
        return { success: false, error: '缺少更新数据' };
      }

      const actDoc = await db.collection('activities').doc(activityId).get();
      const activity = actDoc.data;
      if (!activity) {
        return { success: false, error: '活动不存在' };
      }
      if (activity.creator !== userName) {
        return { success: false, error: '只有创建者可以更新活动' };
      }

      if (newMemberNames.length < originalMemberNames.length) {
        return { success: false, error: '编辑活动时不能删除参与者' };
      }

      const renameMap = buildRenameMap(originalMemberNames, newMemberNames);

      // 更新活动
      if (Object.keys(renameMap).length > 0) {
        await applyRenameMapToActivity(activityId, renameMap, updateData);
      } else {
        await db.collection('activities').doc(activityId).update({
          data: updateData
        });
        const groupRes = await db.collection('groups')
          .where({ activityId })
          .limit(1)
          .get();
        if (groupRes.data && groupRes.data.length > 0) {
          await db.collection('groups').doc(groupRes.data[0]._id).update({
            data: {
              members: updateData.members,
              updatedAt: new Date()
            }
          });
        }
      }

      if (activity.parentId) await refreshParentMembers(db, activity.parentId);

      return { success: true };
    }

    if (action === 'renameMembersByMap') {
      const { activityId, activityName, userName, passwordHash, password, renameMap } = event;
      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) {
        return { success: false, error: auth.error };
      }

      if (!renameMap || typeof renameMap !== 'object') {
        return { success: false, error: '缺少重命名映射' };
      }

      let targetActivityId = activityId;
      if (!targetActivityId && activityName) {
        const actRes = await db.collection('activities')
          .where({ name: activityName, creator: userName })
          .get();
        const acts = actRes.data || [];
        if (acts.length === 0) {
          return { success: false, error: '未找到活动' };
        }
        if (acts.length > 1) {
          return { success: false, error: '活动名称重复，请提供activityId' };
        }
        targetActivityId = acts[0]._id;
      }

      if (!targetActivityId) {
        return { success: false, error: '缺少活动ID' };
      }

      return await applyRenameMapToActivity(targetActivityId, renameMap);
    }

    if (action === 'deleteMemberIfNoRecords') {
      const { activityId, userName, passwordHash, password, memberName } = event;
      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) {
        return { success: false, error: auth.error };
      }

      if (!activityId || !memberName) {
        return { success: false, error: '缺少活动ID或成员名' };
      }

      const actDoc = await db.collection('activities').doc(activityId).get();
      const activity = actDoc.data;
      if (!activity) {
        return { success: false, error: '活动不存在' };
      }
      if (activity.creator !== userName) {
        return { success: false, error: '只有创建者可以删除成员' };
      }
      if (memberName === activity.creator) {
        return { success: false, error: '创建者不可删除' };
      }
      if (activity.keeper === memberName) {
        return { success: false, error: '该成员是保管人员，请先更换保管人员' };
      }

      const hasRecords = await hasMemberRecords(activityId, memberName);
      if (hasRecords) {
        return { success: false, error: '该成员已有付款或参与记录，不能删除' };
      }

      const updatedMembers = (activity.members || []).filter(m => (typeof m === 'string' ? m : m.name) !== memberName);
      const updatedMemberNames = updatedMembers.map(m => (typeof m === 'string' ? m : m.name));

      await db.collection('activities').doc(activityId).update({
        data: {
          members: updatedMembers,
          memberNames: updatedMemberNames,
          updatedAt: new Date()
        }
      });

      const groupRes = await db.collection('groups')
        .where({ activityId })
        .limit(1)
        .get();
      if (groupRes.data && groupRes.data.length > 0) {
        await db.collection('groups').doc(groupRes.data[0]._id).update({
          data: {
            members: updatedMembers,
            updatedAt: new Date()
          }
        });
      }

      return { success: true };
    }

    if (action === 'deleteActivity') {
      const { activityId, userName, passwordHash, password } = event;
      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) {
        return { success: false, error: auth.error };
      }

      if (!activityId) {
        return { success: false, error: '缺少活动ID' };
      }

      const actDoc = await db.collection('activities').doc(activityId).get();
      const activity = actDoc.data;
      if (!activity) {
        return { success: false, error: '活动不存在' };
      }
      if (activity.creator !== userName) {
        return { success: false, error: '只有创建者可以删除活动' };
      }

      if (activity.isParent) {
        const children = await fetchAll(db, 'activities', { parentId: activityId });
        for (const child of children) {
          await deleteActivityRecords(db, child._id, (bills) => (
            deleteUnreferencedActivityAttachments(db, cloud, bills)
          ));
        }
      }
      await deleteActivityRecords(db, activityId, (bills) => (
        deleteUnreferencedActivityAttachments(db, cloud, bills)
      ));

      if (activity.parentId) await refreshParentMembers(db, activity.parentId);

      return { success: true };
    }

    return { success: false, error: '未知操作' };
  } catch (e) {
    console.error('云函数执行失败:', e);
    return {
      success: false,
      error: e.message || '操作失败',
      errCode: e.errCode,
      errMsg: e.errMsg
    };
  }
};
