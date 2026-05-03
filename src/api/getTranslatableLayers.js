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
import { getAllLayers, getSOid } from "./photoshop.js";

const { constants } = photoshop;

// ---------------------------------------------------------------------------



















/**
 * Returns the translatable child layers inside `folderLayer` and a soIdMap for free.
 * Applies kind filtering, visibility filtering, SO deduplication, and phrase-token filtering.
 *
 * @param {Layer} folderLayer - The container group layer from Photoshop.
 * @param {string|null} enPhrase - The raw EN phrase string (newline-delimited) for this folder.
 *   When provided, only layers whose name matches a token in the phrase are kept.
 *   e.g. "(X2)\nCHANCE\nFOR BONUS\nACTIVE" → tokens {"X2","CHANCE","FOR BONUS","ACTIVE"}
 *   Layers like "Base" that are not in the phrase are excluded.
 *   Pass null to skip this filter (returns all visible SO+TEXT layers).
 * @returns {Promise<{ layers: Layer[], soIdMap: Map<number, string> }>}
 *   layers  — ordered list of unique, visible, translatable layers (SO + TEXT)
 *   soIdMap — Map<layer.id → SmartObjectMoreID>, built during dedup, no extra batchPlay calls
 */
export async function getTranslatableLayers(folderLayer, enPhrase) {
  // Build a set of expected layer-name tokens from the matched EN phrase.
  // Split by newlines ONLY — each \n-delimited line in the phrase maps to exactly
  // one layer in the folder, so "FOR BONUS" stays one token and matches the layer
  // named "FOR BONUS" exactly. Global word-splitting would tear it into "FOR"+"BONUS"
  // and break the lookup. Strip () and [] annotations, normalize to uppercase.
  const enPhraseTokens = enPhrase
    ? new Set(
        enPhrase
          .replace(/\(([^)]*)\)/g, "$1")  // (X2) → X2
          .replace(/\[.*?\]/g, "")         // [Number] → ""
          .split("\n")
          .map(l => l.trim().toUpperCase())
          .filter(Boolean)
      )
    : null;

  const candidates = getAllLayers(folderLayer.layers).filter(
    layer =>
      layer.visible &&
      (layer.kind === constants.LayerKind.SMARTOBJECT ||
        layer.kind === constants.LayerKind.TEXT)
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
    // Phrase token filter — layer name must be one of the tokens from the EN phrase.
    // e.g. "FOR BONUS" passes because it is a token; "Base" fails because it is not.
    // Skip this check when enPhrase was not provided.
    if (enPhraseTokens && !enPhraseTokens.has(layer.name.trim().toUpperCase())) continue;
    layers.push(layer);
  }
  console.log(`getTranslatableLayers: ${layers.length} layers passed filters (tokens: ${enPhraseTokens ? [...enPhraseTokens].join(", ") : "none"})`, layers.map(l => l.name));
  return { layers, soIdMap };
}
