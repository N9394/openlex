import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import de from './locales/de.json'
import sk from './locales/sk.json'
import cs from './locales/cs.json'
import ro from './locales/ro.json'
import el from './locales/el.json'
import fr from './locales/fr.json'

export const SUPPORTED_LANGUAGES = ['auto', 'en', 'de', 'fr', 'sk', 'cs', 'ro', 'el'] as const
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  auto: 'Auto — match your prompt',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  sk: 'Slovenčina',
  cs: 'Čeština',
  ro: 'Română',
  el: 'Ελληνικά',
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      fr: { translation: fr },
      sk: { translation: sk },
      cs: { translation: cs },
      ro: { translation: ro },
      el: { translation: el },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'de', 'fr', 'sk', 'cs', 'ro', 'el'],
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
    const target = (['en', 'de', 'fr', 'sk', 'cs', 'ro', 'el'] as const).includes(browser as never)
      ? browser
      : 'en'
    i18n.changeLanguage(target)
    localStorage.setItem('lexvault-ui-lang-pref', 'auto')
  } else {
    i18n.changeLanguage(language)
    localStorage.setItem('lexvault-ui-lang-pref', language)
  }
}

export default i18n
