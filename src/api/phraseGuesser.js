import { photoshop } from "../globals";
import { parseRawPhrase } from "./parsingLogic";
const { constants } = photoshop;

/**
 * Attempts to guess which XLSX phrase a layer belongs to when it doesn't live
 * inside a correctly-named folder (Structure 2 / messy hierarchy).
 *
 * Strategy:
 *   1. Build a vocabulary set of every unique word across all EN phrases.
 *   2. Walk UP from the layer to find the "phrase container" — an ancestor
 *      whose grandparent has no parent (depth 2 from document root).
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
export function guessThePhrase(layer, appState) {
  const enEntries   = appState.languageData?.["EN"];
  const langEntries = appState.languageData?.[appState.selectedLanguage];
  if (!enEntries || !langEntries) return null;

  // Build vocabulary: every unique word that appears in any EN phrase
  const vocabulary = _buildVocabulary(enEntries);

  const candidates = _buildPhraseCandidates(layer, vocabulary);
  if (candidates.length === 0) return null;

  const normalizedEN = enEntries.map(e => _normalizeForMatch(e));

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
    .replace(/\(.*?\)/g, "")   // strip (do not translate!) etc.
    .replace(/\[.*?\]/g, "")   // strip [NUMBER] placeholders
    .toUpperCase()
    .replace(/\s+/g, " ")
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
 * Find the "phrase container" — the ancestor at depth 2 from document root
 * (i.e. its grandparent has no parent).  Returns null if none found.
 */
function _findPhraseContainer(layer) {
  let current = layer.parent;
  while (current) {
    if (current.parent && !current.parent.parent) return current;
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
 * 1. Find the phrase container (depth-2 ancestor from doc root).
 * 2. Collect non-noise ancestor folder names between layer and container.
 * 3. Collect vocab-filtered names inside the container → single compound candidate.
 */
function _buildPhraseCandidates(layer, vocabulary) {
  const candidates = [];

  const container = _findPhraseContainer(layer);

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

  return candidates;
}
