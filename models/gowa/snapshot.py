"""Export the latest training checkpoint as a usable model while training continues.

Watches <run>/checkpoint-last; each time it changes, builds a <snapshot>/final folder from the
checkpoint (encoder, head, tokenizer, gowa-train.json — not calibrated yet: temperature 1.0 and
no automate thresholds, so nothing is automated with a snapshot), exports one ONNX variant, and
replaces <dest> with it (written to <dest>.tmp first, then swapped, so <dest> is never half written).

    python snapshot.py --run /content/drive/MyDrive/openlex-gowa/runs/gowa-small-v0b \\
        --dest /content/drive/MyDrive/openlex-gowa/latest --variant fp16 --watch
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import torch
from transformers import AutoTokenizer

from gowa import format as fmt
from gowa.model import GowaModel


def build_final(run: Path, work: Path) -> int:
    """Turn <run>/checkpoint-last into <work>/final (export_onnx's input). Returns the step."""
    state = torch.load(run / "checkpoint-last" / "state.pt", map_location="cpu", weights_only=False)
    args = state["args"]
    tok = AutoTokenizer.from_pretrained(run / "tokenizer")
    markers = fmt.marker_ids(tok)
    model = GowaModel.from_pretrained(args["base"], len(tok))
    model.load_state_dict(state["model"])
    model.eval()
    final = work / "final"
    shutil.rmtree(final, ignore_errors=True)
    (final / "encoder").mkdir(parents=True)
    model.encoder.save_pretrained(final / "encoder")
    torch.save(model.head_state(), final / "head.pt")
    tok.save_pretrained(final / "tokenizer")
    meta = {
        "format": fmt.FORMAT, "version": "v0-snapshot", "base": args["base"], "base_revision": args.get("revision"),
        "max_length": args["max_len"], "markers": markers, "unk": tok.unk_token_id or 0,
        "temperature": 1.0, "temperatures": {}, "thresholds": {}, "max_error": args.get("max_error"),
        "head_dim": model.q.out_features, "hidden": model.q.in_features, "trained_on": [], "steps": state["step"],
        "snapshot": True, "note": "uncalibrated mid-training snapshot: nothing is automated with it",
    }
    (final / "gowa-train.json").write_text(json.dumps(meta, indent=2))
    return int(state["step"])


def export(work: Path, dest: Path, variant: str, check: list[str]) -> None:
    out = work / "release"
    shutil.rmtree(out, ignore_errors=True)
    cmd = [sys.executable, "export_onnx.py", "--run", str(work), "--out", str(out), "--variant", variant, "--allow-divergence"]
    if check:
        cmd += ["--check-data", *check]
    subprocess.run(cmd, check=True)
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(out, tmp)
    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run", required=True)
    p.add_argument("--dest", required=True, help="folder that always holds the latest snapshot (replaced each time)")
    p.add_argument("--work", default="/tmp/gowa-snapshot")
    p.add_argument("--variant", default="fp16")
    p.add_argument("--check-data", nargs="*", default=[])
    p.add_argument("--watch", action="store_true", help="keep watching until <run>/final exists")
    p.add_argument("--every", type=int, default=60, help="seconds between checks")
    a = p.parse_args(argv)
    run, dest, work = Path(a.run), Path(a.dest), Path(a.work)
    last = None
    while True:
        ck = run / "checkpoint-last" / "state.pt"
        if ck.exists() and ck.stat().st_mtime != last:
            time.sleep(10)  # let the atomic swap and Drive sync settle
            last = ck.stat().st_mtime
            try:
                step = build_final(run, work)
                export(work, dest, a.variant, a.check_data)
                (dest / "SNAPSHOT.txt").write_text(f"step {step}, exported {time.strftime('%Y-%m-%d %H:%M:%S')} ({a.variant}, uncalibrated)\n")
                print(f"snapshot: step {step} → {dest}", flush=True)
            except Exception as err:  # keep watching; the next checkpoint may work
                print(f"snapshot failed: {err}", flush=True)
        if not a.watch or (run / "final").exists():
            break
        time.sleep(a.every)


if __name__ == "__main__":
    main()
