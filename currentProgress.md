# Current Progress

## What we are building
`translateAll` — a function that scans all visible Smart Object layers in the active Photoshop document, deduplicates instances of the same linked Smart Object, and translates each unique SO exactly once using data from the loaded Excel file.

---

## Current approach
1. Collect all visible SO layers into `smartObjectsForProcessing[]`
2. For each SO, call `phraseGuesser.guessThePhrase()` to find the matching EN phrase, translated phrase, and container folder
3. Call `processMatchedFolder()` which maps child layers inside the folder to translated lines and calls `ps.translateSmartObject()` for each
4. Use a module-level `processedIds` Set (keyed on `smartObjectMore.ID`) to skip layers already translated in this run

---

## Session log

### 1. Skipping layers during iteration (the BUY bug) ✅ FIXED
**Problem:** `for...of` over `smartObjectsForProcessing` while splicing elements out of it mid-loop. After splicing 4 instances of `testSO` (indices 0–3), the array shifted — `BUY` moved to index 0 but the iterator advanced to index 1, skipping it entirely.

**Fix:** Replaced snapshot + splice + `some()` pattern with a module-level `processedIds = new Set()`. Array is never mutated. Deduplication is done via `processedIds.has(layerSOId)` — O(1). Set is cleared at the start of each `translateAll` run.

---

### 2. Dead parameters removed from `processMatchedFolder` ✅ FIXED
**Problem:** `processMatchedFolder` still accepted `translatedSOIds, allInfos, layerIndexMap` as parameters from the old architecture. These were always `undefined` in the new flow.

**Fix:** Removed those parameters. The function now reads `processedIds` directly from module scope.

---

### 3. Confidence failure — BONUS not translated (the 0.45 bug) ✅ FIXED
**Problem:** Folder `buyBonusBtnPortrait` had 11 child layers (2 SO + shape/fill/mask layers). `childLayers` was built from ALL `folderLayer.layers`, so non-translatable types inflated `resolved.length`. With `enLines = ["BUY", "BONUS"]` (2 words) and `resolved.length = 11`, `offset = 9`, BONUS landed at `i=1 <= offset=9` → null (middle gap). Confidence was also below 0.5 → entire folder skipped.

**Fix:** Filtered `childLayers` to only `SMARTOBJECT | TEXT` kinds before passing to `matchLayersToLines`. Shape layers, fills, masks excluded. This is done in STEP 6 of `processMatchedFolder`.

---

### 4. `getSOid` — new function in `photoshop.js`
**What it does:** Calls `getLayerInfo(layer)` (single batchPlay "get") and returns `smartObjectMore.ID` — the ID of the embedded PSB document shared by all instances of a linked Smart Object.

**Why it matters:** This is the key used in `processedIds`. All copies of the same SO share this ID, so translating any one instance and storing this ID is enough to block all others.

**Usage:**
- `translateAll`: called once per layer before the guard check
- `processMatchedFolder` STEP 5: called for each child SO to populate `soIdMap`

---

### 5. `soIdMap` batchPlay bug → wrong API usage ✅ FIXED
**Problem:** STEP 5 in `processMatchedFolder` was calling:
```js
const childSOInfos = await batchPlay(
  childSOLayers.map(layer => ps.getSOid(layer)),  // returns Promises, not descriptors
  { synchronousExecution: true }
);
```
`ps.getSOid` is async — passing it inside `.map()` gives `batchPlay` an array of Promises instead of action descriptors. `soIdMap` ended up empty → deduplication never worked → every SO translated twice.

**Fix:** Replaced with a `for...of` loop that properly awaits each call:
```js
for (const layer of childSOLayers) {
  const smartObjectMoreID = await ps.getSOid(layer);
  if (smartObjectMoreID) soIdMap.set(layer.id, smartObjectMoreID);
}
```

---

### 6. Terminology cleanup ✅ DONE
Renamed all comment references from "internal SO document ID" to `SmartObjectMoreID` throughout `parsingLogic.js` for clarity and consistency with the actual Photoshop API field name (`smartObjectMore.ID`).

---

## Status — translation working ✅ (with one known bug)

The double-translation bug has been resolved. The plugin now correctly translates each unique Smart Object exactly once. Deduplication via `processedIds` and `soIdMap` is working as expected.

Diagnostic logs were added to both `photoshop.js` and `parsingLogic.js` to confirm the fix, and have since been commented out (marked `// DELETE LATER`).

---

## "command unavailable" for locked Smart Objects ✅ FIXED

**Symptom:** When `translateSmartObject` was called on a layer with `locked: true`, the `editSmartObject` batchPlay call (`placedLayerEditContents`) failed silently — Photoshop did not open the embedded PSB and left the active document unchanged. The existing `mainDocId` guard caught this and returned early, but the `editSmartObject` attempt itself still triggered an internal "command not available" error in Photoshop.

**Confirmed via diagnostic logs:** `SUPER (DO NOT TRANSLATE)` layer ID 3229 inside `buyBonusBtnActive0Portrait - EXPORT 50%` logged `locked: true`, followed by the FAILED guard firing.

