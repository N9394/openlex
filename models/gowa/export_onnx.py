#!/usr/bin/env python3
"""Export a trained GOWA run to the files the engine loads (gowa.js), with
int8 quantisation that is checked against the PyTorch model, and write the
release manifest (bytes + SHA-256 per file).

    python export_onnx.py --run runs/gowa-small-v0 --out release/gowa-small-v0 \\
        --check-data data/seed.jsonl data/cuad.jsonl ...

Writes:
    model.onnx              inputs input_ids, attention_mask, option_index [B,K],
                            decide_index [B]; output option_logits [B,K]
    tokenizer.json, tokenizer_config.json (+ special_tokens_map.json)
    gowa-model.json         head config: format, markers, max_length, temperature(s), thresholds, versions
    release.json            { files: [{ name, bytes, sha256 }] } — paste into openlex.json
                            "decide": { "gowa": { "source": { url, revision, files } } } or the
                            built-in manifest (sidecar/src/gowa.js) once published
    export_report.json      every variant tried: size, max / mean probability difference and
                            argmax agreement against PyTorch fp32 on held-out questions
    model_fp32.onnx         kept only with --keep-fp32

Quantisation variants (--variant; "auto" tries them smallest first and keeps
the smallest that passes the check):

    int8                    ONNX Runtime dynamic int8, per tensor, everything incl. the
                            embedding table (the old default; diverged on mmBERT)
    int8-pc                 shape pre-processing + per-channel int8 on every MatMul and the embedding
    int8-pc-emb8row         per-channel int8 MatMuls; embedding table int8 with one scale per
                            row (token), dequantised after the lookup
    int8-pc-emb8row-head32  as above, the decision head's two projections kept fp32
    int8-pc-emb16           per-channel int8 MatMuls; embedding table fp16 (cast after the lookup)
    int8-pc-emb16-head32    as above, head kept fp32
    int8-pc-emb32           per-channel int8 MatMuls; embedding table fp32
    fp32                    no quantisation

The check is a hard failure: the shipped model must agree with PyTorch on
the winning option for at least --min-agreement of the held-out questions
(default 99.5 %) with no probability more than --max-diff away (default
0.05). --allow-divergence ships anyway (debugging only).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import shutil
import sys
from pathlib import Path

import torch

from gowa import format as fmt
from gowa.data import read_jsonl
from gowa.model import GowaModel

ENGINE_FILES = ["model.onnx", "tokenizer.json", "tokenizer_config.json", "gowa-model.json"]
VARIANTS = ["int8", "int8-pc", "int8-pc-emb8row", "int8-pc-emb8row-head32", "int8-pc-emb16", "int8-pc-emb16-head32", "int8-pc-emb32", "fp16", "fp32"]
# "auto" tries these in this order (roughly smallest first) and keeps the first that passes.
AUTO_ORDER = ["int8-pc", "int8-pc-emb8row", "int8-pc-emb8row-head32", "int8-pc-emb16", "int8-pc-emb16-head32", "fp16", "int8-pc-emb32", "fp32"]
HEAD_NODE_RE = re.compile(r"^/m/(q|k)/")  # the decision head's two Linear layers in the exported graph


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


# ── graph helpers ─────────────────────────────────────────────────────────


def _embedding_gather(model):
    """The Gather node that looks up token embeddings: data input is a 2-D float initializer with the most rows."""
    from onnx import TensorProto

    inits = {i.name: i for i in model.graph.initializer}
    best = None
    for n in model.graph.node:
        if n.op_type != "Gather" or n.input[0] not in inits:
            continue
        t = inits[n.input[0]]
        if t.data_type == TensorProto.FLOAT and len(t.dims) == 2 and (best is None or t.dims[0] > inits[best.input[0]].dims[0]):
            best = n
    return best, (inits[best.input[0]] if best is not None else None)


def _head_nodes(path: Path) -> list[str]:
    import onnx

    m = onnx.load(str(path), load_external_data=False)
    return [n.name for n in m.graph.node if HEAD_NODE_RE.match(n.name) and n.op_type in ("MatMul", "Gemm")]


def _rewrite_embedding(path: Path, mode: str):
    """Store the embedding table as fp16 ("fp16") or int8 with one symmetric scale per row ("int8row"),
    and turn the lookup back into fp32 right after the Gather (only the looked-up rows are converted)."""
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    m = onnx.load(str(path))
    g, init = _embedding_gather(m)
    if g is None:
        raise RuntimeError("embedding Gather not found")
    w = numpy_helper.to_array(init).astype(np.float32)
    out = g.output[0]
    nodes = list(m.graph.node)
    at = nodes.index(g)
    m.graph.initializer.remove(init)
    if mode == "fp16":
        m.graph.initializer.append(numpy_helper.from_array(w.astype(np.float16), init.name + "_fp16"))
        g.input[0] = init.name + "_fp16"
        g.output[0] = out + "_fp16"
        new = [helper.make_node("Cast", [out + "_fp16"], [out], to=TensorProto.FLOAT, name=g.name + "_to_fp32")]
    elif mode == "int8row":
        scale = np.maximum(np.abs(w).max(axis=1), 1e-12) / 127.0
        q = np.clip(np.rint(w / scale[:, None]), -127, 127).astype(np.int8)
        m.graph.initializer.append(numpy_helper.from_array(q, init.name + "_int8"))
        m.graph.initializer.append(numpy_helper.from_array(scale.astype(np.float32), init.name + "_scale"))
        m.graph.initializer.append(numpy_helper.from_array(np.array([-1], dtype=np.int64), init.name + "_axis"))
        ids = g.input[1]
        g.input[0] = init.name + "_int8"
        g.output[0] = out + "_int8"
        new = [
            helper.make_node("Cast", [out + "_int8"], [out + "_f"], to=TensorProto.FLOAT, name=g.name + "_to_fp32"),
            helper.make_node("Gather", [init.name + "_scale", ids], [out + "_s"], axis=0, name=g.name + "_scale"),
            helper.make_node("Unsqueeze", [out + "_s", init.name + "_axis"], [out + "_s1"], name=g.name + "_scale_unsq"),
            helper.make_node("Mul", [out + "_f", out + "_s1"], [out], name=g.name + "_dequant"),
        ]
    else:
        raise ValueError(mode)
    for i, n in enumerate(new):
        nodes.insert(at + 1 + i, n)
    del m.graph.node[:]
    m.graph.node.extend(nodes)
    onnx.checker.check_model(m)
    onnx.save(m, str(path))


def build_variant(variant: str, fp32: Path, pre: Path | None, target: Path):
    """Write `variant` of the fp32 graph to `target`."""
    if variant == "fp32":
        shutil.copy(fp32, target)
        return
    if variant == "fp16":
        # All weights in float16, inputs/outputs kept float32 (half the size, usually near-lossless).
        # The converter can leave a Cast whose declared output type no longer matches (ORT refuses to load
        # "Type (tensor(float16)) of output arg ... does not match expected type (tensor(float))"), so Cast
        # nodes stay float32; if a graph still doesn't load, LayerNorm/Softmax-type ops stay float32 too.
        import onnx
        import onnxruntime as ort
        from onnxconverter_common import float16
        base = list(float16.DEFAULT_OP_BLOCK_LIST)
        for block in (base + ["Cast"], base + ["Cast", "LayerNormalization", "Softmax", "ReduceMean", "Pow", "Sqrt", "Erf"]):
            m = float16.convert_float_to_float16(onnx.load(str(fp32)), keep_io_types=True, op_block_list=block)
            onnx.save(m, str(target))
            try:
                ort.InferenceSession(str(target), providers=["CPUExecutionProvider"])
                return
            except Exception as e:
                print(f"fp16 graph did not load with op_block_list +{block[len(base):]}: {str(e)[:200]}")
        raise RuntimeError("fp16 conversion produced no loadable graph")
    from onnxruntime.quantization import QuantType, quantize_dynamic

    if variant == "int8":
        quantize_dynamic(str(fp32), str(target), weight_type=QuantType.QInt8)
        return
    src = pre or fp32
    exclude = _head_nodes(src) if variant.endswith("-head32") else []
    ops = ["MatMul", "Gather"] if variant == "int8-pc" else ["MatMul"]  # otherwise the embedding is handled below (or left fp32)
    quantize_dynamic(str(src), str(target), weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=ops, nodes_to_exclude=exclude,
                     extra_options={"MatMulConstBOnly": True})
    if "-emb8row" in variant:
        _rewrite_embedding(target, "int8row")
    elif "-emb16" in variant:
        _rewrite_embedding(target, "fp16")


def preprocess(fp32: Path, out: Path) -> Path | None:
    """ONNX Runtime's recommended pre-quantisation pass (shape inference + graph optimisation)."""
    from onnxruntime.quantization.shape_inference import quant_pre_process

    for skip_symbolic in (False, True):
        try:
            quant_pre_process(str(fp32), str(out), skip_symbolic_shape=skip_symbolic)
            return out
        except Exception as e:  # symbolic shape inference can fail on some graphs; retry without it
            print(f"pre-processing (skip_symbolic_shape={skip_symbolic}) failed: {str(e)[:200]}")
    return None


