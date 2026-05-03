// import { asModal as executeAsModal } from "./utils/photoshop-utils.js";
// import { photoshop } from "../globals";
// Import XLSX - it's a UMD library that may attach to global scope
import "../lib/xlsx.full.min.js";
import { uxp } from "../globals";
import { photoshop } from "../globals";
import * as ps from "./photoshop.js"; // Import all Photoshop API functions as ps
// import {app} from "../globals"; // Import app for showing alerts, etc.
// Access XLSX from global scope
import * as phraseGuesser from "./phraseGuesser";
import { getTranslatableLayers } from "./getTranslatableLayers.js";
const XLSX = window.XLSX;
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











export async function parseExcelFile(fileOrArrayBuffer) {
  let arrayBuffer;
  
  // Check if it's a UXP file object or already an ArrayBuffer
  if (fileOrArrayBuffer.read && typeof fileOrArrayBuffer.read === 'function') {
    // It's a UXP file object - read it
    arrayBuffer = await fileOrArrayBuffer.read({ format: uxp.storage.formats.binary });
  } else {
    // It's already an ArrayBuffer
    arrayBuffer = fileOrArrayBuffer;
  }
  
  // Parse XLSX file
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  
  // Extract language data from workbook
  return extractLanguageData(workbook);
}

/**
 * Extract language data from workbook
 * @param {Object} workbook - XLSX workbook object
 * @returns {Object} - { languageData, availableLanguages }
 */


function extractLanguageData(workbook) {
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  const languageData = {};
  const availableLanguages = [];

  if (jsonData.length > 0) {
    const languages = jsonData[0];
    const ignoredColumns = ["screen preview"];

    languages.forEach(lang => {
      if (lang && lang.trim() && !ignoredColumns.includes(lang.trim().toLowerCase())) {
        availableLanguages.push(lang);
        languageData[lang] = [];
      }
    });

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      availableLanguages.forEach((language) => {
        const columnIndex = languages.indexOf(language);
        const cell = row[columnIndex];
        languageData[language].push((cell && typeof cell === 'string') ? cell : "");
      });
    }
  }

  return { languageData, availableLanguages };
}




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








// export async function translateAll(appState) {
//   const startTime = Date.now();
//   if (!appState.selectedLanguage) {
//     app.showAlert("Please select a language first");
//     return;
//   }
//   if (!appState.languageData?.["EN"]) {
//     app.showAlert("No data loaded.");
//     return;
//   }

//   const allVisibleLayers = ps.getAllVisibleLayers(app.activeDocument.layers);

//   //creates a map of layer.id → index in allVisibleLayers for O(1)/ lookup during the loop, avoiding repeated .findIndex calls
//   const layerIndexMap = new Map(allVisibleLayers.map((layer, i) => [layer.id, i]));

//   // Single bulk batchPlay call to fetch the full Photoshop descriptor for every visible layer at once.
//   // Each entry in allInfos corresponds to the layer at the same index in allVisibleLayers.
//   // The key data used from each descriptor is smartObjectMore.ID — the SmartObjectMoreID
//   // shared across all instances of the same linked Smart Object, used for deduplication.
//   const allInfos = await batchPlay(
//     allVisibleLayers.map(layer => ({ _obj: "get", _target: [{ _ref: "layer", _id: layer.id }] })),
//     { synchronousExecution: true }
//   );

//   // Tracks SmartObjectMoreIDs, not layer instance IDs.
//   // Shared with processMatchedFolder so both branches see the same picture
//   // regardless of which one encounters a given SO first.
//   const translatedSOIds = new Set();

//   for (const layer of allVisibleLayers) {
//     if (!layer.visible) continue;

//     // Guard: skip if this SO's internal document was already translated.
//     // Uses smartObjectMore.ID so all instances of the same SO are blocked by one entry.
//     //1.Give me this layer's position in the array 2. Give me the full descriptor for this layer from allInfos using that position 3. Dig out the internal smart object document ID from the descriptor
//     const layerSOId = allInfos[layerIndexMap.get(layer.id)]?.smartObjectMore?.ID;
//     //If this SO was already translated by another instance, skip it
//     if (layerSOId && translatedSOIds.has(layerSOId)) continue;

