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

// ── Fuzzy naming analysis constants ──────────────────────────────


const COPY_SUFFIX_RE = /\s+copy(\s+\d+)?$/i;

const KNOWN_STRUCTURAL_NAMES = new Set([
"EN","BG",
"FREESPINPORTRAIT",
"FREESPINLANDSCAPE",
"INTROLANDSCAPE",
"INTROPORTRAIT",
"RETRIGGERLANDSCAPE",
"RETRIGGERPORTRAIT",
"OUTROCURRENCYLANDSCAPE",
"OUTROCURRENCYPORTRAIT",
"OUTROCREDITSLANDSCAPE",
"OUTROCREDITSPORTRAIT",
"SUPERFREESPINSCOUNTER",
"FREESPINSCOUNTER",
"BUYBONUSBANNERS",
"BANNERBACKGROUND2LANDSCAPE",
"BANNERBACKGROUND0LANDSCAPE",
"BANNERBACKGROUND1LANDSCAPE",
"BANNERBACKGROUND2PORTRAIT",
"BANNERBACKGROUND0PORTRAIT",
"BANNERBACKGROUND1PORTRAIT",
"DOUBLECHANCEOFFLANDSCAPE",
"BUYBONUSBTN",
"POPUPTITLE",
"BUYBONUSBTNACTIVE2PORTRAIT",
"BASE",
"BUYBONUSBTNACTIVE0PORTRAIT",
"BUYBONUSBTNACTIVE1PORTRAIT",
"X2BTNINACTIVEPORTRAIT",
"BUYBONUSBTNPORTRAIT",
"BASE(FIXED)",
"SLICES","SLICE","BACKGROUND","BACKGROUNDS",
"FREESPIN",
"INTRO",
"RETRIGGER",
"OUTROCURRENCY",
"OUTROCREDITS",
"INSTRUCTIONS",
"BUYBONUSBANNER",
"BANNERBACKGROUND",
"DOUBLECHANCEOFF",
"X2BTNINACTIVE",
]);

const STRUCTURAL_SUBSTRING_MIN_LEN = 4;

const NAMING_WEIGHTS = { groups: 0.40, smartObjects: 0.50, textLayers: 0.05, otherLayers: 0.05 };

const MATCH_SCORE = {
  groups:       { both: 1.0, structural: 1.0, phrase: 0.7 },
  smartObjects: { both: 1.0, phrase: 1.0, structural: 0.7 },
  textLayers:   { both: 1.0, phrase: 1.0, structural: 0.7 },
  otherLayers:  { both: 1.0, phrase: 0.7, structural: 0.7 },
};

function _buildVocabulary(enPhrases) {
  const lines = new Set();
  const words = new Set();
  for (const phrase of enPhrases) {
    const cleaned = phrase
      .replace(/\(([^)]*)\)/g, "$1")
      .replace(/\[.*?\]/g, "");
    for (const line of cleaned.split("\n")) {
      const trimmed = line.trim().toUpperCase();
      if (!trimmed) continue;
      lines.add(trimmed);
      for (const word of trimmed.split(/\s+/)) {
        if (word) words.add(word);
      }
    }
  }
  return { lines, words };
}

function _classifyLayerName(name, vocabulary) {
  const stripped = name.replace(COPY_SUFFIX_RE, '').trim();
  const upper = stripped.toUpperCase();
  const compact = upper.replace(/\s+/g, '');

  let phraseMatch = false;
  if (vocabulary.lines.has(upper)) phraseMatch = true;
  else if (vocabulary.words.has(upper)) phraseMatch = true;
  else {
    const nameWords = upper.split(/\s+/).filter(Boolean);
    if (nameWords.length > 1 && nameWords.every(w => vocabulary.words.has(w))) phraseMatch = true;
  }

  let structuralMatch = KNOWN_STRUCTURAL_NAMES.has(compact);
  if (!structuralMatch) {
    for (const name of KNOWN_STRUCTURAL_NAMES) {
      if (name.length >= STRUCTURAL_SUBSTRING_MIN_LEN && compact.includes(name)) {
        structuralMatch = true;
        break;
      }
    }
  }

  if (phraseMatch && structuralMatch) return "both";
  if (phraseMatch) return "phrase";
  if (structuralMatch) return "structural";

  return "noise";
}

