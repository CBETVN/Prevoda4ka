
import React from "react";
import { translateAll } from "../api/parsingLogic";

export const TranslateAllButton = ({
  appState,
  label = "Translate All",
  disabled
}) => {
  const handleClick = () => {translateAll(appState, disabled);};
  return (
    <sp-action-button onClick={handleClick} disabled={disabled}>
      {label}
    </sp-action-button>
  );
};

