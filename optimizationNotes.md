# Optimization & Refactor Notes — Localization-Master

Consolidated analysis of `parsingLogic.js`, `getTranslatableLayers.js`, and `phraseGuesser.js`. Findings are grouped by category. Each item lists what it is, the risk, and the gain.

---

## 0. Critical assumption underpinning everything

The whole performance-optimization story rests on one observable Photoshop behavior:

> When a Smart Object is translated, its `smartObjectMore.ID` flips to a new value. **All linked instances flip together to the same new value.** They never diverge.

If this invariant holds, the cache-once strategy below is safe. If it ever breaks for some PSD, the existing code's post-translation `getSOid` fetch would be a defensive fallback worth keeping. Worth a one-time test run with the diagnostic block (currently commented out at line 406-411 of `parsingLogic.js`) re-enabled to confirm in real files.

Every "gain" claim below assumes this invariant.

---

## 1. Performance findings

### 1.1 `getSOid` is called 3-4× per layer per run

`getSOid` → `getLayerInfo` → one `batchPlay` IPC round-trip to Photoshop. The same SO has its ID fetched multiple times in a single `translateAll` run:

| Site | Why it's called | Notes |
|---|---|---|
| `purgeSOInstancesFromArray` (photoshop.js:317) | Dedup `allSOs` into `smartObjectsForProcessing` | First fetch |
| `translateAll` outer loop (parsingLogic.js:233) | `processedIds.has(layerSOId)` guard | ID was just thrown away by purge |
| `getTranslatableLayers` (line 89) | Folder-local dedup, builds `soIdMap` | Refetched per matched folder |
| `processMatchedFolder` STEP 6 (line 403) | `processedIds.add(await ps.getSOid(...))` | `smartObjectID` was already in scope from line 391 |

Compounded by the existing bug: `processMatchedFolder` is called N times per folder (once per SO sharing the container), so per-folder fetches multiply by N.

**Risk of fixing:** Low — assumes the lockstep-flip invariant from §0. If it breaks, the cached pre-translation IDs become stale, but **every read site in the current code asks pre-translation questions of pre-translation IDs**, so the cache stays correct in practice.

**Gain:** From `~3N + (N × folders × instances)` IPC calls to `1` bulk batchPlay per run. Largest single perf win available.

**Proposed shape:** One `soIdByLayerId: Map<layerId, preTranslateId>` built at top of `translateAll` via one bulk `batchPlay` over every visible SO. Snapshot, never mutated. All consumers read from it.

---

### 1.2 Redundant `processedIds.add` in `processMatchedFolder` STEP 6

Lines 403 and 415 both add the same SO's ID to the same Set:

```js
processedIds.add(await ps.getSOid(child.layer));   // line 403 — fresh post-translate ID (B)
// ...
if (smartObjectID) processedIds.add(smartObjectID); // line 415 — cached pre-translate ID (A)
```

Under the lockstep-flip behavior, no read site in the pipeline ever queries `B`. Every `processedIds.has(...)` check uses an ID sourced from `soIdMap` or `purgeSOInstancesFromArray`, both of which are pre-translation snapshots. So `B` sits in the Set unused.

**Risk of removing line 403:** Low if §0 holds. Was likely defensive belt-and-braces from the dev who couldn't fully verify the invariant.

**Gain:** Removes one IPC call per translated SO. Plus removes a footgun: the comment block above it documents a real concern, but the implementation never relied on the answer.

---

### 1.3 `getTranslatableLayers` re-runs even when the folder is already done

When `processMatchedFolder` is called N times for the same folder, `getTranslatableLayers` runs N times even though every child SO may already be in `processedIds`. Currently it has no way to know.

**Risk of fixing:** Low — pass `processedIds` in, return `{layers: [], soIdMap: empty}` when the folder is fully covered.

**Gain:** Eliminates redundant subtree walks and fetches in the N-times-per-folder path. Already on the team's TODO list per `currentProgress.md`.

---

### 1.4 `_collectVocabNames(container)` is called twice in `phraseGuesser`

`_findPhraseContainer` calls `_collectVocabNames` on every ancestor as it climbs (line 189). When it stops, `lastGoodAncestor` is the chosen container — and `_collectVocabNames` was already called on it during the climb. Then `_buildPhraseCandidates` calls `_collectVocabNames(container)` *again* at line 326.

