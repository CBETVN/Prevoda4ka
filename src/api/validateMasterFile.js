import { photoshop } from "../globals";
import { uxp } from "../globals";
import { getAllLayers } from "./photoshop.js";
import { parsePsd, extractUuidFromBlock } from "./psdParser.js";
const { app, core,action, constants } = photoshop;
const { executeAsModal } = photoshop.core;
const { batchPlay } = photoshop.action;

const { localFileSystem: fs, formats } = uxp.storage;



export async function getNestedSOData() {
  try {
    const doc = app.activeDocument;
    if (!doc) { console.error('No active document.'); return; }

    const filePath = doc.path;
    console.log('Scanning file:', filePath);

    const entry = await fs.getEntryWithUrl(toUXPUrl(filePath));
    const t0 = Date.now();
    const buffer = await entry.read({ format: formats.binary });
    console.log(`Buffer size: ${buffer.byteLength} — read in ${Date.now()-t0}ms`);

    const t1 = Date.now();
    const nestedSOMap = buildNestedSOMapFast(buffer);
    console.log(`nestedSOMap: ${Object.keys(nestedSOMap).length} entries — parsed in ${Date.now()-t1}ms`);

    const allLayers = getAllLayers(doc.layers);
    for (const layer of allLayers) {
      if (layer.kind === 'smartObject') {
        const res = await batchPlay([{ _obj: 'get', _target: [{ _ref: 'layer', _id: layer.id }] }], {});
        const uuid = res[0]?.smartObjectMore?.ID;
        const hasNested = uuid ? (nestedSOMap[uuid] ?? false) : false;
        if (hasNested) console.log(`Layer "${layer.name}" (ID: ${layer.id}) has nested Smart Object`);
      }
    }
  } catch (err) {
    console.error('getNestedSOData error:', err.message, err.stack);
  }
}





function bytesHasLnk2(bytes, view, start, end, isPsb) {
  for (let i = start; i < end - 12; i++) {
    // Check for '8BIM' (38 42 49 4D) or '8B64' (38 42 36 34)
    if (bytes[i] !== 0x38 || bytes[i+1] !== 0x42) continue;
    const is8B64 = bytes[i+2] === 0x36 && bytes[i+3] === 0x34;
    const is8BIM = bytes[i+2] === 0x49 && bytes[i+3] === 0x4D;
    if (!is8BIM && !is8B64) continue;
    // Check for 'lnk2' (6C 6E 6B 32), 'lnkD' (6C 6E 6B 44), 'lnk3' (6C 6E 6B 33)
    if (bytes[i+4] !== 0x6C || bytes[i+5] !== 0x6E || bytes[i+6] !== 0x6B) continue;
    const b7 = bytes[i+7];
    if (b7 !== 0x32 && b7 !== 0x44 && b7 !== 0x33) continue;
    const useLarge = is8B64 || isPsb;
    const len = useLarge
      ? view.getUint32(i+8, false) * 0x100000000 + view.getUint32(i+12, false)
      : view.getUint32(i+8, false);
    if (len > 0) return true;
  }
  return false;
}












