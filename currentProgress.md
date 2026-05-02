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

## Known bug — "command unavailable" for locked Smart Objects ⚠️ TODO
**Symptom:** When `translateSmartObject` is called on a layer that has `locked: true`, the `editSmartObject` batchPlay call fails silently — Photoshop does not open the embedded PSB. The active document stays the same (main PSD). The `mainDocId` guard catches this and returns early, but the `editSmartObject` attempt itself still triggers an internal "command not available" error in Photoshop.

**Example:** `SUPER (DO NOT TRANSLATE)` layer ID 3229 inside `buyBonusBtnActive0Portrait - EXPORT 50%` — confirmed `locked: true` in console logs.

**Fix needed:** Add an early return in `translateSmartObject` (in `photoshop.js`) before calling `editSmartObject`, when `freshSmartObject.locked === true`:
```js
if (freshSmartObject.locked) {
  console.warn(`[translateSmartObject] Skipping "${freshSmartObject.name}" — layer is locked`);
  return;
}
```
This prevents the failed batchPlay call entirely.

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
