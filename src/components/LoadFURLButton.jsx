import React from "react";
import { api } from "../api/api";
import { photoshop } from "../globals";

const { app } = photoshop;

export const LoadFURLButton = ({ onFileLoaded }) => {
  const handleLoadFromURL = async () => {
    try {
      // Hardcoded URL for now - will be replaced with input field later
      const url = null; // e.g. "https://example.com/path/to/your/file.xlsx";
      // const url = "https://egtdigitalcom-my.sharepoint.com/:x:/r/personal/mariya_krasteva_egt-digital_com/_layouts/15/Doc.aspx?sourcedoc=%7B0AA1EB1B-FE45-4732-8635-0ECCDF9E8DED%7D&file=AllTranslatableAssets.xlsx&action=default&mobileredirect=true";
      if (!url) {
        console.log("No valid URL provided");
        app.showAlert("No URL provided");
        return;
      }
      
      console.log("Fetching from URL:", url);
      
      // Try to convert SharePoint web view URL to download URL
      // SharePoint URLs often need "&download=1" parameter
      let downloadUrl = url;
      if (url.includes('sharepoint.com') && !url.includes('download=')) {
        downloadUrl = url.split('&')[0] + '?download=1';
      }
      
      console.log("Download URL:", downloadUrl);
      
      // Fetch file from URL
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      console.log("File fetched successfully");
      
      // Convert to ArrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      
      console.log("ArrayBuffer size:", arrayBuffer.byteLength);
      
      // Parse the Excel data (parseExcelFile now accepts ArrayBuffer)
      const parsedData = await api.parseExcelFile(arrayBuffer);
      
      console.log("Parsed data:", parsedData);
      
      // Pass to parent
      onFileLoaded(parsedData);
      
      console.log("Data loaded successfully from URL");
      
    } catch (error) {
      console.error("Error loading from URL:", error);
      alert(`Failed to load from URL: ${error.message}`);
    }
  };

  return (
    <sp-action-button disabled onClick={handleLoadFromURL}>
      Load From URL
    </sp-action-button>
  );
};


