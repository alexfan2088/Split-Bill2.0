// 轻量级 XLSX 导出器：仅实现本小程序报表实际需要的文字、样式、边框与合并单元格。
// 避免引入近 900 KB 的通用 XLSX 库，确保主包可通过体积限制。

const UTF8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function encodeUtf8(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (UTF8) return UTF8.encode(text);
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + next - 0xdc00;
        index += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(bytes);
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => { result.set(part, offset); offset += part.length; });
  return result;
}

function uint16(value) { return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff]); }
function uint32(value) { return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]); }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) value = CRC_TABLE[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zip(files) {
  let offset = 0;
  const locals = [];
  const centrals = [];
  files.forEach((file) => {
    const name = encodeUtf8(file.name);
    const data = encodeUtf8(file.content);
    const crc = crc32(data);
    locals.push(concatBytes([
      uint32(0x04034b50), uint16(20), uint16(0), uint16(0), uint16(0), uint16(0), uint32(crc),
      uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), name, data
    ]));
    centrals.push(concatBytes([
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0), uint16(0), uint16(0), uint16(0), uint32(crc),
      uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), uint16(0), uint16(0), uint16(0),
      uint32(0), uint32(offset), name
    ]));
    offset += locals[locals.length - 1].length;
  });
  const central = concatBytes(centrals);
  return concatBytes(locals.concat([
    central,
    uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length), uint32(central.length), uint32(offset), uint16(0)
  ]));
}

function escapeXml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const rest = (value - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function isSectionTitle(row) {
  const value = row && row[0];
  return Array.isArray(row) && row.length === 1 && typeof value === 'string' && (
    value === '活动信息' || value === '结算信息' || value === '账单信息' || value === '预存记录' ||
    value === '一级活动信息' || value === '二级活动清单' || value.indexOf('二级活动 ') === 0
  );
}

function isTableHeader(row) {
  if (!Array.isArray(row)) return false;
  return (row[0] === '项目' && row[1] === '内容') ||
    (row[0] === '成员' && row[1] === '实付' && row[2] === '应付' && row[3] === '余额') ||
    (row[0] === '日期' && (row[1] === '名称' || row[1] === '充值人')) ||
    (row[0] === '序号' && row[1] === '二级活动名称');
}

function estimateLines(value, columnWidth) {
  return String(value === undefined || value === null ? '' : value).split(/\r?\n/).reduce((total, line) => {
    const width = Array.from(line).reduce((sum, char) => {
      const code = char.charCodeAt(0);
      return sum + (code > 0xff || (code >= 0x2e80 && code <= 0x9fff) ? 2 : 1);
    }, 0);
    return total + Math.max(1, Math.ceil(width / columnWidth));
  }, 0) || 1;
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF1D4ED8"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FF1D4ED8"/><name val="Microsoft YaHei"/></font><font><sz val="10"/><name val="Microsoft YaHei"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F7FF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function sheetXml(rows) {
  const sourceRows = rows || [];
  const maxColumns = Math.max(1, ...sourceRows.map(row => Array.isArray(row) ? row.length : 0));
  const merges = [];
  const rowXml = sourceRows.map((row, rowIndex) => {
    const values = Array.isArray(row) ? row : [row];
    const title = isSectionTitle(values);
    const header = isTableHeader(values);
    const twoColumns = values.length === 2;
    const lines = values.reduce((max, value, columnIndex) => {
      const capacity = title ? 7 + Math.max(0, maxColumns - 1) * 6 : (twoColumns && columnIndex === 1 ? 24 : (columnIndex === 0 ? 7 : 6));
      return Math.max(max, estimateLines(value, capacity));
    }, 1);
    if (title) merges.push(`A${rowIndex + 1}:${columnName(maxColumns - 1)}${rowIndex + 1}`);
    if (twoColumns && maxColumns >= 5) merges.push(`B${rowIndex + 1}:E${rowIndex + 1}`);
    const cells = values.map((value, columnIndex) => {
      if (value === undefined || value === null || value === '') return '';
      const style = title ? 1 : (header ? 2 : 3);
      const text = escapeXml(value);
      const preserve = /^\s|\s$/.test(String(value)) ? ' xml:space="preserve"' : '';
      return `<c r="${columnName(columnIndex)}${rowIndex + 1}" s="${style}" t="inlineStr"><is><t${preserve}>${text}</t></is></c>`;
    }).join('');
    if (!cells) return '';
    const height = (title ? 24 : 18) * lines;
    return `<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${cells}</row>`;
  }).join('');
  const cols = Array.from({ length: maxColumns }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 0 ? 7 : 6}" customWidth="1"/>`).join('');
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><cols>${cols}</cols><sheetData>${rowXml}</sheetData>${mergeXml}</worksheet>`;
}

function sanitizeSheetName(name) {
  return String(name || '活动导出').replace(/[\\/:*?\[\]]/g, '_').slice(0, 31) || '活动导出';
}

function build(rows, sheetName) {
  const name = escapeXml(sanitizeSheetName(sheetName));
  const files = [
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', content: stylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml(rows) }
  ];
  const bytes = zip(files);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

module.exports = { build };
