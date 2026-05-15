
import { uxp } from "../globals";
import { photoshop } from "../globals";
import * as ps from "./photoshop.js"; // Import all Photoshop API functions as ps
// import {app} from "../globals"; // Import app for showing alerts, etc.
// Access XLSX from global scope
import * as phraseGuesser from "./phraseGuesser";
import { getTranslatableLayers } from "./getTranslatableLayers.js";
const { core, app, constants } = photoshop;
const { executeAsModal } = photoshop.core;
const { batchPlay } = photoshop.action;

/**
 * Parse Excel file and extract language data
 * @param {File|ArrayBuffer} fileOrArrayBuffer - UXP file object or ArrayBuffer
 * @returns {Object} - { languageData, availableLanguages }
 */



let allVisibleLayers;
let smartObjectsForProcessing = [];
let processedIds = new Set(); // Tracks SmartObjectMoreIDs already translated in this run. Shared across translateAll and processMatchedFolder to prevent duplicate translations of instances.






function getAllEnglishwords(appState) {
  const allEnglishPhrases = appState.languageData && appState.languageData["EN"];
  const allEnglishWords = new Set(allEnglishPhrases.flatMap(p => p.split(/\s+/).filter(Boolean)).map(normalizeForMatch));
  return allEnglishWords;
}


//helper function to normalize layer names and phrases for matching, stripping annotations and normalizing whitespace
function normalizeForMatch(str) {
  return str
    .replace(/[()]/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[^\w\s]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(w => !/^\d+$/.test(w))
    .join(" ");
}




async function isDocumentValidForTranslation() {
  const doc = app.activeDocument;
  if (!doc) { console.log('No active document.'); return false; }

  try {
    const res = await batchPlay([
      { _obj: 'get', _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }] }
    ], {});
    const fmt = res[0]?.extension?.[0]?.toUpperCase();
    if (fmt !== "PSD" && fmt !== "PSB") {
      app.showAlert("Only PSD/PSB documents are supported.");
      return false;
    }
  } catch (e) {
    console.error('isDocumentValidForTranslation error:', e);
    return false;
  }

  return true;
}
















/**
 * Scans all visible layers in the active document and identifies unique Smart Objects
 * and matching EN folder names for translation.
 *
 * Fetches all layer info in a single batchPlay call upfront to avoid redundant
 * Photoshop API calls during the loop. Deduplicates Smart Object instances using
 * their shared SO ID so each unique Smart Object is processed only once.
 *
 * @param {Object} appState - Application state.
 * @param {string} appState.selectedLanguage - The target language code (e.g. "DE", "SK").
 * @param {Object} appState.languageData - Map of language code -> array of phrases.
 */