function _computeNamingFuzziness(layerMap, enPhrases) {
  const vocabulary = _buildVocabulary(enPhrases);

  function scoreCategory(items, categoryKey) {
    const total = items.length;
    if (total === 0) return { score: 100, total: 0, phrase: 0, structural: 0, noise: [] };
    const weights = MATCH_SCORE[categoryKey];
    let phrase = 0, structural = 0, weightedSum = 0;
    const noise = [];
    const _phraseNames = [], _structuralNames = [], _bothNames = []; // DELETE LATER
    for (const item of items) {
      const cls = _classifyLayerName(item.layer.name, vocabulary);
      if (cls === "noise") {
        noise.push(item.layer.name);
      } else if (cls === "phrase") {
        phrase++;
        weightedSum += weights.phrase;
        _phraseNames.push(item.layer.name); // DELETE LATER
      } else if (cls === "structural") {
        structural++;
        weightedSum += weights.structural;
        _structuralNames.push(item.layer.name); // DELETE LATER
      } else {
        phrase++;
        structural++;
        weightedSum += weights.both;
        _bothNames.push(item.layer.name); // DELETE LATER
      }
    }
    // DELETE LATER
    // console.log(`[${categoryKey}] Phrase words: [${_phraseNames.join(", ")}]`);
    // console.log(`[${categoryKey}] Structural: [${_structuralNames.join(", ")}]`);
    if (_bothNames.length) console.log(`[${categoryKey}] Both: [${_bothNames.join(", ")}]`);
    console.log(`[${categoryKey}] Noise: [${noise.join(", ")}]`);
    const score = Math.round((weightedSum / total) * 100);
    return { score, total, phrase, structural, noise };
  }

  const groups       = scoreCategory(layerMap.groups, "groups");
  const smartObjects = scoreCategory(layerMap.smartObjects, "smartObjects");
  const textLayers   = scoreCategory(layerMap.textLayers, "textLayers");
  const otherLayers  = scoreCategory(layerMap.other, "otherLayers");

  let weightedSum = 0, weightTotal = 0;
  const entries = [
    [groups, NAMING_WEIGHTS.groups],
    [smartObjects, NAMING_WEIGHTS.smartObjects],
    [textLayers, NAMING_WEIGHTS.textLayers],
    [otherLayers, NAMING_WEIGHTS.otherLayers],
  ];
  for (const [cat, weight] of entries) {
    if (cat.total > 0) {
      weightedSum += cat.score * weight;
      weightTotal += weight;
    }
  }
  const overallScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 100;

  return { overallScore, groups, smartObjects, textLayers, otherLayers };
}

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

