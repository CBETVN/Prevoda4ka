# LocalizationMaster



## What Is This?

**LocalizationMaster** is a **Adobe Photoshop UXP plugin** that automates the translation of text inside **Smart Objects and plain text layers** in PSD files using a pre-prepared Excel translation table.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Boilerplate | Bolt UXP: https://hyperbrew.co/resources/bolt-uxp
| Runtime | Adobe UXP (Unified Extensibility Platform) inside Photoshop |
| Framework | React 19 (JSX) |
| Build Tool | Vite 6 + `vite-uxp-plugin` |
| Package Manager | npm |
| Excel Parsing | SheetJS (`xlsx.full.min.js`) bundled as a UMD lib in `/src/lib/` |
| Photoshop API | `photoshop` UXP module (batchPlay, executeAsModal, app) |
| Filesystem API | `uxp.storage.localFileSystem` |
| Styling | CSS + CSS variables for UXP theming |

**Dev commands:**
- `npm run dev` — watch build (for live plugin reloading in PS)
- `npm run build` — production build
- `npm run ccx` — package as `.ccx` for distribution

---

## Project Structure

```
LocalizationMaster/
├── src/
│   ├── index.jsx              # UXP entry point
│   ├── main.jsx               # Root App component — all state lives here
│   ├── globals.js             # Safe require() shims for uxp + photoshop modules
│   ├── api/
│   │   ├── api.js                   # Unified API object exported to components
│   │   ├── photoshop.js             # All PS-specific functions (translateSmartObject, getSOid, purgeSOInstancesFromArray, etc.)
│   │   ├── parsingLogic.js          # Excel parsing, translateAll, processMatchedFolder, matchLayersToLines, parseRawPhrase
│   │   ├── phraseGuesser.js         # guessThePhrase — walks layer ancestry to find EN phrase + translation
│   │   ├── getTranslatableLayers.js # Returns SO/text child layers for a folder, filtered and deduped
│   │   ├── validateMasterFile.js    # Validates Excel structure before loading
│   │   ├── psdParser.js             # PSD layer tree utilities
│   │   ├── uxp.js                   # UXP filesystem helpers, plugin info, color scheme
│   │   └── utils/                   # Shared utility helpers
│   ├── components/
│   │   ├── LoadFDiskButton.jsx           # Load Excel from disk via file picker
│   │   ├── LoadFURLButton.jsx            # Load Excel from URL (disabled)
│   │   ├── LanguageSelectorDropdown.jsx  # Dropdown to pick target language
│   │   ├── DataStatusIcon.jsx            # Visual indicator: data loaded or not
│   │   ├── TranslateAllButton.jsx        # Triggers translateAll() for entire document
│   │   ├── TranslateSelectedButton.jsx   # Triggers translateSelected() for active layer
│   │   ├── TranslateSelectedTextField.jsx# Manual translation input field
│   │   ├── GenerateSuggestionsButton.jsx # Triggers suggestion generation for selected layer
│   │   ├── GuessThePhrase.jsx            # Debug UI for testing phraseGuesser on selected layer
│   │   ├── SuggestionsContainer.jsx      # Scrollable list of translation suggestions
│   │   ├── TranslateSuggestion.jsx       # Individual suggestion item (selectable)
│   │   ├── PhraseReference.jsx           # Shows original EN phrase for reference
│   │   └── ValidateMasterFile.jsx        # UI trigger for Excel validation
│   └── lib/
│       └── xlsx.full.min.js              # Bundled SheetJS (accessed via window.XLSX)
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
| `suggestions` | `Array<{id, text, placeholder}>` | Translation suggestions for the selected layer |
| `selectedId` | `number\|null` | Currently selected suggestion ID |
| `isProcessing` | `boolean` | Guards async operations |

The `appState` object bundles the first 4 into a single prop passed down to components/functions that need context.

---

## Excel Translation File Format

The Excel file has this structure:

```
| EN          | DE          | BG          | SK          | ...  |
|-------------|-------------|-------------|-------------|------|
| FREE SPINS  | FREISPIELE  | БЕЗПЛАТНИ   | ZADARMO     | ...  |
| YOU WIN     | SIE GEWINNEN| ПЕЧЕЛИТЕ    | VYHRÁVÁTE   | ...  |
| TOTAL WON   | GESAMT      | ОБЩО        | CELKOVO     | ...  |
```

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

**Key observations from real data:**
- Many cells are empty for certain languages (arrays must stay index-aligned with empty string fallback)
- `[NUMBER]`, `(value)`, `(do not translate!)` markers appear inside phrases
- Some EN entries span 4–5 lines with `\n`
- `Screen Preview` column and trailing empty columns must be ignored
- Some rows have content only in EN + DE (partial translations)
- `SUPER (do not translate!)` lines must be skipped during translation

---

## PSD File Conventions

The plugin uses a single unified traversal strategy regardless of how the PSD is structured — it doesn't branch on "clean" vs "sloppy" naming. Understanding what it expects helps explain both what works and what can break.

### How the Algorithm Traverses the Document

1. **All visible SO layers** are collected from the document root (invisible layers skipped).
2. For each SO, `phraseGuesser` **walks up the layer hierarchy** collecting SO/text leaf names at each ancestor level, scoring the compound against all EN phrases.
3. It stops climbing when an **unexplained word** appears in the compound (a sibling phrase's SO leaked in) or the score drops below 0.5 — the last good ancestor becomes the **phrase container**.
4. Once the container is identified, `getTranslatableLayers` flattens it recursively and keeps only SO + TEXT layers whose names appear as lines in the matched EN phrase.
5. `matchLayersToLines` assigns translated lines to those layers sequentially.

### Naming — What Matters and What Doesn't

- **SO and text layer names are the primary match signal.** The compound of their names (e.g. `"CHANCE\nFOR BONUS\nX2"`) is what scores against the EN phrase table — not the folder/group names.
- **Folder/group names are transparent.** CamelCase scene-container names (`doubleChanceOffLandscape`, `buyBonusBtnActive1Portrait`) are never collected during vocabulary gathering. They do not interfere.
- **"Copy N" suffixes** on SO names are stripped before matching (`"Free copy 3"` → `"Free"`).
- **Short / noise layer names** that have zero word overlap with any EN phrase (e.g. `"Base"`, `"off"`) are filtered out before the compound is built.
- **Ancestor folder names** between the layer and its container are also added as individual scoring candidates. ⚠️ Known issue: a folder named `"buyBonusBtnActive1Portrait - EXPORT 50%"` can outcompete the correct compound when it has overlapping words.

### Transparent / Noise Folder Names

The following are always treated as transparent hierarchy levels and ignored when building name candidates:
- **Language code groups**: `EN`, `DE`, `HR`, `BG`, and all other supported language codes
- **Generic wrapper groups**: `Group 1`, `Group 2`, etc. (matches `/^group\s+\d+$/i`)
- **`SLICES`, `BACKGROUND`, `BG`**

Language group naming variants (`EN_popup`, `BG_mobile`) pass through the noise filter (they don't match exact codes) and are simply never collected as SO/text leaf names, so they don't interfere.

### Target Layer Types

The plugin handles **both**:
- **Smart Objects** (`layer.kind === SMARTOBJECT`) — translated by entering edit mode, finding text layers inside, setting `textItem.contents`
- **Plain text layers** (`layer.kind === TEXT`) — translated directly via `layer.textItem.contents` without entering edit mode

All other layer types (shapes, fill layers, adjustment layers, masks) are excluded at the `getTranslatableLayers` stage.

### Structural Gotchas from Real PSDs

- **Double SO instances**: the same linked SO often appears twice in a folder (one directly, one inside a sub-group). They share `smartObjectMore.ID`. `purgeSOInstancesFromArray` deduplicates before the loop; `processedIds` prevents re-translation when the same container is matched again from a sibling SO.
- **Intermediate wrapper groups**: SO/text layers are commonly nested under unnamed sub-groups (`Group 3`, `Surface`, `txt only`). `_collectVocabNames` recurses through these transparently.
- **Partial translations**: many EN phrases have empty cells for some languages. `parseExcelFile` stores `""` — `phraseGuesser` rejects empty translated phrases and leaves the layer untouched.
- **`(do not translate!)` markers**: some EN lines are annotated with `()` markers (e.g. `SUPER (do not translate!)`). The plugin currently skips a hardcoded test set `["SUPER", "X2"]` — this must be replaced with marker-based logic reading from the Excel phrase. ⚠️ WIP.
- **Locked layers**: `translateSmartObject` checks for locked state before entering edit mode and skips silently.
- **Invisible layers**: excluded at collection time — if a language group (e.g. the `BG` group) is hidden, it is skipped entirely.

### Matching Strategy (current implementation)

The pipeline is fully implemented and working end-to-end:

1. **`translateAll`** collects all visible Smart Object layers, deduplicates by `smartObjectMore.ID` via `purgeSOInstancesFromArray`, then iterates unique SOs.
2. **`phraseGuesser.guessThePhrase(layer, appState)`** walks up the layer ancestry to find the "phrase container" — the highest ancestor whose child SO/text names are fully explained by a single EN phrase. Scores candidates with word-overlap ratio and returns `{ enPhrase, translatedPhrase, container }`.
3. **`processMatchedFolder(folder, appState, enPhrase, translatedPhrase)`** is called with the matched container. It:
   - Parses both phrases into line arrays via `parseRawPhrase(phrase, "linesArray")`
   - Calls `getTranslatableLayers(folder, enPhrase)` to get only relevant SO/text children
   - Calls `matchLayersToLines(childLayers, enLines, transLines)` to assign a translated string to each child layer
4. **`matchLayersToLines`** resolves each child layer to an EN line index using a confidence ladder: exact name → fuzzy (startsWith) → word-in-line → stack index fallback. Layers are sorted by EN index, then assigned trans lines sequentially. The last assigned layer absorbs any remaining trans lines (translator expansion). Layers beyond the trans slot count get `null` (left untouched).
5. **`processedIds`** (module-level `Set` of `smartObjectMore.ID`) prevents duplicate translations when the same SO appears in multiple folders or has multiple PSD instances.

---

## Core Functions

### `photoshop.js`

**`translateSmartObject(layer, translation)`**
- Enters SO edit mode via batchPlay (`placedLayerEditContents`), finds all text layers inside, sets `textItem.contents`, restores `impliedFontSize` via batchPlay (workaround for PS font-shrink bug), then saves and closes the SO document
- Skips locked layers silently (locked SO would trigger "command unavailable" error)

**`translateTextLayer(layer, translation)`**
- Translates a plain text layer directly without entering edit mode

**`getSOid(layer)`**
- Returns `smartObjectMore.ID` for a layer via a single batchPlay `get` call — the shared ID used for deduplication across all instances of the same linked SO

**`purgeSOInstancesFromArray(layers)`**
- Deduplicates an array of SO layers by `smartObjectMore.ID`, returning only one representative per unique SO

**`getAllVisibleLayers(layers)`**
- Recursively flattens the layer tree, returning only visible layers

**`getLayerInfo(layer)`**
- Returns the raw batchPlay descriptor for a layer

**`isLayerAGroup(layer)`**
- Returns true if a layer is a group with children

### `parsingLogic.js`

**`translateAll(appState)`**
- Collects all visible SOs, deduplicates by SO ID, then for each unique SO calls `phraseGuesser.guessThePhrase` and dispatches to `processMatchedFolder`. Uses module-level `processedIds` Set to skip already-translated SOs.

**`translateSelected(appState)`**
- Translates the single currently selected SO or text layer using the value from the manual input field

**`processMatchedFolder(folderLayer, appState, enPhrase, translatedPhrase)`**
- Parses phrases to line arrays, fetches translatable children via `getTranslatableLayers`, matches layers to trans lines via `matchLayersToLines`, then calls `translateSmartObject` for each assigned layer

**`matchLayersToLines(childLayers, enLines, transLines)`**
- Name-first matching (exact → fuzzy → word-in-line → stack index). Returns `Map<layerId, { text, matchType } | null>`. Sequential assignment — last layer absorbs tail; overflow gets null. Returns confidence score; skips folder if below 0.5.

**`parseRawPhrase(phrase, mode)`**
- Cleans a raw Excel phrase. Modes: `"linesArray"` (array of lines, spaces preserved), `"oneLiner"` (flat string), `"raw"` (newlines preserved), `"strict"` (drops `[...]` lines, returns flat string)

**`parseExcelFile(fileOrArrayBuffer)`**
- Accepts UXP file object or ArrayBuffer, parses via SheetJS, returns `{ languageData, availableLanguages }`

**`isNameENPhrase(layerName, appState)`**
- Returns true if a string matches any EN entry after `parseRawPhrase("oneLiner")` normalization

**`generateSuggestions(layer, appState)`**
- Returns translation candidates for the selected layer using `phraseGuesser.guessThePhrase` + `parsePhraseForSuggestions`

### `phraseGuesser.js`

**`guessThePhrase(layer, appState)`**
- Walks up the layer ancestry to find a "phrase container" — the highest ancestor whose visible SO/text child names are fully explained by a single EN phrase. Scores folder names and compound SO-name strings against the EN table with word-overlap ratio. Returns `{ enPhrase, translatedPhrase, container }` or `null`.

### `getTranslatableLayers.js`

**`getTranslatableLayers(folderLayer, enPhrase)`**
- Recursively flattens `folderLayer`, filters to SO + TEXT kinds only, deduplicates SOs by `smartObjectMore.ID`, and filters by whether the layer name matches any word or line in the EN phrase. Returns `{ layers, soIdMap }`.

---

## Known Issues / WIP Areas

- **Already-processed SOs consume a trans slot in `matchLayersToLines`** — when `Free` is already in `processedIds`, it still occupies `uniquePosition=0` during assignment, shifting `Spins` and `ACTIVE` to wrong slots. Fix: pass a `skipLayerIds` set to `matchLayersToLines` so processed layers are excluded without advancing the slot counter.
- **Ancestor folder names as `phraseGuesser` candidates** — `_buildPhraseCandidates` pushes ancestor folder names (e.g. `buyBonusBtnActive1Portrait - EXPORT 50%`) into the scoring pool. These can outcompete the correct compound SO-name candidate when the folder name contains overlapping words. Folder names should be deprioritized or excluded.
- **`doNotTranslate` is a hardcoded test Set** — `matchLayersToLines` has `new Set(["SUPER", "X2"])` which must be replaced with logic that reads `()` markers from the Excel EN phrase.
- `LoadFURLButton` is disabled (URL hardcoded to `null`)
- Font shrink bug: workaround in `translateSmartObject` restores `impliedFontSize` via batchPlay after setting `textItem.contents`
- Some diagnostic `console.log` calls remain, marked `// DELETE LATER`

---

## Important UXP Gotchas

- **`executeAsModal` is required** for any Photoshop document modifications. Always wrap PS writes in it.
- **Layer references go stale** after entering `executeAsModal`. Always re-fetch layers by ID inside the modal scope using `getAllLayers().find(l => l.id === savedId)`.
- **SheetJS** is loaded as a UMD global — access it via `window.XLSX`, not as an ES import.
- `photoshop` and `uxp` modules are UXP-specific `require()` calls — they are shimmed in `globals.js` to avoid errors in non-UXP environments (e.g. browser preview mode).
- The plugin supports a `VITE_BOLT_WEBVIEW_UI=true` env flag for browser-based UI development (renders a dummy view instead of the real plugin UI).
