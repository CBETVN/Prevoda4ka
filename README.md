# Prevoda4ka


## What Is This?

**Prevoda4ka** is an **Adobe Photoshop UXP plugin** that automates the translation of text inside **Smart Objects and plain text layers** in PSD/PSB files using a pre-prepared Excel translation table.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Boilerplate | Bolt UXP: https://hyperbrew.co/resources/bolt-uxp |
| Runtime | Adobe UXP (Unified Extensibility Platform) inside Photoshop |
| Framework | React 19 (JSX) |
| Build Tool | Vite 6 + `vite-uxp-plugin` |
| Package Manager | npm |
| Excel Parsing | SheetJS (`xlsx.full.min.js`) bundled as a UMD lib in `/src/lib/` |
| Photoshop API | `photoshop` UXP module (batchPlay, executeAsModal, app) |
| PSD Binary Parsing | Custom binary parser (`psdParser.js`, `validateMasterFile.js`) for nested SO detection, font extraction, and linked layer scanning — reads raw PSD/PSB bytes without Photoshop API |
| Filesystem API | `uxp.storage.localFileSystem` |
| Styling | CSS + CSS variables for UXP theming |

**Dev commands:**
- `npm run dev` — watch build (for live plugin reloading in PS)
- `npm run build` — production build
- `npm run ccx` — package as `.ccx` for distribution

---

## Project Structure

```
Prevoda4ka/
├── src/
│   ├── index.jsx              # UXP entry point
│   ├── main.jsx               # Root App component — all state lives here
│   ├── globals.js             # Safe require() shims for uxp + photoshop modules
│   ├── api/
│   │   ├── api.js                   # Unified API object exported to components
│   │   ├── photoshop.js             # All PS-specific functions (translateSmartObject, recursive SO translation, font replacement, canvas cropping, etc.)
│   │   ├── excelParser.js           # Excel file parsing — file/ArrayBuffer in → { languageData, availableLanguages } out
│   │   ├── parsingLogic.js          # translateAll, processMatchedFolder, matchLayersToLines, parseRawPhrase, buildDoNotTranslateSet
│   │   ├── phraseGuesser.js         # guessThePhrase — walks layer ancestry to find EN phrase + translation
│   │   ├── getTranslatableLayers.js # Returns SO/text child layers for a folder, filtered and deduped
│   │   ├── validateMasterFile.js    # Binary PSD analysis: nested SO detection, font scanning (main doc + inside SOs), missing link detection, naming quality scoring
│   │   ├── fontManager.js           # Font replacement engine: getAllFonts, setSubstituteFont, changeFont (missing font remap + installed font swap)
│   │   ├── psdParser.js             # Low-level PSD/PSB binary parser (layer records, additional info blocks, UUID extraction)
│   │   ├── uxp.js                   # UXP filesystem helpers, plugin info, color scheme
│   │   └── utils/                   # Shared utility helpers
│   ├── components/
│   │   ├── LoadFDiskButton.jsx           # Load Excel from disk via file picker
│   │   ├── LoadFURLButton.jsx            # Load Excel from URL (disabled)
│   │   ├── LanguageSelectorDropdown.jsx  # Dropdown to pick target language
│   │   ├── FontSelectorDropdown.jsx      # Dropdown to pick substitute font for missing fonts
│   │   ├── DataStatusIcon.jsx            # Visual indicator: data loaded or not (earth icon)
│   │   ├── TranslateAllButton.jsx        # Triggers translateAll() for entire document
│   │   ├── TranslateSelectedButton.jsx   # Triggers translateSelected() for active layer
│   │   ├── TranslateSelectedTextField.jsx# Manual translation input field
│   │   ├── GenerateSuggestionsButton.jsx # Triggers suggestion generation for selected layer
│   │   ├── GuessThePhrase.jsx            # Debug UI for testing phraseGuesser on selected layer
│   │   ├── SuggestionsContainer.jsx      # Scrollable list of translation suggestions
│   │   ├── TranslateSuggestion.jsx       # Individual suggestion item (selectable)
│   │   ├── PhraseReference.jsx           # Shows original EN phrase for reference
│   │   ├── ValidateMFButton.jsx          # UI trigger for document validation
│   │   ├── validationWindow.jsx          # Modal dialog displaying the validation report
│   │   └── ResetButton.jsx              # Reloads the plugin (full state reset)
│   ├── assets/
│   │   └── icons/                        # Plugin icons (light/dark theme, active/inactive states)
│   └── lib/
│       └── xlsx.full.min.js              # Bundled SheetJS (accessed via window.XLSX)
├── public/
│   └── icons/                 # Plugin panel icons (dark@1x/2x, light@1x/2x) — copied to dist/ by Vite
├── uxp.config.js              # Plugin manifest config
├── vite.config.js             # Build config
└── package.json
```

