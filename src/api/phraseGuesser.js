import { photoshop } from "../globals";
import { parseRawPhrase } from "./parsingLogic";
const { app, constants } = photoshop;

/**
 * Attempts to guess which XLSX phrase a layer belongs to when it doesn't live
 * inside a correctly-named folder (Structure 2 / messy hierarchy).
 *
 * Strategy:
 *   1. Pre-normalise all EN phrases (uppercase, strip brackets/parens).
 *   2. Walk UP from the layer to find the "phrase container" — the highest
 *      ancestor whose subtree of SO/text names is still fully explained by
 *      a single EN phrase (no leaked words from sibling phrases).
 *      Folders are always transparent; only SO/text layer names are collected.
 *   3. Collect non-noise ancestor folder names between the layer and the
 *      container as individual candidates.
 *   4. Collect SO/text names from inside the container (filtered by an 80%
 *      phrase-match threshold) → join into a single compound candidate.
 *   5. Score all candidates with word-overlap ratio; tiebreak by absolute
 *      shared-word count — return best match ≥ 0.5.
 *
 * @param {Object} layer    - A Photoshop SO or text layer
 * @param {Object} appState - { languageData, selectedLanguage }
 * @returns {{ enPhrase, translatedPhrase, confidence, matchedCandidate } | null}
 */
export function guessThePhrase(layer, appState) {
  const enEntries   = appState.languageData?.["EN"];
  const langEntries = appState.languageData?.[appState.selectedLanguage];
  if (!enEntries || !langEntries){
    console.log("guessThePhrase: missing language data for EN or selected language");
    return null;

  } 

  // Pre-normalise all EN phrases — used for container-finding, filtering and scoring
  const normalizedEN = enEntries.map(e => _normalizeForMatch(e));

  const { candidates, container } = _buildPhraseCandidates(layer, normalizedEN);
  console.log(`[guessThePhrase] "${layer.name}" candidates:`, candidates);
  if (candidates.length === 0) {
    console.warn(`[guessThePhrase] "${layer.name}" — no candidates built, returning null`);
    return null;
  }

  let bestScore = 0, bestShared = 0, bestIndex = -1, bestCandidate = null;

  for (const candidate of candidates) {
    const normCandidate = _normalizeForMatch(candidate);
    for (let i = 0; i < normalizedEN.length; i++) {
      const { ratio, shared } = _wordOverlapScore(normCandidate, normalizedEN[i]);
      if (ratio > bestScore || (ratio === bestScore && shared > bestShared)) {
        bestScore     = ratio;
        bestShared    = shared;
        bestIndex     = i;
        bestCandidate = candidate;
      }
    }
  }

  if (bestScore < 0.5 || bestIndex === -1) {
    console.warn(`[guessThePhrase] "${layer.name}" — best score ${bestScore.toFixed(2)} below 0.5, no match found`);
    return null;
  }

  const translatedPhrase = parseRawPhrase(langEntries[bestIndex], "raw");
  if (!translatedPhrase) {
    console.log(`"${layer.name}" — matched EN phrase "${enEntries[bestIndex]}" but translation is missing from the Excel file`);
    // console.log(`[guessThePhrase] "${layer.name}" — matched EN phrase "${enEntries[bestIndex]}" but translatedPhrase is empty after parseRawPhrase("strict")`);

    return null;
  }

  return {
    enPhrase:         enEntries[bestIndex],
    translatedPhrase,
    confidence:       bestScore,
    matchedCandidate: bestCandidate,
    container,
  };
}


// ── private helpers ───────────────────────────────────────────────────────────

// NOTE: _NOISE_NAMES and _isNoiseName are NOT used inside _collectVocabNames —
// all folders are traversed transparently there regardless of name.
// They are only used in _buildPhraseCandidates to skip noise folder names
// when building individual ancestor candidates.
const _NOISE_NAMES = new Set([
  "BG", "SLICES", "BACKGROUND",
  // language codes — treated as transparent hierarchy levels
  "EN","DE","HR","EL","IT","RO","PT","ES","MK","SQ","SR",
  "UK","RU","TR","HU","CS","PT-BR","NL","DA","FR","PL",
  "ZH-CN","SK","SL","SV","ET","KO","KA","LV","LT",
]);
const _NOISE_RE = /^group\s+\d+$/i;

function _isNoiseName(name) {
  return _NOISE_NAMES.has(name.trim().toUpperCase()) || _NOISE_RE.test(name.trim());
}

function _stripCopySuffix(name) {
  return name.replace(/\s+copy(\s+\d+)?$/i, "").trim();
}

