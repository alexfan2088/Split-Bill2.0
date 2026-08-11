function normalizeAttachmentFileIDs(attachments) {
  const ids = new Set();
  (Array.isArray(attachments) ? attachments : []).forEach((item) => {
    const fileID = typeof item === 'string' ? item : item && item.fileID;
    if (fileID && typeof fileID === 'string') ids.add(fileID);
  });
  return Array.from(ids);
}

async function findReferencedFileIDs(db, fileIDs) {
  const referenced = new Set();
  try {
    // 逐个查询，兼容 CloudBase 对数组字段的等值匹配。
    for (const fileID of fileIDs) {
      const res = await db.collection('bills').where({ attachments: fileID }).limit(1).get();
      if (res.data && res.data.length) referenced.add(fileID);
    }
    return referenced;
  } catch (error) {
    console.error('检查附件引用失败，跳过文件删除:', error);
    return null;
  }
}

async function deleteFileIDs(cloud, fileIDs) {
  const deleted = [];
  const failed = [];
  // 云存储 deleteFile 单次最多支持 50 个文件。
  for (let i = 0; i < fileIDs.length; i += 50) {
    const batch = fileIDs.slice(i, i + 50);
    try {
      const res = await cloud.deleteFile({ fileList: batch });
      const results = res && res.fileList ? res.fileList : [];
      if (!results.length) {
        deleted.push(...batch);
        continue;
      }
      results.forEach((result, index) => {
        if (result && (result.status === 0 || result.errCode === 0)) deleted.push(batch[index]);
        else failed.push(batch[index]);
      });
    } catch (error) {
      console.error('删除附件文件失败:', error);
      failed.push(...batch);
    }
  }
  return { deleted, failed };
}

async function deleteUnreferencedAttachments(db, cloud, attachments) {
  const fileIDs = normalizeAttachmentFileIDs(attachments);
  if (!fileIDs.length) return { deleted: [], failed: [], skipped: [] };

  const referenced = await findReferencedFileIDs(db, fileIDs);
  if (referenced === null) return { deleted: [], failed: fileIDs, skipped: [] };

  const result = await deleteFileIDs(cloud, fileIDs.filter(fileID => !referenced.has(fileID)));
  return { ...result, skipped: fileIDs.filter(fileID => referenced.has(fileID)) };
}

module.exports = {
  normalizeAttachmentFileIDs,
  deleteUnreferencedAttachments
};
