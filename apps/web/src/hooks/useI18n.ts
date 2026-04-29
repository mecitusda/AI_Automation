import { useThemeLanguage } from "../contexts/ThemeLanguageContext";

export function useI18n() {
  const { t, language, setLanguage, theme, setTheme, toggleTheme } = useThemeLanguage();
  return { t, language, setLanguage, theme, setTheme, toggleTheme };
}