function buildNestedSOMapFast(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const map = {};
  if (buffer.byteLength < 30) return map;
  const isPsb = bytes[4] === 0x00 && bytes[5] === 0x02;

  // Jump through sections to reach Layer and Mask Info
  const colorModeLen = view.getUint32(26, false);
  const imgResOffset = 26 + 4 + colorModeLen;
  if (imgResOffset + 4 > buffer.byteLength) return map;
  const imgResLen = view.getUint32(imgResOffset, false);
  const layerMaskOffset = imgResOffset + 4 + imgResLen;
  if (layerMaskOffset + (isPsb ? 8 : 4) > buffer.byteLength) return map;

  const layerMaskLen = isPsb
    ? view.getUint32(layerMaskOffset, false) * 0x100000000 + view.getUint32(layerMaskOffset + 4, false)
    : view.getUint32(layerMaskOffset, false);
  const layerMaskStart = layerMaskOffset + (isPsb ? 8 : 4);
  const layerMaskEnd = layerMaskStart + layerMaskLen;

  // Inside Layer and Mask Info, skip Layer Info block
  // Layer Info length: 8 bytes in PSB, 4 bytes in PSD
  let pos = layerMaskStart;
  if (pos + (isPsb ? 8 : 4) > buffer.byteLength) return map;
  const layerInfoLen = isPsb
    ? view.getUint32(pos, false) * 0x100000000 + view.getUint32(pos + 4, false)
    : view.getUint32(pos, false);
  pos += (isPsb ? 8 : 4) + layerInfoLen;
  // Align to 2 bytes
  if (pos % 2 !== 0) pos++;

  // Skip Global Layer Mask Info block (always 4-byte length)
  if (pos + 4 > buffer.byteLength) return map;
  const globalMaskLen = view.getUint32(pos, false);
  pos += 4 + globalMaskLen;

  // Now we're at Global Additional Layer Info — lnk2 lives here
  const galiStart = pos;
  const galiEnd = Math.min(layerMaskEnd, buffer.byteLength);

  console.log(`Skipped to GALI at offset ${galiStart}, scanning ${galiEnd - galiStart} bytes (${Math.round((galiEnd-galiStart)/buffer.byteLength*100)}% of file)`);

  const tScan = Date.now();
  for (let i = galiStart; i < galiEnd - 12; i++) {
    // '8B' prefix check first (fast reject)
    if (bytes[i] !== 0x38 || bytes[i+1] !== 0x42) continue;
    const is8B64 = bytes[i+2] === 0x36 && bytes[i+3] === 0x34;
    const is8BIM = bytes[i+2] === 0x49 && bytes[i+3] === 0x4D;
    if (!is8BIM && !is8B64) continue;
    // 'lnk' prefix check
    if (bytes[i+4] !== 0x6C || bytes[i+5] !== 0x6E || bytes[i+6] !== 0x6B) continue;
    const b7 = bytes[i+7];
    if (b7 !== 0x32 && b7 !== 0x44 && b7 !== 0x33) continue;

    const useLarge = is8B64 || isPsb;
    const blockLen = useLarge
      ? view.getUint32(i+8, false) * 0x100000000 + view.getUint32(i+12, false)
      : view.getUint32(i+8, false);
    if (blockLen === 0) continue;

    const blockStart = i + (useLarge ? 16 : 12);
    const blockEnd = Math.min(blockStart + blockLen, galiEnd);

    // Scan for liFD signatures directly — robust against padding/alignment quirks
    let nRec = 0;
    for (let j = blockStart; j < blockEnd - 8; j++) {
      // 'liFD' = 6C 69 46 44
      if (bytes[j] !== 0x6c || bytes[j+1] !== 0x69 || bytes[j+2] !== 0x46 || bytes[j+3] !== 0x44) continue;
      if (j < 4) continue;
      nRec++;
      const recLen = view.getUint32(j - 4, false);
      const recStart = j - 4;
      const recEnd = Math.min(recStart + 4 + recLen, blockEnd);
      const uuid = extractUuidFromBlock(buffer, j, recEnd);
      if (uuid && !(uuid in map)) {
        map[uuid] = liFDRecordHasNestedSO(bytes, view, recStart, recEnd);
      }
      j = recEnd - 1; // skip to end of record
    }
    console.log(`nestedSOMapFast: ${nRec} records scanned in ${Date.now()-tScan}ms`);
    i = blockStart + blockLen - 1;
  }
  return map;
}







