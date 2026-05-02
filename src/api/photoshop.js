import { photoshop } from "../globals";
// import { asModal as executeAsModal } from "./utils/photoshop-utils.js";

const { action } = photoshop;
const { batchPlay } = action;
const { app } = photoshop;
const { executeAsModal } = photoshop.core;



export const notify = async (message) => {
  await photoshop.app.showAlert(message);
};

export const getProjectInfo = async () => {
  const doc = photoshop.app.activeDocument;
  const info = {
    name: doc.name,
    path: doc.path,
    id: doc.id,
  };
  return info;
};






export async function translateSmartObject(smartObject, translation) {
  const smartObjectId = smartObject.id;

  try {
    await executeAsModal(async () => {
      await batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: smartObjectId }],
        _options: { dialogOptions: "silent" }
      }], { synchronousExecution: true });
      // DELETE LATER
      // console.log("Selected Smart Object layer:", smartObject.name, "(ID:", smartObjectId, ")");
      const allDocLayers = getAllLayers(app.activeDocument.layers);
      const freshSmartObject = allDocLayers.find(l => l.id === smartObjectId);

      if (!freshSmartObject) {
        console.error("Could not find smart object with id:", smartObjectId);
        return;
      }

      // DELETE LATER
      // console.log(`[translateSmartObject] About to open SO "${freshSmartObject.name}" | kind: ${freshSmartObject.kind} | locked: ${freshSmartObject.locked} | visible: ${freshSmartObject.visible}`);
      // let anc = freshSmartObject.parent;
      // while (anc && anc.layers) {
      //   console.log(`  ancestor: "${anc.name}" locked: ${anc.locked} visible: ${anc.visible}`);
      //   anc = anc.parent;
      // }
      // console.log(`  active doc BEFORE editSmartObject: "${app.activeDocument.name}" id: ${app.activeDocument.id}`);
      const mainDocId = app.activeDocument.id;
      await editSmartObject(freshSmartObject);
      // DELETE LATER
      // console.log(`  active doc AFTER  editSmartObject: "${app.activeDocument.name}" id: ${app.activeDocument.id}`);

      // Guard: if editSmartObject failed (e.g. "Edit Contents not available"), the active
      // document is still the main PSD. Bail out immediately — do NOT close it.
      if (app.activeDocument.id === mainDocId) {
        // DELETE LATER
        // console.warn(`[translateSmartObject] FAILED to open SO "${freshSmartObject.name}" — doc did not change, still on "${app.activeDocument.name}"`);
        return;
      }
      // DELETE LATER
      // console.log(`[translateSmartObject] Successfully opened SO "${freshSmartObject.name}" as "${app.activeDocument.name}"`);

      // Fetch all inner layers and their info in one shot AFTER opening the SO
      const allLayers = getAllLayers(app.activeDocument.layers);
      const isThereTextLayer = allLayers.some(l => l.kind === "text");
      if (!isThereTextLayer) {
        // DELETE LATER
        // console.warn(`[translateSmartObject] No text layers inside "${freshSmartObject.name}" — closing without save`);
        app.activeDocument.closeWithoutSaving();
        return;
      }
      const allInnerInfos = await batchPlay(
        allLayers.map(l => ({ _obj: "get", _target: [{ _ref: "layer", _id: l.id }] })),
        { synchronousExecution: true }
      );

      // Translate all text layers, reusing allInnerInfos for font size
      for (let i = 0; i < allLayers.length; i++) {
        const layer = allLayers[i];
        if (layer.kind !== "text" || !layer.visible) continue;

        const originalSize = allInnerInfos[i].textKey.textStyleRange[0].textStyle.impliedFontSize._value;

        layer.textItem.contents = translation;
        app.activeDocument.activeLayers = [layer];

        await batchPlay([{
          _obj: "set",
          _target: [
            { _ref: "property", _property: "textStyle" },
            { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }
          ],
          to: {
            _obj: "textStyle",
            textOverrideFeatureName: 808465458,
            typeStyleOperationType: 3,
            size: { _unit: "pointsUnit", _value: originalSize }
          },
          _options: { dialogOptions: "dontDisplay" }
        }], { synchronousExecution: true });
      }

      await cropCanvasToLayerBounds(allLayers, allInnerInfos);

      await app.activeDocument.save();
      app.activeDocument.closeWithoutSaving();

    }, { commandName: "Translate Smart Object" });

  } catch (e) {
    console.error("Error in executeAsModal:", e);
  }
}



export async function translateTextLayer(textLayer, translation) {
  await executeAsModal(async () => {
    textLayer.textItem.contents = translation;
  }, { commandName: "Translate Text Layer" });
}

