---

## State Management

All state lives in `main.jsx` (App component). **No external state library** — plain React `useState`.

| State | Type | Purpose |
|---|---|---|
| `languageData` | `Object` | Keys = language codes (EN, DE, BG...), values = arrays of translation strings |
| `availableLanguages` | `Array<string>` | Language codes parsed from Excel header row |
| `selectedLanguage` | `string` | Currently selected target language |
| `isDataLoaded` | `boolean` | Whether Excel was successfully parsed |
| `availableFonts` | `Array<string>` | All installed font names (populated at Excel load time) |
| `selectedFont` | `string` | Currently selected substitute font |
| `suggestions` | `Array<{id, text, placeholder}>` | Translation suggestions for the selected layer |
| `selectedId` | `number\|null` | Currently selected suggestion ID |
| `isProcessing` | `boolean` | Guards async operations |
| `textfieldValue` | `string` | Manual translation input value |

The `appState` object bundles relevant state into a single prop passed down to components/functions that need context.

---

## UI Workflow

The plugin UI is organized into three steps:

**STEP 1 — Load & Configure:**
- Load Excel translation file (from disk or URL)
- Select target language from dropdown
- Optionally select a substitute font (for documents with missing fonts)
- Validate the document (opens a report dialog)
- Reset button reloads the plugin

**STEP 2 — Translate All:**
- Translates all matching Smart Objects and text layers in the document
- Performs pre-flight guards: document format (PSD/PSB only), structure (must have both SOs and groups), language selection, and loaded data

**OPTIONAL — Manual Translation:**
- Generate translation suggestions for a selected layer
- Select from suggestions or type manual translation
- Translate individual selected layer

---

## Excel Translation File Format

The Excel file has this structure:

![Excel format example](src/assets/excelimage.png)

- Row 0 = language codes (column headers). Special columns like `Screen Preview` are ignored.
- Row 1+ = translation pairs. EN column is the lookup key; other columns are translations.
- `languageData["EN"][i]` corresponds to `languageData["DE"][i]` — **index-aligned arrays**.
- Multi-word phrases appear as a single cell. Multi-line phrases (e.g. `FREE\nSPINS`) are split and individual lines matched separately.

---

## Sample Translation Data

> The following is a sample of the actual translation table, converted from the original `.xlsx` file. It illustrates the real structure, content, and edge cases the plugin must handle — including multiline phrases, `[NUMBER]` placeholders, `(do not translate)` markers, missing cells, and entries that only cover a subset of languages.

```csv
Screen preview,EN,DE,HR,EL,IT,RO,PT,ES,MK,SQ,SR,UK,RU,TR,HU,CS,PT-BR,NL,DA,FR,PL,ZH-CN,SK,SL,SV,ET,KO,KA,LV,LT,,,
,"CONGRATULATIONS
YOU WIN
[NUMBER]
FREE SPINS","HERZLICHEN GLÜCKWUNSCH
SIE GEWINNEN
[NUMBER]
FREISPIELE",...
,"+ [NUMBER]
FREE SPINS
WITH INCREASED MULTIPLIERS","+ [NUMBER]
FREISPIELE
MIT ERHÖHTEN MULTIPLIKATOREN",...
,"TOTAL
WON",GESAMTGEWINN,...
,"TOTAL
CREDITS
WON","GESAMTZAHL 
GEWONNER CREDITS",...
,"FREE SPINS

[NUMBER]  OF [NUMBER]  ","FREISPIELE

[NUMBER] VON [NUMBER]",...
,"SUPER (do not translate!)
FREE SPINS
[NUMBER]  OF [NUMBER] ","SUPER
FREISPIELE
(value) VON (value)",...
,MULTIPLIERS,MULTIPLIKATOREN,...
,BUY BONUS,"BONUS 
KAUFEN",...
,ACTIVE,AKTIV,...
,RESPIN,Neudreh,...
,YOU WIN,SIE GEWINNEN,...
,WIN,GEWINN,...
,COLLECTED,EINGESAMMELT,...
,BACK IN THE GAME,ZURÜCK IM SPIEL,...
,1 free respin,1 kostenloser Neudreh,...
,SELECT FREE SPINS,Freispiele auswählen,...
,0 SPINS REMAINING,0 VERBLEIBENDE DREHS,...
,SPINS COMPLETED,ABGESCHLOSSENE DREHS,...
```

