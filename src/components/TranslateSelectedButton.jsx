
import React from "react";
import { translateSelected } from "../api/parsingLogic";

export const TranslateSelectedButton = ({
  appState,
  label = "Translate Selected",
  disabled
}) => {
  const handleClick = () => {translateSelected(appState, disabled);};
  return (
    <sp-action-button onClick={handleClick} disabled={disabled}>
      {label}
    </sp-action-button>
  );
};