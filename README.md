# LocalizationMaster — Agent Context Document

> **Purpose:** This file gives a fresh AI agent everything it needs to understand the project without reading through all source files. Read this before touching any code.

---

## What Is This?

**LocalizationMaster** is a **Adobe Photoshop UXP plugin** that automates the translation of text inside **Smart Objects and plain text layers** in PSD files. The workflow targets game UI production — PSD files contain translatable text (either inside Smart Objects or as direct text layers) that need to be translated into multiple languages using a pre-prepared Excel translation table.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Boilerplate | Bolt UXP: https://hyperbrew.co/resources/bolt-uxp
| Runtime | Adobe UXP (Unified Extensibility Platform) inside Photoshop |
| UI Framework | React 19 (JSX) |
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
│   │   ├── api.js             # Unified API object (merges photoshop + uxp + parsingLogic)
│   │   ├── photoshop.js       # All PS-specific functions (translateSmartObject, editSmartObject, etc.)
│   │   ├── parsingLogic.js    # Excel parsing + translation matching logic
│   │   └── uxp.js             # UXP filesystem helpers, plugin info, color scheme
│   ├── components/
│   │   ├── LoadFDiskButton.jsx        # Load Excel from disk via file picker
│   │   ├── LoadFURLButton.jsx         # Load Excel from URL (currently disabled/null)
│   │   ├── LanguageSelectorDropdown.jsx # Dropdown to pick target language
│   │   ├── DataStatusIcon.jsx         # Visual indicator: data loaded or not
│   │   ├── TranslateAllButton.jsx     # Triggers translateAll() for entire document
│   │   ├── GenerateSuggestionsButton.jsx # Triggers suggestion generation for selected layer
│   │   ├── SuggestionsContainer.jsx   # Scrollable list of translation suggestions
│   │   ├── TranslateSuggestion.jsx    # Individual suggestion item (selectable)
│   │   └── PhraseReference.jsx        # Shows original EN phrase for reference
│   └── lib/
│       └── xlsx.full.min.js           # Bundled SheetJS (accessed via window.XLSX)
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

### Clean Convention
- **Parent group name = translation key** (e.g. group named `FREE SPINS` contains SOs `FREE` and `SPINS`, or direct text layers)
- Group name matches EN lookup table entries almost exactly
- Individual SO and text layer names are word fragments for layout/animation, not keys
- Translated versions (BG layer group) have SOs renamed / text layers updated to the translated word (Cyrillic)
- Some SOs or text layers are tagged `(DO NOT TRANSLATE)` in their name — must be skipped

### Sloppy Convention
- SO and text layer names are meaningless (`enRed`, `bgBlue`, `free copy`, ` FREE SPINS` with leading space)
- **Parent group names are still descriptive** (`outroCreditsWonLandscape Rome`, `freeSpinsCounterAttila`)
- The group name contains the meaning but has extra words (scene context, character name)
- Requires fuzzy normalization to extract the actual translation key from the group name

### Convention Variant — "Clean with noise"
This is a middle ground observed in practice and represents the most common real-world case. The core rule still holds: **the parent group name is the translation key**, and the layers inside are messy. However several complications arise:

- **Double SO instances**: each phrase group typically contains two SOs pointing to the same underlying Smart Object (e.g. one inside a `Group 3` subgroup, one sitting directly in the parent named `"X copy"`). They share the same `smartObjectMore.ID`. The plugin must **deduplicate by SO ID** and translate only once. Text layers do not have this problem — each is a unique layer.
- **Intermediate wrapper groups**: SOs and text layers are often nested inside unnamed intermediate groups (`Group 3`, `Surface`, `txt only`, etc.) before reaching the translatable layer. Traversal must go deep enough to find the actual SO or text layer.
- **Language group naming variants**: instead of plain `EN` / `BG`, groups may be named `EN_popup` / `BG_popup`. Matching must use `startsWith("EN")` or `includes("EN")` rather than an exact string check.
- **Phrase concatenation in group names**: a group may be named `congratulations you win` — a combined name covering two separate phrases inside it. The plugin should not try to match this combined name directly but instead descend and match subgroups (`you win`, `congratulations`).
- **Direct ungrouped SOs/text layers**: some translatable layers (e.g. `"10 free spins for"`, `"of"`) sit directly inside the EN/BG group with no phrase subgroup wrapping them. Their own layer name is the lookup key, not a parent group.
- **Plain TEXT layers mixed in**: some scenes use direct text layers (not SOs) for translation (e.g. infobar `gameBet` section). These have `layer.kind === "text"` and `layer.textInfo.text` contains the current content. They are translated directly without entering edit mode.
- **PascalCase group names**: some groups use `CreditsWon` instead of `credits won` — normalization must handle both spaced-lowercase and PascalCase forms when matching against the EN lookup table.

