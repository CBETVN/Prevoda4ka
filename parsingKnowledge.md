# Parsing Smart Object Internals — Knowledge Base

## Scanning for Embedded Blobs (8BPS) Inside liFD Records

### False Positive "8BPS" Matches

The liFD record header stores the original filename as UTF-16BE. If the filename contains "8BPS" (or any byte sequence that coincidentally matches `38 42 50 53`), a naive scan will hit a false positive early in the record.

**Fix:** Always validate the version field immediately after the 4-byte signature:
- `bytes[off+4]=0x00, bytes[off+5]=0x01` → PSD (version 1)
- `bytes[off+4]=0x00, bytes[off+5]=0x02` → PSB (version 2)

Any other value means the match is NOT a real PSD/PSB header — skip it and continue scanning.

```js
for (let i = recStart; i < recEnd - 6; i++) {
  if (bytes[i]===0x38 && bytes[i+1]===0x42 && bytes[i+2]===0x50 && bytes[i+3]===0x53) {
    const ver = (bytes[i+4] << 8) | bytes[i+5];
    if (ver === 1 || ver === 2) { bpsOff = i; break; }
  }
}
```

### Don't Limit Search to 400 Bytes

The `soTextContentReader.js` limits the 8BPS search to `recStart + 400` bytes. This works for most SOs but fails when the liFD header is longer (e.g., longer filenames = more UTF-16 bytes before the actual blob). In the "chance" layer, the real 8BPS was at `recStart + 252`, but a false positive at `recStart + 135` was hit first.

**Rule:** Search the entire liFD record range (up to `recEnd`), combined with version validation, to guarantee finding the correct blob regardless of header size.

---

## Extracting Font Names from TySh (engineData)

### Where Font Data Lives

Inside an embedded PSD/PSB → Layer Info section → per-layer additional info → `TySh` blocks → `tdta` (engineData) blob.

Navigation chain:
```
Outer PSD → GALI → lnk2 block → liFD record (by UUID) → 8BPS blob →
  Color Mode Data → Image Resources → Layer and Mask Info →
    Layer Info → TySh blocks → tdta blob → /Name (font)
```

### TySh Block Structure

Found by scanning for bytes `54 79 53 68` ("TySh") in Layer Info. Structure:
```
[4 bytes: "TySh" key]
[4 bytes: block length (big-endian)]
[block data...]
```

Data starts at key+8. Block length tells you where to jump for the next scan.

### Finding tdta Inside TySh

Scan TySh block data for bytes `74 64 74 61` ("tdta"). Structure:
```
[4 bytes: "tdta" OSType]
[4 bytes: data length (big-endian)]
[raw engineData bytes...]
```

There is exactly ONE `tdta` per TySh block.

### engineData Format

The `tdta` blob is a PostScript-like ASCII text structure:
```
\n\n<<
\t/EngineDict
\t<<
\t\t/Editor
\t\t<<
...
/ResourceDict
<<
  /FontSet [
    <<
      /Name (FontPostScriptName)
      /Script 0
      /FontType 1
      /Synthetic 0
    >>
  ]
>>
```

### Font Name Encoding Inside Parentheses

**Critical gotcha:** The value inside `/Name (...)` is NOT always ASCII.

If the parenthesized string starts with bytes `FE FF` (UTF-16BE BOM), the rest of the name is UTF-16BE encoded:
```
/Name (\xFE\xFF\x00K\x00a\x00r\x00l\x00a\x00-\x00E\x00x\x00t\x00r\x00a\x00B\x00o\x00l\x00d)
```

**Decode logic:**
```js
function decodePSString(bytes, start, end) {
  if (end - start >= 2 && bytes[start] === 0xFE && bytes[start+1] === 0xFF) {
    let str = "";
    for (let i = start + 2; i < end - 1; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (code === 0) continue;
      str += String.fromCharCode(code);
    }
    return str;
  }
  return String.fromCharCode(...bytes.slice(start, end));
}
```

### /Name Pattern Scanning

ASCII pattern for `/Name (`: `[0x2F, 0x4E, 0x61, 0x6D, 0x65, 0x20, 0x28]`

Read until closing `)` = `0x29`. Then decode the content between `(` and `)` using `decodePSString`.

### What /Name Returns (Not Just Fonts!)

The `/FontSet` array in engineData contains ALL named resources, not just actual fonts. Typical results include:

| Name | What it is | Real font? |
|---|---|---|
| `Karla-ExtraBold` | Actual font PostScript name | YES |
| `Interstate-Black` | Actual font PostScript name | YES |
| `MyriadPro-Regular` | Default/fallback font | YES |
| `AdobeInvisFont` | Photoshop internal invisible font | NO — filter out |
| `PhotoshopKinsokuHard` | Japanese line-break rule set | NO — filter out |
| `PhotoshopKinsokuSoft` | Japanese line-break rule set | NO — filter out |
| `Normal RGB` | Color profile reference | NO — filter out |

**Recommendation:** Filter results against a known non-font list, or cross-reference against `app.fonts` to confirm which are real installed/missing fonts.

---

## Inner PSD vs PSB

Embedded Smart Objects can be EITHER PSD (version 1) or PSB (version 2). The outer document format doesn't dictate the inner format. Always check the version field at `8BPS+4..+5` to determine:
- Length field sizes (4 vs 8 bytes for LMI and LI sections)
- Channel data length field sizes
- Whether PSB_LARGE_KEYS applies

---

## liFD Header Variable Size

The liFD header before the embedded blob is NOT fixed-length. It depends on:
- `uniqueIdLen` (1 byte) — usually 36 (UUID) but could vary
- `filenameLen` (4 bytes) — number of UTF-16 chars in filename

Formula for preData size (bytes between `[recLen][liFD]` and `8BPS`):
```
preData = version(4) + 1 + uniqueIdLen + 4 + filenameLen*2 + fileType(4) + fileCreator(4) + dataLen(8) + [possible extra fields]
```

Observed values: 127 bytes (test file "chance"), 194 bytes (previous test file). Never hardcode.

---

## Performance Notes

- Reading the outer PSD buffer is the slowest step (~100-300ms for large files). Cache it if scanning multiple SOs in the same document.
- The GALI-to-liFD scan is fast (byte-level pattern matching).
- The TySh scan within Layer Info is fast (typically < 1ms).
- engineData blobs are small (~7-8KB per text layer) — no performance concern.

---

## UUID Matching

`batchPlay` `smartObjectMore.ID` matches the UUID stored in the liFD record reliably for read-only operations. For write operations (binary splice), use the triple-fallback approach (`soldUuid`, `bpId`, `sm.placed`) documented in AGENT_CONTEXT.md.

---

## Detecting Linked SOs with Missing Links Inside Embedded SOs

### Linked vs Embedded SO — Binary Indicators

| Block Key | Meaning | UUID extracted? | Data location |
|---|---|---|---|
| `SoLd` / `PlLd` | Embedded Smart Object | Yes (via `extractUuidFromBlock`) | PSB blob in `liFD` record inside outer `lnk2` |
| `SoLE` | **Linked External** Smart Object | No (`uuid = null`) | External file on disk (path stored in SoLE descriptor) |

When `parsePsd()` reports a layer with `SoLE` in `additionalInfo`, that layer is a **linked external SO**. Its `embeddedBlob` contains the SoLE Action Descriptor (not actual pixel/layer data).

### Key Discovery: No liFE Records Inside Inner PSBs

Linked SOs inside embedded SOs do **NOT** produce `liFE` records in the inner PSB's `lnk2` block. In fact, the inner PSB may have **no `lnk2` block at all** in its GALI section.

Instead, the linked file information is stored entirely in the layer's **SoLE block** (per-layer Additional Layer Info), not in any global resource.

**Wrong assumption:** liFE records in inner lnk2 indicate linked SOs → this approach finds nothing.
**Correct approach:** Scan inner PSB layers for `SoLE` blocks → these are the linked external SOs.

### File Path Extraction from SoLE

The SoLE block contains an Action Descriptor with the file path. However, the path is **not stored as a raw UTF-16 string** inside the SoLE blob — it's wrapped in the Action Descriptor's typed key-value format.