**Risk of fixing:** Low — cache the vocab names on the way up.

**Gain:** Skips one full subtree recursion + 80%-threshold filter pass. Bigger gain on deeply-nested folders.

---

### 1.5 Quadratic re-walking in `_findPhraseContainer`

Each ancestor level calls `_collectVocabNames` which recursively walks the entire subtree from scratch. Level N+1's subtree contains level N's subtree plus a few new siblings. Could be incremental — diff the new siblings only.

**Risk of fixing:** Medium — would change the climb's structure. Easy to introduce subtle off-by-one bugs.

**Gain:** O(depth × subtree) → O(subtree) overall. Real win on deep hierarchies, marginal on shallow ones.

---

### 1.6 EN phrase word-sets rebuilt per call

`_nameMatchesSomePhrase` (phraseGuesser.js:128) and `_wordOverlapScore` (line 148) both do `new Set(phrase.split(/\s+/).filter(Boolean))` on EN phrases inside their inner loops. The same EN phrase gets re-split and re-set hundreds of times per `guessThePhrase` call.

**Risk of fixing:** Very low — precompute once at the top of `guessThePhrase` as `[{phrase, words: Set<string>}]`.

**Gain:** Cuts redundant string splits. Probably a few ms per layer; bigger on large translation tables.

---

### 1.7 `parseRawPhrase` re-parses the same phrase repeatedly

- `processMatchedFolder` parses `matchedPhrase` and `transPhrase` once each per call.
- `getTranslatableLayers` re-parses `enPhrase` again via inline `replace().split()` (lines 64-72) — duplicating what `parseRawPhrase("raw")` already produces.
- `isNameENPhrase` and `extractMatchingPhrase` re-parse every EN entry per call.

**Risk of fixing:** Low — pass already-parsed lines arrays where possible. Cleaner: cache parsed phrases at Excel-load time.

**Gain:** Small per call, but the parsing happens hundreds of times per translation run.

---

### 1.8 `matchLayersToLines` uses linear `findIndex` for fuzzy + word-in-line

Exact match builds `enIndexByName` (Map) for O(1) lookup. Fuzzy and word-in-line both fall back to `enLines.findIndex` per layer. With M layers and N en lines that's O(M×N).

**Risk of fixing:** Low — precompute a `wordToEnIndex` Map covering all three tiers.

**Gain:** Tiny in absolute terms (small M and N typically), but removes a structural inconsistency where exact match is fast and the others aren't.

---

## 2. Dead code

Confirmed unused in the current pipeline by grep:

| Function | Location | Status |
|---|---|---|
| `getAllEnglishwords` | parsingLogic.js:100 | Called once in `translateAll` line 221 only to `console.log`. Result is never consumed. |
| `layerNameMatchesEnVocab` | parsingLogic.js:307 | Defined, never called from live path. |
| `charOverlapRatio` | parsingLogic.js:295 | Used only by `layerNameMatchesEnVocab` (also dead). |
| `extractMatchingPhrase` | parsingLogic.js:883 | Referenced only from commented-out code. |
| `isNameENPhrase` | parsingLogic.js:858 | Referenced only from commented-out code. |
| `normalizeForMatch` | parsingLogic.js:108 | Used only by the dead functions above. |

Plus roughly **400 lines of commented-out code** scattered through parsingLogic.js — the previous version of `processMatchedFolder` (lines 427-508), the previous `translateAll` (lines 142-200), several other dead blocks (913-1000+).

**Risk of deletion:** Very low if grep confirms zero references (it does for the live functions; the commented blocks are by definition unreferenced). One pass with `grep -rn "<funcName>" src/` per function before deletion.

**Gain:** parsingLogic.js shrinks by roughly half. Live structure becomes readable. Future reviewers don't waste time reading dead branches trying to figure out which version is current.

---

## 3. Structural / architectural issues

### 3.1 `parsingLogic.js` is a god-module

1042 lines. Live half handles seven distinct responsibilities:

1. Excel I/O (`parseExcelFile`, `extractLanguageData`)
2. Top-level orchestration (`translateAll`)
3. Per-folder execution (`processMatchedFolder`)
4. UI-driven actions (`translateSelected`, `generateSuggestions`)
5. Matching algorithm (`matchLayersToLines`)
6. Phrase string parsing (`parseRawPhrase`, `parsePhraseForSuggestions`)
7. Lookup/normalization helpers (mostly dead)