### Target Layer Types
The plugin must handle **both**:
- **Smart Objects** — text is inside a nested document; requires entering edit mode to translate
- **Plain text layers** — `layer.kind === "text"`; translated directly via `layer.textItem.contents` without entering any edit mode

### Matching Strategy (intended, partially implemented)
1. **Pass 1 — Parent group name match**: Normalize group name (trim, uppercase, strip scene suffixes) → look up in EN table
2. **Pass 2 — Layer name match**: Normalize SO/text layer name → look up in EN table
3. **Pass 3 — Inner text content**: Enter the SO (or read `textItem.contents` for plain text layers) → use as lookup key

---

## Core Functions

### `photoshop.js`

**`translateSmartObject(smartObject, translation)`**
- Handles Smart Objects: enters edit mode via `batchPlay` (`placedLayerEditContents`), finds all text layers inside, sets `textItem.contents`, restores original `impliedFontSize` via batchPlay (workaround for a PS bug that shrinks font on text change), then saves and closes the SO document
- Plain text layers can be translated directly without entering edit mode — just set `layer.textItem.contents` and restore font size in place

**`editSmartObject(smartObject)`**
- Opens a Smart Object for editing via batchPlay `placedLayerEditContents`

**`getAllLayers(layers)`**
- Recursively flattens the layer tree into a flat array

**`getLayerInfo(layer)`**
- Returns raw batchPlay descriptor for a layer (includes `smartObjectMore.ID` for deduplication)

**`doesSelectedSOhaveInstances(layer)`**
- Checks if a Smart Object has multiple instances by comparing `smartObjectMore.ID` across all layers

**`getParentFolder(layer)`**
- Returns `layer.parent.name` — used for group-name-based matching

**`isLayerAGroup(layer)`**
- Returns true if layer is a group with children

### `parsingLogic.js`

**`parseExcelFile(fileOrArrayBuffer)`**
- Accepts UXP file object or ArrayBuffer, reads via SheetJS, calls `extractLanguageData`

**`isNameENPhrase(layerName, appState)`**
- Checks if a string exactly matches any EN entry (after normalizing whitespace and filtering `()[]{}` lines)

**`compareLayerNameToEN(layer, appState)`**
- Uppercase comparison of `layer.name` against all EN phrase lines

**`matchingPhrase(layer, appState)`**
- Finds the translated phrase for a layer by matching `layer.name` to EN entries and returning the corresponding index in the selected language array

**`translateSelectedLayer(appState)`**
- Gets active layer, runs `matchingPhrase`, calls `translateSmartObject`

**`translateAll(appState)`** *(WIP)*
- Iterates all layers, tries parent-folder match via `isNameENPhrase`, falls back to `compareLayerNameToEN`
- Not yet fully wired up to actually call `translateSmartObject`

**`parseForTranslation(text)`**
- Splits a phrase by `\n`, trims lines, filters out lines containing `()` or `[]`

---

## Known Issues / WIP Areas

- `translateAll` is partially implemented — matching logic runs but translation dispatch is incomplete
- `LoadFURLButton` URL is hardcoded to `null` (disabled)
- `SuggestionsContainer` footer buttons (Apply All / Apply Selected) are commented out
- `handleGenerate` in `main.jsx` uses dummy random data — needs to be wired to real `languageData[selectedLanguage]`
- Font shrink bug: Photoshop shrinks font size when setting `textItem.contents` — workaround in `translateSmartObject` restores `impliedFontSize` via batchPlay
- Multiple debug `console.log` statements throughout codebase

---

## Important UXP Gotchas

- **`executeAsModal` is required** for any Photoshop document modifications. Always wrap PS writes in it.
- **Layer references go stale** after entering `executeAsModal`. Always re-fetch layers by ID inside the modal scope using `getAllLayers().find(l => l.id === savedId)`.
- **SheetJS** is loaded as a UMD global — access it via `window.XLSX`, not as an ES import.
- `photoshop` and `uxp` modules are UXP-specific `require()` calls — they are shimmed in `globals.js` to avoid errors in non-UXP environments (e.g. browser preview mode).
- The plugin supports a `VITE_BOLT_WEBVIEW_UI=true` env flag for browser-based UI development (renders a dummy view instead of the real plugin UI).