//Takes a layer as a parameter and enters edit mode. Doesnt preform a check so make sure layer is in fact SMart object.
export async function editSmartObject(smartObject) {
    // if (smartObject.kind !== "smartObject") {
    //   photoshop.app.showAlert("No layer provided.");
    //   return;
    // }
    // console.log("MUH EDITING:", smartObject.name);
   const result = await batchPlay(
      [
         {
            _obj: "placedLayerEditContents",
            documentID: app.activeDocument.id,
            layerID: smartObject.id,
            _options: {
               dialogOptions: "dontDisplay"
            }
         }
      ],
      {}
   );
}


//Gets the font size of a text layer in real "points" units instead of weird Photoshop units (2.1356666 and such)
async function getFontSizeInPT(layer) {
  let actualFontSize; // Declare outside executeAsModal
  
  await executeAsModal(async () => {
    const layerInfo = await batchPlay([{
      _obj: "get",
      _target: [{ _ref: "layer", _id: layer.id }]
    }], { synchronousExecution: true });

    actualFontSize = layerInfo[0].textKey.textStyleRange[0].textStyle.impliedFontSize._value;
  });
  
  return actualFontSize;
}


// ??? Function to change text size of a text layer to a specific value in points/TO BE TESTED/
async function changeTextSize(number) {
  executeAsModal(async () => {
    const result = await batchPlay(
      [
         {
            _obj: "set",
            _target: [
               {
                  _ref: "property",
                  _property: "textStyle"
               },
               {
                  _ref: "textLayer",
                  _enum: "ordinal",
                  _value: "targetEnum"
               }
            ],
            to: {
               _obj: "textStyle",
               textOverrideFeatureName: 808465458,
               typeStyleOperationType: 3,
               size: {
                  _unit: "pointsUnit",
                  _value: number
               }
            },
            _options: {
               dialogOptions: "dontDisplay"
            }
         }
      ],
      {
         synchronousExecution: true,
        //  modalBehavior: "wait"
      }
   );})
}


export async function getLayerInfo(layer) {
  if (!layer) {
    console.error("No layer selected.");
    return null;
  }

  const res = await batchPlay(
    [
      {
        _obj: "get",
        _target: [
          { _ref: "layer", _id: layer.id }
        ]
      }
    ],
    { synchronousExecution: true }
  );

  const layerInfo = res[0];

  // Uncomment the line below to log the entire layer info object

  // console.log("Layer info:", JSON.stringify(layerInfo, null, 2));

  // if(layerInfo.hasOwnProperty("layerSectionExpanded")) {
  //   const isExpanded = layerInfo.layerSectionExpanded;
  //   if (isExpanded) {
  //     console.log(`Group IS Expanded`);
  //   }else{ console.log(`Group IS NOT Expanded`); }
  // }

  return layerInfo;
}

// Helper function to recursively get all layers including nested ones
export function getAllLayers(layers) {
  let allLayers = [];
  for (const layer of layers) {
    allLayers.push(layer);
    // If it's a group, get its children too
    if (layer.layers && layer.layers.length > 0) {
      allLayers = allLayers.concat(getAllLayers(layer.layers));
    }
  }
  return allLayers;
}



export function getAllVisibleLayers(layers, result = []) {
  for (const layer of layers) {
    if (!layer.visible) continue; // skip invisible layer AND its entire subtree
    if (layer.locked) continue;   // skip locked layer AND its entire subtree
    result.push(layer);
    if (layer.layers?.length) getAllVisibleLayers(layer.layers, result);
  }
  // console.log(`Found ${result.length} visible layers in total.`);
  return result;
}



export async function getSOid(layer) {
  const layerInfo = await getLayerInfo(layer);
  return layerInfo?.smartObjectMore?.ID || null;
}




// Tankes an array of SOs and returns only the unique SOs
export async function purgeSOInstancesFromArray(array) {
  //Unique IDs
  const uniqueSOids = new Set();
  //Unique Layers
  const uniqueLayers = [];

  for (const layer of array) {
    // Check only SO layers as only SOs have the smartObjectMore.ID property that we rely on for uniqueness. Non-SO layers will be ignored and can appear multiple times without affecting the result.
    if (layer.kind !== "smartObject") continue;  
    
    const layerSOid = await getSOid(layer);
    
    if (uniqueSOids.has(layerSOid)){continue;} 
    else {uniqueSOids.add(layerSOid); uniqueLayers.push(layer);}
  }

  return uniqueLayers;
}













/**
 * Returns all layers that share the same Smart Object ID as the given layer.
 * Fetches layer descriptors internally via batchPlay.
 *
 * @param {Layer} layer - The reference Smart Object layer to match against.
 * @param {Layer[]} array - Flat array of layers to search within (e.g. allVisibleLayers).
 * @returns {Layer[]|null} Array of matching instances, or null if the layer is not a Smart Object.
 */