//     if (ps.isLayerAGroup(layer)) {
//       if (isNameENPhrase(layer.name, appState)) {
//         console.log(`Layer: ${layer.name} is a matching folder`);
//         // Pass translatedSOIds so processMatchedFolder can check and populate it
//         await processMatchedFolder(layer, appState, translatedSOIds, allInfos, layerIndexMap);
//       }
//       continue;
//     }

//     if (layer.kind !== constants.LayerKind.SMARTOBJECT) continue;

//     const layerInstances = ps.getSmartObjectInstances(layer, allVisibleLayers, allInfos, layerIndexMap);
//     if (!layerInstances) continue;

//     // Mark the SmartObjectMoreID so all instances are blocked from here on
//     if (layerSOId) translatedSOIds.add(layerSOId);
//   }
//   console.log(`translateAll took ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
// }





//New function that works on SO logic
export async function translateAll(appState) {
  const startTime = Date.now();

  // Clear the set of processed layer IDs at the start of each full translation run
  processedIds.clear();

  if (!appState.selectedLanguage) {
    app.showAlert("Please select a language first");
    return;
  }
  if (!appState.languageData?.["EN"]) {
    app.showAlert("No data loaded.");
    return;
  }
  const allEnglishWords = getAllEnglishwords(appState);
  console.log("All English words for matching:", allEnglishWords);
  allVisibleLayers = ps.getAllVisibleLayers(app.activeDocument.layers);
  const allSOs = allVisibleLayers.filter(layer => layer.kind === constants.LayerKind.SMARTOBJECT);
  smartObjectsForProcessing = await ps.purgeSOInstancesFromArray(allSOs);
  console.log(`Found ${smartObjectsForProcessing.length} smart objects `, smartObjectsForProcessing.map(l => l.name));




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

      // const hasInstances = await ps.getSmartObjectInstances(layer, smartObjectsForProcessing);
      
      // if (hasInstances !== null) {
      //   for (const instance of hasInstances) {
      //     const instanceSOId = await ps.getSOid(instance);
      //     processedIds.add(instanceSOId);
      //     console.log(`Processing instance "${instance.name}" of "${layer.name} with ID: ${instanceSOId}"`);
      //   }
      // }
    }
      // await processMatchedFolder(layerContainerFolder, appState, translatedSOIds, allInfos, layerIndexMap, layerENGPhrase, layerTranslatedPhrase);
      // translatedSOIds.add(layerSOId);
      // } else {
      //   console.warn(`[translateAll] Skipped "${layer.name}":`, { layerENGPhrase, layerTranslatedPhrase, layerContainerFolder });
      // }

    // Guard: skip if this SO's internal document was already translated.
    // Uses smartObjectMore.ID so all instances of the same SO are blocked by one entry.
    // 1.Give me this layer's position in the array 2. Give me the full descriptor for this layer from allInfos using that position 3. Dig out the internal smart object document ID from the descriptor
    // const layerSOId = allInfos[layerIndexMap.get(layer.id)]?.smartObjectMore?.ID;
    
    //If this layer isnt already translated and its name matches the EN vocab, mark it for translation and add its SO ID to the set to block all its instances
    // if (layerSOId && !translatedSOIds.has(layerSOId) && layerNameMatchesEnVocab(layer.name, allEnglishWords, 0.8)){


    // } else if (!layerSOId && layerNameMatchesEnVocab(layer.name, allEnglishWords, 0.8)) {
    //   console.warn(`[translateAll] No SO ID for layer "${layer.name}" — skipping`);
    // } 


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
  const nameStr = normalizeForMatch(layerName).replace(/\s/g, "");
  if (!nameStr) return false;
  for (const word of allEnglishWords) {  // allEnglishWords is the Set of individual words
    if (charOverlapRatio(nameStr, word) >= threshold) return true;
  }
  return false;
}