These don't belong together. The file is a junk drawer.

---

### 3.2 Module-level mutable state

```js
let allVisibleLayers;
let smartObjectsForProcessing = [];
let processedIds = new Set();
```

Written by `translateAll`, read by `processMatchedFolder`. Invisible coupling — calling `processMatchedFolder` outside a `translateAll` run has undefined behavior. The `processedIds.clear()` at the top of `translateAll` is the tell that this state needs a lifecycle, which means it shouldn't be module-level.

**Fix:** Wrap in a `TranslationContext` object built at run start, passed down explicitly.

---

### 3.3 Bidirectional dependency between parsingLogic and phraseGuesser

`phraseGuesser.js` imports `parseRawPhrase` from `parsingLogic.js`.
`parsingLogic.js` imports `* as phraseGuesser` from `phraseGuesser.js`.

Not a top-level cycle, but neither module is independently understandable, and unit-testing either requires loading the other.

**Fix:** Extract `parseRawPhrase` to a third file. Both import from it. DAG restored.

---

### 3.4 Concept duplication across files

Two normalization implementations:
- `_normalizeForMatch` in phraseGuesser.js
- `normalizeForMatch` in parsingLogic.js (different — strips `[^\w\s]`, drops digit-only words)

Three similarity-scoring approaches:
- `_wordOverlapScore` (word sets, ratio + shared) — phraseGuesser
- `charOverlapRatio` (char-based, dead) — parsingLogic
- `layerNameMatchesEnVocab` (uses charOverlapRatio, dead) — parsingLogic

Reader can't tell whether the differences are intentional or drift.

---

### 3.5 No data model for a "phrase"

A phrase is sometimes a raw string, sometimes `\n`-joined, sometimes space-joined, sometimes a lines array, sometimes "strict" with `[]` lines dropped. Every consumer asks `parseRawPhrase` for the shape it wants on demand.

A `Phrase` value computed once at Excel-load time (`{raw, lines, oneLine, strict}`) would remove most of the per-call parsing, the 4-mode dispatcher, and the chance of two callers picking different modes when they meant the same thing.

---

### 3.6 `appState` leaks UI concerns into the engine

The translation engine takes `appState` everywhere just to read `languageData` and `selectedLanguage`. Couples the engine to the UI's data shape.

**Fix:** Engine takes `{enPhrases, targetPhrases}` — its actual inputs. UI assembles those from `appState`.

---

### 3.7 Pipeline is "per-SO" but the unit of work is "per-container"

`translateAll` loops over unique SOs and asks each one which container it belongs to, then translates the container. Multiple SOs in the same container drive the same container through `processMatchedFolder` repeatedly. The `processedIds` skip is a band-aid.

**Structural fix:** Two phases — (1) walk the doc, group SOs by their inferred container; (2) translate each container once.

---

### 3.8 Three separate tree walks for one logical pass

- `getAllVisibleLayers` walks the doc.
- `_findPhraseContainer` walks ancestors and re-walks subtrees.
- `_buildPhraseCandidates` walks ancestors again.
- `getTranslatableLayers` walks the container subtree.

Most could be a single annotated layer index built up front.

---

### 3.9 Stale architectural intent in comments

The doc-comment on `guessThePhrase` says it's the *fallback* when direct folder-name matching fails. In current `translateAll`, it's the *primary* path — folder-name matching is the commented-out block. Naming and comments still reflect the old architecture.

---

### 3.10 Cross-cutting concerns getting bolted into the main loop

The slice-fit work plans to drop `try { fitSOToOverlappingSlice } catch {}` directly inside STEP 8 of `processMatchedFolder`. Nested SO detection is similar. This is how 1000-line files become 1500-line files.

**Fix:** Named post-translation steps the orchestrator runs in sequence — explicit pipeline, not inline calls.

---

## 4. Extraction roadmap (safest first)

Ordered by safety and minimal-touch effort. Each step is mechanical and behavior-preserving.

### Step 1: Excel module — SAFEST

**Move:** `parseExcelFile` + `extractLanguageData` → `src/api/excel.js`.

