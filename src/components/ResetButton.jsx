import React from "react";

export const ResetButton = () => (
  <sp-action-button size="m" onClick={() => location.reload()} style={{ color: "rgb(199, 165, 28)" }}>
    <sp-icon name="ui:Alert" size="s" slot="icon" style={{ color: "rgb(199, 165, 28)" }}></sp-icon>
    RESET
  </sp-action-button>
);


export default ResetButton;