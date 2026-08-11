const assert = require('assert');
const {
  normalizeAttachmentFileIDs,
  deleteUnreferencedAttachments
} = require('../cloudfunctions/billOps/attachmentCleanupCore');

function test(name, fn) {
  Promise.resolve().then(fn).then(() => {
    console.log(`ok - ${name}`);
  }).catch((error) => {
    console.error(`not ok - ${name}`);
    throw error;
  });
}

test('normalizes legacy and object attachment values without duplicates', () => {
  assert.deepStrictEqual(
    normalizeAttachmentFileIDs(['cloud://a', { fileID: 'cloud://b' }, 'cloud://a', null]),
    ['cloud://a', 'cloud://b']
  );
});

test('only deletes attachments no longer referenced by any bill', async () => {
  const deletedBatches = [];
  const fakeDb = {
    collection: () => ({
      where: ({ attachments }) => ({
        limit: () => ({
          get: async () => ({ data: attachments === 'cloud://shared' ? [{ _id: 'other-bill' }] : [] })
        })
      })
    })
  };
  const fakeCloud = {
    deleteFile: async ({ fileList }) => {
      deletedBatches.push(fileList);
      return { fileList: fileList.map(() => ({ status: 0 })) };
    }
  };

  const result = await deleteUnreferencedAttachments(
    fakeDb,
    fakeCloud,
    ['cloud://orphan', 'cloud://shared']
  );

  assert.deepStrictEqual(deletedBatches, [['cloud://orphan']]);
  assert.deepStrictEqual(result.deleted, ['cloud://orphan']);
  assert.deepStrictEqual(result.skipped, ['cloud://shared']);
});