export async function getSmartObjectInstances(layer, array) {
  const allInfos = await batchPlay(
    array.map(l => ({ _obj: "get", _target: [{ _ref: "layer", _id: l.id }] })),
    { synchronousExecution: true }
  );

  // Map layer.id → descriptor — stable regardless of array mutations or reordering
  const infoById = new Map(array.map((l, i) => [l.id, allInfos[i]]));

  const layerInfo = infoById.get(layer.id);

  if (!layerInfo?.smartObjectMore) {
    return null;
  }

  const targetSOid = layerInfo.smartObjectMore.ID;

  const instances = array.filter(l => infoById.get(l.id)?.smartObjectMore?.ID === targetSOid);

  console.log(`Found ${instances.length} instance(s) of "${layer.name}"`);
  return instances;
}


export function getParentFolder(layer) {
  // console.log("Checking:", layer.name);
  // console.log("Layer is part of the group:", layer.parent.name);
  try {
    if (!layer.parent) {
      // console.log("Layer has no parent.");
      return null;
    } else {
      // console.log("Parent folder is:", layer.parent.name);
      return layer.parent;
    }
  } catch (error) {
    console.error("Error accessing parent folder:", error);
  }

}

// Check if layer is a group and has layers in it
export function isLayerAGroup(layer) {
    if(layer.kind === "group" && layer.layers.length > 0) {
      // console.log(`Layer: ${layer.name} is a group/folder`);
      return true;
    }
  // if(layer.kind === "group") {
  //   return true;
  // }
  return false;
}




/**
 * Crops the canvas of the active document to the bounds of the most relevant layer.
 * Prefers the first layer with at least one enabled effect (e.g. drop shadow, gradient, stroke).
 * Falls back to the first text layer if no such layer is found.
 * Designed to be called from within an existing executeAsModal context.
 *
 * @param {Layer[]} allLayers - Flat array of all layers inside the Smart Object.
 * @param {Object[]} allInnerInfos - batchPlay info objects for each layer, same order as allLayers.
 */
export async function cropCanvasToLayerBounds(allLayers, allInnerInfos) {

  // --- HELPER ---
  // Checks if a layer has at least one enabled effect (drop shadow, stroke, gradient, etc.)
  // layerEffects is an object where values can be arrays of effects or single effect objects
  function hasEnabledEffects(layerEffects) {
    if (!layerEffects) return false;
    return Object.values(layerEffects).some(val => {
      if (Array.isArray(val)) return val.some(e => e.enabled);             // e.g. multiple drop shadows
      if (typeof val === 'object' && val !== null) return val.enabled === true; // e.g. single stroke
      return false;
    });
  }

  // --- PICK CROP TARGET ---
  // First choice: a layer that has at least one enabled effect (more precise bounds due to effects)
  // Fallback: the first text layer if no layer with effects is found
  // ?? is the nullish coalescing operator — if the first find() returns undefined, try the second
const cropTarget =
    allLayers.find((l, i) => l.visible && hasEnabledEffects(allInnerInfos[i]?.layerEffects)) ??
    allLayers.find(l => l.visible && l.kind === "text");

  // --- GUARD ---
  // If neither a layer with effects nor a text layer was found, bail out gracefully
  if (!cropTarget) {
    console.warn("No suitable crop target found in:", app.activeDocument.name);
    return;
  }

  // --- GET BOUNDS ---
  // Destructure the pixel bounds of the chosen layer
  const { left, top, right, bottom } = cropTarget.bounds;

  // --- BATCHPLAY: TWO OPERATIONS IN ONE CALL ---
  await batchPlay([

    // OPERATION 1: Select the transparency of the crop target layer
    // This creates a selection based on the layer's transparent pixels
    // (not strictly needed for the crop but sets context)
    {
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      to: {
        _ref: [
          { _ref: "channel", _enum: "channel", _value: "transparencyEnum" },
          { _ref: "layer", _name: cropTarget.name }
        ]
      }
    },

    // OPERATION 2: Crop the canvas to the exact pixel bounds of the crop target layer
    // top/left/bottom/right come from cropTarget.bounds above
    // angle: 0 — no rotation
    // delete: true — deletes pixels outside the crop area
    // AutoFillMethod, cropFillMode, cropAspectRatioModeKey, constrainProportions
    //   — these are standard Photoshop crop options, kept at defaults
    {
      _obj: "crop",
      to: {
        _obj: "rectangle",
        top:    { _unit: "pixelsUnit", _value: top },
        left:   { _unit: "pixelsUnit", _value: left },
        bottom: { _unit: "pixelsUnit", _value: bottom },
        right:  { _unit: "pixelsUnit", _value: right }
      },
      angle: { _unit: "angleUnit", _value: 0 },
      delete: true,
      AutoFillMethod: 1,
      cropFillMode: { _enum: "cropFillMode", _value: "defaultFill" },
      cropAspectRatioModeKey: { _enum: "cropAspectRatioModeClass", _value: "pureAspectRatio" },
      constrainProportions: false
    }

  ], { synchronousExecution: true });

  // console.log(`Cropped canvas to layer: "${cropTarget.name}"`);
}