---

## PSD Naming Convention

The plugin relies on layer names inside the PSD to match against the EN phrase table. Correct naming is the foundation of automatic translation.

### Smart Object Naming

Smart Object (SO) names must match the **individual words/lines** of an EN phrase from the Excel table. The plugin collects all SO and text layer names within a folder, combines them into a compound, and scores it against EN phrases.

**Example — phrase `"FREE\nSPINS"` (two lines in Excel):**

The containing folder should have two SOs (or text layers) named:
```
📁 freeSpinsContainer/
  🔲 FREE          ← SO or text layer, name = first line of EN phrase
  🔲 SPINS         ← SO or text layer, name = second line of EN phrase
```

**Multi-line phrases** are split by newline. Each line becomes an independent layer name to match:
```
EN cell: "CONGRATULATIONS\nYOU WIN\n[NUMBER]\nFREE SPINS"

📁 congratulationsGroup/
  🔲 CONGRATULATIONS
  🔲 YOU WIN
  🔲 [NUMBER]         ← placeholder — kept as-is or skipped via do-not-translate
  🔲 FREE SPINS
```

**Naming rules:**
- Names are **case-insensitive** — `free`, `FREE`, `Free` all match
- **"Copy N" suffixes** are stripped before matching — `"Free copy 3"` → `"Free"`
- **Short/noise names** with zero word overlap with any EN phrase (e.g. `"Base"`, `"off"`) are filtered out
- SO names should match EN phrase lines **exactly** (after normalization). Partial matches fall back to fuzzy scoring

### Indexing / Layer Order

When multiple layers match the same EN phrase, they are assigned translated lines **sequentially by position in the layer stack** (top to bottom in Photoshop = first to last in the layers array):

```
EN phrase: "BUY\nBONUS"
DE translation: "BONUS\nKAUFEN"

📁 buyBonusGroup/
  🔲 BUY     ← matched to EN line 0 → gets DE line 0 = "BONUS"
  🔲 BONUS   ← matched to EN line 1 → gets DE line 1 = "KAUFEN"
```

The matching pipeline (`matchLayersToLines`) uses a confidence ladder:
1. **Exact match** — layer name equals an EN line exactly
2. **Fuzzy match** — layer name starts with an EN line (prefix)
3. **Word-in-line** — layer name appears as a word within an EN line
4. **Stack index fallback** — layer's position in the stack determines assignment

The last matched layer absorbs any remaining translation lines (handles translator expansion where one EN line becomes multiple translated lines). Layers beyond the available translation slots get `null` (left untouched).

### Do-Not-Translate Markers

Lines in the EN phrase wrapped entirely in `()` mark layers that must not be translated:

```
EN: "SUPER (do not translate!)\nFREE SPINS\n[NUMBER] OF [NUMBER]"

📁 superFreeSpins/
  🔲 SUPER          ← in () in the EN phrase → skipped, keeps original text
  🔲 FREE SPINS     ← translated
  🔲 [NUMBER]...    ← translated
```

`buildDoNotTranslateSet(rawEnPhrase)` extracts these markers. Skipped layers still consume their positional slot so subsequent layers receive the correct translation line.

### Folder / Group Names

- **Folder names are transparent** — they are not used for matching. CamelCase scene names like `doubleChanceOffLandscape`, `buyBonusBtnActive1Portrait` do not interfere.
- **Language code groups** (`EN`, `DE`, `HR`, `BG`, etc.) are treated as noise and ignored.
- **Generic wrapper groups** (`Group 1`, `Group 2`, etc.) are ignored.
- **Structural names** (`SLICES`, `BACKGROUND`, `BG`) are ignored.

### Target Layer Types

The plugin handles **both**:
- **Smart Objects** (`SMARTOBJECT`) — translated by entering edit mode, finding text layers inside, setting text, then saving and closing
- **Plain text layers** (`TEXT`) — translated directly via `textItem.contents`

All other layer types (shapes, fills, adjustments, masks) are excluded at the `getTranslatableLayers` stage.

---

## Translation Pipeline

### Full Document Translation (`translateAll`)