// Checks if an embedded SO contains linked external SOs (SoLE layers) inside it.
// Scans RECURSIVELY — if the SO contains nested embedded SOs, those are checked too.
// Entry point: navigates outer PSD buffer → GALI → lnk2 → liFD (by UUID) to find
// the target SO's inner PSB, then hands off to _scanPsbForLinkedLayers for recursive descent.
// Returns an array of layer names that are linked external SOs (empty = none found).
// Pure read-only: only reads bytes from the already-loaded buffer, no Photoshop API calls.
function findLinkedLayersInSO(buffer, targetUuid) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (buffer.byteLength < 30) return [];
  const isPsb = bytes[4] === 0x00 && bytes[5] === 0x02;

  // Jump through PSD sections to reach GALI (same navigation as extractFontsFromSO)
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

  // Skip Layer Info section
  let pos = layerMaskStart;
  if (pos + (isPsb ? 8 : 4) > buffer.byteLength) return [];
  const layerInfoLen = isPsb
    ? view.getUint32(pos, false) * 0x100000000 + view.getUint32(pos + 4, false)
    : view.getUint32(pos, false);
  pos += (isPsb ? 8 : 4) + layerInfoLen;
  if (pos % 2 !== 0) pos++;

  // Skip Global Layer Mask
  if (pos + 4 > buffer.byteLength) return [];
  const globalMaskLen = view.getUint32(pos, false);
  pos += 4 + globalMaskLen;

  // Now at GALI — scan for lnk2/lnkD/lnk3 blocks (contain embedded SO data)
  const galiStart = pos;
  const galiEnd = Math.min(layerMaskEnd, buffer.byteLength);

  for (let i = galiStart; i < galiEnd - 12; i++) {
    // Look for '8BIM' or '8B64' signature
    if (bytes[i] !== 0x38 || bytes[i + 1] !== 0x42) continue;
    const is8B64 = bytes[i + 2] === 0x36 && bytes[i + 3] === 0x34;
    const is8BIM = bytes[i + 2] === 0x49 && bytes[i + 3] === 0x4D;
    if (!is8BIM && !is8B64) continue;
    // Check for 'lnk' key prefix (lnk2, lnkD, lnk3)
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

    // Scan for liFD records — each one is an embedded SO's data
    for (let j = blockStart; j < blockEnd - 8; j++) {
      // 'liFD' = 6C 69 46 44
      if (bytes[j] !== 0x6c || bytes[j + 1] !== 0x69 || bytes[j + 2] !== 0x46 || bytes[j + 3] !== 0x44) continue;
      if (j < 4) continue;
      const recLen = view.getUint32(j - 4, false);
      const recStart = j - 4;
      const recEnd = Math.min(recStart + 4 + recLen, blockEnd);
      const recUuid = extractUuidFromBlock(buffer, j, recEnd);

      // Found the liFD record for our target SO — extract its inner PSB and scan recursively
      if (recUuid === targetUuid) {
        const visited = new Set([targetUuid]);
        return _extractAndScanForLinks(buffer, recStart, recEnd, visited);
      }
      j = recEnd - 1;
    }
    i = blockStart + blockLen - 1;
  }

  return [];
}

// Extracts the inner PSB from a liFD record and hands it to the recursive scanner.
// Finds the 8BPS header (with version validation to skip false positives in filenames),
// slices the inner PSB buffer, and calls _scanPsbForLinkedLayers.
function _extractAndScanForLinks(buffer, recStart, recEnd, visited) {
  const bytes = new Uint8Array(buffer);

  // Find the embedded PSD/PSB header (8BPS + valid version 1 or 2)
  let bpsOff = -1;
  for (let i = recStart; i < recEnd - 6; i++) {
    if (bytes[i] === 0x38 && bytes[i+1] === 0x42 && bytes[i+2] === 0x50 && bytes[i+3] === 0x53) {
      const ver = (bytes[i + 4] << 8) | bytes[i + 5];
      if (ver === 1 || ver === 2) { bpsOff = i; break; }
    }
  }
  if (bpsOff < 0) return [];

  try {
    // Slice the inner PSB — starts at 8BPS header, ends at liFD record boundary
    const innerBuffer = buffer.slice(bpsOff, recEnd);
    return _scanPsbForLinkedLayers(innerBuffer, visited);
  } catch (e) {
    return [];
  }
}

