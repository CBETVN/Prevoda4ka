import React from "react";

export const ResetButton = () => (
  <div className="reset-plugin-button-container">
    <sp-action-button size="m" className="reset-plugin-button" onClick={() => location.reload()}>
        <sp-icon name="ui:Alert" size="s" slot="icon"></sp-icon>
      RESET
    </sp-action-button>
  </div>
);


export default ResetButton;