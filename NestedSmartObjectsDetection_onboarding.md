
# Agent Onboarding: Fast Nested Smart Object Detection in PSB/PSD Files

## Problem

Detect which Smart Object layers contain nested Smart Objects in a **1GB+ PSB file**. The naive approach (`placedLayerEditContents`) took 30+ seconds and crashed. Full buffer scan took 12,700ms.

**Target:** Build a UUID→boolean map (`{ uuid: hasNestedSO }`) fast enough to be practical.

---

## PSD/PSB File Structure (Sequential Sections)

```
[26 bytes]  Header (signature, version, channels, size, depth, color mode)
[4+N bytes] Color Mode Data (4-byte length prefix)
[4+N bytes] Image Resources (4-byte length prefix)
[4/8+N]     Layer and Mask Info ← lnk2 lives here (4-byte PSD / 8-byte PSB length)
[N bytes]   Image Data ← SKIP ENTIRELY (composited pixels, huge)
```

Inside **Layer and Mask Info**:

```
[4/8+N]  Layer Info (4-byte PSD / 8-byte PSB length prefix)
[4+N]    Global Layer Mask Info (always 4-byte length)
[rest]   Global Additional Layer Info (GALI) ← lnk2 usually here
```

---

## Key Byte Signatures (all proven)

| Pattern | Hex              | Purpose                                  |
|---------|------------------|------------------------------------------|
| `8BPS`  | `38 42 50 53`    | PSD/PSB file signature                   |
| `8BIM`  | `38 42 49 4D`    | Standard resource block marker           |
| `8B64`  | `38 42 36 34`    | Large resource block marker (PSB)        |
| `lnk2`  | `6C 6E 6B 32`    | Linked layer data key                    |
| `lnkD`  | `6C 6E 6B 44`    | Linked layer data key (alt)              |
| `lnk3`  | `6C 6E 6B 33`    | Linked layer data key (alt)              |
| `liFD`  | `6C 69 46 44`    | Linked File Data record (one per embedded SO) |

**Version detection:**

- **PSD:** `bytes[4]=0x00`, `bytes[5]=0x01`
- **PSB:** `bytes[4]=0x00`, `bytes[5]=0x02`

**lnk2 block length field:**

- **PSB outer file:** always 8 bytes even with `8BIM` marker
- **PSD outer file:** 4 bytes unless `8B64` marker

---

## The Algorithm: `buildNestedSOMapFast(buffer)`

### Step 1 — Jump to GALI (skip ~90% of file):

```js
const colorModeLen = view.getUint32(26, false);
const imgResOffset = 26 + 4 + colorModeLen;
const imgResLen = view.getUint32(imgResOffset, false);
const layerMaskOffset = imgResOffset + 4 + imgResLen;

const layerMaskLen = isPsb
  ? view.getUint32(layerMaskOffset,false)*0x100000000 + view.getUint32(layerMaskOffset+4,false)
  : view.getUint32(layerMaskOffset, false);
const layerMaskStart = layerMaskOffset + (isPsb ? 8 : 4);

let pos = layerMaskStart;
const layerInfoLen = isPsb
  ? view.getUint32(pos,false)*0x100000000 + view.getUint32(pos+4,false)
  : view.getUint32(pos, false);
pos += (isPsb ? 8 : 4) + layerInfoLen;
if (pos % 2 !== 0) pos++; // 2-byte alignment
const globalMaskLen = view.getUint32(pos, false);
pos += 4 + globalMaskLen;
// pos is now at GALI start
```

### Step 2 — Find lnk2 block (fast byte scan, no string allocations):

```js
if (bytes[i] !== 0x38 || bytes[i+1] !== 0x42) continue; // fast reject
const is8B64 = bytes[i+2]===0x36 && bytes[i+3]===0x34;
const is8BIM = bytes[i+2]===0x49 && bytes[i+3]===0x4D;
if (!is8BIM && !is8B64) continue;
if (bytes[i+4]!==0x6C||bytes[i+5]!==0x6E||bytes[i+6]!==0x6B) continue;
const b7 = bytes[i+7];
if (b7!==0x32 && b7!==0x44 && b7!==0x33) continue;
```

### Step 3 — Scan for liFD signatures directly (robust against padding):

```js
// DO NOT walk by record length — padding between records causes misalignment
// DO scan for liFD signature directly:
for (let j = blockStart; j < blockEnd - 8; j++) {
  if (bytes[j]!==0x6c||bytes[j+1]!==0x69||bytes[j+2]!==0x46||bytes[j+3]!==0x44) continue;
  const recLen = view.getUint32(j - 4, false); // length is 4 bytes BEFORE the signature
  const recStart = j - 4;
  const recEnd = Math.min(recStart + 4 + recLen, blockEnd);
  const uuid = extractUuidFromBlock(buffer, j, recEnd);
  if (uuid && !(uuid in map)) {
    map[uuid] = liFDRecordHasNestedSO(bytes, view, recStart, recEnd);
  }
  j = recEnd - 1;
}
```

### Step 4 — Check inner blob in-place (`liFDRecordHasNestedSO`):

```js
// Find 8BPS inside the liFD record (first ~400 bytes)
// Then jump through inner blob's sections to its GALI
// Scan only inner GALI for lnk2 — no blob extraction, no memory copy
// FALLBACK: if GALI jump fails, scan full record with correct isPsb
const fallbackIsPsb = bpsOff>=0 && bytes[bpsOff+4]===0x00 && bytes[bpsOff+5]===0x02;
return bytesHasLnk2(bytes, view, recStart, recEnd, fallbackIsPsb);
```

---

## Critical Lessons Learned

1. **Never walk lnk2 records by length prefix** — there are padding bytes between records that break the offset math. Always scan for `liFD` signature directly.
2. **lnk2 block starts with 4 zero padding bytes** before the first record — if you must walk by length, skip them (`blockStart + 4`).
3. **PSB lnk2 length is always 8 bytes** even when the block marker is `8BIM` (not `8B64`). Condition: `is8B64 || isPsb`.
4. **lnk2 location varies:** PSB inner blobs → GALI. PSD inner blobs → may be in per-layer additional info (inside Layer Info). The fallback scan of the full record catches both.
5. **Never hardcode `isPsb=false` in the fallback** — inner blobs have their own version independent of the outer file.
6. **String allocations in hot loops kill performance** — `String.fromCharCode` on every byte of a 950MB scan = millions of allocations = 12s. Direct byte comparisons = 100ms.
7. **Deduplication by UUID** — multiple layers share the same embedded blob. `if (uuid && !(uuid in map))` avoids redundant processing.

---

## Performance Results

| Approach | Time (1GB PSB, 78 SOs) |
|---|---|
| `placedLayerEditContents` | 30s+ / crash |
| Full buffer scan + string allocs | 12,700ms |
| GALI jump + string allocs | 12,000ms (no improvement — scan was bottleneck) |
| **GALI jump + byte comparisons + in-place inner GALI** | **110ms** ✅ |

**~115x speedup.** File read dominates at ~340ms.