export async function processMatchedFolder(folderLayer, appState, matchedPhrase, translatedPhrase) {

  // STEP 1: Parse the EN phrase into individual words (one per array entry).
  // e.g. "BUY\nBONUS" → ["BUY", "BONUS"]
  // These are used to match against child layer names inside the folder.
  const enLines = parseRawPhrase(matchedPhrase, "linesArray");
  console.log(`${enLines} `);
  const transPhrase = translatedPhrase;

  // STEP 2: Guard — if there's no translation for this phrase, nothing to do.
  if (!transPhrase) return;

  // STEP 3: Parse the translated phrase into individual words the same way.
  // e.g. "BONUS KAUFEN" → ["BONUS", "KAUFEN"]
  // The count of transLines may differ from enLines — e.g. EN has 3 words, DE merges two into one.
  // matchLayersToLines handles this with tail-anchoring logic.
  const transLines = parseRawPhrase(transPhrase, "linesArray");
  console.log(`${transLines} `);

  // STEP 4-6: Get translatable child layers and soIdMap from single-source-of-truth API.
  // Handles recursive flatten, kind filter (SO + TEXT only), visibility filter, and SO dedup.
  // soIdMap (layer.id → SmartObjectMoreID) is built for free during the dedup pass.
  const { layers: translatableLayers, soIdMap } = await getTranslatableLayers(folderLayer);
  const childLayers = translatableLayers.map((layer, i) => ({
    id:         layer.id,
    name:       layer.name,
    stackIndex: i,
    layer,
  }));

  // STEP 7: Match each child layer to a translated line.
  // Uses a confidence ladder: exact name match → fuzzy name match → stack index fallback.
  // Returns a Map<layerId, { text, matchType } | null>
  // null means the layer was in a "middle gap" and should be left untouched.
  // If overall confidence is too low (too many layers fell to stack index), the whole folder is skipped.
  const { skipped, reason, confidence, result } = matchLayersToLines(
    childLayers,
    enLines,
    transLines
  );

  // DELETE LATER
  // console.log(`[processMatchedFolder] STEP 7: confidence ${confidence.toFixed(2)} for "${folderLayer.name}"`);
  if (skipped) {
    // DELETE LATER
    // console.warn(`[processMatchedFolder] STEP 7: SKIPPED "${folderLayer.name}" — ${reason} (confidence: ${confidence.toFixed(2)})`);
    return;
  }

  // STEP 8: Apply translations.
  // Loop over the match result and translate each assigned layer.
  for (const [layerId, assignment] of result) {
    // null assignment = middle-gap layer, intentionally left untouched
    if (assignment === null) continue;

    const { text, matchType } = assignment;
    const child = childLayers.find(child => child.id === layerId);
    if (!child) continue;

    if (child.layer.kind === constants.LayerKind.SMARTOBJECT) {
      const smartObjectID = soIdMap.get(child.id);

      // DEDUPLICATION: If this SO's internal document was already translated (by an earlier
      // instance of the same SO encountered in a previous folder or earlier in this folder),
      // skip it — translating any one instance updates all of them simultaneously.
      if (smartObjectID && processedIds.has(smartObjectID)) {
        // DELETE LATER
        // console.log(`["${child.layer.name}", "with SmartObjectMoreID: ${smartObjectID}" is instance and is skipped`);
        continue;
      }

      // DELETE LATER
      // console.log(`[${matchType}] "${child.layer.name}" → "${text}"`);
      await ps.translateSmartObject(child.layer, text);
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
      console.log(`Text layer — not yet implemented: "${child.layer.name}" → "${text}"`);
    }
  }
}


// !!!!!!!!! Safe function - do not modify or delete !!!!!!!!!

// export async function processMatchedFolder(folderLayer, appState, translatedSOIds = new Set(), allInfos = null, layerIndexMap = null) {

//   // folderLayer.name IS the EN phrase — no need to look it up again
//   const enLines    = parseRawPhrase(folderLayer.name, "linesArray");

//   // Only need to look up the translation
//   const transPhrase = extractMatchingPhrase(folderLayer, appState);
//   if (!transPhrase) return;