//New function that works on SO logic
export async function translateAll(appState) {
  const startTime = Date.now();

  processedIds.clear();

  const isValid = await executeAsModal(async () => isDocumentValidForTranslation(), { commandName: "Check document format" });
  if (!isValid) return;

  if (!appState.selectedLanguage) {
    app.showAlert("Please select a language first");
    return;
  }
  if (!appState.languageData?.["EN"]) {
    app.showAlert("No data loaded.");
    return;
  }
  const allEnglishWords = getAllEnglishwords(appState);
  // console.log("All English words for matching:", allEnglishWords);
  allVisibleLayers = ps.getAllVisibleLayers(app.activeDocument.layers);
  const hasSOs = allVisibleLayers.some(l => l.kind === constants.LayerKind.SMARTOBJECT);
  const hasGroups = allVisibleLayers.some(l => l.kind === constants.LayerKind.GROUP);
  if (!hasSOs || !hasGroups) {
    app.showAlert("This doesn't look like a master file for translation.");
    return;
  }
  const allSOs = allVisibleLayers.filter(layer => layer.kind === constants.LayerKind.SMARTOBJECT);
  smartObjectsForProcessing = await ps.purgeSOInstancesFromArray(allSOs);
  // console.log(`Found ${smartObjectsForProcessing.length} smart objects `, smartObjectsForProcessing.map(l => l.name));




  for (const layer of smartObjectsForProcessing) {

    const layerSOId = await ps.getSOid(layer);
    // DELETE LATER
    // console.log(`[translateAll] layer "${layer.name}" SmartObjectMoreID: ${layerSOId}`);

    // Guard: skip if this layer ID was already processed in this run, either as a folder match or as an instance of a matched SO. This prevents duplicate processing of the same layer if it appears in multiple folders or is a nested instance.
    if (processedIds.has(layerSOId)) {
      // DELETE LATER
      // console.log(`[translateAll] SKIPPING "${layer.name}" — ID ${layerSOId} already in processedIds`);
      continue;
    }
    // DELETE LATER
    // console.log(`[translateAll] NOT skipped — proceeding with "${layer.name}"`);
    // console.log(`Processing layer "${layer.name}"`, `smart objects for processing: ${smartObjectsForProcessing.length}`);
    const guessResult = phraseGuesser.guessThePhrase(layer, appState);
    // DELETE LATER
    // if (guessResult) { console.log(`Layer "${layer.name} has to be translated":`, guessResult); }
    
    const layerENGPhrase = guessResult?.enPhrase;
    const layerContainerFolder = guessResult?.container;
    const layerTranslatedPhrase = guessResult?.translatedPhrase;

    if (layerENGPhrase && layerTranslatedPhrase && layerContainerFolder) {

      await processMatchedFolder(layerContainerFolder, appState, layerENGPhrase, layerTranslatedPhrase);

    }
  }
}





function charOverlapRatio(a, b) {
  const pool = b.split("");
  let matched = 0;
  for (const c of a) {
    const i = pool.indexOf(c);
    if (i !== -1) { matched++; pool.splice(i, 1); }
  }
  return matched / Math.max(a.length, b.length);
}



function layerNameMatchesEnVocab(layerName, allEnglishWords, threshold = 0.8) {
  // Split the layer name into individual words after normalizing.
  // e.g. "FOR BONUS" → ["FOR", "BONUS"]
  // We check each word separately — joining them into "FORBONUS" before matching
  // would make both words unrecognizable against the single-word vocab entries.
  const words = normalizeForMatch(layerName).split(" ").filter(Boolean);
  if (!words.length) return false;

  // Every word in the layer name must match at least one EN vocab word.
  // This catches multi-word names like "FOR BONUS" (both words are in vocab)
  // while still rejecting names like "Base" (no vocab word scores >= threshold).
  return words.every(w => {
    for (const vocabWord of allEnglishWords) {
      if (charOverlapRatio(w, vocabWord) >= threshold) return true;
    }
    return false;
  });
}


