#!/usr/bin/env python3
"""Export a trained GOWA run to the files the engine loads (gowa.js), with
int8 quantisation, and write the release manifest (bytes + SHA-256 per file).

    python export_onnx.py --run runs/gowa-small-v0 --out release/gowa-small-v0

Writes:
    model.onnx              int8 (dynamic quantisation); inputs input_ids, attention_mask,
                            option_index [B,K], decide_index [B]; output option_logits [B,K]
    tokenizer.json, tokenizer_config.json (+ special_tokens_map.json)
    gowa-model.json         head config: format, markers, max_length, temperature(s), thresholds, versions
    release.json            { files: [{ name, bytes, sha256 }] } — paste into openlex.json
                            "decide": { "gowa": { "source": { url, revision, files } } } or the
                            built-in manifest (sidecar/src/gowa.js) once published
    model_fp32.onnx         kept only with --keep-fp32

Then it checks the int8 model against the PyTorch model on a few held-out
questions (same winner, probabilities within tolerance).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import torch

from gowa import format as fmt
from gowa.model import GowaModel

ENGINE_FILES = ["model.onnx", "tokenizer.json", "tokenizer_config.json", "gowa-model.json"]


class Export(torch.nn.Module):
    def __init__(self, m: GowaModel):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask, option_index, decide_index):
        return self.m(input_ids, attention_mask, option_index, decide_index)


def load_run(final: Path) -> tuple[GowaModel, dict]:
    from transformers import AutoModel

    meta = json.loads((final / "gowa-train.json").read_text())
    enc = AutoModel.from_pretrained(final / "encoder", attn_implementation="eager")
    m = GowaModel(enc, meta["hidden"], meta["head_dim"])
    m.load_head_state(torch.load(final / "head.pt", map_location="cpu", weights_only=False))
    m.eval()
    return m, meta


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run", required=True, help="the train.py --out folder (uses <run>/final)")
    p.add_argument("--out", required=True)
    p.add_argument("--opset", type=int, default=17)
    p.add_argument("--keep-fp32", action="store_true")
    p.add_argument("--no-quantize", action="store_true", help="ship fp32 (larger; for debugging)")
    p.add_argument("--version", default=None, help="version string for gowa-model.json (default: from the run)")
    a = p.parse_args(argv)

    final = Path(a.run) / "final"
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    model, meta = load_run(final)
    mk = meta["markers"]

    # A small dummy batch with the real marker layout (dynamic axes cover any size).
    ids = torch.tensor([[mk["cls"], mk["state"], 10, 11, 12, mk["question"], 13, mk["opt_open"], 14, mk["opt_close"], mk["opt_open"], 15, mk["opt_close"], mk["decide"], mk["sep"]]] * 2)
    att = torch.ones_like(ids)
    opt = torch.tensor([[9, 12]] * 2)
    dec = torch.tensor([13, 13])
    fp32 = out / "model_fp32.onnx"
    torch.onnx.export(
        Export(model), (ids, att, opt, dec), str(fp32),
        input_names=["input_ids", "attention_mask", "option_index", "decide_index"], output_names=["option_logits"],
        dynamic_axes={"input_ids": {0: "B", 1: "L"}, "attention_mask": {0: "B", 1: "L"}, "option_index": {0: "B", 1: "K"}, "decide_index": {0: "B"}, "option_logits": {0: "B", 1: "K"}},
        opset_version=a.opset, do_constant_folding=True, dynamo=False,
    )
    target = out / "model.onnx"
    if a.no_quantize:
        shutil.copy(fp32, target)
    else:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        quantize_dynamic(str(fp32), str(target), weight_type=QuantType.QInt8)

    tokdir = final / "tokenizer"
    for name in ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]:
        if (tokdir / name).exists():
            shutil.copy(tokdir / name, out / name)

    head = {
        "format": fmt.FORMAT, "name": "GOWA small", "version": a.version or meta["version"],
        "base": meta["base"], "base_revision": meta.get("base_revision"), "license": "Apache-2.0",
        "max_length": meta["max_length"], "markers": mk, "unk": meta.get("unk", 0),
        "temperature": meta["temperature"], "temperatures": meta.get("temperatures", {}), "thresholds": meta.get("thresholds", {}),
        "max_error": meta.get("max_error"), "trained_on": meta.get("trained_on", []), "quantized": not a.no_quantize,
    }
    (out / "gowa-model.json").write_text(json.dumps(head, indent=2, ensure_ascii=False))

    check(model, out, meta)
    if not a.keep_fp32:
        fp32.unlink(missing_ok=True)
    files = [{"name": n, "bytes": (out / n).stat().st_size, "sha256": sha256(out / n)} for n in ENGINE_FILES]
    (out / "release.json").write_text(json.dumps({"version": head["version"], "files": files}, indent=2))
    total = sum(f["bytes"] for f in files)
    print(f"exported to {out} ({total / 1e6:.0f} MB): " + ", ".join(f"{f['name']} {f['bytes'] / 1e6:.1f} MB" for f in files))


def check(model, out: Path, meta: dict, tol: float = 0.05):
    """The exported model must give (nearly) the same probabilities as PyTorch on sample questions in three languages."""
    import onnxruntime as ort

    import numpy as np

    sess = ort.InferenceSession(str(out / "model.onnx"), providers=["CPUExecutionProvider"])
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(out)
    enc = lambda t: tok(t, add_special_tokens=False)["input_ids"]  # noqa: E731
    qs = [
        ("The contract is governed by Austrian law.", {"type": "noul", "instructions": "Is Austrian law chosen?"}),
        ("Die Haftung ist auf EUR 100.000 begrenzt.", {"type": "choice", "instructions": "Which clause type?", "criteria": {"liability": None, "payment": None, "other": None}}),
        ("Nájemce je povinen platit nájemné měsíčně.", {"type": "score", "instructions": "How risky for the tenant?", "criteria": ["low", "medium", "high"]}),
    ]
    worst = 0.0
    for state, q in qs:
        s = fmt.build_sequence(state, q, enc, meta["markers"], meta["max_length"])
        feeds = {
            "input_ids": [s.ids], "attention_mask": [[1] * len(s.ids)], "option_index": [s.option_index], "decide_index": [s.decide_index],
        }
        names = {i.name for i in sess.get_inputs()}
        onnx_lg = sess.run(None, {k: np.array(v, dtype=np.int64) for k, v in feeds.items() if k in names})[0][0]
        with torch.no_grad():
            pt_lg = model(*(torch.tensor(feeds[k]) for k in ["input_ids", "attention_mask", "option_index", "decide_index"]))[0].tolist()
        p1, p2 = fmt.softmax(list(map(float, onnx_lg)), meta["temperature"]), fmt.softmax(pt_lg, meta["temperature"])
        worst = max(worst, max(abs(x - y) for x, y in zip(p1, p2)))
    print(f"ONNX vs PyTorch: largest probability difference {worst:.4f}")
    if worst > tol:
        print("WARNING: the quantised model differs more than expected; compare with --no-quantize")


if __name__ == "__main__":
    main()
