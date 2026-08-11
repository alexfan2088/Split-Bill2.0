function collectAttachmentFileIDs(bills) {
  const ids = new Set();
  (bills || []).forEach((bill) => {
    (Array.isArray(bill.attachments) ? bill.attachments : []).forEach((item) => {
      const fileID = typeof item === 'string' ? item : item && item.fileID;
      if (fileID && typeof fileID === 'string') ids.add(fileID);
    });
  });
  return Array.from(ids);
}

async function deleteUnreferencedActivityAttachments(db, cloud, bills) {
  const candidates = collectAttachmentFileIDs(bills);
  const fileIDs = [];

  // 活动内账单已删，仍需确认该文件未被别的账单共用，才允许回收。
  for (const fileID of candidates) {
    try {
      const res = await db.collection('bills').where({ attachments: fileID }).limit(1).get();
      if (!res.data || !res.data.length) fileIDs.push(fileID);
    } catch (error) {
      console.error('检查活动附件引用失败，跳过文件:', error);
    }
  }

  const failed = [];
  for (let i = 0; i < fileIDs.length; i += 50) {
    const batch = fileIDs.slice(i, i + 50);
    try {
      await cloud.deleteFile({ fileList: batch });
    } catch (error) {
      console.error('删除活动附件失败:', error);
      failed.push(...batch);
    }
  }
  return { deleted: fileIDs.length - failed.length, failed: failed.length };
}

module.exports = { deleteUnreferencedActivityAttachments };