// Core recursive scanner. Given a PSB buffer:
//   1. Parses layers with parsePsd() — collects SoLE (linked external) layer names
//   2. Navigates this PSB's own GALI → lnk2 → liFD records (nested embedded SOs)
//   3. For each nested SO not yet visited, extracts its inner PSB and recurses
// The visited Set prevents infinite loops if the same SO appears at multiple nesting levels.
function _scanPsbForLinkedLayers(psbBuffer, visited) {
  const names = [];

  // ── Step 1: Parse layers, collect any SoLE (linked external SO) names ──
  let parsed;
  try {
    parsed = parsePsd(psbBuffer);
  } catch (e) {
    return names;
  }
  for (const layer of parsed.layers) {
    if (layer.additionalInfo.includes("SoLE")) {
      names.push(layer.name);
    }
  }

  // ── Step 2: Navigate this PSB's GALI to find nested embedded SOs ──
  // Same section-skipping logic: header → color mode → image resources →
  // layer/mask info → skip layer info → skip global mask → arrive at GALI
  if (psbBuffer.byteLength < 30) return names;
  const bytes = new Uint8Array(psbBuffer);
  const view = new DataView(psbBuffer instanceof ArrayBuffer ? psbBuffer : psbBuffer.buffer);
  const isPsb = bytes[4] === 0x00 && bytes[5] === 0x02;

  const colorModeLen = view.getUint32(26, false);
  const imgResOffset = 26 + 4 + colorModeLen;
  if (imgResOffset + 4 > psbBuffer.byteLength) return names;
  const imgResLen = view.getUint32(imgResOffset, false);
  const layerMaskOffset = imgResOffset + 4 + imgResLen;
  if (layerMaskOffset + (isPsb ? 8 : 4) > psbBuffer.byteLength) return names;

  const layerMaskLen = isPsb
    ? view.getUint32(layerMaskOffset, false) * 0x100000000 + view.getUint32(layerMaskOffset + 4, false)
    : view.getUint32(layerMaskOffset, false);
  const layerMaskStart = layerMaskOffset + (isPsb ? 8 : 4);
  const layerMaskEnd = Math.min(layerMaskStart + layerMaskLen, psbBuffer.byteLength);

  let pos = layerMaskStart;
  if (pos + (isPsb ? 8 : 4) > psbBuffer.byteLength) return names;
  const layerInfoLen = isPsb
    ? view.getUint32(pos, false) * 0x100000000 + view.getUint32(pos + 4, false)
    : view.getUint32(pos, false);
  pos += (isPsb ? 8 : 4) + layerInfoLen;
  if (pos % 2 !== 0) pos++;

  if (pos + 4 > psbBuffer.byteLength) return names;
  const globalMaskLen = view.getUint32(pos, false);
  pos += 4 + globalMaskLen;

  const galiStart = pos;
  const galiEnd = Math.min(layerMaskEnd, psbBuffer.byteLength);

  // ── Step 3: Scan GALI for lnk2 blocks → liFD records → recurse into each ──
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

    // Each liFD record is a nested embedded SO — recurse into it
    for (let j = blockStart; j < blockEnd - 8; j++) {
      if (bytes[j] !== 0x6c || bytes[j + 1] !== 0x69 || bytes[j + 2] !== 0x46 || bytes[j + 3] !== 0x44) continue;
      if (j < 4) continue;
      const recLen = view.getUint32(j - 4, false);
      const recStart = j - 4;
      const recEnd = Math.min(recStart + 4 + recLen, blockEnd);
      const recUuid = extractUuidFromBlock(psbBuffer, j, recEnd);

      // Only recurse into SOs we haven't visited yet (prevents infinite loops)
      if (recUuid && !visited.has(recUuid)) {
        visited.add(recUuid);
        names.push(..._extractAndScanForLinks(psbBuffer, recStart, recEnd, visited));
      }
      j = recEnd - 1;
    }
    i = blockStart + blockLen - 1;
  }

  return names;
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

