import React from "react";

export const LanguageSelectorDropdown = ({ 
  availableLanguages, 
  selectedLanguage, 
  onLanguageChange 
}) => {
  const handleChange = (event) => {
    const newLanguage = event.target.value;
    onLanguageChange(newLanguage);
  };
  const placeholder = "Select Language";
  
  return (
    <sp-picker
      label="Selection type"
      disabled={availableLanguages.length === 0}
      onchange={handleChange}
    >
      <sp-menu slot="options">
        <sp-menu-item value="" selected={selectedLanguage === ""}>
          {placeholder}
        </sp-menu-item>
        {availableLanguages.map((lang) => (
          <sp-menu-item
            key={lang}
            value={lang}
            selected={lang === selectedLanguage}
          >
            {lang}
          </sp-menu-item>
        ))}
      </sp-menu>
    </sp-picker>
  );
};
