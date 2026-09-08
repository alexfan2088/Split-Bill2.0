const cloud = require('wx-server-sdk');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { pages, pageWidth, pageHeight, padding, lineHeight, mergeFileIDs } = event || {};

  try {
    // 大文件先分卷生成，随后由云端合并。这样前端只下载一个完整 PDF，
    // 同时避免在单次生成中处理过多页面、字体和附件图片。
    if (Array.isArray(mergeFileIDs) && mergeFileIDs.length > 0) {
      const mergedDoc = await PDFDocument.create();
      for (const fileID of mergeFileIDs) {
        const downloadRes = await cloud.downloadFile({ fileID });
        const fileContent = downloadRes && downloadRes.fileContent;
        if (!fileContent || !fileContent.length) {
          throw new Error('PDF分卷下载失败');
        }
        const sourceDoc = await PDFDocument.load(fileContent);
        const copiedPages = await mergedDoc.copyPages(sourceDoc, sourceDoc.getPageIndices());
        copiedPages.forEach((page) => mergedDoc.addPage(page));
      }
      const mergedBytes = await mergedDoc.save();
      const uploadRes = await cloud.uploadFile({
        cloudPath: `pdf/activity_merged_${Date.now()}_${Math.floor(Math.random() * 100000)}.pdf`,
        fileContent: Buffer.from(mergedBytes)
      });
      return { success: true, fileID: uploadRes.fileID };
    }

    if (!pages || pages.length === 0) {
      return { success: false, error: 'missing pages' };
    }

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fontPath = path.join(__dirname, 'assets', 'SourceHanSansSC-Regular.otf');
    const fontBytes = fs.readFileSync(fontPath);
    const font = await pdfDoc.embedFont(fontBytes);

    const toRgb = (hex) => {
      const raw = (hex || '').replace('#', '');
      if (raw.length !== 6) return rgb(0, 0, 0);
      const r = parseInt(raw.slice(0, 2), 16) / 255;
      const g = parseInt(raw.slice(2, 4), 16) / 255;
      const b = parseInt(raw.slice(4, 6), 16) / 255;
      return rgb(r, g, b);
    };

    const drawTextLine = (page, text, x, y, size, color, bold) => {
      if (!text) return;
      page.drawText(text, { x, y, size, font, color });
      if (bold) {
        page.drawText(text, { x: x + 0.4, y, size, font, color });
      }
    };

    const embedImage = async (fileID) => {
      const downloadRes = await cloud.downloadFile({ fileID });
      const buffer = downloadRes && downloadRes.fileContent;
      if (!buffer || !buffer.length) {
        throw new Error('附件图片下载失败');
      }
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      return isPng ? pdfDoc.embedPng(buffer) : pdfDoc.embedJpg(buffer);
    };

    const drawAttachmentPage = async (pageSpec) => {
      const w = pageWidth || 820;
      const h = pageHeight || 1200;
      const pad = padding || 32;
      const page = pdfDoc.addPage([w, h]);
      const indexText = pageSpec.attachmentTotal
        ? `${pageSpec.attachmentIndex || 1}/${pageSpec.attachmentTotal}`
        : String(pageSpec.attachmentIndex || 1);

      drawTextLine(page, `附件图片 ${indexText}`, pad, h - pad - 28, 28, toRgb('#1d4ed8'), true);
      drawTextLine(page, `账单：${pageSpec.billTitle || '未命名'}`, pad, h - pad - 72, 20, rgb(0, 0, 0), true);
      drawTextLine(page, `日期：${pageSpec.billDate || '-'}    金额：${pageSpec.billAmount || '-'}    付款人：${pageSpec.payer || '-'}`, pad, h - pad - 106, 18, rgb(0, 0, 0), false);

      try {
        const image = await embedImage(pageSpec.fileID);
        const maxWidth = w - pad * 2;
        const maxHeight = h - pad * 2 - 150;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const imageWidth = image.width * scale;
        const imageHeight = image.height * scale;
        const x = pad + (maxWidth - imageWidth) / 2;
        const y = pad + Math.max(0, (maxHeight - imageHeight) / 2);
        page.drawImage(image, { x, y, width: imageWidth, height: imageHeight });
      } catch (e) {
        console.error('[PDF] attachment image failed:', e);
        drawTextLine(page, '附件图片加载失败，无法嵌入 PDF。', pad, h - pad - 150, 18, toRgb('#b91c1c'), false);
      }
    };

    console.log('[PDF] pages:', pages.length);
    for (const lines of pages) {
      if (lines && !Array.isArray(lines) && lines.type === 'attachment') {
        await drawAttachmentPage(lines);
        continue;
      }

      const w = pageWidth || 820;
      const h = pageHeight || 1200;
      const pad = padding || 32;
      const lh = lineHeight || 32;
      const page = pdfDoc.addPage([w, h]);

      (Array.isArray(lines) ? lines : []).forEach((line, index) => {
        const fontSize = line.fontSize || 18;
        const isTitle = line.role === 'title';
        const color = isTitle ? toRgb(line.color || '#111111') : rgb(0, 0, 0);
        const y = h - pad - fontSize - index * lh;

        if (line.type === 'row') {
          (line.columns || []).forEach((col) => {
            const text = String(col.text || '');
            const x = pad + (col.x || 0);
            drawTextLine(page, text, x, y, fontSize, rgb(0, 0, 0), false);
          });
        } else {
          drawTextLine(page, String(line.text || ''), pad, y, line.bold ? fontSize + 1 : fontSize, color, !!line.bold);
        }
      });
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