# ── the check ─────────────────────────────────────────────────────────────

BUILTIN = [
    ("The contract is governed by Austrian law.", {"type": "noul", "instructions": "Is Austrian law chosen?"}, ""),
    ("Die Haftung ist auf EUR 100.000 begrenzt.", {"type": "choice", "instructions": "Which clause type?", "criteria": {"liability": None, "payment": None, "other": None}}, ""),
    ("Nájemce je povinen platit nájemné měsíčně.", {"type": "score", "instructions": "How risky for the tenant?", "criteria": ["low", "medium", "high"]}, ""),
]


def check_questions(paths: list[str], n: int, seed: int = 13) -> list[tuple]:
    """Questions for the check: the built-in three, then held-out examples (split test/validation) first, then the rest."""
    held, rest = [], []
    for p in paths:
        for ex in read_jsonl(p):
            q = {"type": ex["type"], "instructions": ex.get("instructions", ""), **({"criteria": ex["criteria"]} if "criteria" in ex else {})}
            (held if ex.get("split") in ("test", "validation", "dev", "heldout") else rest).append((ex["state"], q, ex["task"]))
    rng = random.Random(seed)
    rng.shuffle(held)
    rng.shuffle(rest)
    return list(BUILTIN) + (held + rest)[: max(0, n - len(BUILTIN))]


