# OpenLex LegalBench leaderboard

Twenty everyday tasks of a lawyer: routing a question into a law search in the jurisdiction's own language (AT, SK, RO, CZ, US, UK), short legal answers, clause extraction to JSON, contract risk spotting, cross-jurisdiction comparison, and not calling tools for small talk. See [README.md](README.md) for the method and how to add a model.

| # | Model | Where | Objective | Routing | Answer | Clause | Risk | Cross | Edge | Judge (accuracy / language / format, 1–5) | Median latency | Hardware | Date |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Lotus 2 (lotus-2-reasoning, Q4_K_M, 4B) | local | **100%** | 100% | 100% | 100% | 100% | 100% | 100% | 3.60 / 4.00 / 4.30 | 8.9 s | AMD RX 5700 XT 8 GB | 2026-08-13 |
| 2 | Lotus 2 (lotus-2-reasoning, Q4_K_M, 4B) | local | **100%** | 100% | 100% | 100% | 100% | 100% | 100% | — | 8.4 s | Apple M-series, 8 GB | 2026-10-12 |
| 3 | Qwen3.5 9B | cloud | **91%** | 89% | 83% | 100% | 100% | 100% | 100% | 3.80 / 4.65 / 4.50 | 2.3 s | hosted | 2026-08-13 |
| 4 | Lotus 1 (lotus-ai, Q4_K_M, 4B) | local | **85%** | 94% | 100% | 0% | 100% | 100% | 100% | 2.90 / 3.75 / 3.05 | 11.0 s | AMD RX 5700 XT 8 GB | 2026-08-13 |

Objective scores are deterministic (tool call made, queries in the right language, valid JSON, no tool on small talk). For answer, risk and cross cases the objective check only verifies that an answer was given; legal quality is measured by the LLM judge. Latency depends on the hardware listed.