export async function validateDoc(appState = null) {
  const emptyResult = {
    nestedSOs: { found: false, count: 0, layers: [] },
    missingFonts: { found: false, count: 0, mainDoc: [], smartObjects: [] },
    missingLinks: { found: false, count: 0, samples: [] },
    fuzziness: null,
  };

  if (!app.activeDocument) return emptyResult;

  if (!app.activeDocument.path) {
    app.showAlert("You have to save your file before validating.");
    return null;
  }

  try {
    return await executeAsModal(async () => {
      const doc = app.activeDocument;
      console.log(`validateDoc: doc="${doc.name}", layers=${getAllLayers(doc.layers).length}`);
      const filePath = doc.path;
      const entry = await fs.getEntryWithUrl(toUXPUrl(filePath));
      const buffer = await entry.read({ format: formats.binary });

      // ── PHASE 1: Upfront data collection ─────────────────────────

      const nestedSOMap = buildNestedSOMapFast(buffer);

      const allLayers = getAllLayers(doc.layers);

      const allDescriptors = await batchPlay(
        allLayers.map(l => ({
          _obj: 'get',
          _target: [{ _ref: 'layer', _id: l.id }],
          _options: { dialogOptions: 'dontDisplay' }
        })),
        {}
      );

      const layerMap = {
        all: allLayers,
        smartObjects: [],
        textLayers: [],
        groups: [],
        other: [],
      };

      for (let i = 0; i < allLayers.length; i++) {
        const layer = allLayers[i];
        const desc = allDescriptors[i];

        if (layer.kind === 'smartObject') {
          const uuid = desc?.smartObjectMore?.ID || null;
          layerMap.smartObjects.push({ layer, descriptor: desc, uuid });
        } else if (layer.kind === 'text') {
          layerMap.textLayers.push({ layer, descriptor: desc });
        } else if (layer.layers) {
          layerMap.groups.push({ layer, descriptor: desc });
        } else {
          layerMap.other.push({ layer, descriptor: desc });
        }
      }

      // ── PHASE 2a: Nested SO detection ───────────────────────────

      const nestedLayers = [];
      const soLayers = [];
      const seenUuids = new Set();

      for (const so of layerMap.smartObjects) {
        if (!so.uuid || seenUuids.has(so.uuid)) continue;
        seenUuids.add(so.uuid);
        soLayers.push({ name: so.layer.name, id: so.layer.id, uuid: so.uuid });
        if (nestedSOMap[so.uuid]) {
          nestedLayers.push({ name: so.layer.name, id: so.layer.id, uuid: so.uuid });
        }
      }

      // ── PHASE 2b: Font detection — main document ────────────────

      const usedFonts = new Map();

      for (const { layer, descriptor } of layerMap.textLayers) {
        const tk = descriptor?.textKey;
        if (!tk) continue;
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
          if (!entry.layers.includes(layer.name)) entry.layers.push(layer.name);
        }
      }

      const installed = new Set();
      app.fonts.forEach(f => installed.add(f.postScriptName));

      const missingMainDoc = [];
      for (const [psName, info] of usedFonts) {
        if (!installed.has(psName) && !NON_FONT_NAMES.has(psName)) {
          missingMainDoc.push({ postScriptName: psName, fontName: info.fontName, usedInLayers: info.layers });
        }
      }

      // ── PHASE 2c: Font detection — inside Smart Objects ──────────

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

      // ── PHASE 2d: Missing linked SOs ─────────────────────────────
      // Linked SOs reference external files. If those files are missing,
      // translation will fail when Photoshop tries to open them.

      // Top-level: batchPlay descriptors already tell us if a link is broken
      // (smartObject.linkMissing is a runtime property Photoshop sets automatically)
      const missingLinkSamples = [];
      const seenMissingRefs = new Set();
      for (const so of layerMap.smartObjects) {
        const sm = so.descriptor?.smartObject;
        if (sm?.linked && sm?.linkMissing) {
          // Deduplicate by fileReference (multiple instances can point to same missing file)
          const ref = sm.fileReference || so.layer.name;
          if (!seenMissingRefs.has(ref)) {
            seenMissingRefs.add(ref);
            missingLinkSamples.push(so.layer.name);
          }
        }
      }

      // Nested: scan inside each unique embedded SO for SoLE layers.
      // SoLE = linked external SO inside an embedded SO — these almost always
      // have broken paths because the file reference is machine-specific.
      for (const so of soLayers) {
        const linkedNames = findLinkedLayersInSO(buffer, so.uuid);
        if (linkedNames.length > 0 && !missingLinkSamples.includes(so.name)) {
          missingLinkSamples.push(so.name);
        }
      }

      // ── PHASE 3: Fuzzy naming analysis ──────────────────────────

      const enPhrases = appState?.languageData?.["EN"];
      const fuzziness = Array.isArray(enPhrases) && enPhrases.length > 0
        ? _computeNamingFuzziness(layerMap, enPhrases)
        : null;

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
        },
        missingLinks: {
          found: missingLinkSamples.length > 0,
          count: missingLinkSamples.length,
          samples: missingLinkSamples.slice(0, 3),  // show at most 3 in the report
        },
        fuzziness,
      };
    }, { commandName: "Validate Document" });
  } catch (e) {
    console.error("validateDoc error:", e);
    return emptyResult;
  }
}


