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
 * Applies kind filtering, visibility filtering, and SO deduplication in one pass.
 *
 * @param {Layer} folderLayer - The container group layer from Photoshop.
 * @returns {Promise<{ layers: Layer[], soIdMap: Map<number, string> }>}
 *   layers  — ordered list of unique, visible, translatable layers (SO + TEXT)
 *   soIdMap — Map<layer.id → SmartObjectMoreID>, built during dedup, no extra batchPlay calls
 */
export async function getTranslatableLayers(folderLayer) {
  const candidates = getAllLayers(folderLayer.layers).filter(
    layer =>
      layer.visible &&
      (layer.kind === constants.LayerKind.SMARTOBJECT ||
        layer.kind === constants.LayerKind.TEXT)
  );

  // Single pass: deduplicate SOs and build soIdMap simultaneously.
  // TEXT layers have no SmartObjectMoreID so they always pass through.
  const seenSOIds = new Set();
  const soIdMap = new Map(); // layer.id → SmartObjectMoreID
  const layers = [];

  for (const layer of candidates) {
    if (layer.kind === constants.LayerKind.SMARTOBJECT) {
      const soId = await getSOid(layer);
      if (soId && seenSOIds.has(soId)) continue; // duplicate instance — skip
      if (soId) {
        seenSOIds.add(soId);
        soIdMap.set(layer.id, soId);
      }
    }
    layers.push(layer);
  }

  return { layers, soIdMap };
}
