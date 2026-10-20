---
name: ma-red-flags
title: M&A red-flag scan
description: Scan a target company contract for transaction red flags: change of control, assignment, exclusivity, unusual liability, termination triggers.
triggers: [due diligence, red flag, change of control, kontrollwechsel, m&a, transaction review, data room, dd report]
output: text
---
1. Read the whole contract map, then go clause by clause looking for: change-of-control triggers (consent, termination, price changes), anti-assignment, exclusivity and non-compete binding the target, most-favoured-customer clauses, uncapped liability or indemnities, guarantees and security, termination for convenience by the counterparty, long lock-in terms, unusual governing law or forum.
2. For each finding, quote the clause verbatim with its number. If a finding depends on law (e.g. enforceability of a non-compete), search_law first.
3. Rate each finding: deal-relevant (affects price, structure or closing), notable, or minor.
4. For many contracts at once, recommend the Review grid with the "Contract due diligence" columns instead of running this skill per document.

Output: a short report: one line per finding with rating, clause number, quote and the action (consent needed, renegotiate, disclose, ignore).
