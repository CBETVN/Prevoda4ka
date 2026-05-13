### Visual Reference: Transform Scale Table

#### 1. Transform scale (the main culprit)

|                | YOU WIN | CONGRATULATIONS |
|----------------|---------|-----------------|
| `transform.xx` | 0.78    | 3.17        |
| `transform.yy` | 1.32    | 3.15        |
| `size`         | 100pt   | 19pt        |
| `impliedFontSize` | 131.75pt | 59.87pt |

"CONGRATULATIONS" was created at **19pt** then scaled up **~3x** via free transform in Photoshop. The `impliedFontSize` (59.87pt) is the visual result of `19 * 3.15`. When you programmatically set the text, Photoshop can reset or recalculate that transform matrix, causing it to render at its true 19pt base size — that's your shrink.




"YOU WIN" has a large base size (100pt) with a modest transform, so there's much less to lose.
## TODO: Fix Text Shrinking on Edit (Point Text Layers)

- Issue: When editing point text layers with large transform matrices (e.g., scaled up via free transform), Photoshop resets the transform on text change, causing the text to shrink to its base size. This is compounded if the font is missing and substituted.
  - Example: "CONGRATULATIONS" layer shrinks after edit because it was created at 19pt and scaled up ~3x; transform is lost on edit.
  - "YOU WIN" layer uses a large base size and is less affected.
- Paragraph text layers do not have this problem, as their size is defined by the bounding box and point size, not a transform matrix.
- Workaround: Before editing text, save the transform matrix (textKey.transform), set the new text, then immediately reapply the transform via batchPlay.
- Alternative: Flatten the size by multiplying the point size by the transform factor and resetting the transform, but this permanently changes the layer.
- Action: Review and update text editing code to save/restore the transform matrix when editing point text layers to prevent unwanted shrinking.
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

---

## Session — May 3 2026

### Pipeline is working end-to-end ✅

Full translation run now completes correctly for the test PSD. Core pipeline:
- `translateAll` → `guessThePhrase` → `processMatchedFolder` → `getTranslatableLayers` → `matchLayersToLines` → `translateSmartObject`

**What was fixed this session:**

**`parseRawPhrase("linesArray")` was splitting by spaces, not just newlines** ✅ FIXED
`"FREE\nSPINS\nYOU WIN"` → was producing `["FREE","SPINS","YOU","WIN"]`. Fixed to return the newline-split array directly: `["FREE","SPINS","YOU WIN"]`. Each entry now maps to exactly one SO layer.

**`phraseGuesser` was flattening the translated phrase to a single string** ✅ FIXED
`guessThePhrase` was calling `parseRawPhrase(langEntries[bestIndex], "strict")` which collapsed the DE phrase `"HERZLICHEN GLÜCKWUNSCH\nSIE GEWINNEN\nFREISPIELE"` into `"HERZLICHEN GLÜCKWUNSCH SIE GEWINNEN FREISPIELE"` — a flat string with no newline structure. Changed to `"raw"` mode so newlines are preserved. `processMatchedFolder` can now correctly split it into one entry per SO.

**`getTranslatableLayers` phrase-line filter only did exact match** ✅ FIXED
When the Excel phrase has `"FREE SPINS"` as one line but the PSD has two separate SOs named `"FREE"` and `"SPINS"`, neither passed the exact filter. Added word-in-line matching: a layer name passes if it equals any phrase line OR is one word within a multi-word phrase line.

**`matchLayersToLines` — word-in-line duplicate handling** ✅ FIXED
When two PSD layers (`"FREE"` and `"SPINS"`) both resolve to the same EN line index (`"FREE SPINS"` at index 2), the first gets the translation and the second gets `null` (untouched). Added `assignedEnIndices` Set to track this. Branching is now based on `enLines.length` vs `transLines.length` (not `resolved.length`) so word-in-line duplicates don't skew the offset.

**Skip logs added** ✅ DONE
Every SO now logs its outcome:
- `[translated SO] "FREE" → "FREISPIELE"` — actually translated
- `[skipped SO] "SPINS" → untouched (no translation assigned)` — word-in-line duplicate
- `[skipped SO] "x2" → already translated (same SO in earlier folder)` — processedIds dedup

---

## Known bugs

### BUG — `ACTIVE` translated to wrong line when a phrase line is missing from the PSD folder

**Symptom from logs:**
```
folder "EN" → expected SO names from phrase: [X2, CHANCE, FOR BONUS, ACTIVE] → matched 3 SO(s): ["FOR BONUS", "CHANCE", "ACTIVE"]
[translated SO] "ACTIVE" → "AUF DEN BONUS"   ← wrong, should be "AKTIV"
```