//   const transLines = parseRawPhrase(transPhrase, "linesArray");

//   // Map layer.id → SmartObjectMoreID for O(1) lookup in the loop.
//   // Uses pre-save allInfos passed from translateAll so IDs are stable across folders.
//   // Falls back to a fresh batchPlay fetch if called standalone (e.g. from generateSuggestions).
//   const childSOLayers = [...folderLayer.layers].filter(l => l.kind === constants.LayerKind.SMARTOBJECT);
//   const soIdMap = new Map();
//   if (allInfos && layerIndexMap) {
//     childSOLayers.forEach(l => {
//       const internalId = allInfos[layerIndexMap.get(l.id)]?.smartObjectMore?.ID;
//       if (internalId) soIdMap.set(l.id, internalId);
//     });
//   } else {
//     const childSOInfos = await batchPlay(
//       childSOLayers.map(l => ({ _obj: "get", _target: [{ _ref: "layer", _id: l.id }] })),
//       { synchronousExecution: true }
//     );
//     childSOLayers.forEach((l, i) => {
//       const internalId = childSOInfos[i]?.smartObjectMore?.ID;
//       if (internalId) soIdMap.set(l.id, internalId);
//     });
//   }
//   // console.log("soIdMap:", JSON.stringify([...soIdMap.entries()]));

//   const childLayers = [...folderLayer.layers].map((layer, i) => ({
//     id:         layer.id,
//     name:       layer.name,
//     stackIndex: i,
//     layer,
//   }));

//   const { skipped, reason, confidence, result } = matchLayersToLines(
//     childLayers,
//     enLines,
//     transLines
//   );

//   if (skipped) {
//     console.log(`Skipped "${folderLayer.name}" — ${reason} (confidence: ${confidence})`);
//     return;
//   }

//   for (const [layerId, assignment] of result) {
//     if (assignment === null) continue;

//     const { text, matchType } = assignment;
//     const child = childLayers.find(c => c.id === layerId);
//     if (!child || !child.layer.visible) continue;

//     if (child.layer.kind === constants.LayerKind.SMARTOBJECT) {
//       const internalSOId = soIdMap.get(child.id);


//       console.log(`translatedSOIds has ${internalSOId}:`, translatedSOIds.has(internalSOId));


//       // Skip if this SO's internal document was already translated by another instance
//       if (internalSOId && translatedSOIds.has(internalSOId)) {
//         console.log(`["${child.layer.name}", "with internal SO ID: ${child.layer.id}" is instance and is skipped`);
//         continue;
//       }

//       console.log(`[${matchType}] "${child.layer.name}" → "${text}"`);
//       await ps.translateSmartObject(child.layer, text);

//       // Mark this internal SO document as done
//       if (internalSOId) translatedSOIds.add(internalSOId);

