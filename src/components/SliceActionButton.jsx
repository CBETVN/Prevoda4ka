import React from "react";

export const SliceActionButton = ({ label, onClick, disabled }) => {
  return (
    <sp-action-button onClick={onClick} disabled={disabled}>
      {label}
    </sp-action-button>
  );
};
