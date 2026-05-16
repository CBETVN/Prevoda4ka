import React from "react";

export const ValidateMFButton = ({ onClick, disabled }) => {
  return (
    <sp-action-button onClick={onClick} disabled={disabled}>
      Analyze Doc
    </sp-action-button>
  );
};