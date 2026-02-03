const cloud = require('wx-server-sdk');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { pages, pageWidth, pageHeight, padding, lineHeight } = event || {};
  if (!pages || pages.length === 0) {
    return { success: false, error: 'missing pages' };
  }

  try {
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

    console.log('[PDF] pages:', pages.length);
    pages.forEach((lines) => {
      const w = pageWidth || 820;
      const h = pageHeight || 1200;
      const pad = padding || 32;
      const lh = lineHeight || 32;
      const page = pdfDoc.addPage([w, h]);

      lines.forEach((line, index) => {
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
    });

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
