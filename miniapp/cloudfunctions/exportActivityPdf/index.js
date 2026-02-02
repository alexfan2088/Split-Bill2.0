const cloud = require('wx-server-sdk');
const { PDFDocument } = require('pdf-lib');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { imageBase64, fileID, fileType, files } = event || {};
  if (!imageBase64 && !fileID && (!files || files.length === 0)) {
    return { success: false, error: 'missing image data' };
  }

  try {
    const pdfDoc = await PDFDocument.create();

    const imageItems = (files && files.length > 0)
      ? files
      : [{ fileID, fileType, imageBase64 }];

    console.log('[PDF] pages:', imageItems.length);
    for (const item of imageItems) {
      let imageBuffer;
      let resolvedType = (item.fileType || '').toLowerCase();

      if (item.fileID) {
        const downloadRes = await cloud.downloadFile({ fileID: item.fileID });
        if (!downloadRes || !downloadRes.fileContent) {
          return { success: false, error: 'download file content failed' };
        }
        imageBuffer = downloadRes.fileContent;
        try {
          await cloud.deleteFile({ fileList: [item.fileID] });
        } catch (e) {
          // ignore cleanup failures
        }
      } else {
        imageBuffer = Buffer.from(item.imageBase64, 'base64');
        if (!resolvedType) resolvedType = 'png';
      }

      let embeddedImage;
      if (resolvedType === 'jpg' || resolvedType === 'jpeg') {
        embeddedImage = await pdfDoc.embedJpg(imageBuffer);
      } else {
        embeddedImage = await pdfDoc.embedPng(imageBuffer);
      }
      const { width, height } = embeddedImage.scale(1);
      const page = pdfDoc.addPage([width, height]);
      page.drawImage(embeddedImage, { x: 0, y: 0, width, height });
    }

    const pdfBytes = await pdfDoc.save();
    const filePath = `pdf/activity_${Date.now()}_${Math.floor(Math.random() * 100000)}.pdf`;

    const uploadRes = await cloud.uploadFile({
      cloudPath: filePath,
      fileContent: Buffer.from(pdfBytes)
    });

    return { success: true, fileID: uploadRes.fileID };
  } catch (e) {
    console.error('[PDF] generate failed:', e);
    return { success: false, error: e.message || 'generate failed' };
  }
};
