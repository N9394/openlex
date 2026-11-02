# Redaction check — evaluation and release gate

The redaction check is the feature that has to hold. This folder tests it **end to end, the way a lawyer gets it**: candidate collection (patterns, the matter's lists, heuristics, `pii_candidates.js`) → GOWA's decision per candidate → the harness rules in `redaction_v2.js`. The model alone is never the unit under test: GOWA has one decision head and no tagger, so it can only classify what the harness puts in front of it.

## Built around the model's weaknesses

GOWA's known weaknesses decide what the harness must do. Every gold entity carries weakness tags; the report breaks each number down by tag, so a gap points straight at the harness piece that has to close it.

| Tag | Weakness | Why GOWA alone fails | The harness piece that covers it |
|---|---|---|---|
| w1 | no clue (no title, unknown first name, lower case) | never proposed as a candidate → never seen | more candidate sources: first-name lists per country, lower-case e-mail parts, every capitalised token |
| w2 | inflected form (Novákové, Kowalskiego, Müllers) | trained on base forms | propagation: once a name is ticked, its declined forms are ticked too (stem match per language) |
| w3 | later mention (surname alone, initials) | a bare "Huber" looks like a word | propagation across the document and the matter |
| w4 | no cue context (table, header, signature, ALL CAPS) | training always had a lead phrase ("represented by …") | candidate sources for upper-case lines and table cells; **persons fail closed** (unsure → ticked) |
| w5 | lookalike (Koch, Wolf, Král; "Huber & Partner") | genuinely ambiguous | GOWA's context, plus: a token that is part of a ticked name elsewhere is never dropped |
| w6 | boundary (multi-part names, addresses over lines) | classifies spans as given | span merging: adjacent name / address parts become one finding |
| w8 | fixed shape (IBAN, e-mail, phone, IDs, date of birth) | — | patterns with checksums; **never decided by the model** |
| w9 | foreign name in the document | name lists are per language | all supported languages' name lists in every document |

Two errors are counted separately because they are the ones that hurt:
- **dangerous drop**: a candidate that GOWA confidently classified "not personal data", so it disappeared. Gate: 0.
- **regression**: hidden by version 1 (no model), not hidden with GOWA. Gate: 0. Switching GOWA on must never make the check worse.

## Outcomes per entity
- **hidden**: ticked findings cover all of it
- **partial**: part of it stays visible (counts as a leak)
- **shown**: found but unticked; the lawyer sees it and decides
- **missed**: nothing found, so nobody is prompted to look (the dangerous case)

## Release gate (proposal; the founder signs off the numbers)
- fixed shapes hidden ≥ 99%
- persons **missed** ≤ 1%
- persons hidden ≥ 95% in **every** language
- lookalikes wrongly hidden ≤ 10% (usability: over-redaction makes the AI's answer useless)
- dangerous drops = 0, regressions vs version 1 = 0

The switch `decide.tasks.redaction` stays off by default until the gate passes on this set **and** on a second set written by someone other than the author of the first one.

## The gold set
`gold/<lang>.jsonl`, fictional documents only (no real persons, no client data), in DE/AT, EN, CS, SK, PL, RO, FR, HU, with inline markup:

    [[KIND|tags|surface text]]     KIND: PERSON ORG ADDRESS ID IBAN EMAIL PHONE DATE OTHER, NOT (lookalike that must stay), OPT (either is fine)

IDs carry valid checksums (`make_ids.py`); `validate_gold.py` checks markup, checksums and the hard-case quotas. **Gold errors corrupt the gate**: every document is re-read once only to look for unmarked personal data, and a second person reviews a sample before the numbers count.

The test set is kept apart from training: no gold document or template ever goes into GOWA's training data (otherwise the gate measures memory, not ability).

## Run

    node models/gowa/eval/redaction/run.js                                  # version 1 + the candidate ceiling
    node models/gowa/eval/redaction/run.js --model <release folder>         # + GOWA (on Colab / the RTX 3060)
    node models/gowa/eval/redaction/run.js --model <dir> --list drops --list missed --out report.md

Modes: `v1` (version 1 alone), `candidates` (everything any source proposes = the ceiling GOWA can reach), `gowa`. Exit code 1 when the gate fails.
