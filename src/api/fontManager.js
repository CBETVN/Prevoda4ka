import { photoshop } from "../globals.js";

const { app } = photoshop;
const { batchPlay } = photoshop.action;



//This need attention. What if doesnt select anything and there is a missing font?
let substituteFont = null;

export function setSubstituteFont(fontName) {
  substituteFont = fontName;
}





// Get the fonst with styles from here instead of putting them in the state
let allFontsWithStyles = null;







export async function getAllFonts() {

  

    const allFontsArray = app.fonts.map(font => ({name: font.name, postScriptName: font.postScriptName,family: font.family, style: font.style}));
    // console.log("All fonts from allFontsMap:", allFontsArray);
    //turns an array of font objects into a map keyed by font name, with values containing postScriptName, family, and style
    allFontsWithStyles = Object.fromEntries(allFontsArray.map(({name, ...rest}) => [name, rest]));
    console.log("All fonts with styles:", allFontsWithStyles);
    
    const fontsSet = new Set(); // Use a Set to avoid duplicates
    
    allFontsArray.forEach(font => fontsSet.add(font.name)); // Extract family names
    const fonts = Array.from(fontsSet).sort(); // Convert back to array and sort alphabetically
    return fonts;
    // return fonts.map(font => ({
    //     name: font.name,
    //     postScriptName: font.postScriptName,
    //     family: font.family,
    //     style: font.style
    // }));
}









/**
 * Changes ALL text layer fonts to substituteFont. Two-part approach:
 *
 * PART 1 — Missing fonts: uses PS `remapFonts` (one document-wide batchPlay call).
 *   remapFonts is the only way to fix missing fonts — per-layer set won't work
 *   because PS refuses to resolve a font it considers missing.
 *
 * PART 2 — Installed fonts: uses `set textLayer` per layer.
 *   For each text layer whose font is already installed but differs from the
 *   substitute, we clone its full textKey descriptor, swap font properties in
 *   every textStyleRange, and apply via batchPlay. The full textKey spread
 *   preserves text content, paragraph styles, and all other formatting.
 *   All select+set pairs are batched into one batchPlay call for speed.
 *
 * Called ONCE before the translation loop, not per-layer.
 * The caller should re-fetch descriptors after this call to get updated font names.
 *
 * @param {Object[]} allLayerDescriptors - Pre-remap batchPlay descriptors for all layers.
 * @returns {boolean} true if any fonts were changed.
 */
