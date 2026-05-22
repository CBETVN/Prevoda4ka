import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import { uxp, photoshop} from "./globals";
import { api } from "./api/api";
import { TranslateSuggestion } from "./components/TranslateSuggestion";
import { SuggestionsContainer } from "./components/SuggestionsContainer";
import { PhraseReference } from "./components/PhraseReference";
import { LoadFDiskButton } from "./components/LoadFDiskButton";
import { LoadFURLButton } from "./components/LoadFURLButton";
import { SliceActionButton } from "./components/SliceActionButton";
import { TranslateAllButton } from "./components/TranslateAllButton";
import { LanguageSelectorDropdown } from "./components/LanguageSelectorDropdown";
import { FontSelectorDropdown } from "./components/FontSelectorDropdown";
import { DataStatusIcon } from "./components/DataStatusIcon";
import { GenerateSuggestionsButton } from "./components/GenerateSuggestionsButton";
import { TranslateSelectedTextField } from "./components/TranslateSelectedTextField";
import { TranslateSelectedButton } from "./components/TranslateSelectedButton";
import { GuessThePhrase } from "./components/GuessThePhrase";
import { ValidateMFButton } from "./components/ValidateMFButton";
import {ResetButton} from "./components/ResetButton";
import { ValidationWindow } from "./components/validationWindow";
import * as validate from "./api/validateMasterFile";
import * as pl from "./api/parsingLogic";
import * as phraseGuesser from "./api/phraseGuesser";
import { setSubstituteFont } from "./api/fontManager.js";
// import * as XLSX from "./lib/xlsx.full.min.js";

const { app, core, action } = photoshop;