def reference(model, meta, enc, questions):
    """PyTorch fp32 logits per question (one at a time, like the engine)."""
    feeds, ref = [], []
    for state, q, _task in questions:
        s = fmt.build_sequence(state, q, enc, meta["markers"], meta["max_length"])
        f = {"input_ids": [s.ids], "attention_mask": [[1] * len(s.ids)], "option_index": [s.option_index], "decide_index": [s.decide_index]}
        feeds.append(f)
        with torch.no_grad():
            ref.append(model(*(torch.tensor(f[k]) for k in ["input_ids", "attention_mask", "option_index", "decide_index"]))[0].tolist())
    return feeds, ref


def compare(path: Path, feeds, ref, questions, meta) -> dict:
    """Max / mean probability difference and argmax agreement of an ONNX file against the PyTorch logits."""
    import numpy as np
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 4
    sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
    names = {i.name for i in sess.get_inputs()}
    worst, total, count, agree = 0.0, 0.0, 0, 0
    for f, pt, (_s, _q, task) in zip(feeds, ref, questions):
        lg = sess.run(None, {k: np.array(v, dtype=np.int64) for k, v in f.items() if k in names})[0][0]
        t = meta.get("temperatures", {}).get(task) or meta["temperature"]
        p1, p2 = fmt.softmax([float(x) for x in lg], t), fmt.softmax(pt, t)
        d = [abs(x - y) for x, y in zip(p1, p2)]
        worst = max(worst, max(d))
        total += sum(d)
        count += len(d)
        agree += int(max(range(len(p1)), key=p1.__getitem__) == max(range(len(p2)), key=p2.__getitem__))
    return {"bytes": path.stat().st_size, "max_diff": round(worst, 5), "mean_diff": round(total / max(1, count), 6),
            "agreement": round(agree / max(1, len(feeds)), 5), "n": len(feeds)}