export async function changeFont(allLayerDescriptors) {
  if (!substituteFont) return false;

  // Look up the real style/postScriptName for the user-selected font.
  // substituteFont is font.name (e.g. "Oswald Bold"), allFontsWithStyles maps it
  // to { postScriptName, family, style } for use in batchPlay font fields.
  const fontInfo = allFontsWithStyles[substituteFont];
  const targetFamily = fontInfo?.family || "Myriad Pro";
  const targetStyle = fontInfo?.style || "Regular";
  const targetPostScript = fontInfo?.postScriptName || "MyriadPro-Regular";

  // ══════════════════════════════════════════════════════════════
  // PART 1: Missing fonts → document-wide remapFonts
  // Collects every unique missing font across all layers and remaps
  // them all to the substitute in one call. After this, PS considers
  // them installed (fontAvailable becomes true).
  // ══════════════════════════════════════════════════════════════
  const missingFontsMap = new Map();

  for (const desc of allLayerDescriptors) {
    const ranges = desc?.textKey?.textStyleRange;
    if (!ranges) continue;
    for (const r of ranges) {
      if (r.textStyle?.fontAvailable === false) {
        const key = `${r.textStyle.fontName}|${r.textStyle.fontStyleName}`;
        if (!missingFontsMap.has(key)) {
          missingFontsMap.set(key, { fontName: r.textStyle.fontName, fontStyleName: r.textStyle.fontStyleName });
          console.log(`[font] MISSING: "${r.textStyle.fontName} ${r.textStyle.fontStyleName}" → will remap to "${substituteFont}"`);
        }
      }
    }
  }

  if (missingFontsMap.size > 0) {
    // remapFonts needs family + style (not postScriptName) to resolve the target font
    const entries = Array.from(missingFontsMap.values()).map(f => ({
      _obj: "fontRemapEntry",
      fromFont: { _obj: "fontSpec", fontName: f.fontName, fontStyleName: f.fontStyleName },
      toFont: { _obj: "fontSpec", fontName: targetFamily, fontStyleName: targetStyle }
    }));
    await batchPlay([{
      _obj: "remapFonts", fontMap: entries,
      _options: { dialogOptions: "dontDisplay" }
    }], { synchronousExecution: true });
    console.log(`[font] Remapped ${missingFontsMap.size} missing font(s) → "${substituteFont}"`);
  }

  // ══════════════════════════════════════════════════════════════
  // PART 2: Installed fonts → per-layer set textLayer
  // For layers that already have an installed font (but not the substitute),
  // we change the font via batchPlay "set textLayer".
  // Each layer needs a select (to make it active) + set (to apply the change),
  // because "set textLayer" targets the active layer (ordinal/targetEnum).
  // All pairs are batched into one batchPlay call.
  // ══════════════════════════════════════════════════════════════
  const batchCommands = [];

  for (const desc of allLayerDescriptors) {
    const textKeyObj = desc?.textKey;
    if (!textKeyObj?.textStyleRange) continue;

    // Skip missing-font layers — already handled by remapFonts in PART 1
    if (textKeyObj.textStyleRange.some(r => r.textStyle?.fontAvailable === false)) continue;

    // Skip layers already using the substitute font
    if (textKeyObj.textStyleRange.every(r => r.textStyle?.fontName === substituteFont)) continue;

    // Clone the full textKey and swap only font properties in each style range.
    // Spreading textKeyObj preserves: text content, paragraph styles, warp, etc.
    const modifiedTextKey = { ...textKeyObj };
    modifiedTextKey.textStyleRange = textKeyObj.textStyleRange.map(range => ({
      ...range,
      textStyle: {
        ...range.textStyle,
        fontPostScriptName: targetPostScript,
        fontName: substituteFont,
        fontStyleName: targetStyle
      }
    }));

    // Select the layer by ID, then set its text style
    batchCommands.push(
      { _obj: "select", _target: [{ _ref: "layer", _id: desc.layerID }], _options: { dialogOptions: "dontDisplay" } },
      { _obj: "set",
        _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _obj: "textLayer", ...modifiedTextKey },
        _options: { dialogOptions: "dontDisplay" }
      }
    );
  }

  if (batchCommands.length > 0) {
    await batchPlay(batchCommands, { synchronousExecution: true });
    console.log(`[font] Changed ${batchCommands.length / 2} installed-font layer(s) → "${substituteFont}"`);
  }

  return true;
}













// TESTING ONLY - NOT A REAL FUNCTION
async function changeFontToPanoptica() {
  // Get the current layer descriptor
  const result = await batchPlay(
    [{
      _obj: "get",
      _target: [
        { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
      ],
      _options: { dialogOptions: "dontDisplay" }
    }],
    { synchronousExecution: true }
  );

  const layerInfo = result[0];
  const textKey = { ...layerInfo.textKey };

  // Change only the font in all textStyleRanges
  textKey.textStyleRange = textKey.textStyleRange.map(range => ({
    ...range,
    textStyle: {
      ...range.textStyle,
      fontPostScriptName: "Panoptica"
    }
  }));
console.log("Layer textKey:", textKey);
console.log("Attempting to set font to Panoptica...");
  // Run the set command inside executeAsModal
  await executeAsModal(async () => {
    await batchPlay(
      [{
        _obj: "set",
        _target: [
          { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }
        ],
        to: {
          _obj: "textLayer",
          ...textKey // Spread all properties for point text
        }
      }],
      { synchronousExecution: true }
    );
  }, { commandName: "Change Font to Panoptica" });
}