**Root cause:** The PSD folder is missing the `x2` layer. `getTranslatableLayers` returns 3 layers with EN indices 1, 2, 3 (CHANCE=1, FOR BONUS=2, ACTIVE=3). `uniquePosition` counts 0, 1, 2 — but `transLines[0]` = "X2", `transLines[1]` = "CHANCE", `transLines[2]` = "AUF DEN BONUS", `transLines[3]` = "AKTIV". ACTIVE is at `uniquePosition=2` which maps to `transLines[2]` = "AUF DEN BONUS" instead of `transLines[3]` = "AKTIV".

**Fix needed:** When `enLines.length === transLines.length`, use `enIndex` directly as the `transLines` index instead of `uniquePosition`. This way ACTIVE at `enIndex=3` → `transLines[3]` = "AKTIV" correctly, regardless of how many other phrase lines are missing from the PSD.

---

### BUG — `processMatchedFolder` called N times for same folder ⚠️ TODO

**Problem:** `translateAll` loops over `smartObjectsForProcessing` — one entry per unique SO. Multiple SOs can share the same container folder (e.g. `x2`, `CHANCE`, `FOR BONUS`, `ACTIVE`, `ON` all live inside the same folder). For each of those SOs, `guessThePhrase` returns the same container → `processMatchedFolder` is called once per SO. `processedIds` prevents double-translating but `getTranslatableLayers` and `matchLayersToLines` still run redundantly, and the logs are noisy.

**Proposed fix:** Pass `processedIds` into `getTranslatableLayers`. When all SOs in the folder are already in `processedIds`, it returns 0 layers → `processMatchedFolder` exits early after the first real call.

---

## Session — May 3 2026 (continued) — "do not translate" support

### Challenge: some phrase lines are not meant to be translated

By design, certain words in a banner are language-neutral and must keep their original text — e.g. `x2`, `CHANCE`, `SUPER`. In the Excel file these lines are marked with parentheses: `(x2)`, `(CHANCE)`, `(SUPER)`. The existing `parseRawPhrase` strips the `()` brackets and keeps the content, so those words end up in `enLines` and `transLines` just like any other line. Nothing in the pipeline knew to leave them untouched.

### Challenge: skipping a layer without advancing the position counter caused wrong translations

The first implementation added a skip check but returned early **without** adding the layer's `enIndex` to `assignedEnIndices`. This meant the position counter (`uniquePosition = assignedEnIndices.size`) didn't advance past the skipped slot:

```
EN:    [X2=0, CHANCE=1, FOR BONUS=2]
trans: [X2,   CHANCE,   AUF DEN BONUS]

x2 skipped → assignedEnIndices={}, size=0
CHANCE     → uniquePosition=0 → transLines[0] = "X2"        ← WRONG
FOR BONUS  → uniquePosition=1 → transLines[1] = "CHANCE"    ← WRONG
```

Every layer after the skipped one got shifted one slot back and received the wrong translation.

### Fix — `doNotTranslate` skip advances `assignedEnIndices` ✅ FIXED (`parsingLogic.js`)

Added `assignedEnIndices.add(enIndex)` to the skip branch so the position counter still advances:

```js
if (doNotTranslate.has(layer.name.trim().toUpperCase())) {
  result.set(layer.id, null);
  assignedEnIndices.add(enIndex);  // advance counter — next layer gets the correct trans slot
  return;
}
```

Result with the fix:
```
x2        → skipped, assignedEnIndices={0}, size=1
CHANCE    → uniquePosition=1 → transLines[1] = "CHANCE"       ✓
FOR BONUS → uniquePosition=2 → transLines[2] = "AUF DEN BONUS" ✓
```

### `buildDoNotTranslateSet` — reading `()` markers from the EN phrase ✅ FIXED

The hardcoded skip set has been replaced with `buildDoNotTranslateSet(rawEnPhrase)` in `parsingLogic.js`. It scans the raw EN phrase for lines where the **entire content is wrapped in `()`** and returns those as a `Set` of uppercase names to skip.

```js
// "(X2)\nCHANCE\nFOR BONUS\nACTIVE" → Set{"X2"}
function buildDoNotTranslateSet(rawEnPhrase) {
  const set = new Set();
  for (const line of rawEnPhrase.split("\n")) {
    const match = line.trim().match(/^\(([^)]+)\)$/);
    if (match) set.add(match[1].trim().toUpperCase());
  }
  return set;
}
```

