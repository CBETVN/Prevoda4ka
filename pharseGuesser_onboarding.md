# phraseGuesser.js — Onboarding & Design History

## What It Does

`guessThePhrase()` maps a Photoshop layer (smart object or text) to an EN phrase from a loaded XLSX translation table — even when the layer isn't inside a correctly-named folder. It's the fallback when direct parent-folder matching (in `parsingLogic.js`) fails.

---

## The Problem

Photoshop PSDs have wildly inconsistent layer hierarchies. A phrase like **"TOTAL CREDITS WON"** might be structured as:

```
outroTotalCreditsWonLandscape        ← "phrase container" (unreliable name)
├── BG                               ← structural noise
├── EN                               ← language folder (noise)
│   └── credits won                  ← phrase sub-folder (partial name!)
│       ├── credits/                 ← word-folder
│       │   └── credits won (SO)     ← the actual layer
│       ├── won/                     ← word-folder
│       │   └── won copy 2 (SO)     ← ← selected layer lives here
│       └── total/                   ← word-folder
│           └── Total Credits (SO)
├── common/                          ← structural noise
├── Slices/                          ← structural noise
└── background/                      ← structural noise
```

The algorithm must figure out that "won copy 2" belongs to the phrase **"TOTAL CREDITS WON"**, not **"CREDITS WON"** or **"TOTAL WON"**.

---

## Failed Approaches (and why)

### Approach 1: Bottom-up sibling collection (original)

**Idea:** Walk up from the layer, at each ancestor collect sibling SO/text layer names, join them as a candidate phrase.

**Problem:** At the `won` folder level, siblings are `won` and `won copy 2` — both SOs. But the sibling *folders* (`credits`, `total`) aren't SOs, so they're invisible. Result: candidate = `"won"` only.

### Approach 2: Collect sub-folder names when no SO siblings exist

**Idea:** If a folder has no direct SO/text children, collect its non-noise sub-folder names instead.

**Problem:** Used `child.layers` to detect folders — but `total`'s `.layers` was `undefined` in UXP (unexpanded group quirk). Then tried `child.kind === GROUP` — but `total`'s kind wasn't GROUP either (Photoshop internal weirdness with effects on groups). Result: `total` was always silently dropped.

### Approach 3: Remove all kind/layers guards

**Idea:** Any non-translatable, non-noise sibling is a word-folder. No guards needed.

**Problem:** Worked for the immediate level but the algorithm kept climbing past the phrase boundary, collecting unrelated top-level folder names (`multiplierCreditsWon`, `multiplierWin`, etc.), which polluted candidates.

### Approach 4: Container boundary + full recursive collection

**Idea:** Find the "phrase container" (depth-2 ancestor from document root), then recursively collect ALL names inside it.

**Problem:** The container holds structural elements too (`background`, `Slices`, `common`, `numbers`, `texture`). The compound candidate had 10+ words, so scoring `3/10 = 0.3` against a 3-word phrase — below the 0.5 threshold. The partial match `"credits won"` (ratio 1.0) won instead.

### Approach 5 (current, working): Vocabulary-filtered container collection

See below.

---

## Current Working Algorithm

### Key Insight

Build a **vocabulary set** from all EN phrases upfront. When scanning a container, only collect names whose words exist in the vocabulary. This naturally filters out structural noise (`background`, `Slices`, `common`, `texture`) while keeping phrase-relevant names (`total`, `credits won`, `won`).

### Step-by-step

1. **Build vocabulary:** Extract every unique uppercased word from all EN phrases → `{TOTAL, CREDITS, WON, FREE, SPINS, WIN, ...}`

2. **Find phrase container:** Walk up from the layer. The container is the ancestor at **depth 2 from document root** — i.e., `ancestor.parent` exists but `ancestor.parent.parent` does not. This is the top-level group that holds one complete phrase/scene. Its **name is NOT used** as a candidate (it's unreliable, e.g., `outroTotalCreditsWonLandscape`).

3. **Collect ancestor candidates:** Walk up from the layer to the container, collecting non-noise folder names as individual candidates. E.g., `"won"`, `"credits won"`.

4. **Collect vocab-filtered names from container:** Recursively scan the container:
   - **Noise folders** (`EN`, `BG`, `Group 3`, language codes): recurse into them transparently, don't collect their names.
   - **Translatable layers** (SO/text): collect baseName (with "copy N" stripped) if any word is in vocabulary.
   - **Other children**: collect name if any word is in vocabulary, then recurse into them too.
   - All names are deduplicated (case-insensitive).
   - Result is joined into a single compound candidate.

5. **Score candidates:** Each candidate is normalized (uppercase, strip `(...)` and `[...]`) and scored against each EN phrase using **word-overlap ratio** = `shared_words / max(words_in_candidate, words_in_phrase)`. Ties are broken by **absolute shared-word count** (a 3-word perfect match beats a 2-word perfect match).

6. **Return best match** if score ≥ 0.5.

### Scoring Tiebreaker — Why It Matters

Without the `bestShared` tiebreaker, `"credits won"` (2 words, ratio 1.0 vs "CREDITS WON") would beat `"credits\nwon\ntotal"` (3 words, ratio 1.0 vs "TOTAL CREDITS WON") because the algorithm used strict `>`. The tiebreaker ensures more-specific matches win.

---

## Important UXP/Photoshop Gotchas

- **`child.layers` is unreliable:** Collapsed/unexpanded groups may have `undefined` or empty `.layers` in UXP. Never use this as the sole check for "is this a folder."
- **`child.kind` is unreliable for groups:** Groups with effects or certain internal states may not report `LayerKind.GROUP`. The current code avoids relying on kind for folder detection entirely.
- **Photoshop layer order:** `group.layers` returns bottom-to-top order. We reverse to get top-down (document panel order).
- **"copy N" suffix:** Photoshop auto-appends `copy`, `copy 2`, etc. when duplicating layers. Always strip this before matching.

---

## Noise Detection

A layer/folder name is "noise" if:
- It's in the `_NOISE_NAMES` set: `BG`, `SLICES`, `BACKGROUND`, or any supported language code (`EN`, `DE`, `HR`, etc.)
- It matches `Group N` pattern (e.g., `Group 3`, `group 12`)

Noise folders are traversed transparently — their children are collected but the folder name itself is not.

---

## File Dependencies

- **`parsingLogic.js`** calls `guessThePhrase()` as a fallback when direct parent-folder matching fails. If the guess returns `null`, `parsingLogic` shows `app.showAlert("Parent folder does not match any EN phrase.")`.
- **`parseRawPhrase()`** from `parsingLogic.js` is used to extract the translated phrase from the XLSX data (handles `"strict"` mode parsing).
- **`globals.js`** provides the `photoshop` API object and `constants.LayerKind`.
