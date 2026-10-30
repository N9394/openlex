#!/usr/bin/env python3
"""Write tests/twin_cases.json: questions run through gowa/format.py with a
simple word-level encoder. sidecar/test/gowa_twin.test.js runs the same
cases through the engine's gowa_format.js and must get identical ids and
answers. Re-run after changing the format:  python tests/make_twin_cases.py"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from gowa import format as fmt  # noqa: E402

MARKERS = {"pad": 0, "cls": 1, "sep": 2, "state": 3, "question": 4, "opt_open": 5, "opt_close": 6, "decide": 7}
VOCAB: dict[str, int] = {}


def encode(text):
    out = []
    for w in re.findall(r"\S+", text.lower()):
        if w not in VOCAB:
            VOCAB[w] = 100 + len(VOCAB)
        out.append(VOCAB[w])
    return out


CASES = [
    ("Der Vertrag unterliegt österreichischem Recht.", {"type": "noul", "instructions": "Ist österreichisches Recht gewählt?"}, 64, [1.3, -0.4], 1.7),
    ("The cap is EUR 100,000.", {"type": "choice", "instructions": "Which clause type?", "criteria": {"liability": "limits or excludes liability", "payment": None, "other": None}}, 64, [2.0, 0.5, -1.0], 1.2),
    ("Nájemce platí nájemné měsíčně.", {"type": "score", "instructions": "Jak rizikové?", "criteria": ["nízké", "střední", "vysoké"]}, 64, [0.1, 1.5, 0.3], 0.8),
    ("word " * 80, {"type": "choice", "instructions": "pick", "criteria": ["a", "b"]}, 24, [0.0, 0.0], 1.0),
    ({"party": "Alpenbau", "amount": 5000}, {"type": "noul", "instructions": "Is there an amount?"}, 64, [3.0, -3.0], 2.0),
]

out = []
for state, q, max_len, logits, temp in CASES:
    s = fmt.build_sequence(state, q, encode, MARKERS, max_len)
    out.append({"state": state, "question": q, "max_len": max_len, "ids": s.ids, "option_index": s.option_index, "decide_index": s.decide_index,
                "truncated": s.truncated, "logits": logits, "temperature": temp, "answer": fmt.answer_from(q, logits, temp)})
Path(__file__).with_name("twin_cases.json").write_text(json.dumps({"markers": MARKERS, "vocab": VOCAB, "cases": out}, ensure_ascii=False, indent=1))
print(f"{len(out)} cases written")