`processMatchedFolder` calls `buildDoNotTranslateSet(matchedPhrase)` before calling `matchLayersToLines` and passes the result as the 4th argument. `matchLayersToLines` signature is now `(childLayers, enLines, transLines, doNotTranslate = new Set())`. The skipped layer's `enIndex` is still added to `assignedEnIndices` so subsequent layers receive the correct trans slot — positional alignment is preserved.

---

## Session — May 7 2026 — Recursive SO translation + Missing font replacement

### Recursive SO translation ✅ WORKING

Smart Objects can contain nested SOs — an SO inside an SO containing the actual text layer. `translateSmartObject` previously only went one level deep: open SO → find text layers → translate. If no text layers were found, it closed and gave up.

**Fix:** Added `translateSmartObjectRecursive` and `_translateSOContentsRecursive` — a recursive variant that, after translating any text layers at the current level, also enters nested SOs and repeats the process. Gated by `RECURSIVE_SO = true` flag. A single if-statement at the top of the original `translateSmartObject` redirects to the recursive path. Original code is completely untouched below that line.

**Key details:**
- `purgeSOInstancesFromArray` is used at each recursion level to deduplicate nested SO instances
- `cropCanvasToLayerBounds` only runs at the top-level SO (controlled by `isTopLevel` parameter)
- Each recursion level saves and closes its own SO document, naturally unwinding the PS document stack
- No depth limit needed — Photoshop's own layer structure is finite

**Revert:** `RECURSIVE_SO = false` → one-line redirect stops firing, old code runs unchanged.

---

### Missing font replacement ✅ WORKING

**Problem:** PSD files often contain text layers using fonts not installed on the current machine. Photoshop substitutes Myriad Pro, which looks wrong. The plugin needed to replace missing fonts with a configurable fallback.

**What didn't work (the journey):**

- `textItem.contents` (PS DOM API for writing text) permanently destroys any font that PS internally considers "was missing" — even if the font has been fixed by `remapFonts` beforehand. Installed fonts survive the write; previously-missing fonts revert to Myriad Pro. This is a PS internal behavior, not a bug in our code.
- Setting the font via `textStyle` batchPlay before OR after `textItem.contents` — PS ignores it for previously-missing fonts.
- Calling `remapFonts` after all writes — the writes already changed the font identity from Karla to Myriad Pro, so `remapFonts` has nothing to match on.
- Saving after `remapFonts` to "bake it in" before writing — still didn't survive `textItem.contents`.

**The working solution — two-part approach:**

**Part 1: `remapFonts` before the loop** — PS's built-in `remapFonts` batchPlay command replaces all instances of a missing font across the entire document in one call. This runs once, before any text is written. After this call, all layers report the fallback font with `fontAvailable: true`.

**Part 2: Atomic batchPlay write instead of `textItem.contents`** — For layers that had missing fonts, we bypass `textItem.contents` entirely. Instead, we write text + font + size in one atomic `set textLayer` batchPlay call with `textKey` + `textStyleRange`. This write method does NOT trigger PS's font destruction behavior. Layers with installed fonts still use the normal `textItem.contents` + size restore path (proven and safe).

**Implementation flow in the translate loop:**

```
STEP A: Snapshot all layer descriptors (preRemapInfos)
        → Used to detect which layers have fontAvailable === false

STEP B: remapMissingFontsInDocument(preRemapInfos)
        → Scans all descriptors, collects unique missing fontName|fontStyleName combos
        → Fires ONE remapFonts batchPlay call mapping them all to FALLBACK_FONT

STEP C: Re-fetch descriptors (allInnerInfos)
        → Now contains the remapped font names (e.g. "Ethnocentric" instead of "Karla")

STEP D: For each text layer:
        → Read fontWasMissing from preRemapInfos (BEFORE remap snapshot)
        → If fontWasMissing:
            Atomic batchPlay write: set textLayer with textKey + textStyleRange
            (font name comes from post-remap descriptor)
        → If font was fine:
            Normal textItem.contents + size restore (existing code)
```

**Key functions:**
- `layerHasMissingFont(descriptor)` — pure sync check, reads `fontAvailable` from a pre-captured descriptor. No batchPlay.
- `remapMissingFontsInDocument(descriptors)` — scans all descriptors, deduplicates missing fonts, fires one `remapFonts` call.