function liFDRecordHasNestedSO(bytes, view, recStart, recEnd) {
  // Full-range scan with version validation to avoid 8BPS false positives
  let bpsOff = -1;
  for (let i = recStart; i < recEnd - 6; i++) {
    if (bytes[i]===0x38 && bytes[i+1]===0x42 && bytes[i+2]===0x50 && bytes[i+3]===0x53) {
      const ver = (bytes[i + 4] << 8) | bytes[i + 5];
      if (ver === 1 || ver === 2) { bpsOff = i; break; }
    }
  }
  if (bpsOff < 0) return false;

  try {
    const innerIsPsb = bytes[bpsOff+4] === 0x00 && bytes[bpsOff+5] === 0x02;
    const base = bpsOff;

    // Jump to Color Mode Data
    const colorModeLen = view.getUint32(base + 26, false);
    const imgResOff = base + 26 + 4 + colorModeLen;
    if (imgResOff + 4 > recEnd) return false;

    // Jump to Image Resources
    const imgResLen = view.getUint32(imgResOff, false);
    const layerMaskOff = imgResOff + 4 + imgResLen;
    if (layerMaskOff + (innerIsPsb ? 8 : 4) > recEnd) return false;

    // Jump to Layer and Mask Info
    const layerMaskLen = innerIsPsb
      ? view.getUint32(layerMaskOff, false) * 0x100000000 + view.getUint32(layerMaskOff+4, false)
      : view.getUint32(layerMaskOff, false);
    const layerMaskStart = layerMaskOff + (innerIsPsb ? 8 : 4);
    const layerMaskEnd = Math.min(layerMaskStart + layerMaskLen, recEnd);

    // Skip Layer Info
    let pos = layerMaskStart;
    if (pos + (innerIsPsb ? 8 : 4) > layerMaskEnd) return false;
    const layerInfoLen = innerIsPsb
      ? view.getUint32(pos, false) * 0x100000000 + view.getUint32(pos+4, false)
      : view.getUint32(pos, false);
    pos += (innerIsPsb ? 8 : 4) + layerInfoLen;
    if (pos % 2 !== 0) pos++;

    // Skip Global Mask
    if (pos + 4 > layerMaskEnd) return false;
    const globalMaskLen = view.getUint32(pos, false);
    pos += 4 + globalMaskLen;

    // Scan GALI only — tiny section, no pixel data
    return bytesHasLnk2(bytes, view, pos, layerMaskEnd, innerIsPsb);
  } catch(e) {
    // Fallback: scan whole record, use correct isPsb
    const fallbackIsPsb = bpsOff >= 0 && bytes[bpsOff+4] === 0x00 && bytes[bpsOff+5] === 0x02;
    return bytesHasLnk2(bytes, view, recStart, recEnd, fallbackIsPsb);
  }
}











function toUXPUrl(nativePath) {
  // Replace backslashes with forward slashes
  const normalized = nativePath.replace(/\\/g, '/');
  // Prefix with 'file:/'
  return 'file:/' + normalized;
}


// ── Font extraction helpers (ported from TestingPlugin) ───────────

const NON_FONT_NAMES = new Set([
  'AdobeInvisFont', 'PhotoshopKinsokuHard', 'PhotoshopKinsokuSoft', 'Normal RGB'
]);

function decodePSString(bytes, start, end) {
  if (end - start >= 2 && bytes[start] === 0xFE && bytes[start + 1] === 0xFF) {
    let str = "";
    for (let i = start + 2; i < end - 1; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (code === 0) continue;
      str += String.fromCharCode(code);
    }
    return str;
  }
  let str = "";
  for (let i = start; i < end; i++) str += String.fromCharCode(bytes[i]);
  return str;
}

