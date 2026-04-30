import { photoshop } from "../globals";
import { parseRawPhrase } from "./parsingLogic";
const { constants } = photoshop;

/**
 * Attempts to guess which XLSX phrase a layer belongs to when it doesn't live
 * inside a correctly-named folder (Structure 2 / messy hierarchy).
 *
 * Strategy:
 *   1. Build a vocabulary set of every unique word across all EN phrases.
 *   2. Walk UP from the layer to find the "phrase container" — the highest
 *      ancestor that still best-matches the same single EN phrase.
 *      (Stops climbing when the best match flips to a different phrase,
 *      which means that ancestor holds content from multiple phrases.)
 *   3. Recursively scan inside the container, collecting every name
 *      (folder names, translatable layer baseNames) that contains at least
 *      one word present in the vocabulary. Structural noise is filtered out.
 *   4. Also collect non-noise ancestor folder names between the layer
 *      and the container.
 *   5. Build a single compound candidate from vocabulary-filtered names,
 *      plus individual ancestor names as separate candidates.
 *   6. Score with word-overlap ratio; tiebreak by absolute shared-word count
 *      — return best match ≥ 0.5.
 *
 * @param {Object} layer    - A Photoshop SO or text layer
 * @param {Object} appState - { languageData, selectedLanguage }
 * @returns {{ enPhrase, translatedPhrase, confidence, matchedCandidate } | null}
 */
export function guessThePhrase(layer, appState) {  const enEntries   = appState.languageData?.["EN"];
  const langEntries = appState.languageData?.[appState.selectedLanguage];
  if (!enEntries || !langEntries) return null;

  // Build vocabulary: every unique word that appears in any EN phrase
  const vocabulary = _buildVocabulary(enEntries);

  // Pre-normalise all EN phrases — shared by container-finding and scoring
  const normalizedEN = enEntries.map(e => _normalizeForMatch(e));

  const candidates = _buildPhraseCandidates(layer, vocabulary, normalizedEN);
  // console.log("Phrase guesser candidates:", candidates);
  if (candidates.length === 0) return null;

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

  if (bestScore < 0.5 || bestIndex === -1) return null;

  const translatedPhrase = parseRawPhrase(langEntries[bestIndex], "strict");
  if (!translatedPhrase) return null;

  return {
    enPhrase:         enEntries[bestIndex],
    translatedPhrase,
    confidence:       bestScore,
    matchedCandidate: bestCandidate,
  };
}


// ── private helpers ───────────────────────────────────────────────────────────

