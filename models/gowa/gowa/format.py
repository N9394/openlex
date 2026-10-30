"""GOWA input format and answer maths — the Python twin of
sidecar/src/gowa_format.js. Both must produce the same token ids for the
same question and the same probabilities for the same logits; the test
tests/test_format.py and sidecar/test/gowa_twin.test.js check that.

One sequence per question (Kev-style pointer head):

    [CLS] <state> state ... <q> instructions <opt> option 1 </opt> <opt> option 2 </opt> ... <decide> [SEP]

Each text piece is tokenized on its own, without special tokens, and the
pieces are concatenated with the marker ids in between (exactly what the
engine does at run time).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Callable, Sequence

MAX_OPTIONS = 255
NOUL_OPTIONS = ["yes", "no"]
MARKER_TOKENS = {"state": "<state>", "question": "<q>", "opt_open": "<opt>", "opt_close": "</opt>", "decide": "<decide>"}
FORMAT = "gowa-decision-v1"


def state_text(state) -> str:
    if isinstance(state, str):
        return state
    return json.dumps(state, ensure_ascii=False, separators=(",", ":"))


def options_of(q: dict, noul_options: Sequence[str] = NOUL_OPTIONS) -> list[str]:
    """Option texts in order: noul → yes/no; choice → "key: description" or "key"; score → the levels."""
    t = q["type"]
    if t == "noul":
        return list(noul_options)[:2]
    if t == "choice":
        crit = q["criteria"]
        if isinstance(crit, list):
            crit = {str(k): None for k in crit}
        return [f"{k}: {d}" if d else str(k) for k, d in crit.items()]
    if t == "score":
        return [str(c) for c in q["criteria"]]
    raise ValueError(f"unknown question type {t}")


def option_keys(q: dict) -> list[str]:
    t = q["type"]
    if t == "choice":
        crit = q["criteria"]
        return [str(k) for k in (crit if isinstance(crit, list) else crit.keys())]
    if t == "score":
        return [str(i) for i in range(len(q["criteria"]))]
    return list(NOUL_OPTIONS)


@dataclass
class Sequence_:
    ids: list[int]
    option_index: list[int]
    decide_index: int
    truncated: bool


def build_sequence(state, question: dict, encode: Callable[[str], list[int]], markers: dict, max_len: int = 512) -> Sequence_:
    m = markers
    opts = options_of(question)
    if not opts:
        raise ValueError("a question needs at least one option")
    if len(opts) > MAX_OPTIONS:
        raise ValueError(f"at most {MAX_OPTIONS} options")
    tail = [m["question"], *encode(str(question.get("instructions") or ""))]
    option_rel = []
    for o in opts:
        tail += [m["opt_open"], *encode(o), m["opt_close"]]
        option_rel.append(len(tail) - 1)
    tail.append(m["decide"])
    decide_rel = len(tail) - 1
    tail.append(m["sep"])
    head = [m["cls"], m["state"]]
    room = max_len - len(head) - len(tail)
    if room < 1:
        raise ValueError("the question and its options are too long for the model")
    st = question.get("state", state)
    state_ids = encode(state_text(st))
    truncated = len(state_ids) > room
    state_ids = state_ids[:room]
    at = len(head) + len(state_ids)
    return Sequence_(ids=head + state_ids + tail, option_index=[at + i for i in option_rel], decide_index=at + decide_rel, truncated=truncated)


def softmax(logits: Sequence[float], temperature: float = 1.0) -> list[float]:
    t = temperature if temperature and temperature > 0 else 1.0
    z = [x / t for x in logits]
    mx = max(z)
    e = [math.exp(x - mx) for x in z]
    s = sum(e)
    return [x / s for x in e]


def _r4(x: float) -> float:
    # Same rounding as the engine (Math.round(x * 1e4) / 1e4 rounds half up).
    return math.floor(x * 1e4 + 0.5) / 1e4


def answer_from(question: dict, logits: Sequence[float], temperature: float = 1.0) -> dict:
    p = softmax(logits, temperature)
    k = len(p)
    if question["type"] == "noul":
        return {"type": "noul", "noul": _r4(p[0])}
    best = max(range(k), key=lambda i: (p[i], -i))
    keys = option_keys(question)
    probs = {key: _r4(p[i]) for i, key in enumerate(keys)}
    if question["type"] == "choice":
        conf = max(0.0, (p[best] - 1 / k) / (1 - 1 / k)) if k > 1 else 1.0
        return {"type": "choice", "choice": keys[best], "probabilities": probs, "confidence": _r4(conf)}
    score = sum(i * x for i, x in enumerate(p))
    spread = sum(x * abs(i - best) for i, x in enumerate(p))
    conf = max(0.0, 1 - spread / (k - 1)) if k > 1 else 1.0
    legend = {str(i): c for i, c in enumerate(question["criteria"])}
    return {"type": "score", "score": _r4(score), "legend": legend, "probabilities": probs, "confidence": _r4(conf)}


def marker_ids(tokenizer) -> dict:
    """Marker ids from a tokenizer that has the GOWA special tokens added."""
    ids = {k: tokenizer.convert_tokens_to_ids(v) for k, v in MARKER_TOKENS.items()}
    cls = tokenizer.cls_token_id if tokenizer.cls_token_id is not None else tokenizer.bos_token_id
    sep = tokenizer.sep_token_id if tokenizer.sep_token_id is not None else tokenizer.eos_token_id
    pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else 0
    unk = tokenizer.unk_token_id if tokenizer.unk_token_id is not None else 0
    out = {**ids, "cls": cls, "sep": sep, "pad": pad}
    for k, v in out.items():
        if v is None or v < 0 or (k in MARKER_TOKENS and v == unk):
            raise ValueError(f"tokenizer has no id for marker {k}")
    return out


def add_markers(tokenizer) -> int:
    """Add the GOWA marker tokens as special tokens. Returns how many were new."""
    return tokenizer.add_special_tokens({"additional_special_tokens": list(MARKER_TOKENS.values())}, replace_additional_special_tokens=False)
