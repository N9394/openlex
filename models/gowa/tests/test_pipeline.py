"""Unit tests for the pipeline pieces that need no GPU and no downloads.

    cd models/gowa && python -m pytest tests -q
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from gowa import format as fmt  # noqa: E402
from gowa.data import answer_index, split_examples, validate  # noqa: E402
from gowa.register import NotCleared, Register, parse, problems  # noqa: E402

M = {"pad": 0, "cls": 1, "sep": 2, "state": 3, "question": 4, "opt_open": 5, "opt_close": 6, "decide": 7}


def enc(t):
    return [100 + len(w) for w in t.split()]


def test_twin_cases_still_match():
    data = json.loads((Path(__file__).with_name("twin_cases.json")).read_text())
    vocab = data["vocab"]
    e = lambda t: [vocab[w] for w in t.lower().split()]  # noqa: E731
    for c in data["cases"]:
        s = fmt.build_sequence(c["state"], c["question"], e, data["markers"], c["max_len"])
        assert s.ids == c["ids"]
        assert fmt.answer_from(c["question"], c["logits"], c["temperature"]) == c["answer"]


def test_sequence_layout_and_truncation():
    s = fmt.build_sequence("a b c " * 50, {"type": "noul", "instructions": "x"}, enc, M, 32)
    assert len(s.ids) == 32 and s.truncated
    assert s.ids[s.decide_index] == M["decide"]
    assert all(s.ids[i] == M["opt_close"] for i in s.option_index)
    with pytest.raises(ValueError):
        fmt.build_sequence("x", {"type": "noul", "instructions": "w " * 40}, enc, M, 32)


def test_kev_formulas():
    ch = fmt.answer_from({"type": "choice", "criteria": ["a", "b", "c"]}, [0, math.log(8), 0])
    assert ch["choice"] == "b" and abs(ch["confidence"] - (0.8 - 1 / 3) / (2 / 3)) < 1e-3
    sc = fmt.answer_from({"type": "score", "criteria": ["l", "m", "h"]}, [0, 0, math.log(8)])
    assert abs(sc["score"] - 1.7) < 1e-3 and abs(sc["confidence"] - 0.85) < 1e-3


def test_register_is_valid_and_refuses_excluded_sources():
    reg = Register()
    reg.require("cuad")
    for bad in ("contract_nli", "ai4privacy", "client_documents", "nope", "lextreme", "lextreme/swiss_judgment_prediction"):
        with pytest.raises(NotCleared):
            reg.require(bad)
    entries = parse("datasets:\n  - id: x\n    name: x\n    kind: dataset\n    source: s\n    licence: CC-BY-NC-4.0\n    commercial: no\n    include: yes\n    tasks: []\n    reason: r\n")
    assert any("non-commercial" in p for p in problems(entries))


def test_examples_validate_against_register():
    reg = Register()
    ex = {"task": "routing", "type": "choice", "state": "x", "criteria": {"a": None, "b": None}, "answer": "b", "source": "openlex_seed"}
    assert answer_index(validate(ex, reg)) == 1
    with pytest.raises(NotCleared):
        validate({**ex, "source": "contract_nli"}, reg)
    with pytest.raises(ValueError):
        validate({**ex, "answer": "z"}, reg)
    tr, ho = split_examples([{**ex, "split": "test"}, {**ex, "split": "train"}])
    assert len(tr) == 1 and len(ho) == 1


def test_calibration_helpers():
    torch = pytest.importorskip("torch")  # noqa: F841
    from gowa.model import ece, fit_temperature, threshold_for

    # Over-confident logits → the fitted temperature is above 1.
    rows = [[8.0, 0.0]] * 70 + [[0.0, 8.0]] * 30
    answers = [0] * 100
    assert fit_temperature(rows, answers) > 1.0
    conf = [0.99] * 90 + [0.6] * 10
    ok = [True] * 89 + [False] + [False] * 5 + [True] * 5
    th = threshold_for(conf, ok, 0.02)
    assert th["threshold"] == 0.99 and th["coverage"] == 0.9
    assert ece([1.0, 1.0], [True, True]) == 0.0