const _NOISE_NAMES = new Set([
  "BG", "SLICES", "BACKGROUND",
  // language codes — treat as transparent hierarchy levels
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
 * Build a Set of every unique uppercased word across all EN phrases.
 * Used to filter container children: only names containing vocabulary words
 * are considered phrase-relevant.
 */
function _buildVocabulary(enEntries) {
  const vocab = new Set();
  for (const phrase of enEntries) {
    const normalized = _normalizeForMatch(phrase);
    for (const word of normalized.split(/\s+/)) {
      if (word) vocab.add(word);
    }
  }
  return vocab;
}

/**
 * Check whether a name contains at least one word from the vocabulary.
 * The name is stripped of "copy N" suffix, normalized, then split into words.
 */
function _nameHasVocabWord(name, vocabulary) {
  const clean = _normalizeForMatch(_stripCopySuffix(name));
  return clean.split(/\s+/).some(w => w && vocabulary.has(w));
}

/**
 * Word-overlap ratio between two normalized strings.
 * Returns { ratio: shared / max(|a|, |b|), shared: count }
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
 * At each ancestor we collect vocab-filtered names recursively and score
 * the compound against all EN phrases to find the best-matching phrase.
 *
 * Rules:
 *   1. Seed:    first ancestor that scores ≥ 0.5 → records that phrase
 *              index as the "target phrase" and saves ancestor as lastGood.
 *   2. Climb:   keep going UP while the SAME phrase index is still best
 *              (the true container may be higher, e.g. when noise folders
 *              like BG / EN sit between the layer and the real container).
 *   3. Stop:    when best match flips to a DIFFERENT phrase index → this
 *              level already contains multiple phrases → return lastGood.
 *   4. Stop:    also when score drops below 0.5 after seeding → return lastGood.
 *   5. Fallback: if nothing ever seeded, use the old depth-2 logic so
 *              existing working cases don't regress.
 *
 * Handles sub-phrase ambiguity (e.g. "YOU WIN" inside "CONGRATULATIONS YOU WIN"):
 *   A sub-container with only "you" + "win" seeds to "YOU WIN" (index A).
 *   Its parent introduces "congratulations" → best match becomes
 *   "CONGRATULATIONS YOU WIN" (index B ≠ A) → stop → sub-container returned ✓
 */
function _findPhraseContainer(layer, vocabulary, normalizedEN) {
  let current = layer.parent;
  let seedPhraseIndex  = -1;   // phrase index first matched while climbing
  let lastGoodAncestor = null; // last ancestor still matching the seed phrase

  while (current && current.parent) { // stop before document root (no parent)
    const vocabNames = _collectVocabNames(current, vocabulary);

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
        if (seedPhraseIndex === -1) {
          // First match — seed the target phrase
          seedPhraseIndex  = bestIndex;
          lastGoodAncestor = current;
          console.log("phraseContainer seed:", current.name, "→ phrase index", bestIndex, "score", bestScore);
        } else if (bestIndex === seedPhraseIndex) {
          // Same phrase still wins — true container might be higher, keep climbing
          lastGoodAncestor = current;
        } else {
          // Best match changed → this level spans multiple phrases → stop
          console.log("phraseContainer stop at:", current.name, "— match flipped from", seedPhraseIndex, "to", bestIndex);
          break;
        }
      } else if (seedPhraseIndex !== -1) {
        // Score dropped below 0.5 after seeding → stop
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

  // Fallback: old depth-2 logic (no phrase was ever matched while climbing)
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
 * Recursively collect names inside a container, filtered by vocabulary.
 * - Noise folders: recurse into them transparently (don't collect name).
 * - Translatable layers (SO/text): collect baseName if it has a vocab word.
 * - Other children: collect name if it has a vocab word, and recurse.
 * Returns deduplicated array of clean baseNames.
 */
function _collectVocabNames(group, vocabulary) {
  const seen  = new Set();
  const names = [];
  const children = group.layers ? [...group.layers].reverse() : [];

  for (const child of children) {
    const isTranslatable =
      child.kind === constants.LayerKind.SMARTOBJECT ||
      child.kind === constants.LayerKind.TEXT;

    if (isTranslatable) {
      const base = _stripCopySuffix(child.name);
      const key  = base.toUpperCase();
      if (!seen.has(key) && _nameHasVocabWord(base, vocabulary)) {
        seen.add(key);
        names.push(base);
      }
    } else if (_isNoiseName(child.name)) {
      // noise — recurse transparently
      for (const n of _collectVocabNames(child, vocabulary)) {
        if (!seen.has(n.toUpperCase())) {
          seen.add(n.toUpperCase());
          names.push(n);
        }
      }
    } else {
      // non-noise child — collect if vocab-relevant, always recurse
      const cleanName = _stripCopySuffix(child.name);
      const key = cleanName.toUpperCase();
      if (!seen.has(key) && _nameHasVocabWord(cleanName, vocabulary)) {
        seen.add(key);
        names.push(cleanName);
      }
      for (const n of _collectVocabNames(child, vocabulary)) {
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
 * 1. Find the phrase container (climb-and-stop heuristic, depth-2 fallback).
 * 2. Collect non-noise ancestor folder names between layer and container.
 * 3. Collect vocab-filtered names inside the container → single compound candidate.
 */
function _buildPhraseCandidates(layer, vocabulary, normalizedEN) {
  const candidates = [];

  const container = _findPhraseContainer(layer, vocabulary, normalizedEN);

  // ── Ancestors between layer and container (nearest first) ──
  let current = layer.parent;
  while (current && current !== container) {
    if (!_isNoiseName(current.name)) {
      candidates.push(current.name);
    }
    current = current.parent;
  }

  // ── Vocab-filtered names from inside the container ──
  if (container) {
    const vocabNames = _collectVocabNames(container, vocabulary);
    if (vocabNames.length > 0) {
      candidates.push(vocabNames.join("\n"));
    }
  }
  // console.log("Layer candidates:", candidates);
  return candidates;
}
