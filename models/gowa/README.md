# GOWA — General OpenLex Worker Agent

GOWA is OpenLex's own decision model. It is small, it runs on the lawyer's computer, and it answers **typed questions about a text** instead of writing text:

- `noul`: yes or no, with the probability of yes
- `choice`: one of up to 255 options, with a probability for each
- `score`: a level on a rubric (lowest first), with the mean level and a confidence

The design is Kev/Jev-style (github.com/jaredpalmer/kev, the System One API). The base encoder is **mmBERT-small** (`jhu-clsp/mmBERT-small`, MIT, 140M parameters). On top of it sits **one decision head**, a pointer head: the state, the question and its options go into one sequence. The head scores each option's `</opt>` marker against the `<decide>` marker, and a fitted temperature turns those scores into calibrated probabilities. Each question gets one pass through the model.

```
[CLS] <state> the text … <q> instructions <opt> option 1 </opt> <opt> option 2 </opt> … <decide> [SEP]
```

There is **only one head** and no token tagger. Everything OpenLex does with GOWA is a typed question to that head. The harness (the engine) builds the questions and decides what happens with the answers.

| Task (engine switch) | Question | What happens with the answer |
|---|---|---|
| `redaction` | choice: person / organisation / address / ID number / other personal data / not personal data, for each candidate in its context | confident → ticked in the lawyer's redaction check; unsure → shown for review (`sidecar/src/redaction_v2.js`) |
| `injection` | noul: does this passage read like instructions to an AI? | a flag in the permission prompt, never a block (`untrusted.js`) |
| `claim_support` | choice: supported / partly / not supported / not covered | a **hint for the judge agent**, never a verdict, never a reason to skip the judge (`judge.js`) |
| `clause_type` | choice over the clause types | a label on the analysis card, with its confidence |
| `relevance` | noul: is this law passage relevant to the search? | reranks law search results |
| `routing` | choice: question / rewrite / review / research / files / firm / other | adds a prompt intent when confident |

Every task is **off** by default (`openlex.json` → `"decide": { "tasks": { … } }`). A task also needs a decision model. When a task is off or no model is available, the engine does exactly what it did before.

**Redaction, honestly.** GOWA can only classify candidates that something proposed. The candidate sources are the patterns, the matter's and the firm's lists, titles and legal forms, common first names per country, capitalised words, and GLiNER when it is installed. **A name with no clue at all depends on candidate generation.** Lower case, no title, no list entry and a first name we do not know means GOWA never sees it. The check finds candidates and suggests. The lawyer reviews. Nothing here anonymises a document or guarantees anything.

## Files

| File | What it does |
|---|---|
| `datasets.yaml` | **licence register**: each source with its licence, whether commercial use is allowed, include yes/no and the reason. Nothing is used unless it is listed with `include: yes`. |
| `check_datasets.py` | validates the register, and optionally every example's source |
| `gowa/format.py` | input format and answer maths, the Python twin of `sidecar/src/gowa_format.js` (a shared test keeps them identical) |
| `gowa/register.py`, `gowa/data.py`, `gowa/model.py` | register rules, example format, model + calibration (temperature, thresholds, ECE) |
| `convert.py` | public datasets → examples: CUAD, LEDGAR, UNFAIR-ToS, MultiEURLEX, cleared LEXTREME subsets, synthetic redaction and injection examples on public law texts, seed |
| `label_llm.py` | labels from an open LLM (Qwen3, Apache-2.0) on **public** law, court and contract-template texts. It refuses to run on a Mac and refuses any source that is not a cleared public corpus. |
| `train.py` | multi-task training of the one head on mmBERT-small. Checkpoints (resumable after a Colab disconnect), then temperature fitting and per-task thresholds on the held-out set |
| `export_onnx.py` | ONNX export + int8 quantisation, `gowa-model.json`, `release.json` (bytes + SHA-256 per file); checks ONNX against PyTorch |
| `eval.py` | results per task and language (DE, EN, CS, SK, PL, RO, HU, FR): accuracy, macro-F1 / level error, ECE, coverage at 2% / 5% error. Also runs against any System One endpoint (local Kev) on the same items |
| `train_colab.ipynb` | the whole pipeline on Colab |
| `seed/` | a few hand-written examples (invented names) |
| `tests/` | `python -m pytest tests -q` (no GPU, no downloads) |

