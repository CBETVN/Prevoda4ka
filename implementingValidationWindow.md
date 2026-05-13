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

## Current Implementation (WIP)

### How it's wired

The validation window uses the standard UXP modal dialog pattern. No manifest changes or new entrypoints were needed — the dialog is created dynamically from within the existing panel.

**Flow:**

1. User clicks "Validate Doc" button (`ValidateMFButton` in [src/main.jsx](src/main.jsx))
2. `handleValidateMasterFile` in `main.jsx` calls `validateDoc()` from [src/api/validateMasterFile.js](src/api/validateMasterFile.js)
3. If `validateDoc` returns `null` (unsaved file, no document) — the dialog is **not** shown
4. Otherwise a `<dialog>` DOM element is created on the fly
5. `ReactDOM.createRoot` renders `<ValidationWindow>` into it, passing `results` and `dialog` as props
6. `dialog.uxpShowModal()` pops the modal — PS blocks interaction with the main panel until it's closed
7. On close, the React root is unmounted and the `<dialog>` element is removed from the DOM

### Files changed

| File | What changed |
|---|---|
| [src/main.jsx](src/main.jsx) | Added `ReactDOM` and `ValidationWindow` imports. Rewired `handleValidateMasterFile` to call `validateDoc()`, create a `<dialog>`, render the component into it, and show via `uxpShowModal()`. Added `null` check — if `validateDoc` returns `null` (unsaved file), the handler returns early without opening the dialog. |
| [src/components/validationWindow.jsx](src/components/validationWindow.jsx) | Replaced dummy OS info content. Receives `results` and `dialog` as props. Two sections using `sp-table` components with scroller. |
| [src/components/validationWindow.css](src/components/validationWindow.css) | Replaced old `.aboutDialog` class names with `.validationWindow`. Basic layout styles for sections, result items, and button group. |
| [src/api/validateMasterFile.js](src/api/validateMasterFile.js) | Multiple changes — see "Backend safety fixes" and "Performance" sections below. |
| [vite.config.js](vite.config.js) | Changed `sourcemap` to always `true` so stack traces show real file names and line numbers instead of bundled offsets. |

**No changes to:** manifest.json, api.js, index.jsx.

### Current window content (WIP — will be changed)

The window shows two sections, both simplified to show only summary-level info:

- **Nested Smart Objects** — shows total count of SOs that contain nested SOs (e.g. "Found 3 Smart Object(s) with nested SOs."), or "No nested Smart Objects found." No per-layer details.
- **Missing Fonts** — a single-column `sp-table` (300px height, side scroller) listing unique missing font names. Fonts are deduplicated across main document and all Smart Objects — no info about where each font comes from. Shows "All fonts are installed." if clean.

### Backend safety fixes (validateMasterFile.js)

These were added to prevent Photoshop crashes during validation:

1. **`executeAsModal` wrapping** — all batchPlay calls inside `validateDoc` now run in a modal context via `executeAsModal({ commandName: "Validate Document" })`. Prevents crashes if the user interacts with PS while validation is running.
2. **Unsaved file guard** — if `doc.path` is empty (file not yet saved), shows a PS alert "You have to save your file before validating." and returns `null`. The handler in `main.jsx` checks for `null` and skips the dialog.
3. **`decodePSString` stack overflow fix** — replaced `String.fromCharCode(...bytes.slice(start, end))` spread with a safe loop. The spread operator can exceed the JS argument limit on large engineData blobs.
4. **`liFDRecordHasNestedSO` 8BPS search fix** — removed the 400-byte search limit, now uses full-range scan with version validation (matching `extractFontsFromLiFD`). Prevents false positives from filename bytes that happen to match "8BPS".
5. **Bounds checks on DataView reads** — added `buffer.byteLength` guards before every `view.getUint32()` in `buildNestedSOMapFast` and `extractFontsFromSO`. Corrupted/unusual length fields now return empty results instead of throwing `RangeError`.
6. **`j < 4` guards** — prevents `view.getUint32(j - 4)` from reading a negative offset when scanning liFD records.
7. **Better error logging** — catch block logs the raw error value (`console.error("validateDoc error:", e)`) instead of `e.message`/`e.stack`, because UXP's `executeAsModal` can reject with non-standard error objects.

### Performance optimization

- **SO instance deduplication** — the SO layer loop now tracks seen UUIDs with a `Set`. Instance layers (SOs sharing the same embedded data/UUID) are skipped. Only the first occurrence of each unique UUID gets the batchPlay call and binary font extraction. For a doc with 20 SO layers but only 5 unique sources, this eliminates 15 unnecessary batchPlay calls and 15 unnecessary GALI scans.

### What's still TODO
- "Success prediction" bar (red to green gradient)
- Layer/folder naming fuzziness checks
- Better visual design, icons, spacing
- Real styling pass (current CSS is functional only)
- Potential optimization: scan GALI once for all UUIDs instead of per-SO (currently `extractFontsFromSO` re-navigates the PSD sections from scratch for each UUID)