function _normalizeForMatch(str) {
  return str
    .replace(/[()]/g, "") // TESTING Removes all opening "(" and closing ")" parentheses from the string while preserving the text inside.
    // .replace(/\(.*?\)/g, "")   // strip (do not translate!) etc.
    .replace(/\[.*?\]/g, "")   // strip [NUMBER] placeholders
    .toUpperCase()
    .replace(/\s+/g, " ") // Replaces all whitespace sequences (spaces, tabs, line breaks) with a single space to normalize text formatting.
    .trim();
}

/**
 * Returns true if at least `threshold` (default 0.8) fraction of the name's
 * words appear in at least one EN phrase.
 *
 * Used to decide whether an SO/text layer name is phrase-relevant or noise.
 * The denominator is the candidate's own word count (not max), so short but
 * valid names always pass.
 *
 * Examples:
 *   "chance"                  → 1/1 = 1.0  ✓
 *   "for bonus"               → 2/2 = 1.0  ✓
 *   "off"                     → 0/1 = 0.0  ✗  (no phrase contains "OFF")
 *   "doubleChanceOnLandscape" → 0/1 = 0.0  ✗  (CamelCase = single token, no match)
 */
function _nameMatchesSomePhrase(name, normalizedEN, threshold = 0.8) {
  const clean = _normalizeForMatch(_stripCopySuffix(name));
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const wordSet = new Set(words);
  for (const phrase of normalizedEN) {
    const phraseWords = new Set(phrase.split(/\s+/).filter(Boolean));
    let shared = 0;
    for (const w of wordSet) { if (phraseWords.has(w)) shared++; }
    if (shared / words.length >= threshold) return true;
  }
  return false;
}

/**
 * Word-overlap ratio between two already-normalized strings.
 * Returns { ratio: shared / max(|a|, |b|), shared: count }.
 * Tiebreaking on `shared` ensures more-specific matches win over short
 * high-ratio matches (e.g. "CREDITS WON" ratio 1.0 vs "TOTAL CREDITS WON" ratio 1.0).
 */
function _wordOverlapScore(a, b) {
  const wa = new Set(a.split(/\s+/).filter(Boolean));
  const wb = new Set(b.split(/\s+/).filter(Boolean));
  if (!wa.size || !wb.size) return { ratio: 0, shared: 0 };
  let shared = 0;
  for (const w of wa) { if (wb.has(w)) shared++; }
  return { ratio: shared / Math.max(wa.size, wb.size), shared };
}

/**
 * Find the "phrase container" by walking up the layer hierarchy.
 *
 * Only SO/text layer names are collected — folder names are always transparent.
 * At each ancestor we score the compound of translatable layer names against
 * all EN phrases to find the best-matching phrase.
 *
 * Stop rules:
 *   1. Unexplained words: compound contains a word NOT in the best-match phrase
 *                        → a sibling phrase's SO leaked in → stop, return lastGood.
 *   2. Score drop:       score falls below 0.5 after seeding → stop.
 *   3. Fallback:         nothing ever seeded → use old depth-2 logic.
 *
 * Climbing continues as long as all compound words belong to the current
 * best-match phrase — even if the best-match phrase index updates upward
 * (e.g. "WON" seeds "TOTAL WON", gains CREDITS → flips to "TOTAL CREDITS WON",
 * no unexplained words → keeps climbing correctly).
 *
 * Example — doubleChanceBtn:
 *   EN → {X2,FOR BONUS,CHANCE} no unexplained → lastGood=EN
 *   txt only → same → lastGood=txt only
 *   doubleChanceOffLandscape → same → lastGood=doubleChanceOffLandscape
 *   doubleChanceBtn → same → lastGood=doubleChanceBtn
 *   Landscape → adds BUY → BUY not in "X2 CHANCE FOR BONUS" → STOP
 *   → returns doubleChanceBtn ✓
 */
