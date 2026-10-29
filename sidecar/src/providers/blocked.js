"use strict"
/**
 * Models OpenLex never sends client data to, whatever the settings say,
 * with the reason in plain words (research 2026-10-29):
 *
 *   Claude Fable 5 / 5.1   keep what you send for up to 30 days for review
 *                          (on Bedrock: AWS review; Anthropic: 30-day retention)
 *   Mistral Large 4 and preview / "labs" models
 *                          a public preview: Mistral may train on it and
 *                          zero retention does not apply
 *   Bedrock global / US / Asia inference profiles
 *                          processed outside the EU
 *
 *   reason(provider) → { en, de } or null
 */

const FABLE = /fable[-_ .]?5/i
const MISTRAL_PREVIEW = /mistral-large-(4|latest)|large-4|(^|[/:-])labs-|preview/i
const NON_EU_PROFILE = /^(global|us|us-gov|apac|jp|au|ca)\./i

function reason(p) {
  if (!p || p.local) return null
  const model = String(p.model || '')
  if (FABLE.test(model)) {
    return {
      en: 'Claude Fable 5 and 5.1 keep what you send for up to 30 days so it can be reviewed, so OpenLex does not send client data to them. Choose Claude Sonnet 5.5 or Opus 5.5.',
      de: 'Claude Fable 5 und 5.1 speichern Ihre Eingaben bis zu 30 Tage zur Überprüfung; OpenLex sendet daher keine Mandantendaten an sie. Wählen Sie Claude Sonnet 5.5 oder Opus 5.5.',
    }
  }
  if ((p.id === 'mistral' || /mistral/i.test(model)) && MISTRAL_PREVIEW.test(model)) {
    return {
      en: 'This Mistral model is a preview: Mistral may use what you send for training, and zero retention does not apply. Choose Mistral Medium 3.5.',
      de: 'Dieses Mistral-Modell ist eine Vorschau: Mistral darf Ihre Eingaben zum Training verwenden, und Zero-Data-Retention gilt nicht. Wählen Sie Mistral Medium 3.5.',
    }
  }
  if (p.kind === 'bedrock' && p.region && !require('./settings').BEDROCK_EU.includes(p.region)) {
    return {
      en: `AWS Bedrock is set to ${p.region}, which is not an EU region (or adds non-EU regions). Use eu-central-1 (Frankfurt).`,
      de: `AWS Bedrock ist auf ${p.region} eingestellt; das ist keine EU-Region (oder fügt Regionen außerhalb der EU hinzu). Verwenden Sie eu-central-1 (Frankfurt).`,
    }
  }
  if (p.kind === 'bedrock' && NON_EU_PROFILE.test(model)) {
    return {
      en: 'This Bedrock model profile is processed outside the EU. Use a profile that starts with "eu.", for example eu.anthropic.claude-sonnet-5-5.',
      de: 'Dieses Bedrock-Modellprofil wird außerhalb der EU verarbeitet. Verwenden Sie ein Profil, das mit „eu.“ beginnt, zum Beispiel eu.anthropic.claude-sonnet-5-5.',
    }
  }
  return null
}

module.exports = { reason }
