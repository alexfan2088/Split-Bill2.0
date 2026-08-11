// 云函数：处理账单更新/删除（跨设备，基于用户名+密码）
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const { deleteUnreferencedAttachments, normalizeAttachmentFileIDs } = require('./attachmentCleanupCore');

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

exports.main = async (event) => {
  const { action } = event || {};

  try {
    if (action === 'deleteBill') {
      const { billId, userName, passwordHash, password } = event;
      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) {
        return { success: false, error: auth.error };
      }

      if (!billId) {
        return { success: false, error: '缺少账单ID' };
      }

      const billDoc = await db.collection('bills').doc(billId).get();
      const bill = billDoc.data;
      if (!bill) {
        return { success: false, error: '账单不存在' };
      }

      if (bill.creator !== userName) {
        return { success: false, error: '只有创建者可以删除' };
      }

      if (bill.relatedRechargeId) {
        try {
          await db.collection('recharges').doc(bill.relatedRechargeId).remove();
        } catch (e) {
          console.error('删除关联充值记录失败:', e);
        }
      }

      await db.collection('bills').doc(billId).remove();
      const attachmentCleanup = await deleteUnreferencedAttachments(db, cloud, bill.attachments);
      return { success: true, attachmentCleanup };
    }

    if (action === 'updateBill') {
      const {
        billId,
        userName,
        passwordHash,
        password,
        billData,
        flags,
        dateStr
      } = event;

      const auth = await verifyUser(userName, passwordHash, password);
      if (!auth.ok) {
        return { success: false, error: auth.error };
      }

      if (!billId || !billData) {
        return { success: false, error: '缺少更新数据' };
      }

      const billDoc = await db.collection('bills').doc(billId).get();
      const currentBill = billDoc.data;
      if (!currentBill) {
        return { success: false, error: '账单不存在' };
      }

      if (currentBill.creator !== userName) {
        return { success: false, error: '只有创建者可以更新' };
      }

      const previousAttachmentIDs = normalizeAttachmentFileIDs(currentBill.attachments);

      const needCreateRecharge = !!(flags && flags.needCreateRecharge);
      const originalPayer = flags ? flags.originalPayer : null;
      const billshow = flags ? flags.billshow : null;
      const existingRelatedRechargeId = flags ? flags.existingRelatedRechargeId : null;
      const isPrepaid = !!(flags && flags.isPrepaid);
      const keeper = flags ? flags.keeper : '';

      let finalRelatedRechargeId = null;
      if (needCreateRecharge) {
        finalRelatedRechargeId = existingRelatedRechargeId || null;
      } else if (existingRelatedRechargeId) {
        finalRelatedRechargeId = null;
      }

      const cleanBillData = {
        activityId: billData.activityId,
        amount: billData.amount,
        title: billData.title,
        billType: billData.billType,
        payer: billData.payer,
        participants: billData.participants,
        splitDetail: billData.splitDetail,
        time: billData.time,
        remark: billData.remark,
        attachments: billData.attachments || [],
        creator: currentBill.creator || userName,
        createdAt: currentBill.createdAt || new Date(),
        updatedAt: new Date(),
        isPayerAutoModified: needCreateRecharge || false,
        originalPayer: needCreateRecharge ? originalPayer : null,
        billshow: billshow || null,
        relatedRechargeId: finalRelatedRechargeId
      };

      await db.collection('bills').doc(billId).set({ data: cleanBillData });
      const nextAttachmentIDs = new Set(normalizeAttachmentFileIDs(cleanBillData.attachments));
      const removedAttachments = previousAttachmentIDs.filter(fileID => !nextAttachmentIDs.has(fileID));
      const attachmentCleanup = await deleteUnreferencedAttachments(db, cloud, removedAttachments);

      let rechargeMessage = '';
      let rechargeAction = 'none';
      let relatedRechargeId = finalRelatedRechargeId;

      if (isPrepaid && keeper) {
        if (needCreateRecharge && originalPayer) {
          const date = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
          if (existingRelatedRechargeId) {
            try {
              await db.collection('recharges').doc(existingRelatedRechargeId).update({
                data: {
                  amount: billData.amount,
                  payer: originalPayer,
                  date: date,
                  updatedAt: new Date()
                }
              });
              rechargeAction = 'updated';
              relatedRechargeId = existingRelatedRechargeId;
              rechargeMessage = `预存模式下，付款人不是保管人员，已同步更新预存记录：${originalPayer} 向 ${keeper} 充值 ¥${billData.amount}`;
            } catch (updateErr) {
              console.error('更新预存记录失败:', updateErr);
              const rechargeResult = await db.collection('recharges').add({
                data: {
                  activityId: billData.activityId,
                  amount: billData.amount,
                  payer: originalPayer,
                  keeper: keeper,
                  recorder: userName,
                  date: date,
                  creator: userName,
                  createdAt: new Date(),
                  isAuto: true
                }
              });
              rechargeAction = 'created';
              relatedRechargeId = rechargeResult._id;
              rechargeMessage = `预存模式下，付款人不是保管人员，已自动创建充值记录：${originalPayer} 向 ${keeper} 充值 ¥${billData.amount}`;
            }
          } else {
            const rechargeResult = await db.collection('recharges').add({
              data: {
                activityId: billData.activityId,
                amount: billData.amount,
                payer: originalPayer,
                keeper: keeper,
                recorder: userName,
                date: date,
                creator: userName,
                createdAt: new Date(),
                isAuto: true
              }
            });
            rechargeAction = 'created';
            relatedRechargeId = rechargeResult._id;
            rechargeMessage = `预存模式下，付款人不是保管人员，已自动创建充值记录：${originalPayer} 向 ${keeper} 充值 ¥${billData.amount}`;
          }

          if (relatedRechargeId && relatedRechargeId !== finalRelatedRechargeId) {
            await db.collection('bills').doc(billId).update({
              data: {
                relatedRechargeId: relatedRechargeId
              }
            });
          }
        } else if (existingRelatedRechargeId) {
          try {
            await db.collection('recharges').doc(existingRelatedRechargeId).remove();
            rechargeAction = 'deleted';
          } catch (deleteErr) {
            console.error('删除预存记录失败:', deleteErr);
          }
        }
      }

      return {
        success: true,
        rechargeAction,
        rechargeMessage,
        relatedRechargeId,
        attachmentCleanup
      };
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
