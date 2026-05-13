import React from "react";
import "./validationWindow.css";

const CATEGORY_LABELS = [
  ['groups',       'Groups'],
  ['smartObjects', 'Smart Objects'],
  ['textLayers',   'Text Layers'],
  ['otherLayers',  'Other Layers'],
];

export const ValidationWindow = ({ dialog, results }) => {
  const { nestedSOs, missingFonts, fuzziness } = results || {};

  const allMissingFontNames = missingFonts?.found
    ? [...new Set([
        ...missingFonts.mainDoc.map(f => f.fontName),
        ...missingFonts.smartObjects.flatMap(so => so.fonts)
      ])]
    : [];

  return (
    <form method="dialog" className="validationWindow">
      <sp-heading>Document Report</sp-heading>
      <sp-divider size="small"></sp-divider>

      <div className="section">
        <sp-detail>NESTED SMART OBJECTS</sp-detail>
        {nestedSOs?.found ? (
          <sp-body>Found {nestedSOs.count} Smart Object(s) with nested SOs.</sp-body>
        ) : (
          <sp-body class="success">No nested Smart Objects found.</sp-body>
        )}
      </div>

      <sp-divider size="small"></sp-divider>

      <div className="section">
        <sp-detail>MISSING FONTS</sp-detail>
        {allMissingFontNames.length > 0 ? (
          <>
            <sp-body>{allMissingFontNames.length} missing font(s):</sp-body>
            <sp-table class="missing-fonts-table" style={{ maxHeight: "300px" }} scroller="true">
              <sp-table-body>
                {allMissingFontNames.map((name) => (
                  <sp-table-row key={name}>
                    <sp-table-cell>{name}</sp-table-cell>
                  </sp-table-row>
                ))}
              </sp-table-body>
            </sp-table>
          </>
        ) : (
          <sp-body class="success">All fonts are installed.</sp-body>
        )}
      </div>

      <sp-divider size="small"></sp-divider>

      <div className="section">
        <sp-detail>NAMING QUALITY</sp-detail>
        {fuzziness ? (
          <>
            <sp-body>Overall Score: {fuzziness.overallScore}/100</sp-body>
            {fuzziness.overallScore < 100 && (
              <div className="fuzziness-breakdown">
                {CATEGORY_LABELS
                  .map(([key, label]) => [label, fuzziness[key]])
                  .filter(([, cat]) => cat && cat.total > 0)
                  .map(([label, cat]) => (
                    <div key={label} className="fuzziness-category">
                      <sp-detail>{label}: {cat.score}/100</sp-detail>
                      <sp-body class="fuzziness-stats">
                        {cat.matched} matched, {cat.named} meaningful, {cat.generic.length} generic
                        {" "}(of {cat.total})
                      </sp-body>
                    </div>
                  ))}
              </div>
            )}
          </>
        ) : (
          <sp-body class="muted">Load XLSX data to see naming analysis.</sp-body>
        )}
      </div>

      <sp-button-group>
        <sp-button variant="primary" onClick={() => dialog.close("ok")}>Close</sp-button>
      </sp-button-group>
    </form>
  );
};
