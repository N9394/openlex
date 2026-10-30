"""Training examples for GOWA: one JSON object per line.

    {"task": "clause_type", "lang": "en", "source": "cuad", "type": "choice",
     "state": "...", "instructions": "...", "criteria": {"liability": "...", ...},
     "answer": "liability", "split": "train"}

- task:    one of TASKS (the engine's task families; temperatures and
           thresholds are fitted per task)
- type:    noul | choice | score
- answer:  noul → true/false; choice → the option key; score → the level index
- source:  an id from datasets.yaml with include: true (checked on load)
- lang:    ISO 639-1 (de, en, cs, sk, pl, ro, hu, fr, ...)

Never client data: every example names a public source from the register.
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Iterable, Iterator

from .format import option_keys
from .register import Register

TASKS = ["redaction", "injection", "claim_support", "clause_type", "relevance", "routing", "in_force", "general"]
LANGS = ["de", "en", "cs", "sk", "pl", "ro", "hu", "fr"]


def answer_index(ex: dict) -> int:
    t = ex["type"]
    if t == "noul":
        return 0 if ex["answer"] in (True, "yes", 1) else 1
    if t == "score":
        i = int(ex["answer"])
        if not 0 <= i < len(ex["criteria"]):
            raise ValueError("score answer out of range")
        return i
    keys = option_keys(ex)
    if str(ex["answer"]) not in keys:
        raise ValueError(f"answer {ex['answer']!r} is not an option")
    return keys.index(str(ex["answer"]))


def validate(ex: dict, register: Register | None = None) -> dict:
    for k in ("task", "type", "state", "answer", "source"):
        if k not in ex:
            raise ValueError(f"example without {k}")
    if ex["task"] not in TASKS:
        raise ValueError(f"unknown task {ex['task']}")
    if ex["type"] not in ("noul", "choice", "score"):
        raise ValueError(f"unknown type {ex['type']}")
    if ex["type"] != "noul" and not ex.get("criteria"):
        raise ValueError("choice/score need criteria")
    if register is not None:
        register.require(ex["source"])
    answer_index(ex)
    return ex


def read_jsonl(path: str | Path, register: Register | None = None) -> Iterator[dict]:
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            if not line.strip():
                continue
            ex = json.loads(line)
            try:
                yield validate(ex, register)
            except ValueError as e:
                raise ValueError(f"{path}:{n}: {e}") from None


def write_jsonl(path: str | Path, rows: Iterable[dict]) -> int:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            n += 1
    return n


def shuffle_options(ex: dict, rng: random.Random) -> dict:
    """Kev-style augmentation: choice options in random order (scores keep their order)."""
    if ex["type"] != "choice":
        return ex
    crit = ex["criteria"]
    items = list(crit.items()) if isinstance(crit, dict) else [(k, None) for k in crit]
    rng.shuffle(items)
    return {**ex, "criteria": dict(items)}


def split_examples(rows: list[dict], held_out: float = 0.1, seed: int = 13) -> tuple[list[dict], list[dict]]:
    """Use an explicit "split" when given; otherwise a seeded random held-out share (for calibration and eval)."""
    rng = random.Random(seed)
    train, held = [], []
    for r in rows:
        s = r.get("split")
        if s in ("test", "validation", "dev", "heldout"):
            held.append(r)
        elif s == "train":
            train.append(r)
        else:
            (held if rng.random() < held_out else train).append(r)
    return train, held
