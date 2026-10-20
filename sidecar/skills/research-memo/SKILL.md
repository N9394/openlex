---
name: research-memo
title: Legal research memo
description: Answer a legal question with a short research memo grounded in statute and EU law, with exact citations.
triggers: [research memo, memo, gutachten, rechtsfrage, legal question, is it allowed, allowed in, permitted under, zulässig, ist es erlaubt, právne stanovisko]
output: text
---
1. Restate the question in one sentence and name the jurisdiction (ask if it is genuinely unclear).
2. Search before answering: search_law in the jurisdiction (several queries in the language of that law), search_ris for current Austrian federal law, search_eurlex and get_eu_law for EU law. Use get_law_section to read the full section you rely on.
3. Structure: Question, Short answer, Legal basis (each provision cited as "Statute - § N" with the decisive words quoted), Analysis, Open points and risks.
4. Never cite a provision you have not retrieved. If the sources don't answer the question, say so and say what to check next.
5. Write in the lawyer's language.

Output: the memo as text. Offer to save it with write_file under the matter folder.