## Licences (summary of `datasets.yaml`)

GOWA weights are meant to be published under Apache-2.0, so no non-commercial, unclear or client data goes in.

- **In:** mmBERT-small (MIT), CUAD (CC-BY-4.0), LexGLUE (CC-BY-4.0), MultiEURLEX (CC-BY-4.0), tasksource synthetic typed decisions (Apache-2.0), official law texts (EUR-Lex, RIS, Légifrance, the national gazettes), our own LLM labels on those texts, the seed examples.
- **Per task only:** LEXTREME. A subset is used only after its own licence has been checked and the subset added under `subsets`.
- **Out until cleared:** ContractNLI (NC on the HF mirror), ai4privacy (custom licence), LegalBench (varies per task, some NC), Kev's decision-v7 mix (unknown or restrictive parts), tasksource Jev typed decisions ("other"), MultiNLI (mixed), the Horizon injection data (pending a spot check).
- **Never:** client documents.

Attribution for the CC-BY sources goes into the model card when the weights are published.

## Run it end to end

### On Colab
Open `train_colab.ipynb` in Colab (File → Open notebook → GitHub → `N9394/openlex`, path `models/gowa/train_colab.ipynb`). Choose a GPU runtime and run the cells top to bottom. Checkpoints go to your Google Drive. When a session ends, re-run the training cell and it resumes.

### On the RTX 3060 box
```bash
cd models/gowa
python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python check_datasets.py
python convert.py seed --out data/seed.jsonl
python convert.py cuad --out data/cuad.jsonl
python convert.py ledgar --out data/ledgar.jsonl
python convert.py multi_eurlex --out data/multi_eurlex.jsonl --limit 5000
# optional, public texts only: label_llm.py claim_support / relevance / routing, convert.py redaction / injection
python train.py --data data/*.jsonl --out runs/gowa-small-v0 \
  --revision abc32620dd4f6ab06f5fbe905dc25f310618e09f --bf16 --grad-ckpt
python export_onnx.py --run runs/gowa-small-v0 --out release/gowa-small-v0
python eval.py --onnx release/gowa-small-v0 --data data/test/*.jsonl --out eval/gowa-small-v0
```
A smoke test with no encoder download (random tiny encoder, real tokenizer) takes about a minute:
`python train.py --data seed/*.jsonl --out /tmp/gowa-smoke --tiny --max-steps 20 --batch 4`.

Rough cost: mmBERT-small, 512 tokens, about 300k examples × 2 epochs takes about 2–3 hours on the RTX 3060. Generating labels with an 8B LLM is the bigger time cost.

### Use the model in OpenLex
Copy `model.onnx`, `tokenizer.json`, `tokenizer_config.json` and `gowa-model.json` into `<data folder>/models/gowa-small/`. Then:
```bash
openlex gowa status          # OpenLex model (GOWA): installed / not yet available, runtime, last run
openlex gowa on redaction    # switch a task on (tasks: openlex gowa tasks)
```
The engine needs its ONNX runtime. The desktop app bundles it; the CLI from Homebrew does not.

To publish a release, upload the release folder to Hugging Face. Pin the commit, and put `url` (with `{revision}` and `{file}`), `revision` and the `files` list from `release.json` into the manifest in `sidecar/src/gowa.js`, or into a firm's `openlex.json` → `"decide": { "gowa": { "source": { … } } }`. Every file is checked against its SHA-256 before it is used. Until then the engine shows "GOWA small v0 — not yet available".

## Calibration and "confident → automate, unsure → escalate"
`train.py` fits one temperature per task family on held-out examples. Then it picks, per task, the lowest probability at which at most 2% of the answers at or above it are wrong (`--max-error`), and reports the share of decisions this automates. These thresholds go into `gowa-model.json`. A firm can override them in `openlex.json` → `"decide": { "thresholds": { … } }`. With fewer than 30 held-out answers for a task, no threshold is trusted (1.0 means never automate). "Automate" means the result is applied and stays visible and reversible. "Escalate" means the lawyer, or the LLM judge, decides. The AI record logs each task call: task, model, number of decisions, how many were confident, and rounded confidences. It never logs content.
