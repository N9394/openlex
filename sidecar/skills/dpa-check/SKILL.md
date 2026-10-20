---
name: dpa-check
title: Data processing agreement check (GDPR Art. 28)
description: Check a data processing agreement or DPA clause against the mandatory content of GDPR Article 28 and flag what is missing.
triggers: [dpa, data processing agreement, auftragsverarbeitung, avv, art. 28, article 28, gdpr processor, zmluva o spracúvaní, acord de prelucrare]
output: suggestions
---
1. Load the mandatory list first: get_eu_law for Regulation (EU) 2016/679, Article 28(3). Quote it, do not paraphrase from memory.
2. Check the document for each element of Art. 28(3)(a)–(h): documented instructions (incl. transfers), confidentiality of personnel, Art. 32 security, sub-processor conditions (Art. 28(2) and (4)), assistance with data subject rights, assistance with Art. 32–36, deletion or return at the end, audits and information.
3. Also check: subject matter, duration, nature and purpose, types of personal data and categories of data subjects (first sentence of Art. 28(3)); international transfers (Chapter V, SCCs).
4. Use run_playbook with "dpa-gdpr-art28" if it exists for a deterministic cross-check.
5. One suggestion per missing or weak element, citing "Regulation (EU) 2016/679 - Art. 28(3)(x)".

Output: suggestion cards plus a short table of the eight elements: present / weak / missing.
