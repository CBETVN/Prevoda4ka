import { photoshop } from "../globals.js";

const { app } = photoshop;
const { batchPlay } = photoshop.action;

let substituteFont = "Ethnocentric";

export function setSubstituteFont(fontName) {
  substituteFont = fontName;
}







export async function getAllFonts() {
    // const allFontObjects = app.fonts; // Photoshop font list
    // const fonts = allFontObjects.map(font => (font.family)); // Extract family names
    // return fonts;
    const allFontObjects = app.fonts; // Photoshop font list
    const fontsSet = new Set(); // Use a Set to avoid duplicates
    allFontObjects.forEach(font => fontsSet.add(font.family)); // Extract family names
    const fonts = Array.from(fontsSet).sort(); // Convert back to array and sort alphabetically
    return fonts;
    // return fonts.map(font => ({
    //     name: font.name,
    //     postScriptName: font.postScriptName,
    //     family: font.family,
    //     style: font.style
    // }));
}

// async function logFonts() {
//     const fonts = await getAllFonts();
//     fonts.forEach(font => {console.log(font.family)});
//     // console.log(fonts);
// }









/**
 * Scans all layer descriptors for missing fonts and remaps them to FALLBACK_FONT
 * in one document-wide batchPlay call.
 *
 * IMPORTANT: Must be called ONCE before the translation loop, not per-layer.
 * After this call, all previously-missing fonts become FALLBACK_FONT with fontAvailable=true.
 * The caller should re-fetch descriptors after this to get the updated font names.
 *
 * Why remapFonts + atomic write instead of textItem.contents?
 *   - textItem.contents permanently destroys any font that was ever "missing",
 *     even after remapFonts fixes it. PS remembers the "was missing" stain.
 *   - So for missing-font layers, we use atomic batchPlay writes (set textLayer)
 *     which don't trigger the font reset. Normal layers use textItem.contents as before.
 *
 * @param {Object[]} allLayerDescriptors - Pre-remap batchPlay descriptors for all layers.
 * @returns {boolean} true if any fonts were remapped.
 */
export async function changeFont(allLayerDescriptors) {
  // Collect every unique missing font across all layers.
  // Each layer can have multiple textStyleRanges (mixed formatting),
  // and each range can have a different font.
  const missingFontsMap = new Map();

  for (const layerDescriptor of allLayerDescriptors) {
    const styleRanges = layerDescriptor?.textKey?.textStyleRange;
    if (!styleRanges) continue;

    for (const range of styleRanges) {
      if (range.textStyle?.fontAvailable === false) {
        const missingFontName = range.textStyle.fontName;
        const missingFontStyle = range.textStyle.fontStyleName;
        // Deduplicate — same font on different layers only needs one fontMap entry
        const dedupeKey = `${missingFontName}|${missingFontStyle}`;
        if (!missingFontsMap.has(dedupeKey)) {
          missingFontsMap.set(dedupeKey, { fontName: missingFontName, fontStyleName: missingFontStyle });
          console.log(`[font-replace] "${missingFontName} ${missingFontStyle}" is missing → will remap to "${substituteFont}"`);
        }
      }
    }
  }

  // No missing fonts — nothing to do
  if (missingFontsMap.size === 0) return false;

  // Build one fontMap entry per unique missing font, all pointing to FALLBACK_FONT
  const fontMapEntries = Array.from(missingFontsMap.values()).map(missingFont => ({
    _obj: "fontRemapEntry",
    fromFont: {
      _obj: "fontSpec",
      fontName: missingFont.fontName,
      fontStyleName: missingFont.fontStyleName
    },
    toFont: {
      _obj: "fontSpec",
      fontName: substituteFont,
      fontStyleName: substituteFont
    }
  }));

  // One single remapFonts call for the entire document
  await batchPlay([{
    _obj: "remapFonts",
    fontMap: fontMapEntries,
    _options: { dialogOptions: "dontDisplay" }
  }], { synchronousExecution: true });

  console.log(`[font-replace] Remapped ${missingFontsMap.size} missing font(s) → "${substituteFont}"`);
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