**Workaround:** Scan the **full PSB buffer** for Windows file path patterns (`X:\` in UTF-16BE or UTF-16LE). Then match paths to SoLE layer names by checking if the filename portion of the path contains the layer name.

```
Scan order:
1. Try SoLE blob directly (mlExtractFilePathFromRecord on embeddedBlob)
2. Fallback: scan full PSB buffer (mlFindAllFilePathsInBuffer)
3. Match path to layer by name substring
```

The full-buffer scan works because the SoLE descriptor data (including the path) is part of the inner PSB's layer records section, which is part of the buffer.

### Detection Algorithm

```
For each embedded SO (liFD record in outer lnk2):
  1. Extract inner PSB blob (extractPsbFromLiFD)
  2. parsePsd(innerPsb) → get layer list
  3. For each layer with 'SoLE' in additionalInfo:
     a. Scan SoLE blob for Windows file path (UTF-16)
     b. If not found: scan full PSB buffer, match by layer name
     c. Check file existence via fs.getEntryWithUrl(toUXPUrl(path))
     d. If file doesn't exist → MISSING LINKED SO
  4. For each layer with 'SoLd'/'PlLd' (embedded SOs):
     → Find matching liFD in inner lnk2, extract deeper PSB, recurse to step 1
```

### batchPlay Descriptor Properties (for reference)

When checking linked SOs at the **document level** (not binary), batchPlay returns:

```json
{
  "layerKind": 5,
  "smartObject": {
    "linked": true,
    "linkMissing": true,
    "fileReference": "missingFile.psd",
    "link": {
      "_path": "C:\\Users\\...\\missingFile.psd",
      "_kind": "local"
    }
  }
}
```

`linkMissing` is a **runtime property** — Photoshop checks file existence when the document is open. This property does NOT exist in the binary PSD data. For binary detection, file existence must be checked explicitly.

### Performance

Full recursive scan (doc-level batchPlay + binary descent through 3 nesting levels) completes in ~10-45ms. No SO opening required.

---

## Production Implementation: `findLinkedLayersInSO` (validateMasterFile.js)

### Overview

The missing-link detection was integrated into `validateDoc()` as **Phase 2d**. It uses a three-function recursive architecture that operates entirely on the already-loaded binary buffer — no additional file I/O or Photoshop API calls.

### Architecture — Three Functions

```
findLinkedLayersInSO(buffer, targetUuid)        ← entry point
  │
  │  Navigates outer PSD's GALI → lnk2 → liFD to find the target SO by UUID.
  │  Creates a visited Set, then hands off to:
  │
  └→ _extractAndScanForLinks(buffer, recStart, recEnd, visited)
       │
       │  Finds the 8BPS header inside the liFD record (with version validation).
       │  Slices the inner PSB buffer. Hands off to:
       │
       └→ _scanPsbForLinkedLayers(psbBuffer, visited)
            │
            │  Step 1: parsePsd(psbBuffer) → collects SoLE layer names
            │  Step 2: Navigates this PSB's own GALI → lnk2 → liFD records
            │  Step 3: For each liFD with a new UUID → calls _extractAndScanForLinks
            │          (which calls back here — this is the recursive loop)
            │
            └→ Returns accumulated SoLE layer names from all nesting levels
```

### How Recursion Works

`_scanPsbForLinkedLayers` is the recursive core. After collecting SoLE names from the current level, it navigates the PSB's own GALI section to find nested embedded SOs (liFD records). For each one not already in the `visited` Set, it calls `_extractAndScanForLinks`, which slices the deeper inner PSB and calls `_scanPsbForLinkedLayers` again — going one level deeper.

The `visited` Set (keyed on UUID) prevents infinite loops. Photoshop's layer structure is finite, so recursion naturally bottoms out when there are no more liFD records to descend into.

### Integration in validateDoc() — Phase 2d

Two checks run in sequence:

1. **Top-level linked SOs** — the bulk batchPlay descriptors from Phase 1 already contain `smartObject.linked` and `smartObject.linkMissing` (runtime properties set by Photoshop). Just loop and filter — no binary parsing needed.

2. **Nested linked SOs** — for each unique SO in `soLayers` (already deduplicated by UUID in Phase 2a), call `findLinkedLayersInSO(buffer, uuid)`. The presence of SoLE layers inside an embedded SO is the signal — linked files inside SOs are almost always broken when PSDs are shared between machines.

Results are capped at 3 sample names for the UI report.

### Return Structure

```js
missingLinks: {
  found: boolean,       // true if any missing links detected
  count: number,        // total unique SOs with missing links
  samples: string[],    // up to 3 layer names for the report
}
```

### Key Design Decisions

- **No file path extraction** — the presence of SoLE inside an embedded SO is enough to flag it. Path extraction and existence checking add complexity for minimal benefit in the validation report context.
- **Reuses existing infrastructure** — `parsePsd()` already detects SoLE blocks. The GALI navigation follows the same pattern as `extractFontsFromSO`. No existing functions were modified.
- **Pure read-only** — all three functions operate on byte arrays already in memory. No batchPlay, no executeAsModal, no document mutations. Cannot affect Photoshop state.
