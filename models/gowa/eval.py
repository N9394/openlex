#!/usr/bin/env python3
"""Evaluate a decision model per task and language, with a results table.

    # the exported GOWA files (what the engine runs)
    python eval.py --onnx release/gowa-small-v0 --data data/test/*.jsonl --out eval/results
    # any System One endpoint on the same items (local Kev; Jev only with public data)
    python eval.py --remote http://127.0.0.1:8009 --model kev-4b --data data/test/*.jsonl --out eval/kev

Metrics per task × language (DE, EN, CS, SK, PL, RO, HU, FR and any other
language present): n, accuracy, macro-F1 (noul/choice), mean absolute error
in levels (score), expected calibration error, and coverage — the share of
decisions that can be automated with at most 2% / 5% wrong among them (Kev's
"automatable at 5% error"). Writes results.json and results.md.
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

from gowa import format as fmt
from gowa.data import LANGS, answer_index, read_jsonl
from gowa.model import ece, threshold_for
from gowa.register import Register


def question_of(ex):
    return {"type": ex["type"], "instructions": ex.get("instructions", ""), **({"criteria": ex["criteria"]} if "criteria" in ex else {})}


class OnnxModel:
    def __init__(self, folder: str, threads: int = 4):
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self.np = np
        self.cfg = json.loads((Path(folder) / "gowa-model.json").read_text())
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(str(Path(folder) / "model.onnx"), opts, providers=["CPUExecutionProvider"])
        self.names = {i.name for i in self.sess.get_inputs()}
        tok = AutoTokenizer.from_pretrained(folder)
        self.encode = lambda t: tok(t, add_special_tokens=False)["input_ids"]
        self.name = f"gowa-{self.cfg.get('version', '?')}"

    def answer(self, ex):
        q = question_of(ex)
        s = fmt.build_sequence(ex["state"], q, self.encode, self.cfg["markers"], self.cfg["max_length"])
        feeds = {"input_ids": [s.ids], "attention_mask": [[1] * len(s.ids)], "option_index": [s.option_index], "decide_index": [s.decide_index]}
        lg = self.sess.run(None, {k: self.np.array(v, dtype=self.np.int64) for k, v in feeds.items() if k in self.names})[0][0]
        t = self.cfg.get("temperatures", {}).get(ex["task"]) or self.cfg["temperature"]
        p = fmt.softmax([float(x) for x in lg], t)
        return p


class RemoteModel:
    """Any System One endpoint (POST /v1/systemone)."""

    def __init__(self, url: str, model: str, key: str | None = None):
        self.url, self.model, self.key = url.rstrip("/"), model, key
        self.name = model

    def answer(self, ex):
        q = question_of(ex)
        body = json.dumps({"state": ex["state"], "model": self.model, "questions": {"q": q}}).encode()
        req = urllib.request.Request(f"{self.url}/v1/systemone", body, {"content-type": "application/json", **({"authorization": f"Bearer {self.key}"} if self.key else {})})
        with urllib.request.urlopen(req, timeout=120) as r:
            a = json.loads(r.read())["answers"]["q"]
        if a["type"] == "noul":
            return [a["noul"], 1 - a["noul"]]
        keys = fmt.option_keys(q)
        return [float(a["probabilities"].get(k, 0.0)) for k in keys]


def macro_f1(golds, preds, k):
    f1s = []
    for c in range(k):
        tp = sum(1 for g, p in zip(golds, preds) if g == c and p == c)
        fp = sum(1 for g, p in zip(golds, preds) if g != c and p == c)
        fn = sum(1 for g, p in zip(golds, preds) if g == c and p != c)
        if tp + fp + fn == 0:
            continue
        f1s.append(2 * tp / (2 * tp + fp + fn))
    return sum(f1s) / len(f1s) if f1s else 0.0


def metrics(items):
    golds = [it["gold"] for it in items]
    preds = [max(range(len(it["p"])), key=lambda i: it["p"][i]) for it in items]
    conf = [max(it["p"]) for it in items]
    ok = [g == p for g, p in zip(golds, preds)]
    out = {"n": len(items), "accuracy": round(sum(ok) / len(ok), 4), "ece": ece(conf, ok)}
    if items[0]["type"] == "score":
        out["mae_levels"] = round(sum(abs(sum(i * x for i, x in enumerate(it["p"])) - it["gold"]) for it in items) / len(items), 4)
    else:
        out["macro_f1"] = round(macro_f1(golds, preds, max(len(it["p"]) for it in items)), 4)
    for budget in (0.02, 0.05):
        th = threshold_for(conf, ok, budget, min_n=20)
        out[f"coverage@{int(budget * 100)}%"] = th["coverage"]
    return out


def table(results, name):
    langs = [l for l in LANGS if any(l in r for r in results.values())] + sorted({l for r in results.values() for l in r if l not in LANGS and l != "all"})
    lines = [f"# Results — {name}", "", "Accuracy (n) per task and language; last columns over all languages: macro-F1 or level error, ECE, coverage at 2% / 5% error.", ""]
    head = "| task | " + " | ".join(l.upper() for l in langs) + " | all | F1 / MAE | ECE | cov@2% | cov@5% |"
    lines += [head, "|" + "---|" * (len(langs) + 6)]
    for task, r in sorted(results.items()):
        cells = [f"{r[l]['accuracy']:.2f} ({r[l]['n']})" if l in r else "—" for l in langs]
        a = r["all"]
        f1 = a.get("macro_f1", a.get("mae_levels", "—"))
        lines.append(f"| {task} | " + " | ".join(cells) + f" | {a['accuracy']:.2f} ({a['n']}) | {f1} | {a['ece']} | {a['coverage@2%']} | {a['coverage@5%']} |")
    return "\n".join(lines) + "\n"


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", nargs="+", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--onnx", help="folder with model.onnx, tokenizer and gowa-model.json")
    g.add_argument("--remote", help="System One endpoint URL")
    p.add_argument("--model", default="kev-latest")
    p.add_argument("--key", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--limit", type=int, default=0, help="at most N items per file (quick runs)")
    a = p.parse_args(argv)

    reg = Register()
    m = OnnxModel(a.onnx) if a.onnx else RemoteModel(a.remote, a.model, a.key)
    groups = defaultdict(lambda: defaultdict(list))
    for path in a.data:
        for i, ex in enumerate(read_jsonl(path, reg)):
            if a.limit and i >= a.limit:
                break
            item = {"gold": answer_index(ex), "p": m.answer(ex), "type": ex["type"]}
            groups[ex["task"]][ex.get("lang") or "?"].append(item)
            groups[ex["task"]]["all"].append(item)
    results = {task: {lang: metrics(items) for lang, items in by.items()} for task, by in groups.items()}
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps({"model": m.name, "results": results}, indent=2))
    (out / "results.md").write_text(table(results, m.name))
    print(table(results, m.name))


if __name__ == "__main__":
    main()
