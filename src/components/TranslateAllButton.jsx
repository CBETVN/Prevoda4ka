
import React from "react";
import { translateAll } from "../api/parsingLogic";

export const TranslateAllButton = ({
  appState,
  label = "Translate All",
  disabled,
  onComplete
}) => {
  const handleClick = async () => {
    try {
      await translateAll(appState, disabled);
    } catch (err) {
      console.error("[TranslateAllButton] translateAll error:", err);
    }
      onComplete?.();
  };
  return (
    <sp-action-button onClick={handleClick} disabled={disabled}>
      {label}
    </sp-action-button>
  );
};

