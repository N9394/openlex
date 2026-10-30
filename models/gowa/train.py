#!/usr/bin/env python3
"""Train GOWA: mmBERT-small + one decision head, multi-task over every
OpenLex task family (one head, many question types).

    python train.py --data data/*.jsonl --out runs/gowa-small-v0

Runs on an RTX 3060 (12 GB) or a Colab GPU. Checkpoints every --save-every
steps to <out>/checkpoint-last (atomic), so a Colab session that ends can
resume with the same command. At the end it fits a temperature (global and
per task) on the held-out examples, picks a per-task threshold for
"automate" at the chosen error budget, and writes <out>/final/ for
export_onnx.py.

Smoke test without downloading the encoder weights (only the tokenizer):
    python train.py --data seed/*.jsonl --out /tmp/gowa-smoke --tiny --max-steps 20
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset

from gowa import format as fmt
from gowa.data import answer_index, read_jsonl, shuffle_options, split_examples
from gowa.model import GowaModel, ece, fit_temperature, masked_logits, threshold_for
from gowa.register import Register

VERSION = "v0"


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", nargs="+", required=True, help="JSONL example files (see gowa/data.py)")
    p.add_argument("--out", required=True, help="run folder (checkpoints, final model)")
    p.add_argument("--base", default="jhu-clsp/mmBERT-small", help="encoder (Hugging Face id or folder)")
    p.add_argument("--revision", default=None, help="pin the encoder revision (recommended)")
    p.add_argument("--tokenizer", default=None, help="tokenizer (default: --base)")
    p.add_argument("--tiny", action="store_true", help="random tiny encoder with the real tokenizer (smoke tests; no weights download)")
    p.add_argument("--max-len", type=int, default=512)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--grad-accum", type=int, default=2)
    p.add_argument("--epochs", type=float, default=2.0)
    p.add_argument("--max-steps", type=int, default=0, help="stop after N optimiser steps (0 = by epochs)")
    p.add_argument("--lr", type=float, default=3e-5, help="encoder learning rate")
    p.add_argument("--head-lr", type=float, default=1e-3)
    p.add_argument("--warmup", type=float, default=0.06)
    p.add_argument("--held-out", type=float, default=0.1, help="share held out for calibration and eval when examples carry no split")
    p.add_argument("--max-error", type=float, default=0.02, help="error budget among automated answers, for the per-task thresholds")
    p.add_argument("--save-every", type=int, default=500)
    p.add_argument("--bf16", action="store_true", help="bfloat16 autocast (Ampere GPUs: RTX 3060, A100, L4)")
    p.add_argument("--grad-ckpt", action="store_true", help="gradient checkpointing (less memory)")
    p.add_argument("--seed", type=int, default=13)
    p.add_argument("--workers", type=int, default=2)
    return p.parse_args(argv)


class Examples(Dataset):
    def __init__(self, rows, encode, markers, max_len, train, seed):
        self.rows, self.encode, self.markers, self.max_len, self.train = rows, encode, markers, max_len, train
        self.rng = random.Random(seed)

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        ex = self.rows[i]
        if self.train:
            ex = shuffle_options(ex, self.rng)
        q = {"type": ex["type"], "instructions": ex.get("instructions", ""), **({"criteria": ex["criteria"]} if "criteria" in ex else {})}
        s = fmt.build_sequence(ex["state"], q, self.encode, self.markers, self.max_len)
        return {"ids": s.ids, "opt": s.option_index, "dec": s.decide_index, "y": answer_index(ex), "task": ex["task"], "lang": ex.get("lang", "")}


def collate(batch, pad):
    L = max(len(b["ids"]) for b in batch)
    K = max(len(b["opt"]) for b in batch)
    ids = torch.full((len(batch), L), pad, dtype=torch.long)
    att = torch.zeros((len(batch), L), dtype=torch.long)
    opt = torch.zeros((len(batch), K), dtype=torch.long)
    for i, b in enumerate(batch):
        ids[i, : len(b["ids"])] = torch.tensor(b["ids"])
        att[i, : len(b["ids"])] = 1
        opt[i] = torch.tensor(b["opt"] + [b["dec"]] * (K - len(b["opt"])))
    return {
        "input_ids": ids, "attention_mask": att, "option_index": opt,
        "decide_index": torch.tensor([b["dec"] for b in batch]),
        "counts": torch.tensor([len(b["opt"]) for b in batch]),
        "y": torch.tensor([b["y"] for b in batch]),
        "task": [b["task"] for b in batch], "lang": [b["lang"] for b in batch],
    }


def tiny_encoder(tok, max_len):
    from transformers import ModernBertConfig, ModernBertModel

    cfg = ModernBertConfig(
        vocab_size=len(tok), hidden_size=64, intermediate_size=128, num_hidden_layers=2, num_attention_heads=2,
        max_position_embeddings=max(max_len, 512), pad_token_id=tok.pad_token_id or 0,
        bos_token_id=tok.bos_token_id or tok.cls_token_id or 0, eos_token_id=tok.eos_token_id or tok.sep_token_id or 0,
        cls_token_id=tok.cls_token_id or tok.bos_token_id or 0, sep_token_id=tok.sep_token_id or tok.eos_token_id or 0,
        global_attn_every_n_layers=1, local_attention=128,
    )
    return ModernBertModel(cfg)


def save_checkpoint(path: Path, model, opt, sched, step, epoch_pos, args):
    tmp = path.with_name(path.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "step": step, "epoch_pos": epoch_pos,
                "rng": random.getstate(), "torch_rng": torch.get_rng_state(), "args": vars(args)}, tmp / "state.pt")
    shutil.rmtree(path, ignore_errors=True)
    os.replace(tmp, path)


@torch.no_grad()
def predict(model, loader, device, bf16):
    model.eval()
    rows = []
    for b in loader:
        with torch.autocast(device.type, dtype=torch.bfloat16, enabled=bf16 and device.type == "cuda"):
            lg = model(b["input_ids"].to(device), b["attention_mask"].to(device), b["option_index"].to(device), b["decide_index"].to(device))
        lg = lg.float().cpu()
        for i in range(lg.size(0)):
            k = int(b["counts"][i])
            rows.append({"logits": lg[i, :k].tolist(), "y": int(b["y"][i]), "task": b["task"][i], "lang": b["lang"][i]})
    model.train()
    return rows


def calibrate(rows, max_error):
    """Global and per-task temperatures, per-task thresholds and a short report."""
    T = fit_temperature([r["logits"] for r in rows], [r["y"] for r in rows])
    by_task = defaultdict(list)
    for r in rows:
        by_task[r["task"]].append(r)
    temps, thresholds, report = {}, {}, {}
    for task, rs in by_task.items():
        t = fit_temperature([r["logits"] for r in rs], [r["y"] for r in rs]) if len(rs) >= 50 else T
        temps[task] = t
        conf, ok = [], []
        for r in rs:
            p = fmt.softmax(r["logits"], t)
            best = max(range(len(p)), key=lambda i: p[i])
            conf.append(p[best])
            ok.append(best == r["y"])
        th = threshold_for(conf, ok, max_error)
        thresholds[task] = th["threshold"]
        report[task] = {"n": len(rs), "accuracy": round(sum(ok) / len(ok), 4), "ece": ece(conf, ok), "temperature": t, **{f"automate_{k}": v for k, v in th.items()}}
    return T, temps, thresholds, report


def main(argv=None):
    args = parse_args(argv)
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    reg = Register()
    rows = [ex for path in args.data for ex in read_jsonl(path, reg)]
    if not rows:
        sys.exit("no examples")
    train_rows, held_rows = split_examples(rows, args.held_out, args.seed)
    print(f"examples: {len(train_rows)} train, {len(held_rows)} held out; sources: {sorted({r['source'] for r in rows})}")

    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(args.tokenizer or args.base, revision=None if args.tokenizer else args.revision)
    fmt.add_markers(tok)
    markers = fmt.marker_ids(tok)
    tok.save_pretrained(out / "tokenizer")

    def encode(text):
        return tok(text, add_special_tokens=False)["input_ids"]

    if args.tiny:
        model = GowaModel(tiny_encoder(tok, args.max_len), 64, 32)
    else:
        model = GowaModel.from_pretrained(args.base, len(tok), attn_implementation="sdpa")
        if args.revision:
            print(f"encoder {args.base}@{args.revision}")
    if args.grad_ckpt and hasattr(model.encoder, "gradient_checkpointing_enable"):
        model.encoder.gradient_checkpointing_enable()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    train_ds = Examples(train_rows, encode, markers, args.max_len, True, args.seed)
    held_ds = Examples(held_rows, encode, markers, args.max_len, False, args.seed)
    col = lambda b: collate(b, markers["pad"])  # noqa: E731
    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True, collate_fn=col, num_workers=args.workers if device.type == "cuda" else 0, drop_last=False)
    held_dl = DataLoader(held_ds, batch_size=args.batch * 2, shuffle=False, collate_fn=col)

    steps_per_epoch = max(1, math.ceil(len(train_dl) / args.grad_accum))
    total = args.max_steps or max(1, int(steps_per_epoch * args.epochs))
    head = [p for n, p in model.named_parameters() if not n.startswith("encoder.")]
    enc = [p for n, p in model.named_parameters() if n.startswith("encoder.")]
    opt = torch.optim.AdamW([{"params": enc, "lr": args.lr}, {"params": head, "lr": args.head_lr}], weight_decay=0.01)
    warm = max(1, int(total * args.warmup))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: (s + 1) / warm if s < warm else max(0.0, (total - s) / max(1, total - warm)))

    step, start_pos = 0, 0
    ck = out / "checkpoint-last"
    if (ck / "state.pt").exists():
        st = torch.load(ck / "state.pt", map_location="cpu", weights_only=False)
        model.load_state_dict(st["model"])
        opt.load_state_dict(st["opt"])
        sched.load_state_dict(st["sched"])
        step, start_pos = st["step"], st.get("epoch_pos", 0)
        random.setstate(st["rng"])
        torch.set_rng_state(st["torch_rng"])
        print(f"resumed at step {step}")

    loss_fn = torch.nn.CrossEntropyLoss()
    model.train()
    t0 = time.time()
    micro = 0
    done = step >= total
    while not done:
        for pos, b in enumerate(train_dl):
            if start_pos and pos < start_pos:
                continue  # roughly skip what the previous session saw in this epoch (the order is reshuffled)
            with torch.autocast(device.type, dtype=torch.bfloat16, enabled=args.bf16 and device.type == "cuda"):
                lg = model(b["input_ids"].to(device), b["attention_mask"].to(device), b["option_index"].to(device), b["decide_index"].to(device))
            loss = loss_fn(masked_logits(lg.float(), b["counts"].to(device)), b["y"].to(device)) / args.grad_accum
            loss.backward()
            micro += 1
            if micro % args.grad_accum:
                continue
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            if step % 20 == 0 or step == 1:
                print(f"step {step}/{total} loss {loss.item() * args.grad_accum:.4f} ({time.time() - t0:.0f}s)", flush=True)
            if step % args.save_every == 0:
                save_checkpoint(ck, model, opt, sched, step, pos + 1, args)
            if step >= total:
                done = True
                break
        start_pos = 0

    # ── calibration on the held-out set ──
    rows_out = predict(model, held_dl, device, args.bf16) if len(held_ds) else []
    T, temps, thresholds, report = calibrate(rows_out, args.max_error) if rows_out else (1.0, {}, {}, {})
    final = out / "final"
    shutil.rmtree(final, ignore_errors=True)
    (final / "encoder").mkdir(parents=True)
    model.encoder.save_pretrained(final / "encoder")
    torch.save(model.head_state(), final / "head.pt")
    tok.save_pretrained(final / "tokenizer")
    meta = {
        "format": fmt.FORMAT, "version": VERSION, "base": args.base if not args.tiny else "tiny-random (smoke test)",
        "base_revision": args.revision, "max_length": args.max_len, "markers": markers, "unk": tok.unk_token_id or 0,
        "temperature": T, "temperatures": temps, "thresholds": thresholds, "max_error": args.max_error,
        "head_dim": model.q.out_features, "hidden": model.q.in_features,
        "trained_on": sorted({r["source"] for r in rows}), "examples": {"train": len(train_rows), "held_out": len(held_rows)}, "steps": step,
    }
    (final / "gowa-train.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    (final / "calibration.json").write_text(json.dumps(report, indent=2))
    with open(final / "heldout_predictions.jsonl", "w") as f:
        for r in rows_out:
            f.write(json.dumps(r) + "\n")
    shutil.rmtree(ck, ignore_errors=True)
    print(f"done: {final}  temperature {T}  per task: {json.dumps(report)}")


if __name__ == "__main__":
    main()