export async function processMatchedFolder(folderLayer, appState, matchedPhrase, translatedPhrase) {

  // STEP 1: Parse the EN phrase into individual words (one per array entry).
  // e.g. "BUY\nBONUS" → ["BUY", "BONUS"]
  // These are used to match against child layer names inside the folder.
  const enLines = parseRawPhrase(matchedPhrase, "linesArray");
  console.log("[processMatchedFolder] EN lines:", enLines);
  const transPhrase = translatedPhrase;

  // STEP 2: Guard — if there's no translation for this phrase, nothing to do.
  if (!transPhrase) return;

  // STEP 3: Parse the translated phrase into individual words the same way.
  // e.g. "BONUS KAUFEN" → ["BONUS", "KAUFEN"]
  // The count of transLines may differ from enLines — e.g. EN has 3 words, DE merges two into one.
  // matchLayersToLines handles this with tail-anchoring logic.
  const transLines = parseRawPhrase(transPhrase, "linesArray");
  console.log("[processMatchedFolder] translated lines:", transLines);

  // STEP 4: Get translatable child layers and soIdMap from single-source-of-truth API.
  // Handles recursive flatten, kind filter (SO + TEXT only), visibility filter, and SO dedup.
  // soIdMap (layer.id → SmartObjectMoreID) is built for free during the dedup pass.
  const { layers: translatableLayers, soIdMap } = await getTranslatableLayers(folderLayer, matchedPhrase);
  const childLayers = translatableLayers.map((layer, i) => ({
    id:         layer.id,
    name:       layer.name,
    stackIndex: i,
    layer,
  }));

  // STEP 5: Build the do-not-translate set from the raw EN phrase.
  // Lines wrapped entirely in () — e.g. "(X2)" — mark layers that must be left
  // untouched in every language. The set is derived on-demand from the matched
  // EN phrase so it's always in sync with the Excel data and requires no
  // hardcoding. Passed into matchLayersToLines so it can skip those layers while
  // still advancing the trans-slot counter to preserve positional alignment.
  const doNotTranslate = buildDoNotTranslateSet(matchedPhrase);

  // STEP 6: Match each child layer to a translated line.
  // Uses a confidence ladder: exact name match → fuzzy name match → stack index fallback.
  // Returns a Map<layerId, { text, matchType } | null>
  // null means the layer is untouched (do-not-translate, duplicate EN index, or overflow).
  // If overall confidence is too low (too many layers fell to stack index), the whole folder is skipped.
  const { skipped, reason, confidence, result } = matchLayersToLines(
    childLayers,
    enLines,
    transLines,
    doNotTranslate
  );

  // DELETE LATER
  // console.log(`[processMatchedFolder] STEP 7: confidence ${confidence.toFixed(2)} for "${folderLayer.name}"`);
  if (skipped) {
    // DELETE LATER
    // console.warn(`[processMatchedFolder] STEP 7: SKIPPED "${folderLayer.name}" — ${reason} (confidence: ${confidence.toFixed(2)})`);
    return;
  }

  // STEP 6: Apply translations.
  // Loop over the match result and translate each assigned layer.
  for (const [layerId, assignment] of result) {
    // null assignment = middle-gap layer or word-in-line duplicate, intentionally left untouched
    if (assignment === null) {
      const child = childLayers.find(child => child.id === layerId);
      if (child) console.log(`[skipped SO] "${child.layer.name}" → untouched (no translation assigned)`);
      continue;
    }

    const { text, matchType } = assignment;
    const child = childLayers.find(child => child.id === layerId);
    if (!child) continue;

    if (child.layer.kind === constants.LayerKind.SMARTOBJECT) {
      const smartObjectID = soIdMap.get(child.id);

      // DEDUPLICATION: If this SO's internal document was already translated (by an earlier
      // instance of the same SO encountered in a previous folder or earlier in this folder),
      // skip it — translating any one instance updates all of them simultaneously.
      if (smartObjectID && processedIds.has(smartObjectID)) {
        console.log(`[skipped SO] "${child.layer.name}" → already translated (same SO in earlier folder)`);
        continue;
      }

      await ps.translateSmartObject(child.layer, text);
      console.log(`[translated SO] "${child.layer.name}" → "${text}"`);
      processedIds.add(await ps.getSOid(child.layer)); // Mark this SO as processed to prevent duplicate translations of its instances


      // // DIAGNOSTIC: check if SmartObjectMoreID changed after translation
      // const smartObjectMoreIDAfter = await ps.getSOid(child.layer);
      // if (smartObjectMoreIDAfter !== smartObjectID) {
      //   console.warn(`[processMatchedFolder] ID CHANGED after translation! "${child.layer.name}": before=${smartObjectID} after=${smartObjectMoreIDAfter}`);
      // } else {
      //   console.log(`[processMatchedFolder] ID stable after translation: "${child.layer.name}" ID=${smartObjectID}`);
      // }

      // Mark this SO document as done so all future instances are skipped
      if (smartObjectID) processedIds.add(smartObjectID);
      // console.log(`[processMatchedFolder] processedIds after adding:`, [...processedIds]);

    } else if (child.layer.kind === constants.LayerKind.TEXT) {
      console.log(`[translated Text] "${child.layer.name}" → "${text}"`);
    }
  }
}




function isTextfieldValueValid(value) {
  return value?.trim().length > 0;
}





