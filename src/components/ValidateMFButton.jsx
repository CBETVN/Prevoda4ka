import React from "react";

export const ValidateMFButton = ({ onClick, disabled }) => {
  return (
    <sp-action-button onClick={onClick} disabled={disabled}>
      Validate Doc
    </sp-action-button>
  );
};