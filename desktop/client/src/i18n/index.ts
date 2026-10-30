import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import de from './locales/de.json'

// Only English and German are offered: the other locale files (fr, sk, cs,
// ro, el) are about half translated and gave mixed-language screens. They
// stay in the repository for translators; add one back here when it is
// complete (≥ 95 % of the keys).
export const SUPPORTED_LANGUAGES = ['auto', 'en', 'de'] as const
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  auto: 'Auto',
  en: 'English',
  de: 'Deutsch',
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'de'],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'lexvault-ui-lang',
      caches: ['localStorage'],
    },
  })

export function setUiLanguage(language: SupportedLanguage) {
  if (language === 'auto') {
    const browser = (navigator.language || 'en').split('-')[0]
    i18n.changeLanguage(browser === 'de' ? 'de' : 'en')
    localStorage.setItem('lexvault-ui-lang-pref', 'auto')
  } else {
    i18n.changeLanguage(language)
    localStorage.setItem('lexvault-ui-lang-pref', language)
  }
}

export default i18n