//     } else if (child.layer.kind === constants.LayerKind.TEXT) {
//       console.log(`Text layer — not yet implemented: "${child.layer.name}" → "${text}"`);
//     }
//   }
// }




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
function matchLayersToLines(childLayers, enLines, transLines) {
  const result = new Map();

  // Build normalized EN word → index lookup
  // e.g. "TOTAL" → 0, "CREDITS" → 1, "WON" → 2
  const enIndexByName = new Map(
    enLines.map((word, i) => [word.trim().toUpperCase(), i])
  );

  // Resolve each layer to an EN index using confidence ladder:
  //   1. Exact name match   → layer name matches EN word exactly
  //   2. Fuzzy name match   → layer name starts with EN word ("CREDITS copy 2")
  //   3. Stack index        → last resort, risky if layers were reordered
  const resolved = childLayers.map((layer) => {
    const normalizedName = layer.name.trim().toUpperCase();

    // 1. Exact match
    if (enIndexByName.has(normalizedName)) {
      return { layer, enIndex: enIndexByName.get(normalizedName), matchType: "name" };
    }

    // 2. Fuzzy — layer name starts with an EN word ("CREDITS copy 2" → "CREDITS")
    const fuzzyIndex = enLines.findIndex((word) =>
      normalizedName.startsWith(word.trim().toUpperCase())
    );
    if (fuzzyIndex !== -1) {
      return { layer, enIndex: fuzzyIndex, matchType: "fuzzy" };
    }

    // 3. Stack index — last resort
    return { layer, enIndex: layer.stackIndex, matchType: "stackIndex" };
  });

  // Sort by EN index so assignment is always top-down
  // regardless of how the artist ordered the layers in the panel
  resolved.sort((a, b) => a.enIndex - b.enIndex);

  // Confidence guard — skip folder if too many layers are unrecognizable
  // confidence 1.0 = all matched by name/fuzzy
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

  // offset = how many EN lines collapsed into fewer translated lines
  // e.g. EN has 3 lines, DE has 2 → offset = 1 (one word was merged)
  const offset = resolved.length - transLines.length;

  resolved.forEach(({ layer, matchType, enIndex }, i) => {

    // Case A — trans has more lines than layers
    // Translator split a word into more lines than there are layers.
    // Absorb overflow into the last layer by joining remaining lines with a space.
    // e.g. EN: ["YOU", "WIN"] / BG: ["ти", "вече", "спечели"]
    //   YOU → "ти"
    //   WIN → "вече спечели"
    if (resolved.length <= transLines.length) {
      const isLast = i === resolved.length - 1;
      const text = isLast ? transLines.slice(i).join(" ") : transLines[i];
      result.set(layer.id, { text, matchType, enIndex });
      return;
    }

    // Case B — EN has more lines than trans, true tail-anchoring
    // First maps to first, last maps to last, middle gap is untouched.
    // e.g. EN: ["TOTAL", "CREDITS", "WON"] / DE: ["GESAMTGUTHABEN", "GEWONNEN"]
    //   TOTAL   → "GESAMTGUTHABEN"
    //   CREDITS → null (middle gap, untouched)
    //   WON     → "GEWONNEN"
    if (i === 0) {
      result.set(layer.id, { text: transLines[0], matchType, enIndex });
    } else if (i <= offset) {
      result.set(layer.id, null); // middle gap, untouched
    } else {
      result.set(layer.id, { text: transLines[i - offset], matchType, enIndex });
    }
  });

  return { skipped: false, confidence, result };
}

















/**
 * Parses a raw phrase string into different representations based on the requested mode.
 * Strips (…) annotations in all modes.
 * Modes:
 *   "raw"      — returns phrase with \n intact and [] preserved, only (…) stripped
 *   "oneLiner" — collapses all lines into one space-separated string, [] content stripped
 *   "withLines"— returns array of individual words across all lines, [] content stripped
 *   "strict"   — same as oneLiner but drops entire lines that contain [...] placeholders
 */
export function parseRawPhrase(phrase, mode = "oneLiner") {

  // strict: remove entire lines that contain [...] before any other processing
  let input = phrase;
  if (mode === "strict") {
    input = phrase.split("\n").filter(l => !/\[.*?\]/.test(l)).join("\n");
  }

  // Remove () brackets but keep their content: (SUPER) → SUPER
  // Remove [] tokens entirely: [Number] → ""
  const withParens = input.replace(/\(([^)]*)\)/g, "$1");
  const withSquare = withParens.replace(/\[.*?\]/g, "");
  const cleaned = withSquare.replace(/\s+\n/g, "\n").trim();

  // Trim each line, collapse internal spaces, drop empty lines
  const lines = cleaned.split("\n").map(l => l.trim().replace(/\s+/g, " ")).filter(Boolean);

  if (mode === "raw")        return lines.join("\n");
  if (mode === "oneLiner")   return lines.join(" ").replace(/\s+/g, " ").trim();
  if (mode === "linesArray") return lines.flatMap(l => l.split(/\s+/)).filter(Boolean);
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

  // 4. Full phrase — all lines joined with space
  results.add(lines.join(" "));

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





//DEAD CODE