export async function translateSelected(appState) {
  // console.log("translateSelected called", appState);
  const selLayers = app.activeDocument.activeLayers;
  // console.log("selLayers:", selLayers.length, selLayers[0]?.kind);

  
  if (selLayers.length !== 1) {
    app.showAlert(selLayers.length === 0 ? "Please select a layer to translate." : "Please select only one layer to translate.");
    return;
  }

  const layer = selLayers[0];
  const isValidKind = layer.kind === constants.LayerKind.SMARTOBJECT || layer.kind === constants.LayerKind.TEXT;

  if (!isValidKind) {
    app.showAlert("Please select a smart object or text layer to translate.");
    return;
  }


  if (!isTextfieldValueValid(appState.suggestionTextfieldValue)) {
    app.showAlert("Please enter a translation first.");
    return;
  }

  // const confirmed = confirm(`Translate layer "${layer.name}"?`);
  // if (!confirmed) return;

  const translation = appState.suggestionTextfieldValue.trim();

  if (layer.kind === constants.LayerKind.TEXT) {
    await ps.translateTextLayer(layer, translation);
  } else if (layer.kind === constants.LayerKind.SMARTOBJECT) {
    await ps.translateSmartObject(layer, translation);
  }

  // console.log(`Translated "${layer.name}" → "${translation}"`);
  // const confirmed = confirm(`Translate layer "${layer.name}"?`);
  // console.log("confirm result:", confirmed);
  // console.log("Translating selected layer: ", appState.suggestionTextfieldValue);

  // if (!confirmed) return;
}







export async function generateSuggestions(layer, appState) {
  let parentFolder = layer.parent;
  if (!parentFolder) {
    app.showAlert("Cant find phrase reference for this layer.");
    return null;
  }
  // const suggestion = extractMatchingPhrase(parentFolder, appState);
  const suggestion = phraseGuesser.guessThePhrase(layer, appState)?.translatedPhrase;
  if (suggestion) { 
    console.log("Suggestion found:", suggestion);
    return parsePhraseForSuggestions(suggestion);
  }else {
    app.showAlert("Parent folder does not match any EN phrase.");
      return null;}
}


////////////// Helper functions //////////////////////

/**
 * Reads a raw EN phrase from the Excel table and returns the set of layer names
 * that must NOT be translated — identified by lines where the entire content is
 * wrapped in parentheses: e.g. "(X2)" or "(SUPER)".
 *
 * This is the authoritative source for skip decisions. It reads directly from
 * the Excel data, so no hardcoding is needed and it works correctly for any phrase
 * in any current or future PSD without code changes.
 *
 * Why () wrapping = do-not-translate:
 *   The convention in the Excel file is that a line like "(X2)" means the layer
 *   named X2 should appear unchanged in all languages — it's a symbol, number,
 *   or brand element that is never localized. The translator marks it this way
 *   deliberately so the plugin knows to skip it.
 *
 * Why the slot must still be consumed:
 *   Even though the layer is skipped, its position in the EN line sequence is real.
 *   If X2 is at enIndex=0 and CHANCE is at enIndex=1, CHANCE must still receive
 *   transLines[1] — not transLines[0]. Consuming the slot preserves the alignment
 *   between EN line positions and translated line positions.
 *
 * @param {string} rawEnPhrase - Raw EN phrase string as stored in languageData["EN"][i]
 *   e.g. "(X2)\nCHANCE\nFOR BONUS\nACTIVE"
 * @returns {Set<string>} Uppercase layer names to leave untouched during translation
 *   e.g. Set{"X2"}
 */
function buildDoNotTranslateSet(rawEnPhrase) {
  const set = new Set();
  for (const line of rawEnPhrase.split("\n")) {
    // Match lines where the ENTIRE content (after trimming) is wrapped in ().
    // e.g. "(X2)" → captures "X2". "CHANCE" → no match. "(do not translate!)" → captures "do not translate!".
    // The + quantifier ensures empty parens "()" are ignored.
    const match = line.trim().match(/^\(([^)]+)\)$/);
    if (match) set.add(match[1].trim().toUpperCase());
  }
  return set;
}