function _findPhraseContainer(layer, normalizedEN) {
  let current          = layer.parent;
  let seedPhraseIndex  = -1;   // phrase index first matched while climbing
  let lastGoodAncestor = null; // last ancestor still matching the seed phrase

  while (current) { // climb until past the document root
    const vocabNames = _collectVocabNames(current, normalizedEN);

    if (vocabNames.length > 0) {
      const normCompound = _normalizeForMatch(vocabNames.join("\n"));

      // Find the best-matching EN phrase at this ancestor level
      let bestScore = 0, bestShared = 0, bestIndex = -1;
      for (let i = 0; i < normalizedEN.length; i++) {
        const { ratio, shared } = _wordOverlapScore(normCompound, normalizedEN[i]);
        if (ratio > bestScore || (ratio === bestScore && shared > bestShared)) {
          bestScore = ratio; bestShared = shared; bestIndex = i;
        }
      }

      if (bestScore >= 0.5) {
        // Stop rule 1: unexplained word — compound contains a word not present
        // in the best-match phrase, meaning a sibling phrase's SO leaked in.
        // Only checked after the first seed (no baseline to compare on first match).
        if (seedPhraseIndex !== -1) {
          const compoundWords   = new Set(normCompound.split(/\s+/).filter(Boolean));
          const bestPhraseWords = new Set(normalizedEN[bestIndex].split(/\s+/).filter(Boolean));
          const unexplained = [...compoundWords].filter(w => !bestPhraseWords.has(w));
          if (unexplained.length > 0) {
            console.log("phraseContainer stop at:", current.name, "— unexplained words:", unexplained.join(", "));
            break;
          }
        }

        // Advance — update seed and lastGood. Allows upgrading from a sub-phrase
        // to a longer one (e.g. {WON} seeds "TOTAL WON", gains CREDITS →
        // upgrades to "TOTAL CREDITS WON", all words still explained → keep climbing).
        seedPhraseIndex  = bestIndex;
        lastGoodAncestor = current;
        console.log(`[climb] folder "${current.name}" best EN match: idx ${bestIndex} score ${bestScore.toFixed(2)}`);

      } else if (seedPhraseIndex !== -1) {
        // Stop rule 2: score dropped below 0.5 after seeding
        console.log("phraseContainer stop at:", current.name, "— score dropped to", bestScore);
        break;
      }
    }

    current = current.parent;
  }

  if (lastGoodAncestor) {
    console.log("phraseContainer selected:", lastGoodAncestor.name);
    return lastGoodAncestor;
  }

  // Fallback: depth-2 logic — used when no phrase was ever matched while
  // climbing (e.g. all layer names are CamelCase noise). Climbs until the
  // ancestor whose parent is the document root, matching the old heuristic.
  current = layer.parent;
  while (current) {
    if (current.parent && !current.parent.parent) {
      console.log("phraseContainer selected (fallback depth-2):", current.name);
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Recursively collect translatable layer names inside a group.
 *
 * - SO and text layers: collect baseName ("copy N" stripped) if it passes
 *   the 80% phrase-match threshold (_nameMatchesSomePhrase). No recursion.
 * - Everything else (groups, folders, adjustment layers): recurse transparently
 *   — the container's own name is never collected, only its descendants.
 *
 * This means CamelCase scene-folder names (e.g. "doubleChanceOffLandscape")
 * never pollute the compound — only SO/text leaf names do.
 * Returns a deduplicated (case-insensitive) array of clean baseNames.
 */
function _collectVocabNames(group, normalizedEN) {
  const seen  = new Set();
  const names = [];
  const children = group.layers ? [...group.layers].reverse() : [];

  for (const child of children) {
    const isTranslatable =
      child.kind === constants.LayerKind.SMARTOBJECT ||
      child.kind === constants.LayerKind.TEXT;

    if (isTranslatable) {
      // SO or text layer — keep only if name matches ≥ 80% of some phrase's words
      const base = _stripCopySuffix(child.name);
      const key  = base.toUpperCase();
      if (!seen.has(key) && _nameMatchesSomePhrase(base, normalizedEN)) {
        seen.add(key);
        names.push(base);
      }
    } else {
      // Everything else (folders, groups, adjustment layers) —
      // recurse transparently, never collect the container's own name
      for (const n of _collectVocabNames(child, normalizedEN)) {
        if (!seen.has(n.toUpperCase())) {
          seen.add(n.toUpperCase());
          names.push(n);
        }
      }
    }
  }
  return names;
}

/**
 * Build phrase candidates for scoring against EN phrases.
 *
 * 1. Find the phrase container via _findPhraseContainer (unexplained-words
 *    stop heuristic, with depth-2 fallback).
 * 2. Walk from the layer up to the container, collecting non-noise ancestor
 *    folder names as individual candidates (e.g. "won", "credits won").
 * 3. Collect SO/text names from inside the container via _collectVocabNames
 *    and join them into a single compound candidate.
 *
 * The ancestor names (step 2) give the scorer extra signal when the container
 * subtree alone is ambiguous.
 */
function _buildPhraseCandidates(layer, normalizedEN) {
  const candidates = [];

  const container = _findPhraseContainer(layer, normalizedEN);

  // ── Ancestors between layer and container (nearest first) ──
  let current = layer.parent;
  while (current && current !== container) {
    if (!_isNoiseName(current.name)) {
      candidates.push(current.name);
    }
    current = current.parent;
  }

  // ── Phrase-matched names from inside the container ──
  if (container) {
    const vocabNames = _collectVocabNames(container, normalizedEN);
    if (vocabNames.length > 0) {
      candidates.push(vocabNames.join("\n"));
    }
  }
  // console.log("Layer candidates:", candidates);
  return { candidates, container };
}
