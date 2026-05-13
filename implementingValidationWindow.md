## Plan: Implement Validate Document Window

### 1. Data Source
- Use the validation logic from  
	[src/api/validateMasterFile.js](src/api/validateMasterFile.js)  
	(specifically, the `validateDoc` function) to gather validation results.

### 2. UI Trigger
- The window should open when the user clicks the `ValidateMFButton` component.

### 3. Window Design
- The window should be a popup overlay - you have to close it to continue working.
- Content:
	- Display validation results as text (e.g., missing fonts, nested SOs), fuzzyness of the naming of layers, folders etc.
	- Nice to have a "Success predictment" bar that goes from red to green
	- Only one action button: **Close** (closes the window).

#### d. Display Results
- In `ValidationWindow`, render:
	- Text summary of validation (e.g., "No missing fonts", "2 nested Smart Objects found").
	- A single **Close** button that calls `onClose`.

#### e. Styling
- Style the window as a modal overlay (centered, with backdrop).
- Use CSS for layout and graphics.

### 5. Testing
- Test with documents that have:
	- No issues .
	- Missing fonts.
	- Nested Smart Objects.
- Ensure the window displays correct info and closes as expected.

---

## Current Implementation

### How it's wired

The validation window uses the standard UXP modal dialog pattern. No manifest changes or new entrypoints were needed — the dialog is created dynamically from within the existing panel.

**Flow:**

1. User clicks "Validate Doc" button (`ValidateMFButton` in [src/main.jsx](src/main.jsx))
2. `handleValidateMasterFile` in `main.jsx` calls `validateDoc(appState)` from [src/api/validateMasterFile.js](src/api/validateMasterFile.js)
3. If `validateDoc` returns `null` (unsaved file, no document) — the dialog is **not** shown
4. Otherwise a `<dialog>` DOM element is created on the fly
5. `ReactDOM.createRoot` renders `<ValidationWindow>` into it, passing `results` and `dialog` as props
6. `dialog.uxpShowModal()` pops the modal — PS blocks interaction with the main panel until it's closed
7. On close, the React root is unmounted and the `<dialog>` element is removed from the DOM

### Files changed

| File | What changed |
|---|---|
| [src/main.jsx](src/main.jsx) | Added `ReactDOM` and `ValidationWindow` imports. Rewired `handleValidateMasterFile` to call `validateDoc(appState)`, create a `<dialog>`, render the component into it, and show via `uxpShowModal()`. |
| [src/components/validationWindow.jsx](src/components/validationWindow.jsx) | Receives `results` and `dialog` as props. Three sections: nested SOs, missing fonts, naming quality. |
| [src/components/validationWindow.css](src/components/validationWindow.css) | Styles for `.validationWindow`, sections, fuzziness breakdown, and button group. |
| [src/api/validateMasterFile.js](src/api/validateMasterFile.js) | Major refactor — see sections below. |
| [vite.config.js](vite.config.js) | Changed `sourcemap` to always `true` so stack traces show real file names and line numbers instead of bundled offsets. |

**No changes to:** manifest.json, api.js, index.jsx.

### Current window content

The window shows three sections:

- **Nested Smart Objects** — total count of SOs that contain nested SOs, or "No nested Smart Objects found."
- **Missing Fonts** — deduplicated list of missing font names across main document and all SOs, displayed in a single-column `sp-table` (300px height, side scroller). Shows "All fonts are installed." if clean.
- **Naming Quality** — vocabulary-based fuzzy naming analysis (see below). Shows overall score (0-100) and per-category breakdown (groups, smart objects, text layers, other). Only shown when XLSX data is loaded; otherwise displays "Load XLSX data to see naming analysis."

---

### Backend safety fixes (validateMasterFile.js)

These were added to prevent Photoshop crashes during validation:

1. **`executeAsModal` wrapping** — all batchPlay calls inside `validateDoc` now run in a modal context via `executeAsModal({ commandName: "Validate Document" })`. Prevents crashes if the user interacts with PS while validation is running.
2. **Unsaved file guard** — if `doc.path` is empty (file not yet saved), shows a PS alert "You have to save your file before validating." and returns `null`. The handler in `main.jsx` checks for `null` and skips the dialog.
3. **`decodePSString` stack overflow fix** — replaced `String.fromCharCode(...bytes.slice(start, end))` spread with a safe loop. The spread operator can exceed the JS argument limit on large engineData blobs.
4. **`liFDRecordHasNestedSO` 8BPS search fix** — removed the 400-byte search limit, now uses full-range scan with version validation (matching `extractFontsFromLiFD`). Prevents false positives from filename bytes that happen to match "8BPS".
5. **Bounds checks on DataView reads** — added `buffer.byteLength` guards before every `view.getUint32()` in `buildNestedSOMapFast` and `extractFontsFromSO`. Corrupted/unusual length fields now return empty results instead of throwing `RangeError`.
6. **`j < 4` guards** — prevents `view.getUint32(j - 4)` from reading a negative offset when scanning liFD records.
7. **Better error logging** — catch block logs the raw error value (`console.error("validateDoc error:", e)`) instead of `e.message`/`e.stack`, because UXP's `executeAsModal` can reject with non-standard error objects.

---

### Performance: Bulk batchPlay refactor

**Benchmarked first** — two temporary test functions (`benchmarkIndividualFetch`, `benchmarkBulkFetch`) were added to compare individual vs. bulk batchPlay performance. Results on a 227-SO document:

| Approach | Time |
|---|---|
| Individual (227 separate batchPlay calls) | 120 ms |
| Bulk (1 batchPlay with 227 descriptors) | 68 ms |

Bulk is ~1.8x faster. Based on these results, `validateDoc` was refactored.

**Before refactor:**
- `getAllLayers()` called once
- Individual batchPlay per SO layer to get UUID (~N calls)
- `scanMainDocFonts()` did its own `getAllLayers()` + individual batchPlay per text layer (~2M calls)
- Total: ~N + 2M batchPlay calls (for 227 SOs / 400 total layers ≈ 1027 calls)

**After refactor:**
- `getAllLayers()` called once
- **One bulk batchPlay** for ALL layer descriptors (1 call)
- Layers categorized into `layerMap { smartObjects, textLayers, groups, other }` in a single loop
- SO UUIDs extracted from `desc.smartObjectMore.ID` (already in the bulk result)
- Text layer font info extracted from `desc.textKey.textStyleRange` (already in the bulk result)
- `scanMainDocFonts()` no longer called (left in file untouched, just not invoked)
- SO instance deduplication via `seenUuids` Set
- Total: **1 batchPlay call** + binary PSD scans (unchanged)

The benchmark functions are still in the file but no longer called from `main.jsx`.

---

### Fuzzy naming analysis

Added in the bulk refactor. Scores how well the PSD's layer naming follows conventions.

**Requires XLSX data to be loaded** — `validateDoc(appState)` now accepts an optional `appState` parameter. If `appState.languageData.EN` is available, fuzzy analysis runs. Otherwise `fuzziness` is `null` in the result.

#### Vocabulary

Built from two sources:

1. **EN phrases (from XLSX)** — all lines from `languageData["EN"]`, normalized: strip `()` annotations (keep content), strip `[]` placeholders entirely, split by `\n`, uppercase. Both whole lines ("FOR BONUS") and individual words ("FOR", "BONUS") are added to the vocabulary.

2. **Hardcoded structural names** — language codes (EN, DE, HR, EL, IT, RO, PT, ES, MK, SQ, SR, UK, RU, TR, HU, CS, PT-BR, NL, DA, FR, PL, ZH-CN, SK, SL, SV, ET, KO, KA, LV, LT) + structural markers (BG, BACKGROUND, BASE, SLICES).

#### Layer classification

Each layer is classified (after stripping "copy N" suffix, normalizing to uppercase):

1. **Matched** — name is in the vocabulary (exact line match, single word match, multi-word all-in-vocab, or structural name match)
2. **Named** — not in vocabulary but not a Photoshop default (meaningful scene/feature names like "freeSpinPortrait", "buyBonusBtn")
3. **Generic** — matches a Photoshop auto-generated default pattern (`Group 1`, `Layer 1`, `Shape 1`, `Smart Object`, `Rectangle 2`, adjustment layer defaults, fill layer defaults, etc.)

#### Scoring

**Per-category score** (0-100): `score = round(((matched * 1.0 + named * 0.5) / total) * 100)`
- All matched → 100
- All meaningful but not matching → 50
- All generic → 0

**Overall score**: weighted average of non-empty categories:
- Groups: **40%** (translation relies on folder structure for phrase detection)
- Smart Objects: **50%** (primary translation targets, names used for matching)
- Text Layers: **5%**
- Other: **5%**

**Layer scope**: ALL layers including invisible/locked.

#### Return structure

```js
{
  nestedSOs: { found, count, layers },
  missingFonts: { found, count, mainDoc, smartObjects },
  fuzziness: {                          // null if XLSX not loaded
    overallScore: 0-100,
    groups:       { score, total, matched, named, generic: string[] },
    smartObjects: { score, total, matched, named, generic: string[] },
    textLayers:   { score, total, matched, named, generic: string[] },
    otherLayers:  { score, total, matched, named, generic: string[] },
  }
}
```

#### New private functions in validateMasterFile.js

| Function | Purpose |
|---|---|
| `_isGenericName(name)` | Strips "copy N" suffix, tests against `GENERIC_NAME_PATTERNS` regex array |
| `_buildVocabulary(enPhrases)` | Builds `{ lines: Set, words: Set }` from EN phrase data |
| `_classifyLayerName(name, vocabulary)` | Returns `"matched"` / `"named"` / `"generic"` |
| `_computeNamingFuzziness(layerMap, enPhrases)` | Scores each layer category, returns weighted overall score |

#### New constants in validateMasterFile.js

| Constant | Purpose |
|---|---|
| `GENERIC_NAME_PATTERNS` | Array of regexes for Photoshop default names |
| `COPY_SUFFIX_RE` | `/\s+copy(\s+\d+)?$/i` — strips copy suffixes before classification |
| `KNOWN_STRUCTURAL_NAMES` | Set of language codes + BG, BACKGROUND, BASE, SLICES |
| `NAMING_WEIGHTS` | `{ groups: 0.40, smartObjects: 0.50, textLayers: 0.05, otherLayers: 0.05 }` |

---

### What's still TODO
- "Success prediction" bar (red to green gradient)
- Better visual design for the naming quality section (CSS + data visualization)
- Potential optimization: scan GALI once for all UUIDs instead of per-SO (currently `extractFontsFromSO` re-navigates the PSD sections from scratch for each UUID)