def passes(r: dict, min_agreement: float, max_diff: float) -> bool:
    return r["agreement"] >= min_agreement and r["max_diff"] <= max_diff


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run", required=True, help="the train.py --out folder (uses <run>/final)")
    p.add_argument("--out", required=True)
    p.add_argument("--opset", type=int, default=17)
    p.add_argument("--variant", default="auto", choices=["auto", "all", *VARIANTS],
                   help="quantisation variant; auto = smallest that passes; all = measure every variant, then ship the smallest that passes")
    p.add_argument("--no-quantize", action="store_true", help="same as --variant fp32")
    p.add_argument("--check-data", nargs="*", default=None, help="JSONL examples for the check (default: the seed examples)")
    p.add_argument("--check-n", type=int, default=400, help="questions in the check")
    p.add_argument("--min-agreement", type=float, default=0.995)
    p.add_argument("--max-diff", type=float, default=0.05)
    p.add_argument("--allow-divergence", action="store_true", help="ship even if the check fails (debugging only)")
    p.add_argument("--keep-fp32", action="store_true")
    p.add_argument("--version", default=None, help="version string for gowa-model.json (default: from the run)")
    a = p.parse_args(argv)
    if a.no_quantize:
        a.variant = "fp32"

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
    work = out / "_variants"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    fp32 = out / "model_fp32.onnx"
    torch.onnx.export(
        Export(model), (ids, att, opt, dec), str(fp32),
        input_names=["input_ids", "attention_mask", "option_index", "decide_index"], output_names=["option_logits"],
        dynamic_axes={"input_ids": {0: "B", 1: "L"}, "attention_mask": {0: "B", 1: "L"}, "option_index": {0: "B", 1: "K"}, "decide_index": {0: "B"}, "option_logits": {0: "B", 1: "K"}},
        opset_version=a.opset, do_constant_folding=True, dynamo=False,
    )

    tokdir = final / "tokenizer"
    for name in ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]:
        if (tokdir / name).exists():
            shutil.copy(tokdir / name, out / name)
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(out)
    enc = lambda t: tok(t, add_special_tokens=False)["input_ids"]  # noqa: E731
    check_paths = a.check_data or sorted(str(x) for x in (Path(__file__).resolve().parent / "seed").glob("*.jsonl"))
    questions = check_questions(check_paths, a.check_n)
    feeds, ref = reference(model, meta, enc, questions)
    print(f"check: {len(questions)} questions from {len(check_paths)} file(s), against PyTorch fp32")

    order = VARIANTS if a.variant == "all" else AUTO_ORDER if a.variant == "auto" else [a.variant]
    pre = preprocess(fp32, work / "pre.onnx") if any(v.startswith("int8-pc") for v in order) else None
    report, chosen = {}, None
    for v in order:
        path = work / f"{v}.onnx"
        try:
            build_variant(v, fp32, pre, path)
            r = compare(path, feeds, ref, questions, meta)
        except Exception as e:  # a variant that cannot be built is reported, not fatal
            report[v] = {"error": str(e)[:300]}
            print(f"  {v:<24} failed to build: {str(e)[:200]}")
            continue
        r["passes"] = passes(r, a.min_agreement, a.max_diff)
        report[v] = r
        print(f"  {v:<24} {r['bytes'] / 1e6:7.1f} MB  max diff {r['max_diff']:.4f}  mean diff {r['mean_diff']:.5f}  "
              f"argmax agreement {r['agreement'] * 100:.2f}%  {'PASS' if r['passes'] else 'fail'}", flush=True)
        if a.variant != "all" and r["passes"]:
            chosen = v
            break
    if a.variant == "all":
        ok = [v for v in report if report[v].get("passes")]
        chosen = min(ok, key=lambda v: report[v]["bytes"]) if ok else None
    summary = {"variants": report, "check_n": len(questions), "check_data": check_paths, "min_agreement": a.min_agreement, "max_diff": a.max_diff}
    if chosen is None:
        built = [v for v in order if "bytes" in report.get(v, {})]
        if not a.allow_divergence or not built:
            (out / "export_report.json").write_text(json.dumps({"chosen": None, **summary}, indent=2))
            sys.exit(f"export failed: no variant agrees with PyTorch (need argmax agreement >= {a.min_agreement} and max probability "
                     f"difference <= {a.max_diff}); see {out / 'export_report.json'}. --allow-divergence ships anyway.")
        chosen = built[-1]
        print(f"WARNING: shipping {chosen} although it fails the check (--allow-divergence)")
    shutil.copy(work / f"{chosen}.onnx", out / "model.onnx")
    print(f"chosen: {chosen}")

    head = {
        "format": fmt.FORMAT, "name": "GOWA small", "version": a.version or meta["version"],
        "base": meta["base"], "base_revision": meta.get("base_revision"), "license": "Apache-2.0",
        "max_length": meta["max_length"], "markers": mk, "unk": meta.get("unk", 0),
        "temperature": meta["temperature"], "temperatures": meta.get("temperatures", {}), "thresholds": meta.get("thresholds", {}),
        "max_error": meta.get("max_error"), "trained_on": meta.get("trained_on", []), "quantized": chosen != "fp32", "quantization": chosen,
    }
    (out / "gowa-model.json").write_text(json.dumps(head, indent=2, ensure_ascii=False))
    (out / "export_report.json").write_text(json.dumps({"chosen": chosen, **summary}, indent=2))
    shutil.rmtree(work, ignore_errors=True)
    if not a.keep_fp32:
        fp32.unlink(missing_ok=True)
    files = [{"name": n, "bytes": (out / n).stat().st_size, "sha256": sha256(out / n)} for n in ENGINE_FILES]
    (out / "release.json").write_text(json.dumps({"version": head["version"], "files": files}, indent=2))
    total = sum(f["bytes"] for f in files)
    print(f"exported to {out} ({total / 1e6:.0f} MB): " + ", ".join(f"{f['name']} {f['bytes'] / 1e6:.1f} MB" for f in files))


if __name__ == "__main__":
    main()