function extractFontsFromTySh(bytes, view, start, end) {
  const fonts = [];

  for (let i = start; i < end - 8; i++) {
    // tdta = 74 64 74 61
    if (bytes[i] !== 0x74 || bytes[i + 1] !== 0x64 || bytes[i + 2] !== 0x74 || bytes[i + 3] !== 0x61) continue;

    const dataLen = view.getUint32(i + 4, false);
    const dataStart = i + 8;
    const dataEnd = Math.min(dataStart + dataLen, end);

    const isUtf16 = bytes[dataStart] === 0xFE && bytes[dataStart + 1] === 0xFF;

    if (isUtf16) {
      // UTF-16BE: "/Name (" = 00 2F 00 4E 00 61 00 6D 00 65 00 20 00 28
      for (let j = dataStart; j < dataEnd - 30; j += 2) {
        if (bytes[j] !== 0x00 || bytes[j+1] !== 0x2F) continue;
        if (bytes[j+2] !== 0x00 || bytes[j+3] !== 0x4E) continue;
        if (bytes[j+4] !== 0x00 || bytes[j+5] !== 0x61) continue;
        if (bytes[j+6] !== 0x00 || bytes[j+7] !== 0x6D) continue;
        if (bytes[j+8] !== 0x00 || bytes[j+9] !== 0x65) continue;
        if (bytes[j+10] !== 0x00 || bytes[j+11] !== 0x20) continue;
        if (bytes[j+12] !== 0x00 || bytes[j+13] !== 0x28) continue;

        const nameStart = j + 14;
        let nameEnd = nameStart;
        while (nameEnd < dataEnd - 1 && !(bytes[nameEnd] === 0x00 && bytes[nameEnd+1] === 0x29)) nameEnd += 2;
        if (nameEnd > nameStart) {
          let fontName = "";
          for (let k = nameStart; k < nameEnd; k += 2) {
            fontName += String.fromCharCode((bytes[k] << 8) | bytes[k+1]);
          }
          if (fontName && !fonts.includes(fontName)) fonts.push(fontName);
        }
        j = nameEnd;
      }
    } else {
      // ASCII: "/Name (" = 2F 4E 61 6D 65 20 28
      const namePattern = [0x2F, 0x4E, 0x61, 0x6D, 0x65, 0x20, 0x28];
      for (let j = dataStart; j < dataEnd - 20; j++) {
        let match = true;
        for (let k = 0; k < namePattern.length; k++) {
          if (bytes[j + k] !== namePattern[k]) { match = false; break; }
        }
        if (!match) continue;

        const nameStart = j + namePattern.length;
        let nameEnd = nameStart;
        while (nameEnd < dataEnd && bytes[nameEnd] !== 0x29) nameEnd++;
        if (nameEnd > nameStart) {
          const fontName = decodePSString(bytes, nameStart, nameEnd);
          if (fontName && !fonts.includes(fontName)) fonts.push(fontName);
        }
        j = nameEnd;
      }
    }
    break; // one tdta per TySh
  }

  return fonts;
}

function scanForFonts(bytes, view, start, end) {
  const results = [];
  for (let i = start; i < end - 4; i++) {
    // TySh = 54 79 53 68
    if (bytes[i] !== 0x54 || bytes[i + 1] !== 0x79 || bytes[i + 2] !== 0x53 || bytes[i + 3] !== 0x68) continue;

    const tyshBlockLen = view.getUint32(i + 4, false);
    const tyshEnd = Math.min(i + 8 + tyshBlockLen, end);

    const fonts = extractFontsFromTySh(bytes, view, i + 8, tyshEnd);
    if (fonts.length) results.push(fonts);

    i = tyshEnd - 1;
  }
  return results;
}

// Finds inner 8BPS with version validation (full-range scan, no 400-byte limit)
function extractFontsFromLiFD(bytes, view, recStart, recEnd) {
  let bpsOff = -1;
  for (let i = recStart; i < recEnd - 6; i++) {
    if (bytes[i] === 0x38 && bytes[i + 1] === 0x42 && bytes[i + 2] === 0x50 && bytes[i + 3] === 0x53) {
      const ver = (bytes[i + 4] << 8) | bytes[i + 5];
      if (ver === 1 || ver === 2) { bpsOff = i; break; }
    }
  }
  if (bpsOff < 0) return [];

  const innerIsPsb = bytes[bpsOff + 4] === 0x00 && bytes[bpsOff + 5] === 0x02;
  const base = bpsOff;

  try {
    const colorModeLen = view.getUint32(base + 26, false);
    const imgResOff = base + 26 + 4 + colorModeLen;
    if (imgResOff + 4 > recEnd) return [];

    const imgResLen = view.getUint32(imgResOff, false);
    const layerMaskOff = imgResOff + 4 + imgResLen;
    if (layerMaskOff + (innerIsPsb ? 8 : 4) > recEnd) return [];

    const layerMaskLen = innerIsPsb
      ? view.getUint32(layerMaskOff, false) * 0x100000000 + view.getUint32(layerMaskOff + 4, false)
      : view.getUint32(layerMaskOff, false);
    const layerMaskStart = layerMaskOff + (innerIsPsb ? 8 : 4);
    const layerMaskEnd = Math.min(layerMaskStart + layerMaskLen, recEnd);

    const layerInfoLenField = innerIsPsb
      ? view.getUint32(layerMaskStart, false) * 0x100000000 + view.getUint32(layerMaskStart + 4, false)
      : view.getUint32(layerMaskStart, false);
    const layerInfoStart = layerMaskStart + (innerIsPsb ? 8 : 4);
    const layerInfoEnd = Math.min(layerInfoStart + layerInfoLenField, layerMaskEnd);

    return scanForFonts(bytes, view, layerInfoStart, layerInfoEnd);
  } catch (e) {
    return [];
  }
}

