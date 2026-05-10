import React from "react";

export const FontSelectorDropdown = ({ 
  availableFonts, 
  selectedFont, 
  onFontChange 
}) => {
  const handleChange = (event) => {
    const newFont = event.target.value;
    console.log("Font selected:", newFont);
    onFontChange(newFont);
  };
  const placeholder = "Select Font";
  
  return (
    <div className="font-selector-dropdown">
      <sp-picker
        label="Selection type"
        disabled={availableFonts.length === 0}
        onchange={handleChange}
      > 
        <sp-menu slot="options">
          <sp-menu-item value="" selected={selectedFont === ""}>
            {placeholder}
          </sp-menu-item>
          {availableFonts.map((font) => (
            <sp-menu-item 
              key={font} 
              value={font}
              selected={font === selectedFont}
            >
              {font}
            </sp-menu-item>
          ))}
        </sp-menu>
      </sp-picker>
    </div>
  );
};