1. **Pre-flight guards:**
   - Document format check via `isDocumentValidForTranslation()` — must be PSD or PSB (uses `batchPlay` to read the file extension)
   - Structure check — document must contain both Smart Objects and groups among visible layers
   - Language must be selected and Excel data must be loaded

2. **Layer collection:** `getAllVisibleLayers` flattens the document tree, keeping only visible layers. Smart Objects are filtered and deduplicated by `smartObjectMore.ID` via `purgeSOInstancesFromArray`.

3. **Phrase matching:** For each unique SO, `phraseGuesser.guessThePhrase(layer, appState)` walks up the layer ancestry to find the "phrase container" — the highest ancestor whose child SO/text names are fully explained by a single EN phrase. Returns `{ enPhrase, translatedPhrase, container }`.

4. **Folder processing:** `processMatchedFolder(folder, appState, enPhrase, translatedPhrase)`:
   - Parses both phrases into line arrays via `parseRawPhrase`
   - Calls `getTranslatableLayers(folder, enPhrase)` to get only relevant SO/text children
   - Builds a `doNotTranslate` set from `()` markers in the EN phrase
   - Calls `matchLayersToLines` to assign a translated string to each child layer
   - Calls `translateSmartObject` or `translateTextLayer` for each assigned layer

5. **Deduplication:** `processedIds` (module-level `Set` of `smartObjectMore.ID`) prevents duplicate translations when the same SO appears in multiple folders or has multiple PSD instances.

### Smart Object Translation (`translateSmartObject`)

Two modes controlled by the `RECURSIVE_SO` flag:

**Non-recursive (legacy):**
- Opens the SO, translates all visible text layers inside, restores font sizes, saves and closes

**Recursive (current default, `RECURSIVE_SO = true`):**
- Opens the SO, translates all visible text layers
- Then iterates any nested SOs inside, opens each one recursively, translates, saves and closes
- Each level: remap fonts → translate text → recurse into nested SOs → crop canvas → save → close
- A layer count safeguard skips SOs with excessive layers to prevent performance issues
- `isTopLevel` flag controls whether canvas cropping runs (only at the outermost SO level)

### Font Replacement (`fontManager.js`)

When a substitute font is selected, font replacement runs inside each SO before text translation:

**Part 1 — Missing fonts:** Uses Photoshop's `remapFonts` batchPlay command — a single document-wide call that replaces all missing font identities at once. This is the only way to fix missing fonts; per-layer writes don't work because PS refuses to resolve fonts it considers missing.

**Part 2 — Installed fonts:** For layers that have an installed font but not the substitute, uses `set textLayer` batchPlay per layer. Clones the full `textKey` descriptor (preserving text content, paragraph styles, all formatting) and swaps only font properties in each `textStyleRange`.

**Atomic write path:** After font remap, text layers that had missing fonts use a special single batchPlay call that sets text + font + size atomically. This prevents `textItem.contents` from destroying the remapped font (a known Photoshop bug where the DOM write path permanently nukes remapped fonts).

**Normal write path:** Layers with installed fonts use `textItem.contents` followed by a `batchPlay` size restore (workaround for the PS font-shrink bug where `textItem.contents` resets `impliedFontSize`).

### Canvas Cropping (`cropCanvasToLayerBounds`)

After translating text inside an SO, the plugin crops the SO's canvas to fit the bounds of the translated content. This prevents the SO from visually overflowing in the parent document. Runs only at the top-level SO (not on nested SOs).

---

## Document Validation (`validateDoc`)

The "Validate Doc" button runs a comprehensive pre-translation analysis and displays results in a modal dialog (`ValidationWindow`). All checks run inside a single `executeAsModal` call for efficiency.

The validation reads the PSD file as raw bytes alongside the Photoshop DOM, performing binary-level analysis that the PS API cannot provide.

### Checks performed:

**1. Nested Smart Objects**
- Parses the PSD binary to find embedded SO data (lnk2/lnkD/lnk3 blocks in GALI)
- For each unique SO, checks if its inner PSB contains further embedded SOs
- Reports count and names of SOs that contain nested SOs (these may cause issues during recursive translation)

**2. Missing Fonts**
- **Main document:** Reads `textKey.textStyleRange` descriptors for all text layers, checks `fontPostScriptName` against `app.fonts`
- **Inside Smart Objects:** Binary extraction — navigates the PSD's GALI section → lnk2 blocks → liFD records → inner PSB → TySh (type tool) blocks → `/Name (...)` fields in tdta. Supports both ASCII and UTF-16BE encoded font names
- Reports all missing fonts with layer names