function extractFontsFromSO(buffer, targetUuid) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (buffer.byteLength < 30) return [];
  const isPsb = bytes[4] === 0x00 && bytes[5] === 0x02;

  const colorModeLen = view.getUint32(26, false);
  const imgResOffset = 26 + 4 + colorModeLen;
  if (imgResOffset + 4 > buffer.byteLength) return [];
  const imgResLen = view.getUint32(imgResOffset, false);
  const layerMaskOffset = imgResOffset + 4 + imgResLen;
  if (layerMaskOffset + (isPsb ? 8 : 4) > buffer.byteLength) return [];

  const layerMaskLen = isPsb
    ? view.getUint32(layerMaskOffset, false) * 0x100000000 + view.getUint32(layerMaskOffset + 4, false)
    : view.getUint32(layerMaskOffset, false);
  const layerMaskStart = layerMaskOffset + (isPsb ? 8 : 4);
  const layerMaskEnd = layerMaskStart + layerMaskLen;

  let pos = layerMaskStart;
  if (pos + (isPsb ? 8 : 4) > buffer.byteLength) return [];
  const layerInfoLen = isPsb
    ? view.getUint32(pos, false) * 0x100000000 + view.getUint32(pos + 4, false)
    : view.getUint32(pos, false);
  pos += (isPsb ? 8 : 4) + layerInfoLen;
  if (pos % 2 !== 0) pos++;

  if (pos + 4 > buffer.byteLength) return [];
  const globalMaskLen = view.getUint32(pos, false);
  pos += 4 + globalMaskLen;

  const galiStart = pos;
  const galiEnd = Math.min(layerMaskEnd, buffer.byteLength);

  for (let i = galiStart; i < galiEnd - 12; i++) {
    if (bytes[i] !== 0x38 || bytes[i + 1] !== 0x42) continue;
    const is8B64 = bytes[i + 2] === 0x36 && bytes[i + 3] === 0x34;
    const is8BIM = bytes[i + 2] === 0x49 && bytes[i + 3] === 0x4D;
    if (!is8BIM && !is8B64) continue;
    if (bytes[i + 4] !== 0x6C || bytes[i + 5] !== 0x6E || bytes[i + 6] !== 0x6B) continue;
    const b7 = bytes[i + 7];
    if (b7 !== 0x32 && b7 !== 0x44 && b7 !== 0x33) continue;

    const useLarge = is8B64 || isPsb;
    const blockLen = useLarge
      ? view.getUint32(i + 8, false) * 0x100000000 + view.getUint32(i + 12, false)
      : view.getUint32(i + 8, false);
    if (blockLen === 0) continue;

    const blockStart = i + (useLarge ? 16 : 12);
    const blockEnd = Math.min(blockStart + blockLen, galiEnd);

    for (let j = blockStart; j < blockEnd - 8; j++) {
      if (bytes[j] !== 0x6c || bytes[j + 1] !== 0x69 || bytes[j + 2] !== 0x46 || bytes[j + 3] !== 0x44) continue;
      if (j < 4) continue;
      const recLen = view.getUint32(j - 4, false);
      const recStart = j - 4;
      const recEnd = Math.min(recStart + 4 + recLen, blockEnd);
      const recUuid = extractUuidFromBlock(buffer, j, recEnd);
      if (recUuid === targetUuid) {
        return extractFontsFromLiFD(bytes, view, recStart, recEnd);
      }
      j = recEnd - 1;
    }
    i = blockStart + blockLen - 1;
  }

  return [];
}