export const App = () => {
  const webviewUI = import.meta.env.VITE_BOLT_WEBVIEW_UI === "true";
  

  const [languageData, setLanguageData] = useState({});
  const [availableLanguages, setAvailableLanguages] = useState([]);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [availableFonts, setFonts] = useState([]);
  const [count, setCount] = useState(0);
  const [selectedFont, setSelectedFont] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [textfieldValue, setTextfieldValue] = useState("");

  // Bundle all relevant state into a single object to pass to logic/helpers or child components
  const appState = {
  languageData,
  availableLanguages,
  selectedLanguage,
  isDataLoaded,
  availableFonts,
  selectedFont,
  suggestionTextfieldValue: textfieldValue,
  // ...add more as needed
  };


  const handleFileLoaded = ({parsedData, availableFonts}) => {
    // Check if languageData is a non-empty object
    const hasLanguageData =
      parsedData &&
      parsedData.languageData &&
      Object.keys(parsedData.languageData).length > 0;
    //Check if availableLanguages is a non-empty array  
    const hasAvailableLanguages =
      parsedData &&
      Array.isArray(parsedData.availableLanguages) &&
      parsedData.availableLanguages.length > 0;

    if (!hasLanguageData || !hasAvailableLanguages) {
      setIsDataLoaded(false);
      return;
    }

    setLanguageData(parsedData.languageData);
    setAvailableLanguages(parsedData.availableLanguages);
    setIsDataLoaded(true);
    setFonts(availableFonts);
    // console.log("handleFileLoaded: availableFonts:", availableFonts);
    // Don't auto-select - let user choose
  };


// Depricated Guess the phrase button
  // const handleGuessThePhrase = async () => {
  //   const activeLayer = app.activeDocument.activeLayers[0];
  //   if (!activeLayer) {
  //     api.notify("No layer selected.");
  //     return;
  //   }
  //   try {
  //     setIsProcessing(true);
  //     const result = api.guessThePhrase(activeLayer, appState);
  //     if (!result) {
  //       console.log("guessThePhrase: no match found");
  //       api.notify("No matching phrase found.");
  //       return;
  //     }
  //     console.log(`guessThePhrase result:`);
  //     console.log(`  enPhrase:         "${result.enPhrase}"`);
  //     console.log(`  translatedPhrase: "${result.translatedPhrase}"`);
  //     console.log(`  confidence:       ${(result.confidence * 100).toFixed(0)}%`);
  //     console.log(`  matchedCandidate: "${result.matchedCandidate}"`);
  //     setTextfieldValue(result.translatedPhrase);
  //   } catch (error) {
  //     console.error("guessThePhrase error:", error);
  //   } finally {
  //     setIsProcessing(false);
  //   }
  // };





  // Generate suggestions from your logic
  const handleGenerate = async () => {

    setSelectedId(null); // ← reset selection before generating new list
    const activeLayer = app.activeDocument.activeLayers[0];
    if (!activeLayer) {
      api.notify("No layer selected.");
      return;
    }

    try {
      setIsProcessing(true);
      const phrases = await pl.generateSuggestions(activeLayer, appState);
      if (!phrases) return;

      const newSuggestions = phrases.map((text, index) => ({
        id: index + 1,
        text,
        placeholder: ""
      }));

      setSuggestions(newSuggestions);
    } catch (error) {
      console.error("Error generating suggestions:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Example: Dynamically update suggestion text
  const updateSuggestion = (id, newText) => {
    setSuggestions(prev =>
      prev.map(s => s.id === id ? { ...s, text: newText } : s)
    );
  };

  const hostName = (uxp.host.name).toLowerCase();

  //* Call Functions Conditionally by App
  // if (hostName === "photoshop") {
  //   console.log("Hello from Photoshop", photoshop);
  // }
      
  //* Or call the unified API object directly and the correct app function will be used
  const simpleAlert = () => {
    api.notify("Hello World");
  };



  const handleCenterToSlice = async () => {
    await core.executeAsModal(async () => {
      const layer = app.activeDocument.activeLayers[0];
      if (!layer || (layer.kind !== "smartObject" && layer.kind !== "text")) {
        app.showAlert("Select a Smart Object or Text layer");
        return;
      }
      await api.centerLayerToSlice();
    }, { commandName: "Center to Slice" });
  };

  const handleFitToSlice = async () => {
    await core.executeAsModal(async () => {
      const layer = app.activeDocument.activeLayers[0];
      if (!layer || (layer.kind !== "smartObject" && layer.kind !== "text")) {
        app.showAlert("Select a Smart Object or Text layer");
        return;
      }
      await api.scaleDownToSlice(layer);
      await api.centerLayerToSlice();
    }, { commandName: "Fit to Slice" });
  };

  const handleValidateMasterFile = async () => {
    try {
      setIsProcessing(true);

      const results = await validate.validateDoc(appState);
      if (!results) return;

      const dialog = document.createElement("dialog");
      const root = ReactDOM.createRoot(dialog);
      root.render(<ValidationWindow dialog={dialog} results={results} />);
      document.body.appendChild(dialog);
      await dialog.uxpShowModal({ title: "Document Report", resize: "both", size: { width: 480, height: 800 } });
      root.unmount();
      dialog.remove();
    } catch (error) {
      console.error("Error validating master file:", error);
    } finally {
      setIsProcessing(false);
    }
  };



  return (
    <>
      {!webviewUI ? (
        <main>

        <div className="group-icon">
          <DataStatusIcon isActive={isDataLoaded} />
        </div>

          {/* ── Step 1: Load & Configure ── */}
          <div className="group">
              <div className="button-grid">
                <LoadFDiskButton onFileLoaded={handleFileLoaded} />
                <LoadFURLButton onFileLoaded={handleFileLoaded} />
                <ValidateMFButton onClick={handleValidateMasterFile} disabled={isProcessing || !isDataLoaded} />
                <ResetButton onClick={() => location.reload()} />
              </div>
              <div className="divider">
                <sp-divider size="m"></sp-divider>
              </div>
              <div className="group-dropdowns">
                <LanguageSelectorDropdown
                  availableLanguages={availableLanguages}
                  selectedLanguage={selectedLanguage}
                  onLanguageChange={setSelectedLanguage}
                />
                <FontSelectorDropdown
                  availableFonts={availableFonts}
                  selectedFont={selectedFont}
                  onFontChange={(font) => {
                    setSelectedFont(font);
                    setSubstituteFont(font);
                  }}
                />
            </div>
              <div className="divider">
                <sp-divider size="m"></sp-divider>
              </div>
              <div className="translate-all-button-row">
                <TranslateAllButton appState={appState} disabled={isProcessing || !selectedLanguage}/>
              </div>
          </div>

          {/* ── Group 3: Generate Suggestions ── */}
          <div className="group">
            <div className="translate-selected-container">
              <div className="group-button-row">
                <GenerateSuggestionsButton onClick={handleGenerate} disabled={isProcessing || !selectedLanguage} />
              </div>
              <SuggestionsContainer
                maxHeight="160px"
                suggestions={suggestions}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setTextfieldValue(suggestions.find(s => s.id === id)?.text || "");
                }}
                onGenerate={handleGenerate}
                isProcessing={isProcessing}
              />
            </div>
            <div className="input-button-row">
              <TranslateSelectedTextField
                value={textfieldValue}
                placeholder="Select a suggestion to translate..."
                onChange={setTextfieldValue}
              />
              <TranslateSelectedButton appState={appState} disabled={isProcessing || !selectedLanguage} label="Translate Selected" />
            </div>
          </div>

                    {/* ── Group 4: Slice Actions ── */}
          <div className="group">
            
              <div className="layout-buttons">
                <div className="group-dropdowns">
                  <SliceActionButton label="Center to Slice" onClick={handleCenterToSlice} disabled={isProcessing} />
                  <SliceActionButton label="Fit to Slice" onClick={handleFitToSlice} disabled={isProcessing} />
                </div>
              </div>
          </div>
        </main>
      ) : (
        <div>
          <h1>Hello World</h1>
          <p>This is a Bolt WebView UI plugin.</p>
        </div>
      )}
    </>
  );
};
