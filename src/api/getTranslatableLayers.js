// getTranslatableLayers.js
//
// Single source of truth: given a container folder layer, returns the exact set of child
// layers that will be translated — no more, no less.
//
// Rules applied (in order):
//   1. Recursive flatten — descends into nested groups.
//   2. Kind filter — only SMARTOBJECT and TEXT pass. Shapes, fills, adjustments,
//      masks and any other type are excluded so they cannot inflate layer counts,
//      corrupt offset calculations, or cause mismatches in matchLayersToLines.
//   3. Visibility filter — invisible layers are skipped.
//   4. SO deduplication — linked Smart Objects share one embedded PSB document.
//      Translating any instance updates all copies simultaneously, so only the first
//      encountered instance of each unique SmartObjectMoreID is kept.
//
// If name-based skip rules are ever added (e.g. layers named "DO NOT TRANSLATE"),
// add them here — this is the only place that decides what gets translated.

import { photoshop } from "../globals.js";
import { getAllVisibleLayers, getSOid } from "./photoshop.js";

const { constants } = photoshop;

// ---------------------------------------------------------------------------



















/**
 * Returns the translatable child layers inside `folderLayer` and a soIdMap for free.
 * Applies kind filtering, visibility filtering, SO deduplication, and phrase-line filtering.
 *
 * @param {Layer} folderLayer - The container group layer from Photoshop.
 * @param {string[]|string|null} enPhrase - Either an array of cleaned EN phrase lines
 *   (strip model — preferred, DNT lines already removed), a raw newline-delimited
 *   EN phrase string (legacy), or null to skip the phrase-line filter.
 *   When provided, only layers whose name matches a line in the phrase are kept.
 *   e.g. "(X2)\nCHANCE\nFOR BONUS\nACTIVE" → lines {"X2","CHANCE","FOR BONUS","ACTIVE"}
 *   Layers like "Base" that are not in the phrase are excluded.
 *   Pass null to skip this filter (returns all visible SO+TEXT layers).
 * @returns {Promise<{ layers: Layer[], soIdMap: Map<number, string> }>}
 *   layers  — ordered list of unique, visible, translatable layers (SO + TEXT)
 *   soIdMap — Map<layer.id → SmartObjectMoreID>, built during dedup, no extra batchPlay calls
 */
export async function getTranslatableLayers(folderLayer, enPhrase) {
  // Build a set of expected layer names from the matched EN phrase.
  // `enPhrase` may be:
  //   • an ARRAY of already-cleaned lines (STRIP MODEL — DNT lines removed,
  //     [] placeholders stripped by parseRawPhrase) → used directly. Because
  //     DNT lines like "X2" are absent, layers named after DNT tokens are
  //     excluded here and therefore left untouched by translation.
  //   • a raw STRING (legacy callers) → parsed here as before: strip () keeping
  //     content, strip [] entirely, split by newlines ONLY — "FOR BONUS" stays
  //     one line and matches the layer named "FOR BONUS" exactly.
  //   • null → filter skipped (all visible SO+TEXT layers returned).
  const enPhraseLines = Array.isArray(enPhrase)
    ? new Set(enPhrase.map(l => l.trim().toUpperCase()).filter(Boolean))
    : enPhrase
      ? new Set(
          enPhrase
            .replace(/\(([^)]*)\)/g, "$1")  // (X2) → X2
            .replace(/\[.*?\]/g, "")         // [Number] → ""
            .split("\n")
            .map(l => l.trim().toUpperCase())
            .filter(Boolean)
        )
      : null;

  const candidates = getAllVisibleLayers(folderLayer.layers).filter(
    layer =>
      layer.kind === constants.LayerKind.SMARTOBJECT ||
      layer.kind === constants.LayerKind.TEXT
  );

  // Single pass: deduplicate SOs and build soIdMap simultaneously.
  // TEXT layers have no SmartObjectMoreID so they always pass through.
  const processedSOIds = new Set();
  const soIdMap = new Map(); // layer.id → SmartObjectMoreID
  const layers = [];

  for (const layer of candidates) {
    if (layer.kind === constants.LayerKind.SMARTOBJECT) {
      const soId = await getSOid(layer);
      if (soId && processedSOIds.has(soId)) continue; // duplicate instance — skip
      if (soId) {
        processedSOIds.add(soId);
        soIdMap.set(layer.id, soId);
      }
    }
    // Phrase line filter — layer name must match an EN phrase line, either exactly
    // or as one word within a multi-word line.
    // e.g. "FOR BONUS" passes (exact). "FREE" passes (word within "FREE SPINS"). "Base" fails.
    // Skip this check when enPhrase was not provided.
    if (enPhraseLines) {
      const layerNameUpper = layer.name.trim().toUpperCase();
      const matchesPhrase = [...enPhraseLines].some(
        line => layerNameUpper === line ||
                layerNameUpper.startsWith(line) ||
                line.split(/\s+/).includes(layerNameUpper)
      );
      if (!matchesPhrase) continue;
    }
    layers.push(layer);
  }
  // console.log(`[getTranslatableLayers] folder "${folderLayer.name}" → expected SO names from phrase: [${enPhraseLines ? [...enPhraseLines].join(", ") : "none"}] → matched ${layers.length} SO(s):`, layers.map(l => l.name));
  return { layers, soIdMap };
}
