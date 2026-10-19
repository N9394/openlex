# LegalBench (OpenLex)

A small, open benchmark of everyday legal work for language models, especially the small local models a law firm can run on its own machines. The results are in [LEADERBOARD.md](LEADERBOARD.md).

## What it measures

The 20 cases are in [cases.json](cases.json), in six categories:

| Category | Cases | Objective check |
|---|---|---|
| routing | AT, SK, RO, CZ, US, UK questions | Exactly one `search_legal_database` call with at least 2 queries, written in the jurisdiction's language (checked by diacritics) |
| answer | Short statutory answers in 6 jurisdictions | An answer was given (the judge grades the substance) |
| clause | Clause → JSON (EN, DE) | Valid JSON with `parties`, `obligations`, `prohibitions`, `values`, `durations` |
| risk | Contract risk for the client, with a fix | An answer was given (judge) |
| cross | AT vs DE, SK vs CZ comparisons | An answer was given (judge) |
| edge | Small talk | No tool call |

- The **objective** score is deterministic and reproducible. It measures tool use, language discipline and format: the things that decide whether a model works inside an agent.
- The **judge** score (optional) has a strong model grade each response 1–5 on legal accuracy, language/terminology and format. That is where legal quality shows.

A model can score 100% objective and still give weaker answers than a bigger model. Read both columns.

## Add a model

Any OpenAI-compatible endpoint works: llama.cpp, Ollama, vLLM, LM Studio, OpenRouter, OpenAI, Mistral, Anthropic's OpenAI-compatible API, and others.

```bash
node run.mjs --endpoint http://127.0.0.1:8080/v1 --model my-model --name my-model \
  --label "My Model 7B Q4_K_M" --runtime "llama.cpp b11560 CUDA" --hardware "RTX 3060 12 GB"
node judge.mjs --name my-model --endpoint https://openrouter.ai/api/v1 --model qwen/qwen3.5-122b-a10b --key-env OPENROUTER_API_KEY   # optional
node leaderboard.mjs
```

Open a pull request with `results/<name>.jsonl`, `results/<name>.meta.json` and the regenerated `LEADERBOARD.md`. The judge model must be stated in the meta file. Compare judge scores only between runs that used the same judge.

## Limits

Twenty cases is a smoke test, not a certification. Cases skew toward Central and Eastern European corporate law, where OpenLex started. More cases, especially for retrieval (whether the right section is in the top 5), are planned. See the OpenLex plan, Phase 6.
