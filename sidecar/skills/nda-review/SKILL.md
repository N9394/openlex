---
name: nda-review
title: NDA review
description: Review a non-disclosure or confidentiality agreement for the risks of the side the lawyer represents and propose balanced fixes.
triggers: [nda, non-disclosure, confidentiality agreement, geheimhaltungsvereinbarung, vertraulichkeitsvereinbarung, dohoda o mlčanlivosti, acord de confidențialitate]
output: suggestions
---
1. Find out which party the lawyer represents. If the request doesn't say, assume the receiving party and say so in one line.
2. Read the document map. Check, in this order: definition of confidential information (scope, marking, oral disclosures), exclusions (public, already known, independently developed, received from a third party), permitted disclosures (advisers, group companies, legal compulsion with notice), duration of the obligations and survival, return or destruction (including backups and legal-hold carve-out), remedies (injunction, penalty clause, liability cap), non-solicitation or non-compete riders, governing law and forum.
3. If the firm library has a standard NDA, use search_firm_library and measure the draft against it.
4. For any penalty clause, non-compete or unusual duration, search_law in the document's jurisdiction before you judge it.
5. Propose one suggestion per issue, anchored to the exact clause text, rebalanced toward the client but still signable.

Output: suggestion cards, then three lines of prose: the biggest risk, what you changed, and anything the lawyer must decide.
