import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { WORLD_LANGUAGES, WORLD_COUNTRIES, WorldLanguage, WorldCountry } from './worldData';
import { TRANSLATIONS, TranslationKeys } from './translations';

interface LanguageContextType {
  currentLanguage: WorldLanguage;
  setLanguage: (langCode: string) => void;
  t: (
    key: keyof TranslationKeys | string,
    fallback?: string,
    vars?: Record<string, string | number>
  ) => string;
  isRTL: boolean;
  dir: 'ltr' | 'rtl';
  allLanguages: WorldLanguage[];
  allCountries: WorldCountry[];
  isLanguageModalOpen: boolean;
  openLanguageModal: () => void;
  closeLanguageModal: () => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const findTranslationDict = (langCode: string): TranslationKeys | undefined => {
  if (TRANSLATIONS[langCode]) return TRANSLATIONS[langCode];
  const lower = langCode.toLowerCase();
  const exactInsensitiveKey = Object.keys(TRANSLATIONS).find((k) => k.toLowerCase() === lower);
  if (exactInsensitiveKey) return TRANSLATIONS[exactInsensitiveKey];

  const base = lower.split('-')[0];
  if (TRANSLATIONS[base]) return TRANSLATIONS[base];
  const baseInsensitiveKey = Object.keys(TRANSLATIONS).find((k) => k.toLowerCase() === base);
  return baseInsensitiveKey ? TRANSLATIONS[baseInsensitiveKey] : undefined;
};

const interpolateVars = (text: string, vars?: Record<string, string | number>): string => {
  if (!vars) return text;
  let result = text;
  for (const [varKey, varVal] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${varKey}\\}`, 'g'), String(varVal));
  }
  return result;
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentLanguage, setCurrentLanguage] = useState<WorldLanguage>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('liveconnect_language');
      if (saved) {
        const found =
          WORLD_LANGUAGES.find((l) => l.code === saved) ||
          WORLD_LANGUAGES.find((l) => l.code.toLowerCase() === saved.toLowerCase()) ||
          WORLD_LANGUAGES.find((l) => l.code.split('-')[0].toLowerCase() === saved.split('-')[0].toLowerCase());
        if (found) return found;
      }
      // Auto detect browser language if available
      try {
        const browserLang = navigator.language;
        if (browserLang) {
          const matched =
            WORLD_LANGUAGES.find((l) => l.code.toLowerCase() === browserLang.toLowerCase()) ||
            WORLD_LANGUAGES.find((l) => l.code.toLowerCase() === browserLang.split('-')[0].toLowerCase());
          if (matched) return matched;
        }
      } catch (e) {
        // Safe fallback
      }
    }
    return WORLD_LANGUAGES[0]; // English default
  });

  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);

  const openLanguageModal = useCallback(() => setIsLanguageModalOpen(true), []);
  const closeLanguageModal = useCallback(() => setIsLanguageModalOpen(false), []);

  const setLanguage = useCallback((langCode: string) => {
    let found = WORLD_LANGUAGES.find((l) => l.code.toLowerCase() === langCode.toLowerCase());
    if (!found) {
      const base = langCode.split('-')[0].toLowerCase();
      found = WORLD_LANGUAGES.find((l) => l.code.toLowerCase() === base);
    }
    if (!found) {
      found = WORLD_LANGUAGES.find((l) => l.code.toLowerCase().startsWith(langCode.toLowerCase()));
    }

    if (found) {
      setCurrentLanguage(found);
      if (typeof window !== 'undefined') {
        localStorage.setItem('liveconnect_language', found.code);
        document.documentElement.lang = found.code;
        document.documentElement.dir = found.dir;
      }
    }
  }, []);

  // Update HTML tag dir and lang on mount/change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = currentLanguage.code;
      document.documentElement.dir = currentLanguage.dir;
    }
  }, [currentLanguage]);

  // Translate helper
  const t = useCallback(
    (
      key: keyof TranslationKeys | string,
      fallback?: string,
      vars?: Record<string, string | number>
    ): string => {
      const langDict = findTranslationDict(currentLanguage.code);

      if (langDict && (langDict as Record<string, string>)[key]) {
        return interpolateVars((langDict as Record<string, string>)[key], vars);
      }

      // English fallback
      const enDict = TRANSLATIONS['en'];
      if (enDict && (enDict as Record<string, string>)[key]) {
        return interpolateVars((enDict as Record<string, string>)[key], vars);
      }

      return interpolateVars(fallback || key, vars);
    },
    [currentLanguage]
  );

  const value: LanguageContextType = {
    currentLanguage,
    setLanguage,
    t,
    isRTL: currentLanguage.dir === 'rtl',
    dir: currentLanguage.dir,
    allLanguages: WORLD_LANGUAGES,
    allCountries: WORLD_COUNTRIES,
    isLanguageModalOpen,
    openLanguageModal,
    closeLanguageModal,
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