**3. Missing Links**
- **Top-level:** Checks `smartObject.linkMissing` on each SO's batchPlay descriptor
- **Nested:** Uses `findLinkedLayersInSO` to recursively scan inside embedded SOs for SoLE (linked external SO) layers — these almost always have broken paths because file references are machine-specific
- Reports count and sample layer names

**4. Naming Quality (Fuzziness)**
- Only runs when Excel data is loaded
- Classifies every layer name as `phrase` (matches EN vocabulary), `structural` (matches known structural names like `BACKGROUND`, `SLICES`, scene container names), `both`, or `noise`
- Scores each category (groups, smart objects, text layers, other) with weighted scoring: `groups: 0.40, smartObjects: 0.50, textLayers: 0.05, otherLayers: 0.05`
- Overall score 0–100 indicates how well the PSD naming aligns with the translation table

---

## Core Functions

### `photoshop.js`

| Function | Description |
|---|---|
| `translateSmartObject(layer, translation)` | Routes to recursive or legacy path based on `RECURSIVE_SO` flag. Opens SO, translates text layers (with font remap if enabled), handles nested SOs recursively, crops canvas, saves and closes. |
| `translateTextLayer(layer, translation)` | Translates a plain text layer directly via `textItem.contents`. |
| `editSmartObject(smartObject)` | Opens an SO for editing via batchPlay `placedLayerEditContents`. |
| `getSOid(layer)` | Returns `smartObjectMore.ID` — the shared ID used for deduplication across all instances of the same linked SO. |
| `purgeSOInstancesFromArray(layers)` | Deduplicates an array of SO layers by `smartObjectMore.ID`, returning one representative per unique SO. |
| `getAllLayers(layers)` | Recursively flattens the layer tree, returning all layers. |
| `getAllVisibleLayers(layers)` | Recursively flattens the layer tree, returning only visible layers. |
| `getLayerInfo(layer)` | Returns the raw batchPlay descriptor for a layer. |
| `getParentFolder(layer)` | Walks up the layer tree to find the parent group. |
| `isLayerAGroup(layer)` | Returns true if a layer is a group with children. |
| `cropCanvasToLayerBounds(allLayers, allInnerInfos)` | Resizes the SO canvas to fit translated text bounds. |

### `parsingLogic.js`

| Function | Description |
|---|---|
| `translateAll(appState)` | Main entry point. Guards: format check (PSD/PSB), structure check (SOs + groups), language + data check. Collects visible SOs, deduplicates, runs `phraseGuesser` + `processMatchedFolder` for each. |
| `processMatchedFolder(folder, appState, enPhrase, translatedPhrase)` | Parses phrases to line arrays, fetches translatable children, matches layers to translation lines, dispatches to `translateSmartObject`/`translateTextLayer`. |
| `matchLayersToLines(childLayers, enLines, transLines, doNotTranslate)` | Name-first matching (exact → fuzzy → word-in-line → stack index). Returns `Map<layerId, { text, matchType } | null>`. |
| `translateSelected(appState)` | Translates the single currently selected layer using manual input. |
| `generateSuggestions(layer, appState)` | Returns translation candidates using `phraseGuesser` + `parsePhraseForSuggestions`. |
| `parseRawPhrase(phrase, mode)` | Cleans a raw Excel phrase. Modes: `"linesArray"`, `"oneLiner"`, `"raw"`, `"strict"`. |
| `buildDoNotTranslateSet(rawEnPhrase)` | Extracts `()`-wrapped EN lines into a Set of layer names to skip. |
| `isDocumentValidForTranslation()` | Checks document format via batchPlay — returns false with alert if not PSD/PSB. |

### `phraseGuesser.js`

| Function | Description |
|---|---|
| `guessThePhrase(layer, appState)` | Walks up the layer ancestry to find a "phrase container" — the highest ancestor whose visible SO/text child names are fully explained by a single EN phrase. Returns `{ enPhrase, translatedPhrase, container }` or `null`. |

### `getTranslatableLayers.js`

| Function | Description |
|---|---|
| `getTranslatableLayers(folderLayer, enPhrase)` | Recursively flattens a folder, filters to SO + TEXT kinds, deduplicates SOs by ID, filters by EN phrase word match. Returns `{ layers, soIdMap }`. |

### `excelParser.js`

| Function | Description |
|---|---|
| `parseExcelFile(fileOrArrayBuffer)` | Reads Excel via SheetJS, returns `{ languageData, availableLanguages }`. |

