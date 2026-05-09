import { photoshop } from "../globals.js";


const { app } = photoshop;









export async function getAllFonts() {
    const allFontObjects = app.fonts; // Photoshop font list
    const fonts = allFontObjects.map(font => (font.postScriptName)); // Extract family names
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