async function scanMainDocFonts() {
  const docInfo = await batchPlay([{
    _obj: "get",
    _target: [
      { _property: "numberOfLayers" },
      { _ref: "document", _enum: "ordinal", _value: "targetEnum" }
    ]
  }], {});
  const count = docInfo[0].numberOfLayers;

  const usedFonts = new Map();

  for (let i = 1; i <= count; i++) {
    try {
      const r = await batchPlay([{
        _obj: "get",
        _target: [
          { _property: "textKey" },
          { _ref: "layer", _index: i }
        ]
      }], {});
      const tk = r[0].textKey;
      if (!tk) continue;

      const nameR = await batchPlay([{
        _obj: "get",
        _target: [
          { _property: "name" },
          { _ref: "layer", _index: i }
        ]
      }], {});
      const layerName = nameR[0].name || `layer#${i}`;

      const ranges = tk.textStyleRange || [];
      for (const range of ranges) {
        const ts = range.textStyle;
        if (!ts) continue;
        const psName = ts.fontPostScriptName;
        if (!psName) continue;
        if (!usedFonts.has(psName)) {
          usedFonts.set(psName, { fontName: ts.fontName || psName, layers: [] });
        }
        const entry = usedFonts.get(psName);
        if (!entry.layers.includes(layerName)) entry.layers.push(layerName);
      }
    } catch (e) {
      // Not a text layer — skip
    }
  }

  return usedFonts;
}


// ── Unified validate entry point ──────────────────────

export async function validateDoc() {
  const doc = app.activeDocument;
  const emptyResult = { nestedSOs: { found: false, count: 0, layers: [] }, missingFonts: { found: false, count: 0, mainDoc: [], smartObjects: [] } };
  if (!doc) return emptyResult;

  try {
    return await executeAsModal(async () => {
      const filePath = doc.path;
      const entry = await fs.getEntryWithUrl(toUXPUrl(filePath));
      const buffer = await entry.read({ format: formats.binary });

      // Nested SO detection
      const nestedSOMap = buildNestedSOMapFast(buffer);
      const allLayers = getAllLayers(doc.layers);
      const nestedLayers = [];

      const soLayers = [];
      for (const layer of allLayers) {
        if (layer.kind !== 'smartObject') continue;
        const res = await batchPlay([{ _obj: 'get', _target: [{ _ref: 'layer', _id: layer.id }] }], {});
        const uuid = res[0]?.smartObjectMore?.ID;
        if (!uuid) continue;
        soLayers.push({ name: layer.name, id: layer.id, uuid });
        if (nestedSOMap[uuid]) {
          nestedLayers.push({ name: layer.name, id: layer.id, uuid });
        }
      }

      // Font detection — main document
      const usedFonts = await scanMainDocFonts();
      const installed = new Set();
      app.fonts.forEach(f => installed.add(f.postScriptName));

      const missingMainDoc = [];
      for (const [psName, info] of usedFonts) {
        if (!installed.has(psName) && !NON_FONT_NAMES.has(psName)) {
          missingMainDoc.push({ postScriptName: psName, fontName: info.fontName, usedInLayers: info.layers });
        }
      }

      // Font detection — inside Smart Objects
      const missingSOs = [];
      for (const so of soLayers) {
        const fontLayers = extractFontsFromSO(buffer, so.uuid);
        const allSOFonts = new Set();
        for (const layerFonts of fontLayers) {
          for (const f of layerFonts) {
            if (!NON_FONT_NAMES.has(f)) allSOFonts.add(f);
          }
        }
        const missingInSO = [...allSOFonts].filter(f => !installed.has(f));
        if (missingInSO.length > 0) {
          missingSOs.push({ soName: so.name, soUuid: so.uuid, fonts: missingInSO });
        }
      }

      const allMissingNames = new Set([
        ...missingMainDoc.map(m => m.postScriptName),
        ...missingSOs.flatMap(s => s.fonts)
      ]);

      return {
        nestedSOs: {
          found: nestedLayers.length > 0,
          count: nestedLayers.length,
          layers: nestedLayers
        },
        missingFonts: {
          found: allMissingNames.size > 0,
          count: allMissingNames.size,
          mainDoc: missingMainDoc,
          smartObjects: missingSOs
        }
      };
    }, { commandName: "Validate Document" });
  } catch (e) {
    console.error("validateDoc error:", e.message, e.stack);
    return emptyResult;
  }
}
