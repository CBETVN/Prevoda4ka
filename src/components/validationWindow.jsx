import React, { useEffect, useRef } from "react";

import { versions } from "uxp";
import os from "os";

import "./validationWindow.css";

export const ValidationWindow = (props) => {
      const formatRef = useRef(null);






    return (
        <form method="dialog" className="validationWindow">
        <sp-heading>Document Report</sp-heading>
        <sp-divider size="small"></sp-divider>
        <sp-body>
            Some text about the following information
        </sp-body>
        {/* <webview id="webview" width="100%" height="360px" src="https://www.google.com"></webview> */}
        


        <div className="table">
            <div><sp-detail>PLUGIN: </sp-detail><sp-body> {versions.plugin}</sp-body></div>
            <div><sp-detail>OPERATING SYSTEM:</sp-detail><sp-body> {os.platform()} {os.release()}</sp-body></div>
            <div><sp-detail>UNIFIED EXTENSIBILITY PLATFORM:</sp-detail><sp-body>{versions.uxp}</sp-body></div>
        </div>
        <sp-button-group>
            <sp-button tabindex={0} autofocus="autofocus" variant="primary" onClick={() => props.dialog.close("ok")}>OK</sp-button>
        </sp-button-group>
    </form>
    );
}
