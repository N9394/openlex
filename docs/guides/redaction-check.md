# Redaction check

*In German: Schwärzen mit Prüfung.*

When a question or a document may go to an online AI service, OpenLex first shows you what it will hide: names, numbers and addresses it found, marked in the text. You untick what may stay, add what it missed, and then send. Hidden text is replaced on your computer by placeholders such as `[[PERSON_1]]`; the answer comes back with the real names put back, also in Word and PDF exports.

It is a help that takes work off your hands, not a guarantee. OpenLex can miss things, especially indirect details (a rare job title, a unique event, a combination of facts). Please read the check before you send.

## When the check appears

- Only when something could leave your computer: your [client-data rule](client-data-rules.md) allows an online AI service for this matter, and the request would use it.
- **Only this computer** (local-only rule, a privileged matter, or the AI on this computer): no check, because nothing leaves. The line under the answer says "Stayed on this computer".
- It is **on by default** for every online call that carries your question or a document. You can switch it off in Settings → Where client data may go → "Redaction check before cloud use (recommended)". Your firm can switch it on for everyone and lock it (see below).
- It covers the chat, the full analysis, the contract review in Word, a panel of agents, and runs over several documents (one check for all documents before the run starts, with a list of the documents). Investigation and due diligence runs are checked the same way.
- Other work that runs in the background (for example a review grid, a plan, a draft) hides names and numbers automatically with the same rules, without the check window. In the AI record those calls say "names and numbers hidden (pseudonymised)" without "checked by you".

## What you see

- **The text** with every finding marked. Click a mark to switch it on or off.
- **Findings, grouped:** People, Organisations, Addresses, IDs & numbers, Contact, Other. Each can be unticked. "Hide all" per group; "Hide all like this" per kind. A small dot shows how sure OpenLex is (likely / possible / not sure); "not sure" findings start unticked.
- **Also hide this:** select any text and add it. It is then hidden everywhere in the matter, also in later documents.
- **What the AI will see:** a preview with the placeholders.
- **Long documents:** the findings list with jump-to; the text around the chosen place is shown, not one giant page.
- **Send with these hidden** / **Cancel.** Cancel sends nothing.

Your choices are remembered for the matter: what you hid joins the matter's list, what you unticked stays as it is next time. So the second document of a matter is faster. You can edit both lists in Settings → Where client data may go → "Lists for …" (the active matter).

The Word pane shows the same check as a compact list (with a field to add text). The terminal app shows a numbered list: a number and Enter switches a line on or off, `+` adds text, `s` sends, Esc cancels.

## What OpenLex looks for

Everything runs on your computer. Nothing is sent anywhere to find names.

1. **Your lists:** the client, the names on the matter's list, what you ticked or added in earlier checks, and the firm's list. A listed person's last name alone is hidden too.
2. **Patterns**, with check digits where the number has them (a number whose check digit is wrong is not treated as that ID):

| Where | What | Checked |
|---|---|---|
| everywhere | e-mail addresses, phone numbers | phone: by form (+, 0, 3-3-3 groups, "Tel." before it) |
| everywhere | IBAN | mod 97 |
| everywhere | BIC / SWIFT (with "BIC" or "SWIFT" before it) | — |
| everywhere | card numbers | Luhn |
| everywhere | dates of birth ("geb.", "born", "nar.", "ur.", "născut", "szül." … before the date) | — |
| everywhere | passport, ID card and driving licence numbers (with the word before them) | — |
| everywhere | court file numbers after "Az.", "GZ", "sp. zn.", "sygn. akt", "dosar nr.", "ügyszám", "Case No." … | — |
| AT | Sozialversicherungsnummer | check digit |
| AT | Firmenbuchnummer (FN), UID (ATU…) | — |
| AT, DE | court file numbers like "3 Cg 45/21k" without a word before them | shown unticked ("not sure") |
| DE | Steuer-Identifikationsnummer | ISO 7064 mod 11,10 |
| DE | Sozialversicherungs-/Rentenversicherungsnummer | check digit |
| DE | HRB / HRA, USt-IdNr. (DE…) | — |
| CH | AHV-Nummer (756.…) | EAN-13 |
| CH | UID (CHE-…) | mod 11 |
| CZ, SK | rodné číslo | mod 11 and a real date |
| CZ, SK | IČO (with "IČO" before it), DIČ / IČ DPH | mod 11 |
| PL | PESEL | checksum and a real date |
| PL | NIP | checksum |
| PL | KRS, REGON (with the word before them) | — |
| RO | CNP | checksum and a real date |
| RO | CUI / CIF (with the word before it) | checksum |
| RO | trade register number (J40/…/…) | — |
| HU | TAJ (with "TAJ" before it) | checksum |
| HU | adóazonosító jel | checksum |
| HU | cégjegyzékszám (with "Cg." before it), adószám | — |
| US | Social Security number | invalid ranges excluded |
| US | EIN | assigned prefixes |
| AT, DE, CH | street addresses (…straße 12, …gasse 3/4/5, PLZ and town) | — |
| CZ, SK | street, number, PSČ and town | — |
| PL | ul./al./pl. …, 00-000 town | — |
| RO | Str./Bd./Calea … nr. …, sector, cod poștal | — |
| HU | … utca/út/tér 7., 1051 Budapest | — |
| US | 1600 Main Street, Town, ST 12345 | — |