### `fontManager.js`

| Function | Description |
|---|---|
| `getAllFonts()` | Returns sorted array of all installed font names. Also caches font metadata (postScriptName, family, style) for use by `changeFont`. |
| `setSubstituteFont(fontName)` | Sets the module-level substitute font target. |
| `changeFont(allLayerDescriptors)` | Two-phase font replacement: (1) `remapFonts` for missing fonts, (2) `set textLayer` for installed fonts. Returns true if any fonts were changed. |

### `validateMasterFile.js`

| Function | Description |
|---|---|
| `validateDoc(appState)` | Unified validation entry point. Reads PSD as binary, fetches all layer descriptors in one bulk batchPlay, then runs: nested SO detection, font scanning (main doc + inside SOs), missing link detection, naming quality analysis. Returns structured results for the validation window. |
| `getNestedSOData()` | Standalone nested SO scanner (diagnostic/debug). |
| `extractFontsFromSO(buffer, uuid)` | Binary extraction of font names from inside a specific embedded SO. |
| `findLinkedLayersInSO(buffer, uuid)` | Recursively scans inside an embedded SO for SoLE (linked external) layers. |

### `psdParser.js`

| Function | Description |
|---|---|
| `parsePsd(buffer)` | Parses a PSD/PSB binary buffer into layer records with names, bounds, and additional info block keys. |
| `extractUuidFromBlock(buffer, offset, end)` | Extracts the UUID string from a liFD record in the PSD binary. |

---

## Structural Gotchas from Real PSDs

- **Double SO instances**: the same linked SO often appears twice in a folder (one directly, one inside a sub-group). They share `smartObjectMore.ID`. `purgeSOInstancesFromArray` deduplicates before the loop; `processedIds` prevents re-translation when the same container is matched again from a sibling SO.
- **Intermediate wrapper groups**: SO/text layers are commonly nested under unnamed sub-groups (`Group 3`, `Surface`, `txt only`). `_collectVocabNames` recurses through these transparently.
- **Partial translations**: many EN phrases have empty cells for some languages. `parseExcelFile` stores `""` — `phraseGuesser` rejects empty translated phrases and leaves the layer untouched.
- **Locked layers**: `translateSmartObject` checks for locked state before entering edit mode and skips silently (locked SO would trigger "command unavailable").
- **Invisible layers**: excluded at collection time — if a language group (e.g. the `BG` group) is hidden, it is skipped entirely.
- **Nested Smart Objects**: the recursive translation path opens nested SOs depth-first. A layer count safeguard prevents runaway processing on very complex SOs.
- **Missing fonts**: `textItem.contents` permanently destroys remapped fonts. The atomic batchPlay write path avoids this. Font remap must happen BEFORE any text writes.

---

## Known Issues / WIP Areas

- `LoadFURLButton` is disabled (URL hardcoded to `null`)
- Font shrink bug: workaround in `translateSmartObject` restores `impliedFontSize` via batchPlay after setting `textItem.contents`
- Some diagnostic `console.log` calls remain, marked `// DELETE LATER`
- `validateMasterFile.js` contains `KNOWN_STRUCTURAL_NAMES` — a hardcoded set of known PSD structural/scene names used for naming quality scoring. Should be made configurable or derived from the document.

---

## Important UXP Gotchas

- **`executeAsModal` is required** for any Photoshop document modifications. Always wrap PS writes in it.
- **Layer references go stale** after entering `executeAsModal`. Always re-fetch layers by ID inside the modal scope using `getAllLayers().find(l => l.id === savedId)`.
- **SheetJS** is loaded as a UMD global — access it via `window.XLSX`, not as an ES import.
- `photoshop` and `uxp` modules are UXP-specific `require()` calls — they are shimmed in `globals.js` to avoid errors in non-UXP environments (e.g. browser preview mode).
- The plugin supports a `VITE_BOLT_WEBVIEW_UI=true` env flag for browser-based UI development (renders a dummy view instead of the real plugin UI).
- **`remapFonts` is the only way to fix missing fonts** — per-layer `set textLayer` won't work because PS refuses to resolve a font it considers missing. Must be called before any `textItem.contents` writes.
- **Plugin icons** must be placed in `public/icons/` so Vite copies them to `dist/icons/` at build time. The manifest references `icons/dark.png` and `icons/light.png`; Photoshop resolves `@1x`/`@2x` variants automatically from the base path.
