# GOWA task evaluation

Gold sets and one runner for the five decision tasks besides redaction
(`sidecar/src/decide_tasks.js`). Each task is off by default; a task switches on
only when GOWA passes its gates here.

```
node models/gowa/eval/tasks/run.js                          # gold check + rules + oracle
node models/gowa/eval/tasks/run.js --model /path/release    # + GOWA
  --task injection,routing  --lang de,cs  --out report.md  --json report.json  --list wrong
```

The runner calls the same functions as the app (`injectionSignal`, `routeRequest`,
`clauseTypes`, `claimSupport`, `rerank`), so windows, prompts and thresholds are
measured together with the model. No GPU needed: a CPU runs all five in minutes.

| task | gold (8 languages) | what is scored | gates |
|---|---|---|---|
| injection | 240 passages: 96 with instructions to an AI (hidden, exfiltration, tool calls, fake system messages, persuasion, mixed language), 144 without (80 hard: orders to humans, texts about AI rules) | share of injections flagged; share of ordinary text flagged | flagged ≥ 80%, false flags ≤ 3% |
| routing | 224 messages, 4 per route per language (clear, hard, short, informal, no diacritics) | confident answers right; how often confident | right ≥ 95% when confident, confident on ≥ 50% |
| clause_type | 240 clauses, all 21 types + other; 99 hard (no heading, misleading heading, keyword traps, near types) | confident answers right; overall vs the keyword rules (`clauses.classify`) | right ≥ 90% when confident, better than the rules |
| claim_support | 224 claim/source pairs, 56 per answer, mostly near misses (numbers, negation, scope, party, combined, same topic) | dangerous = confident "supported" for an unsupported or uncovered claim | dangerous ≤ 2%, right ≥ 90% when confident |
| relevance | 80 queries × 6 law passages, hard distractors first (search order nDCG@3 0.40) | nDCG@3 after reranking vs the search order | gain ≥ +0.05, worse on ≤ 20% of queries |

The gates are proposals until the founder signs them off (OPEN_QUESTIONS).

## Modes

- **gold**: format check; any problem makes the run exit 1.
- **rules**: the app without GOWA, where there is a rule (clause types: 56.7% overall;
  it was 42.9% before Polish and Hungarian keywords were added on 2026-11-24).
- **oracle**: a perfect model built from the gold answers. It must reach 100%; anything
  less is a plumbing or gold bug, not a model result.
- **gowa**: the release folder given by `--model`.

## Rules for editing the gold

- Never train on these files. Each language follows the same scenarios, adapted
  to local law, so a model could learn the template.
- Synthetic text only: fictional parties, example.com addresses, no client data.
- relevance: the oracle only says relevant or not, so within a query every
  `rel: 2` passage must come before the `rel: 1` passage, or the oracle drops below 1.000.
- The oracle finds an item by the first 200 characters of its text (and claim / query);
  two items must not share both.
- Written by one author without a native check. A native read of cs, sk, pl, ro and hu is
  still open; known judgement calls: scope generalisations are `partly` (claim_support),
  "has the Supreme Court ruled on X" is `research` (routing), fixed term plus extension
  option is `term` (clause_type). Some figures in relevance passages (VAT thresholds and
  rates, SK consumer act numbers) change often and were right as of 2025–26.