3. **Names by their surroundings:** a title before a name ("Herr", "Frau", "Dr.", "Mag.", "Ing.", "JUDr.", "Mgr.", "pan", "pani", "domnul", "Mr.", "Ms." …) and a legal form after a company name ("GmbH", "AG", "KG", "s.r.o.", "a.s.", "sp. z o.o.", "S.A.", "SRL", "Kft.", "Zrt.", "LLC", "Inc." …). A name found once is found again in the other texts of the same check.
4. **Optional name finder** (Settings, desktop app): a small model that also finds names, organisations and addresses without a title or legal form. The check says "with name finder" only when the model really went through every text of that check; otherwise it says "basic detection" and why. The AI record and the data line note which it was.

The list of patterns is one data file in the engine (`sidecar/src/pii_patterns.js`), with tests for valid and invalid numbers.

### The optional name finder

- Model: [GLiNER-X small](https://huggingface.co/knowledgator/gliner-x-small) by Knowledgator, licence Apache-2.0. It was trained for about 20 languages, among them German, English, Czech, Polish and Romanian; Slovak and Hungarian work through their neighbours, less reliably.
- Size: about 190 MB to download (a 173 MB model file plus its word list). It is never part of the installer; it is downloaded only when you click "Download", from Hugging Face at a fixed version, and every file is checked against its SHA-256 before it is used. "Remove" deletes it.
- Where it runs: in the desktop app on Windows, Linux and Apple Silicon Macs, which include the runtime it needs (ONNX Runtime, CPU only). Not on Intel Macs (the runtime no longer supports them) and not in the CLI or Homebrew install — there Settings does not offer it and the check says so.
- It runs on your computer (it is not a chat AI and sends nothing). A 30-page contract takes about ten seconds. Very long documents: the first ~150 pages go through the name finder; the rest is checked by the other rules.

## Your firm's settings

In the firm's `openlex.json` (see [firm setup](firm-setup.md)):

```json
{
  "lock": ["redaction"],
  "redaction": {
    "check": true,
    "terms": ["Example Holding", "Project Falcon"],
    "patterns": [{ "regex": "KD-\\d{6}", "kind": "ID", "label": "Client number" }]
  }
}
```

- `check`: on (the default) or off.
- `lock`: with `"redaction"` in it, nobody can switch the check off on their computer.
- `terms`: names hidden in every matter.
- `patterns`: the firm's own numbers (regular expressions). `kind` is one of PERSON, ORG, ADDRESS, ID, TAXID, REGNO, CASENO, IBAN, EMAIL, PHONE, DATE, OTHER.

## The AI record

Every check is in the [AI record](ai-record.md): when, how many items of each kind were hidden ("3 people, 1 IBAN …"), in how many texts, and whether you changed anything. Every online call says "names and numbers hidden (pseudonymised)", with "checked by you" when it went through the check. The record never contains what was hidden. A call that was held back because the check was not done is listed as such.

The placeholders of a matter (which real name stands behind `[[PERSON_3]]`) are kept on your computer only, readable only by your user account, so that answers and exports can be put back together.

## Limits — please read

- **Pseudonymised data is still personal data.** Under the GDPR (Art. 4(5) and recital 26), data that can be linked back to a person with additional information is pseudonymised, not anonymous. The placeholders can be linked back on your computer, and the context of a document can point to a person. Whether and how you may use an online AI service for client data is for you and your firm to decide (professional secrecy, data protection, the client's consent, the provider's contract). OpenLex does not decide that for you.
- **Removing names alone may not be enough.** The German Federal Bar (BRAK) points out in its guidance on AI that removing names may not be enough to keep a client from being identifiable. Facts, dates, amounts, places and rare details can identify someone too.
- **It can miss things.** Spelling variants, names in tables or scanned pages with poor text recognition, nicknames, initials, foreign names without a title, numbers in unusual formats, and everything indirect.
- **It can hide too much.** A public authority, a court, a statute's name or a well-known company may be marked; untick them if the AI needs them.
- **Background work is not checked by you**, only hidden automatically (see above).
- **Placeholders can confuse the AI.** It sees `[[PERSON_1]]` instead of a name; it usually keeps them, and OpenLex puts the names back, but a summary can occasionally be worded oddly around them.

## Switching it off

Settings → Where client data may go → untick "Redaction check before cloud use (recommended)" (not possible when your firm has locked it). "Always hide names and numbers, also without the check" then still hides automatically, without showing you the check.
