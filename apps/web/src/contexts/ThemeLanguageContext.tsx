import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translations, type Language } from "../i18n/translations";

type Theme = "light" | "dark";

type ThemeLanguageValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const THEME_KEY = "aa_theme";
const LANGUAGE_KEY = "aa_language";

const ThemeLanguageContext = createContext<ThemeLanguageValue | null>(null);

function detectSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveText(language: Language, key: string): string {
  return translations[language][key] || translations.en[key] || key;
}

export function ThemeLanguageProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return detectSystemTheme();
  });
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === "undefined") return "en";
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    return stored === "tr" ? "tr" : "en";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("lang", language);
    window.localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

  const value = useMemo<ThemeLanguageValue>(() => ({
    theme,
    setTheme: (nextTheme) => setThemeState(nextTheme),
    toggleTheme: () => setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    language,
    setLanguage: (nextLanguage) => setLanguageState(nextLanguage),
    t: (key, vars) => {
      let text = resolveText(language, key);
      if (!vars) return text;
      for (const [varKey, varValue] of Object.entries(vars)) {
        text = text.replaceAll(`{{${varKey}}}`, String(varValue));
      }
      return text;
    }
  }), [language, theme]);

  return <ThemeLanguageContext.Provider value={value}>{children}</ThemeLanguageContext.Provider>;
}

export function useThemeLanguage() {
  const ctx = useContext(ThemeLanguageContext);
  if (!ctx) {
    throw new Error("useThemeLanguage must be used within ThemeLanguageProvider");
  }
  return ctx;
}