**Why safest:**
- Zero coupling to any module-level state.
- Zero internal calls to other parsingLogic functions.
- External deps are just `XLSX` and `uxp` — already injected.
- Only 2 callers (`LoadFDiskButton.jsx`, `LoadFURLButton.jsx`).
- Pure data transformation: file in → `{languageData, availableLanguages}` out.

**Risk:** Essentially zero. If imports resolve, it works.

**Gain:** ~60 lines out of parsingLogic. Establishes the extraction pattern. First step toward the file actually meaning something.

**Execution:** Create `excel.js`, copy the two functions + `import "../lib/xlsx.full.min.js"` + `const XLSX = window.XLSX`. Delete from parsingLogic. Either update the two UI imports OR add a temporary re-export from parsingLogic (`export { parseExcelFile } from "./excel.js"`) for zero blast radius.

---

### Step 2: Phrase module — VERY SAFE, BIG ARCHITECTURAL WIN

**Move:** `parseRawPhrase` + `parsePhraseForSuggestions` → `src/api/phrase.js`.

**Why second:**
- Pure string functions, no state, no async.
- **Breaks the bidirectional import** between parsingLogic and phraseGuesser.
- Slightly more touch points than Excel (5 live calls in parsingLogic, 1 in phraseGuesser).

**Risk:** Low. Stateless, deterministic, explicit string I/O. Either it imports cleanly or it errors immediately.

**Gain:** ~90 lines out. DAG restored — phraseGuesser no longer depends on parsingLogic. Both files become independently testable.

**Execution:** Create `phrase.js`. Delete from parsingLogic. Update `phraseGuesser.js` import path. Add an internal import in parsingLogic for its own uses. Optional re-export shim if any other file imports `parseRawPhrase` from parsingLogic.

---

### Step 3: Layer matcher — SAFE, BUT LARGER

**Move:** `matchLayersToLines` → `src/api/layerMatcher.js`.

**Why third:**
- Pure function. Single caller. ~140 lines.
- Largest of the three extractions.
- First one containing real algorithmic logic (confidence ladder, tail-anchoring, two-branch case analysis).
- Hardcoded `doNotTranslate = new Set(["SUPER", "X2"])` is local to the function and moves with it.

**Risk:** Low. Pure, single caller, no state. Risk is psychological — if a bug shows up later you might wonder if the move caused it. With Excel and phrase, you wouldn't.

**Gain:** ~140 lines out. parsingLogic.js is now genuinely a coordinator, not a junk drawer.

**Execution:** Create `layerMatcher.js`. Copy `matchLayersToLines`. Delete from parsingLogic. Add the import in parsingLogic.

---

### Cumulative effect of steps 1-3

parsingLogic.js loses ~290 lines of live code (plus whatever dead code is deleted alongside). What remains is the actual orchestration:

- `translateAll`
- `processMatchedFolder`
- `translateSelected`
- `generateSuggestions`
- Small helpers around them
- Module-level state (still — that's the next refactor)

Outside parsingLogic, the module set becomes:

```
src/api/
  excel.js                  ← step 1
  phrase.js                 ← step 2
  layerMatcher.js           ← step 3
  phraseGuesser.js          (unchanged structure; updated import only)
  getTranslatableLayers.js  (unchanged)
  photoshop.js              (unchanged)
  parsingLogic.js           (orchestrator)
```

Clean leaves, one coordinator.

---

## 5. The bigger refactor — `TranslationContext`

After steps 1-3, the next move is structural rather than mechanical.

**What:** A `TranslationContext` object built at the top of `translateAll`, holding:

```js
{
  allVisibleLayers,         // snapshot
  soIdByLayerId,            // pre-translate snapshot, one bulk batchPlay
  normalizedEN,             // [{phrase, words: Set}] precomputed
  processedIds,             // run-wide dedup set
  appStateRefs: {           // narrow surface, not the full appState
    enPhrases,
    targetPhrases,
  },
}
```

Pass `ctx` to every consumer. Module-level `let` declarations go away.

**Risk:** Higher than the extractions. Touches `translateAll`, `processMatchedFolder`, `getTranslatableLayers`, and `phraseGuesser`. Changes the function signatures. Needs a careful test pass.

**Gain:**
- Kills module-level mutable state.
- Removes `appState` plumbing through the engine.
- Single source of truth for SO IDs (the §1.1 perf win lives here).
- Sets up the per-container two-phase loop fix (§3.7) cleanly.
- Makes the engine testable — call `translateAll` with a fake context, no need for a live Photoshop.

**Recommended sequence:** Do this *after* steps 1-3. Extractions reduce the surface this refactor has to touch. Doing them first gives you confidence that mechanical moves work before attempting a structural one.

---

## 6. What would make any of this unsafe

The whole optimization story has one structural assumption and a few smaller ones:

- **§0 — soId lockstep flip.** Confirmed by user but worth a one-time real-PSD test with the existing diagnostic block re-enabled before committing to removing line 403.
- **No mid-run layer creation.** `translateSmartObject` edits in place; doesn't create new layers. If any post-step (slice-fit, future hooks) creates layers, the snapshot map needs invalidation logic for those specific IDs.
- **No re-entrant `translateAll`.** If translation kicks off another translation mid-run, both would share `processedIds` via module scope today — chaotic. The `TranslationContext` refactor fixes this by isolation.
- **Visibility/locked filter coverage.** `getAllVisibleLayers` skips invisible/locked subtrees. Translatable SOs inside a locked group aren't in the snapshot. Same exposure as today — not a regression, but worth flagging.

---

## 7. TL;DR ranked recommendations

**Safe and high-value:**
1. Extract `parseExcelFile` + `extractLanguageData` → `excel.js`
2. Extract `parseRawPhrase` + `parsePhraseForSuggestions` → `phrase.js` (breaks the bidirectional import)
3. Extract `matchLayersToLines` → `layerMatcher.js`
4. Delete confirmed dead code (`getAllEnglishwords`, `layerNameMatchesEnVocab`, `charOverlapRatio`, `extractMatchingPhrase`, `isNameENPhrase`, `normalizeForMatch`, ~400 lines of commented blocks)
5. Drop the redundant `processedIds.add` + `await getSOid` in `processMatchedFolder` STEP 6 (line 403)
6. Pass `processedIds` into `getTranslatableLayers` so N-times-per-folder shortcuts after first call

**Bigger but still high-value:**
7. Build `soIdByLayerId` once via one bulk `batchPlay` at top of `translateAll`; thread to all consumers (the §1.1 main perf win)
8. Precompute `normalizedEN` with cached word-sets in `guessThePhrase`
9. Cache `_collectVocabNames(container)` from the climb so it isn't called twice

**Structural:**
10. `TranslationContext` object replaces module-level `let`s
11. Rework `translateAll` to two-phase per-container loop (groups SOs by container before translating)
12. Move cross-cutting concerns (slice-fit, future hooks) to named post-translation steps

---

*Generated from conversation analysis of the repo at commit `0b7cadc`.*






### Layer 2: `executionContext`

The `executionContext` object has these relevant properties:

| Property | Purpose |
|---|---|
| `executionContext.hostControl` | Sub-object for controlling Photoshop's host behavior (history, document state) |
| `executionContext.isCancelled` | Boolean — `true` if the user clicked Cancel in Photoshop's progress dialog. Long-running operations should poll this. |
| `executionContext.reportProgress` | Function to update the Photoshop progress bar (for very long operations) |

For this codebase, only `hostControl` is used. The key method on `hostControl` is `suspendHistory`.

**Important:** `executionContext` is only valid inside the `executeAsModal` callback. Do NOT store it or pass it outside the callback's lifetime — it becomes invalid once the modal returns.

---

### Layer 3: `suspendHistory` / `resumeHistory`

```js
const suspension = await executionContext.hostControl.suspendHistory({
  documentID: app.activeDocument.id,
  name: "Rename Layers"
});
```

**What it does:** Tells Photoshop to stop recording individual history steps. Every `batchPlay` set/rename call that happens after this point will NOT create its own undo entry. Instead, all changes are grouped together under one single entry.

**The `suspension` token:** `suspendHistory` returns a token object (`{ historySuspensionID: <number> }`). You MUST pass this exact token back to `resumeHistory`. Without it, Photoshop doesn't know which suspension to end.

**The `name` parameter:** `"Rename Layers"` is the label that appears in the History panel as a single undo step. After the operation completes, the user sees one entry called "Rename Layers" instead of 500 individual "Set Layer" entries.

**The `documentID` parameter:** Identifies which document's history to suspend. Must be `app.activeDocument.id` (an integer). This is critical — if the user switches documents mid-operation, you'd be suspending history on the wrong document without this.

```js
await executionContext.hostControl.resumeHistory(suspension, true);
```

**What it does:** Ends the history suspension and either commits or rolls back all changes made since `suspendHistory`.

**The second argument is a plain boolean:**
- `true` → **commit** — all changes become one undo step in the History panel. The user can Ctrl+Z to undo ALL of them at once.
- `false` → **rollback** — all changes since `suspendHistory` are discarded, as if they never happened.

**CRITICAL: Do NOT pass an object** like `{ commit: true }`. This crashes Photoshop silently. It must be a bare `true` or `false`.

---

### The `try/finally` Pattern

```js
try {
  // ... all batchPlay mutations ...
} finally {
  await executionContext.hostControl.resumeHistory(suspension, true);
}
```

**Why `finally` is mandatory:** If any code between `suspendHistory` and `resumeHistory` throws an exception, `resumeHistory` would never be called. This leaves Photoshop in a permanently suspended history state — the next operation that tries to suspend history will crash, and the History panel becomes unusable until the plugin is reloaded.

`finally` guarantees `resumeHistory` runs whether the try block succeeds or throws. This is non-negotiable.

**Note:** Even inside `finally`, we pass `true` (commit). This is a deliberate choice — if some renames succeeded and then something threw, we keep the partial work rather than rolling back everything. The user can Ctrl+Z the partial result. If you wanted atomic all-or-nothing behavior, you'd pass `false` in the catch and `true` at the end of try, but this codebase opts for commit-always.

---

### Complete Flow — What Happens at Runtime

Here's the exact sequence when the user clicks "Rename All" with 500 layers:

```
1. User clicks button
2. renameLayersNew("toAll") is called
3. core.executeAsModal acquires the modal lock
   → Photoshop is now locked; no other plugin or user action can modify the document
4. executionContext is created by Photoshop and passed to our callback
5. suspendHistory pauses history recording for the active document
   → suspension token is stored
6. getLayerDescriptors() runs batchPlay "get" calls to read all layer data
   → This is a READ inside the modal. It could technically run outside,
     but keeping it inside ensures no layer state changes between read and write.
7. JS computes all new names (pure JS, zero Photoshop cost)
8. One batchPlay "set" call renames ALL 500 layers at once
   → Photoshop processes 500 rename descriptors but records ZERO history steps
     (because history is suspended)
9. One batchPlay "set" call restores collapsed state on groups
   → Also records zero history steps
10. resumeHistory(suspension, true) commits everything
    → ONE history entry "Rename Layers" appears in the History panel
    → User can Ctrl+Z to undo all 500 renames at once
11. The async callback returns → executeAsModal releases the modal lock
    → Photoshop is unlocked; user and other plugins can interact again
```

---

### Rules for Any Agent Modifying This Pattern

1. **All document writes (`_obj: "set"`, `_obj: "delete"`, etc.) MUST be inside `executeAsModal`.** Calling them outside will throw a "no modal scope" error.

2. **All document reads (`_obj: "get"`) CAN run outside `executeAsModal`.** Moving reads outside reduces modal hold time and improves responsiveness. The current code keeps reads inside for atomicity (no state change between read and write), which is a valid tradeoff.

3. **`suspendHistory` and `resumeHistory` MUST be paired.** Every `suspendHistory` call must have exactly one matching `resumeHistory`. Use `try/finally` to guarantee this.

4. **`resumeHistory`'s second argument is a bare boolean.** `true` = commit, `false` = rollback. Not an object. Not optional.

5. **The `suspension` token from `suspendHistory` must be passed to `resumeHistory`.** Do not discard it or reconstruct it.

6. **`executionContext` is only valid inside the callback.** Do not store it in module-level variables or closures that outlive the modal.

7. **Keep modal scope minimal.** The modal blocks all other plugins and user interaction. Do computation (name building, filtering, validation) outside or before the write phase when possible.

8. **`batchPlay` with `{ synchronousExecution: true }` inside modal is the standard pattern.** This ensures each batchPlay completes before the next line runs. Without it, batchPlay returns a Promise that resolves when Photoshop finishes — still works, but `synchronousExecution: true` avoids race conditions inside modal scope.