/**
 * Matches child layers (Smart Objects or Text layers) to translated lines
 * using name-first, tail-anchored logic.
 *
 * @param {Array} childLayers  - [{ id, name, stackIndex }]
 * @param {Array} enLines      - ["TOTAL", "CREDITS", "WON"]
 * @param {Array} transLines   - ["GESAMTGUTHABEN", "GEWONNEN"]
 * @returns {Object}           - { skipped, reason, confidence, result }
 *                               result is Map<layerId, { text, matchType, enIndex } | null>
 *                               null means untouched
 */
/**
 * @param {Set<string>} doNotTranslate - Uppercase layer names to skip without translating.
 *   Built from () markers in the raw EN phrase by buildDoNotTranslateSet().
 *   Skipped layers still advance the trans-slot counter so subsequent layers
 *   receive the correct translation line and positional alignment is preserved.
 *   Defaults to empty set (no skips) when called without this argument.
 */
function matchLayersToLines(childLayers, enLines, transLines, doNotTranslate = new Set()) {
  const result = new Map();

  // Build exact EN line → index lookup (uppercase)
  // e.g. "CONGRATULATIONS" → 0, "YOU WIN" → 1, "FREE SPINS" → 2
  const enIndexByName = new Map(
    enLines.map((line, i) => [line.trim().toUpperCase(), i])
  );

  // Resolve each layer to an EN line index using confidence ladder:
  //   1. Exact name match   → layer name equals an EN line exactly
  //                           e.g. "YOU WIN" matches line "YOU WIN" at index 1
  //   2. Fuzzy name match   → layer name starts with an EN line
  //                           e.g. "CREDITS copy 2" starts with "CREDITS"
  //   3. Word-in-line match → layer name is one word within a multi-word EN line
  //                           e.g. "FREE" is a word in "FREE SPINS" at index 2
  //                           When the PSD splits one phrase line into multiple SOs,
  //                           only the first matched layer gets translated — the rest are null.
  //   4. Stack index        → last resort, risky if layers were reordered
  const resolved = childLayers.map((layer) => {
    const normalizedName = layer.name.trim().toUpperCase();

    // 1. Exact match
    if (enIndexByName.has(normalizedName)) {
      return { layer, enIndex: enIndexByName.get(normalizedName), matchType: "name" };
    }

    // 2. Fuzzy — layer name starts with an EN line ("CREDITS copy 2" → "CREDITS")
    const fuzzyIndex = enLines.findIndex((line) =>
      normalizedName.startsWith(line.trim().toUpperCase())
    );
    if (fuzzyIndex !== -1) {
      return { layer, enIndex: fuzzyIndex, matchType: "fuzzy" };
    }

    // 3. Word-in-line — layer name is a word within a multi-word EN line
    // e.g. "FREE" is a word within "FREE SPINS" → enIndex 2
    const wordInLineIndex = enLines.findIndex((line) =>
      line.split(/\s+/).includes(normalizedName)
    );
    if (wordInLineIndex !== -1) {
      return { layer, enIndex: wordInLineIndex, matchType: "wordInLine" };
    }

    // 4. Stack index — last resort
    return { layer, enIndex: layer.stackIndex, matchType: "stackIndex" };
  });

  // Sort by EN index so assignment is always top-down
  // regardless of how the artist ordered the layers in the panel
  resolved.sort((a, b) => a.enIndex - b.enIndex);

  // Confidence guard — skip folder if too many layers are unrecognizable
  // confidence 1.0 = all matched by name/fuzzy/wordInLine
  // confidence 0.0 = all fell through to stackIndex → skip
  const stackIndexCount = resolved.filter((r) => r.matchType === "stackIndex").length;
  const confidence = 1 - stackIndexCount / resolved.length;

  if (confidence < 0.5) {
    return {
      skipped: true,
      reason: confidence === 0 ? "no_name_matches" : "low_confidence",
      confidence,
      result: null,
    };
  }

  // Track which EN line indices have already been assigned a translation.
  // When multiple PSD layers match the same EN line ("FREE" and "SPINS" both → "FREE SPINS"),
  // only the first gets the translation — the rest are left untouched (null).
  const assignedEnIndices = new Set();

  resolved.forEach(({ layer, matchType, enIndex }, resolvedIndex) => {

    // Skip layers marked as do-not-translate (entire EN line was wrapped in parentheses).
    // The layer is left untouched (null) but its enIndex is still added to assignedEnIndices
    // so the trans-slot counter advances normally — subsequent layers receive the correct
    // translation line without positional shift.
    // e.g. phrase "(X2)\nCHANCE\nFOR BONUS": X2 skipped at slot 0 → CHANCE gets transLines[1].
    if (doNotTranslate.has(layer.name.trim().toUpperCase())) {
      result.set(layer.id, null);
      assignedEnIndices.add(enIndex);
      return;
    }

    // Duplicate — this EN line was already assigned by a previous layer → leave untouched
    if (assignedEnIndices.has(enIndex)) {
      result.set(layer.id, null);
      return;
    }

    // 0-based position of this EN line among the unique ones assigned so far
    const uniquePosition = assignedEnIndices.size;

    // Sequential — no forced gaps.
    // Last assigned layer absorbs remaining trans lines (translator expanded).
    // Layers beyond the last trans slot get null (translator contracted).
    if (uniquePosition >= transLines.length) {
      result.set(layer.id, null);
    } else {
      const isLastLayer = resolvedIndex === resolved.length - 1;
      const isLast = uniquePosition === transLines.length - 1 || isLastLayer;
      const text = isLast ? transLines.slice(uniquePosition).join(" ") : transLines[uniquePosition];
      result.set(layer.id, { text, matchType, enIndex });
    }

    assignedEnIndices.add(enIndex);
  });

  return { skipped: false, confidence, result };
}

















