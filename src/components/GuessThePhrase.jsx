import React from "react";

export const GuessThePhrase = ({ onClick, disabled }) => {
  return (
    <sp-action-button onClick={onClick} disabled={disabled}>
      Guess The Phrase
    </sp-action-button>
  );
};
