import React from "react";
import { uxp } from "../globals";
import { api } from "../api/api";

export const LoadFDiskButton = ({ onFileLoaded }) => {
  const handleLoadFile = async () => {
    try {
      const file = await uxp.storage.localFileSystem.getFileForOpening({
        types: ["xlsx", "xls"],
      });

      if (!file) {
        console.log("No file selected");
        return;
      }
      console.log("File selected:", file.name);

      const parsedData = await api.parseExcelFile(file);
      const availableFonts = await api.getAllFonts();
      // console.log("Available fonts count:", availableFonts.length);
      // availableFonts.forEach(font => {console.log(font.family)});

      console.log("Parsed data:", parsedData);
      // console.log("Available languages:", parsedData.availableLanguages);
      // console.log("Language data:", parsedData.languageData);

      onFileLoaded({parsedData, availableFonts});

      console.log("Data passed to parent successfully");

    } catch (error) {
      console.error("Error loading file:", error);
    }
  };

  return (
    <sp-action-button onClick={handleLoadFile}>
      Load From Disk
    </sp-action-button>
  );
};