**Fix applied:** Added a preflight locked-layer check in `translateSmartObject` (`photoshop.js`), immediately after the `freshSmartObject` null guard and before `editSmartObject` is ever called:

```js
if (freshSmartObject.locked) {
  // Known Photoshop behavior: editing a locked SO triggers "command unavailable".
  // Skip early to keep the run stable and avoid modal failure.
  return;
}
```

This prevents the failed batchPlay call entirely. The layer is silently skipped and the translation run continues with the next SO. No changes to the matching logic, dedup, or modal flow.

---

## Wrong words assigned to layers — the `parseRawPhrase` split bug ⚠️ UNDER INVESTIGATION

**Symptom:** A banner that should read `X2 / CHANCE / AUF DEN BONUS / AKTIV` (4 visual lines) instead renders as `X2 / CHANCE / AUF / DEN` — only 4 of 6 translated words appear, and they're wrong because the 3-word phrase `AUF DEN BONUS` has been torn apart and individual words assigned to individual SOs.

**Banner layer structure:** `[x2, FOR BONUS, CHANCE, ACTIVE, ON, Base]` — 6 layers total.

**Visual evidence:**
- Layer `FOR BONUS` (one SO, one line in Excel) → gets assigned only `"AUF"` instead of `"AUF DEN BONUS"`
- Layer `CHANCE` → gets `"AUF"`, layer `base` → gets `"BONUS"` etc.

**Root cause — two compounding issues:**

**Issue A: `parseRawPhrase("linesArray")` splits by spaces, not just newlines**

```js
if (mode === "linesArray") return lines.flatMap(l => l.split(/\s+/)).filter(Boolean);
```

EN phrase `"(X2)\nCHANCE\nFOR BONUS\nACTIVE"` → after newline split gives lines `["X2","CHANCE","FOR BONUS","ACTIVE"]`. Then `.flatMap(l => l.split(/\s+/))` **splits each line by spaces too**, giving:

```
enLines:   ["X2", "CHANCE", "FOR", "BONUS", "ACTIVE"]   ← 5 items
```

But the folder only has 3 relevant SOs (`x2`, `CHANCE`, `FOR BONUS`). `"FOR BONUS"` is one semantic unit — one line in Excel, one SO — but it's been split into two tokens. The layer name `"FOR BONUS"` fuzzy-matches `"FOR"` → gets assigned only `"AUF"`.

**Issue B: `phraseGuesser` flattens the translated phrase before returning it**

`guessThePhrase` calls `parseRawPhrase(langEntries[bestIndex], "strict")` which joins all translated lines with spaces:

```
Excel DE cell: "X2\nCHANCE\nAUF DEN BONUS\nAKTIV"
  → parseRawPhrase("strict") → "X2 CHANCE AUF DEN BONUS AKTIV"   ← flat string
```

Then `processMatchedFolder` calls `parseRawPhrase(transPhrase, "linesArray")` on that flat string, splitting by spaces again:

```
transLines: ["X2", "CHANCE", "AUF", "DEN", "BONUS", "AKTIV"]   ← 6 items
```

Now `matchLayersToLines` is trying to match 3 SOs to 6 single-word tokens — the 1:1 assumption is broken.

**The core mismatch:**
The Excel row has newline-delimited structure that maps 1 line → 1 SO. But both EN and DE phrases lose that structure before reaching `matchLayersToLines`, which then works on flat word arrays with no concept of "this phrase has multi-word tokens."

**Fix needed:**
1. `parseRawPhrase("linesArray")` should split by **newlines only**, not spaces — preserving `"FOR BONUS"` as one token.
2. `parseRawPhrase("strict")` (used to return `translatedPhrase` from `guessThePhrase`) should preserve newlines, returning a raw newline-delimited string — not flatten to a space-joined string.
3. `processMatchedFolder` then calls `parseRawPhrase(transPhrase, "linesArray")` on that newline-preserved string and gets the correct per-line tokens.

**Open question before applying the fix:**
Does the Excel DE column for this phrase actually contain newlines (`\n`), or is the whole translation on one line with spaces? If it's all on one line, the newline-split approach won't help and a different strategy is needed.

---

## Key concepts

### SmartObjectMoreID (`smartObjectMore.ID`)
The ID of the embedded PSB document inside a Smart Object. All layer instances (copies) of the same linked SO share this exact value. Translating any one instance updates all simultaneously — so the code only needs to call `translateSmartObject` once per unique `smartObjectMore.ID`.

### `processedIds` (module-level Set)
Stores `smartObjectMore.ID` values that have already been translated in the current run. Checked in both `translateAll` (to skip whole folders) and `processMatchedFolder` STEP 8 (to skip duplicate instances within a folder). Cleared at the start of each `translateAll` call.

### `soIdMap` (local Map, per folder)
Maps `layer.id → smartObjectMore.ID` for child SOs within a single folder. Built in STEP 5 of `processMatchedFolder` for O(1) lookup during STEP 8.

### `matchLayersToLines`
Matches child layers to translated lines using: exact name → fuzzy name → stack index fallback. Returns a confidence score. If confidence < 0.5, the whole folder is skipped. Uses tail-anchoring when EN has more lines than the translation.