**Configuration:**
```js
const REPLACE_MISSING_FONTS = true;
const FALLBACK_FONT = {
  fontName: "Ethnocentric",
  fontStyleName: ""
};
```

**Revert:** `REPLACE_MISSING_FONTS = false` → all font logic is skipped, every layer uses `textItem.contents` as before.

**Applied to both:** original `translateSmartObject` and `_translateSOContentsRecursive`.

---

## Session — May 10 2026 — Font change architecture refactored

### Previous state: hardcoded `FALLBACK_FONT`

The font replacement system used a hardcoded `FALLBACK_FONT` object (`{ fontName: "Ethnocentric", fontStyleName: "" }`) in `photoshop.js`. There was no UI to choose a substitute font — it was always Ethnocentric.

### Current state: user-selectable substitute font via dropdown

The hardcoded `FALLBACK_FONT` has been replaced with a **module-level `substituteFont` variable** in `fontManager.js`, set by the user through a dropdown in the UI.

**Full data flow:**

```
UI (fontSelectorDropdown.jsx)
  → user picks a font from <sp-picker>
  → onFontChange callback fires in main.jsx
  → calls setSubstituteFont(fontName) from fontManager.js
  → sets module-level `substituteFont` variable

Translation run (photoshop.js)
  → translateSmartObject / _translateSOContentsRecursive
  → STEP A: snapshot all layer descriptors (preRemapInfos)
  → STEP B: calls changeFont(preRemapInfos) from fontManager.js
    → changeFont scans descriptors for fontAvailable === false
    → builds remapFonts batchPlay call mapping missing fonts → substituteFont
    → if substituteFont is null, warns and returns false (no remap)
  → STEP C: re-fetch descriptors (allInnerInfos) with updated font names
  → STEP D: per layer — if font was missing, uses atomic batchPlay write with remapped font;
            otherwise uses normal textItem.contents path
```

**Key files and their roles:**

| File | Role |
|------|------|
| `fontManager.js` | Owns `substituteFont` state, exports `setSubstituteFont()`, `getAllFonts()`, `changeFont()` |
| `photoshop.js` | Imports `changeFont`, calls it during translation with pre-remap descriptors. Still owns `REPLACE_MISSING_FONTS` flag and `layerHasMissingFont()` |
| `fontSelectorDropdown.jsx` | Stateless UI — `<sp-picker>` dropdown listing all installed fonts |
| `main.jsx` | Wires it together: state (`availableFonts`, `selectedFont`), passes props to dropdown, calls `setSubstituteFont` on change |
| `LoadFDiskButton.jsx` | On file load, calls `getAllFonts()` and passes result up via `onFileLoaded` callback |

**How fonts are loaded into the dropdown:**
1. User clicks "Load File" → `LoadFDiskButton` calls `api.getAllFonts()`
2. `getAllFonts()` reads `app.fonts`, extracts font names into a deduplicated sorted array
3. Array is passed back to `main.jsx` via `onFileLoaded({parsedData, availableFonts})`
4. `main.jsx` stores it in `availableFonts` state → passed as prop to `FontSelectorDropdown`

**Current issues / rough edges:**

1. **`fontStyleName` is set to `substituteFont` (the font name)** — in `changeFont()` line 108, the `toFont` entry sets both `fontName` and `fontStyleName` to the same `substituteFont` string. This may not be correct — `fontStyleName` should typically be a style like `"Regular"`, `"Bold"`, etc. Works for fonts with a single style but may fail for multi-style families.

2. **`getAllFonts()` returns `font.name` (not `postScriptName` or `family`)** — the dropdown lists `font.name` values, and `setSubstituteFont` stores one of these. `changeFont()` then uses it as `fontName` in the `remapFonts` batchPlay call. This works if PS `remapFonts` accepts the `name` field, but PS batchPlay font APIs sometimes expect `postScriptName`. Needs verification that the remap actually applies correctly for all fonts.

3. **Dead test function** — `changeFontToPanoptica()` at the bottom of `fontManager.js` (line 136) is a leftover test function, never exported or called.

4. **`REPLACE_MISSING_FONTS` flag still lives in `photoshop.js`** — the gating logic is split: `photoshop.js` owns the flag and `layerHasMissingFont()`, while `fontManager.js` owns the remap logic. Could be consolidated.

5. **No guard if user doesn't select a font** — if the user runs a translation without picking a font, `substituteFont` is `null`. `changeFont()` handles this (warns + returns false), but the atomic write path in `photoshop.js` still checks `fontWasMissing` and may attempt a write with the un-remapped (broken) font name.