/**
 * Parses a raw phrase string from the Excel table into a usable representation.
 * In all modes: strips () annotation brackets (keeps content), strips [] placeholders entirely,
 * trims whitespace per line, collapses multi-spaces, and drops empty lines.
 *
 * Modes:
 *
 *   "raw"        — Returns the cleaned phrase with \n line breaks preserved.
 *                  Use when you need the full phrase structure intact (e.g. to pass into
 *                  getTranslatableLayers which splits by \n to build expected layer names).
 *                  Input:  "(X2)\nFOR BONUS\n[Number]"
 *                  Output: "X2\nFOR BONUS"
 *
 *   "oneLiner"   — Collapses all lines into one space-separated string.
 *                  Use for folder-name matching (guessThePhrase / isNameENPhrase) where
 *                  the full phrase needs to be compared as a single string.
 *                  Input:  "FREE\nSPINS\nYOU WIN"
 *                  Output: "FREE SPINS YOU WIN"
 *
 *   "linesArray" — Returns an array of lines, one entry per \n-delimited line.
 *                  Each line may contain spaces — "FOR BONUS" stays as one entry.
 *                  Use in processMatchedFolder to build enLines / transLines for
 *                  matchLayersToLines, where each line maps to exactly one SO layer.
 *                  Input:  "CONGRATULATIONS\nYOU WIN\nFREE SPINS"
 *                  Output: ["CONGRATULATIONS", "YOU WIN", "FREE SPINS"]
 *
 *   "strict"     — Same as "oneLiner" but entire lines containing [...] are dropped first.
 *                  Use when building a translated phrase string and placeholder lines like
 *                  "[Number]" or "[Multiplier]" must not appear in the output.
 *                  Input:  "GEWINNEN\nSIE\n[Number] FREISPIELE"
 *                  Output: "GEWINNEN SIE"
 */