// ── TEMPORARY BENCHMARK: individual vs bulk batchPlay ──────────────
// Purpose: measure whether one bulk batchPlay call is faster than
// N individual calls when fetching SO layer descriptors.
// These are standalone test functions — they don't modify anything.
// Wire them to temp buttons or call from console, then remove.

// APPROACH A: One batchPlay call per SO layer, awaited in sequence.
// This is what validateDoc currently does (line 536).
// For 20 SO layers = 20 separate round-trips across the UXP bridge.
export async function benchmarkIndividualFetch() {
  const doc = app.activeDocument;
  if (!doc) { console.log("[bench-individual] No active document"); return; }

  // Get all layers from the DOM, keep only Smart Objects
  const allLayers = getAllLayers(doc.layers);
  const soLayers = allLayers.filter(l => l.kind === 'smartObject');
  console.log(`[bench-individual] Found ${soLayers.length} SO layers. Starting individual fetch...`);

  const t0 = Date.now();

  // Loop: one batchPlay per layer, each awaited before the next
  for (const layer of soLayers) {
    const res = await batchPlay(
      [{ _obj: 'get', _target: [{ _ref: 'layer', _id: layer.id }], _options: { dialogOptions: "dontDisplay" } }],
      {}
    );
    // Access the UUID to simulate real usage (not just fetching and discarding)
    const uuid = res[0]?.smartObjectMore?.ID;
  }

  const elapsed = Date.now() - t0;
  console.log(`[bench-individual] DONE — ${soLayers.length} individual calls took ${elapsed}ms`);
}

// APPROACH B: All SO layers fetched in a single batchPlay call.
// Packs N descriptors into one array, sends them in one round-trip.
// For 20 SO layers = 1 bridge crossing returning 20 results.
export async function benchmarkBulkFetch() {
  const doc = app.activeDocument;
  if (!doc) { console.log("[bench-bulk] No active document"); return; }

  // Get all layers from the DOM, keep only Smart Objects
  const allLayers = getAllLayers(doc.layers);
  const soLayers = allLayers.filter(l => l.kind === 'smartObject');
  console.log(`[bench-bulk] Found ${soLayers.length} SO layers. Starting bulk fetch...`);

  const t0 = Date.now();

  // Build one array of descriptors — one entry per SO layer — and send all at once
  const results = await batchPlay(
    soLayers.map(l => ({
      _obj: 'get',
      _target: [{ _ref: 'layer', _id: l.id }],
      _options: { dialogOptions: "dontDisplay" }
    })),
    {}
  );

  // Loop through results in JS (microseconds — just array access)
  for (let i = 0; i < results.length; i++) {
    const uuid = results[i]?.smartObjectMore?.ID;
  }

  const elapsed = Date.now() - t0;
  console.log(`[bench-bulk] DONE — 1 bulk call (${soLayers.length} descriptors) took ${elapsed}ms`);
}
