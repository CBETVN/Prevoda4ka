import { photoshop } from "../globals.js";


const { app } = photoshop;









export async function getAllFonts() {
    const fonts = app.fonts; // Photoshop font list
    return fonts.map(font => ({
        name: font.name,
        postScriptName: font.postScriptName,
        family: font.family,
        style: font.style
    }));
}

async function logFonts() {
    const fonts = await getAllFonts();
    console.log(fonts);
}