export function parseRawPhrase(phrase, mode = "oneLiner") {

  // "strict" drops entire lines that are [...] placeholders before any other processing.
  // e.g. "GEWINNEN\n[Number] FREISPIELE" → "GEWINNEN"
  let input = phrase;
  if (mode === "strict") {
    input = phrase.split("\n").filter(l => !/\[.*?\]/.test(l)).join("\n");
  }

  // Strip () brackets but keep their content: (SUPER) → SUPER
  // Strip [] placeholders entirely: [Number] → ""
  const withParens = input.replace(/\(([^)]*)\)/g, "$1");
  const withSquare = withParens.replace(/\[.*?\]/g, "");
  const cleaned = withSquare.replace(/\s+\n/g, "\n").trim();

  // Trim each line, collapse internal spaces, drop empty lines.
  // Result is an array of clean lines, e.g. ["FOR BONUS", "ACTIVE"]
  const lines = cleaned.split("\n").map(l => l.trim().replace(/\s+/g, " ")).filter(Boolean);

  if (mode === "raw")        return lines.join("\n");
  if (mode === "oneLiner")   return lines.join(" ").replace(/\s+/g, " ").trim();
  if (mode === "linesArray") return lines; // one entry per \n-line — "FOR BONUS" stays intact as one entry
  if (mode === "strict")     return lines.join(" ").replace(/\s+/g, " ").trim();

  throw new Error(`parseRawPhrase: unknown mode "${mode}"`);
}


// Parses a newline-delimited phrase into an array of translation candidates.
// Returns individual lines, individual words, adjacent line pairs, and the full phrase joined by spaces.
// Used to maximize matching coverage against the EN translation table.

export function parsePhraseForSuggestions(phrase) {
    // Split into lines, trim, strip trailing punctuation
  const lines = phrase
    .split("\n")
    .map(l => l.trim().replace(/[.,!?]+$/, ""))
    .filter(Boolean);

  const results = new Set();

  // 4. Full phrase — all lines joined with space
  results.add(lines.join(" "));


  // 1. Individual lines as-is
  lines.forEach(line => results.add(line));

  // 2. Individual words from each line
  lines.forEach(line => {
    line.split(/\s+/).forEach(word => results.add(word));
  });

  // 3. Sliding window — adjacent line pairs joined with space
  for (let i = 0; i < lines.length - 1; i++) {
    results.add(lines[i] + " " + lines[i + 1]);
  }



  return Array.from(results);

}




// Checks if a layer name matches any EN phrase in the translation table
export function isNameENPhrase(layerName, appState) {
  const engKey = appState.languageData && appState.languageData["EN"];
  if (!engKey || !Array.isArray(engKey)) return false;

  for (const entry of engKey) {
    // CHANGED: was manually splitting lines and dropping entire lines containing ()[]{}  
    // which lost meaningful words like "SUPER" and "OF" from annotated lines.
    // Now uses parseRawPhrase("oneLiner") which strips annotation CONTENT from within lines
    // but preserves surrounding words — consistent with how extractMatchingPhrase works.
    const normalized = parseRawPhrase(entry, "oneLiner");

    if (normalized.toUpperCase() === layerName.toUpperCase()) {
      return true;
    }
  }
  return false;
}







//Temporary function to generate suggestions based on selected language - replace with actual logic
export function extractMatchingPhrase(layer, appState) {
  const enEntries = appState.languageData && appState.languageData["EN"];
  const selectedLang = appState.selectedLanguage;
  const langEntries = appState.languageData && appState.languageData[selectedLang];
  if (!enEntries || !Array.isArray(enEntries) || !langEntries || !Array.isArray(langEntries)) return null;

  for (let i = 0; i < enEntries.length; i++) {
    // CHANGED: was "strict" which dropped entire lines containing [...], losing words like "OF"
    // Now uses "oneLiner" — consistent with isNameENPhrase — so both functions normalize identically
    const normalizedEN = parseRawPhrase(enEntries[i], "oneLiner");
    // console.log(`Comparing: "${layer.name.toUpperCase().trim()}" vs "${normalizedEN}"`);

    if (layer.name.toUpperCase() === normalizedEN.toUpperCase()) {
      const phrase = parseRawPhrase(langEntries[i], "strict"); // Get the corresponding phrase in the selected language
      // console.log(`Layer name: ${layer.name}, Phrase: ${enEntries[i]}, Suggestion: ${phrase}`);
      return phrase !== undefined ? phrase : null;
    }
  }
  return null;
}