// export function getChildrenLayers(layer) {
//     if (layer.kind === "group" && layer.layers && layer.layers.length > 0) {
//         return layer.layers;
//     }
//     return [];
// }



// // Serch for parent folder and translate
// export function translateByFolder(appState, allLayers) {
  
//     for (const layer of allLayers) {
//       // Only process visible group layers
//       if (ps.isLayerAGroup(layer) && layer.visible === true) {
//         if (isNameENPhrase(layer.name, appState)) {
//           console.log(`Layer: ${layer.name} is in EN list and will be translated`);
//           // Example action: hide the layer (replace with translation logic)
//           // layer.visible = false;
//           let childrenLayers = layer.layers;
//           for (const child of childrenLayers) {
//             console.log(`Child layer: ${child.name} of parent ${layer.name}`);
//             if (child.kind === "textLayer" && child.visible === true) {
//               console.log(`--> Text layer found: ${child.name}`);
//             } else if (child.kind === "smartObject" && child.visible === true) {
//               console.log(`--> SmartObject layer found: ${child.name}`);
//             }
//           }
//         }
//       }
//     }


// }







// export async function translateSelectedLayer(appState) {
//   console.log("Translating selected layer...");
//   const activeLayer = app.activeDocument.activeLayers[0];
//   if (!activeLayer) return;

//   const suggestion = extractMatchingPhrase(activeLayer, appState);
//   if (suggestion) {
//     // console.log("Suggestion found:", suggestion);
//     await ps.translateSmartObject(activeLayer, suggestion);
//   } else {
//     // console.log("No matching phrase found for selected layer.");
//   }
// }





// Compare layer.name to parsed EN lines, log and break on first match
// export function compareLayerNameToEN(layer, appState) {
//   const enEntries = appState.languageData && appState.languageData["EN"];
//   if (!enEntries || !Array.isArray(enEntries)) return false;
//   // Preprocess all EN lines to uppercase for case-insensitive comparison
//   const enLines = [];
//   for (const entry of enEntries) {
//     enLines.push(...parseForTranslation(entry).map(line => line.toUpperCase()));
//   }
//   const enLineSet = new Set(enLines);
//   // Compare layer.name uppercased
//   const layerNameUpper = layer.name.toUpperCase();
//   if (enLineSet.has(layerNameUpper)) {
//     console.log(`Layer name "${layer.name}" matches EN line.`);
//     return true;
//   }
//   return false;
// }




// //parse a phrase into lines and ignore lines with () or [] (like [NUMBER])
// export function parseForTranslation(text) {
//   return text
//     .split('\n') // Split into lines
//     .map(line => line.trim()) // Remove extra spaces
//     .filter(line => line && !line.includes('(') && !line.includes('[')); // Ignore lines with () or []
// }



// function extractLanguageData(workbook) {
//   // Get the first worksheet
//   const sheetName = workbook.SheetNames[0];
//   const worksheet = workbook.Sheets[sheetName];
  
//   // Convert to array of arrays (first row becomes headers)
//   const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
//   const languageData = {};
//   const availableLanguages = [];
  
//   if (jsonData.length > 0) {
//     // First row contains language keys (ENG, BG, DE, etc.)
//     const languages = jsonData[0];
    
//     // Columns to ignore (not language data) - case insensitive
//     const ignoredColumns = ["screen preview"];
    
//     // Store available languages (filter out empty cells and ignored columns)
//     languages.forEach(lang => {
//       if (lang && lang.trim() && !ignoredColumns.includes(lang.trim().toLowerCase())) {
//         availableLanguages.push(lang);
//         languageData[lang] = [];
//       }
//     });
    
//     // Process remaining rows (translation data for each language)
//     for (let i = 1; i < jsonData.length; i++) {
//       const row = jsonData[i];
//       row.forEach((cell, columnIndex) => {
//         const language = languages[columnIndex];
//         if (language && cell && typeof cell === 'string' && !ignoredColumns.includes(language.trim().toLowerCase())) {
//           languageData[language].push(cell);
//         }
//       });
//     }
//   }
  
//   return { languageData, availableLanguages };
// }