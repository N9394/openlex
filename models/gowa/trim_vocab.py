#!/usr/bin/env python3
"""Trim GOWA's vocabulary to the languages OpenLex supports, so the model ships small.

mmBERT-small has a 256k-token vocabulary for 1,800+ languages: 256,000 x 384 ≈ 98M of its
~140M parameters are the token embedding table. OpenLex reads DE/AT, EN, CS, SK, PL, RO, FR
and HU documents, which use a small part of it. This keeps

    every special / added token (incl. the GOWA markers), the 256 byte-fallback tokens,
    the base characters of the Latin, Greek and Cyrillic scripts plus punctuation and symbols,
    every token the corpora use (--min-count times or more),
    the --keep-rank most common merges of the original tokenizer (general coverage), and
    the merge chain of every kept token (BPE only reaches a token through its merges),

and slices the embedding table to those rows. Text outside the kept vocabulary still
tokenizes (into smaller pieces, down to bytes); nothing becomes <unk>.

    python trim_vocab.py --run runs/gowa-small-v0b --out runs/gowa-small-v0b-trim \\
        --corpus data/corpus/*.jsonl --check-data data/heldout.jsonl

Writes <out>/final/ in the same layout as train.py (encoder/, head.pt, tokenizer/,
gowa-train.json), so export_onnx.py --run <out> works unchanged, plus <out>/trim_report.json:
kept tokens, parameters, how many held-out texts tokenize exactly as before, and the
agreement of the trimmed model with the original on --check-data.

--tokenizer-only skips the model (no torch needed): trims tokenizer.json and reports.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import sys
import unicodedata
from collections import Counter
from pathlib import Path

BYTE_RE = re.compile(r"^<0x[0-9A-F]{2}>$")
# Base characters kept even if the corpora never use them (Latin incl. extensions, Greek, Cyrillic,
# punctuation, currency, letterlike symbols, arrows, maths, box drawing, typographic quotes).
KEEP_RANGES = [(0x20, 0x7E), (0xA0, 0x24F), (0x1E00, 0x1EFF), (0x370, 0x3FF), (0x400, 0x4FF),
               (0x2000, 0x206F), (0x20A0, 0x20CF), (0x2100, 0x214F), (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2500, 0x257F)]
TEXT_KEYS = ("state", "text", "context", "content", "body")


def wanted_char(tok: str) -> bool:
    s = tok.replace("▁", "")
    if len(s) != 1:
        return tok == "▁"
    c = ord(s)
    return any(a <= c <= b for a, b in KEEP_RANGES)


def texts(paths: list[str], limit: int | None = None):
    """Text from JSONL (any of TEXT_KEYS, nested `state` dicts flattened) or plain text files."""
    n = 0
    for p in paths:
        with open(p, encoding="utf-8", errors="replace") as f:
            if not p.endswith((".jsonl", ".json")):
                for line in f:
                    if line.strip():
                        yield line
                        n += 1
                        if limit and n >= limit:
                            return
                continue
            for line in f:
                try:
                    ex = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for k in TEXT_KEYS:
                    v = ex.get(k) if isinstance(ex, dict) else None
                    if isinstance(v, dict):
                        v = "\n".join(str(x) for x in v.values() if isinstance(x, str))
                    if isinstance(v, str) and v.strip():
                        yield v
                        n += 1
                        if limit and n >= limit:
                            return
                if isinstance(ex, dict) and isinstance(ex.get("instructions"), str):
                    yield ex["instructions"]


def split_merge(m) -> tuple[str, str]:
    if isinstance(m, list):
        return m[0], m[1]
    a, b = m.split(" ", 1)
    return a, b


def trim_tokenizer(tj: dict, used: Counter, min_count: int, keep_rank: int, max_vocab: int | None = None) -> tuple[dict, list[int]]:
    """Return (new tokenizer.json, old ids in new order). New id i = old_ids[i].
    With max_vocab, the least used corpus tokens are dropped until the result (merge chains
    included) fits."""
    if max_vocab:
        ranked = [i for i, c in used.most_common() if c >= min_count]
        lo, hi, best = 0, len(ranked), None
        while lo <= hi:  # the largest prefix of the most used tokens that fits
            mid = (lo + hi) // 2
            r = trim_tokenizer(tj, Counter({i: min_count for i in ranked[:mid]}), min_count, keep_rank)
            if len(r[1]) <= max_vocab:
                best, lo = r, mid + 1
            else:
                hi = mid - 1
        if best is None:
            raise SystemExit(f"--max-vocab {max_vocab} is smaller than the fixed part of the vocabulary")
        return best
    model = tj["model"]
    assert model["type"] == "BPE", f"only BPE tokenizers are supported, got {model['type']}"
    vocab: dict[str, int] = model["vocab"]
    inv = {i: t for t, i in vocab.items()}
    added = {a["id"]: a["content"] for a in tj.get("added_tokens", [])}
    merges = [split_merge(m) for m in model["merges"]]

    keep: set[int] = set(added)  # every special / added token, markers included
    for t, i in vocab.items():
        if BYTE_RE.match(t) or wanted_char(t):
            keep.add(i)
    keep |= {i for i, c in used.items() if c >= min_count}
    producers: dict[str, list[tuple[str, str]]] = {}
    for a, b in merges:
        producers.setdefault(a + b, []).append((a, b))  # every merge that can build a token
    for a, b in merges[:keep_rank]:
        if a + b in vocab:
            keep.add(vocab[a + b])
    # Merge-chain closure: BPE reaches a token only through the merges that build it, and which
    # of them fires depends on the word around it, so the parts of every producing merge are kept.
    stack = [inv[i] for i in keep if i in inv]
    while stack:
        t = stack.pop()
        for pair in producers.get(t, ()):
            for part in pair:
                j = vocab.get(part)
                if j is not None and j not in keep:
                    keep.add(j)
                    stack.append(part)
    old_ids = sorted(keep)
    new = {o: n for n, o in enumerate(old_ids)}

    out = copy.deepcopy(tj)
    out["model"]["vocab"] = {inv[o]: new[o] for o in old_ids if o in inv}
    kept_tokens = out["model"]["vocab"]
    raw = model["merges"]
    out["model"]["merges"] = [m for m, (a, b) in zip(raw, merges) if a in kept_tokens and b in kept_tokens and (a + b) in kept_tokens]
    for a in out.get("added_tokens", []):
        a["id"] = new[a["id"]]
    pp = out.get("post_processor") or {}
    for proc in [pp, *pp.get("processors", [])]:
        for st in (proc.get("special_tokens") or {}).values():
            st["ids"] = [new[i] for i in st["ids"]]
    return out, old_ids


def count_used(tok, paths: list[str], limit: int | None) -> Counter:
    used: Counter = Counter()
    batch = []
    for t in texts(paths, limit):
        batch.append(t)
        if len(batch) == 512:
            for e in tok.encode_batch(batch, add_special_tokens=False):
                used.update(e.ids)
            batch = []
    if batch:
        for e in tok.encode_batch(batch, add_special_tokens=False):
            used.update(e.ids)
    return used


def tokenization_check(orig, trimmed, old_ids: list[int], paths: list[str], limit: int) -> dict:
    """How many held-out texts tokenize exactly as before (ids mapped), and the token-count growth of the rest."""
    new = {o: n for n, o in enumerate(old_ids)}
    same = total = n_orig = n_trim = unk = 0
    unk_id = trimmed.token_to_id("<unk>")
    for t in texts(paths, limit):
        a = orig.encode(t, add_special_tokens=False).ids
        b = trimmed.encode(t, add_special_tokens=False).ids
        total += 1
        n_orig += len(a)
        n_trim += len(b)
        same += int([new.get(i, -1) for i in a] == b)
        unk += sum(1 for i in b if i == unk_id)
    return {"texts": total, "identical": round(same / max(1, total), 5), "token_growth": round(n_trim / max(1, n_orig) - 1, 5), "unk_tokens": unk}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--run", required=True, help="train.py --out folder (reads <run>/final)")
    p.add_argument("--out", required=True, help="new run folder (writes <out>/final)")
    p.add_argument("--corpus", nargs="+", required=True, help="text in the supported languages (JSONL or plain text)")
    p.add_argument("--corpus-limit", type=int, default=None, help="read at most this many texts from the corpus")
    p.add_argument("--min-count", type=int, default=2, help="keep tokens used at least this often in the corpus")
    p.add_argument("--max-vocab", type=int, default=80000, help="at most this many tokens (0 = no cap); 80k x 384 keeps GOWA near 120-150 MB")
    p.add_argument("--keep-rank", type=int, default=8000, help="also keep the tokens of the N most common merges")
    p.add_argument("--heldout", nargs="*", default=None, help="texts for the tokenization check (default: last part of --corpus is not held out; pass files)")
    p.add_argument("--heldout-limit", type=int, default=5000)
    p.add_argument("--check-data", nargs="*", default=None, help="GOWA examples: trimmed vs original model agreement")
    p.add_argument("--check-n", type=int, default=400)
    p.add_argument("--tokenizer-only", action="store_true", help="trim and check the tokenizer only (no torch)")
    a = p.parse_args(argv)

    from tokenizers import Tokenizer

    final, out = Path(a.run) / "final", Path(a.out) / "final"
    tokdir = final / "tokenizer"
    tj = json.loads((tokdir / "tokenizer.json").read_text(encoding="utf-8"))
    orig = Tokenizer.from_str(json.dumps(tj))
    used = count_used(orig, a.corpus, a.corpus_limit)
    new_tj, old_ids = trim_tokenizer(tj, used, a.min_count, a.keep_rank, a.max_vocab or None)
    trimmed = Tokenizer.from_str(json.dumps(new_tj, ensure_ascii=False))
    before = orig.get_vocab_size(with_added_tokens=True)
    report = {"vocab_before": before, "vocab_after": len(old_ids), "min_count": a.min_count, "keep_rank": a.keep_rank, "max_vocab": a.max_vocab,
              "corpus": a.corpus, "corpus_tokens_seen": len(used)}
    print(f"vocabulary {before:,} -> {len(old_ids):,} tokens")
    if a.heldout:
        report["tokenization"] = tokenization_check(orig, trimmed, old_ids, a.heldout, a.heldout_limit)
        print(f"held-out texts tokenized exactly as before: {report['tokenization']['identical'] * 100:.2f}%  "
              f"token growth {report['tokenization']['token_growth'] * 100:.2f}%  <unk>: {report['tokenization']['unk_tokens']}")
    for probe in ["Rechtsanwältin Dr. Šárka Nováková, Kraków 12.03.1984", "合同 🙂 ∑ Ωmega", "Kowalskiego Żółć Ăăîșț Őrült"]:
        if trimmed.token_to_id("<unk>") in trimmed.encode(probe, add_special_tokens=False).ids:
            sys.exit(f"trimmed tokenizer produces <unk> for {probe!r}: byte fallback broken")

    out.mkdir(parents=True, exist_ok=True)
    (out / "tokenizer").mkdir(exist_ok=True)
    (out / "tokenizer" / "tokenizer.json").write_text(json.dumps(new_tj, ensure_ascii=False), encoding="utf-8")
    new = {o: n for n, o in enumerate(old_ids)}
    cfg_path = tokdir / "tokenizer_config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        if "added_tokens_decoder" in cfg:
            cfg["added_tokens_decoder"] = {str(new[int(k)]): v for k, v in cfg["added_tokens_decoder"].items() if int(k) in new}
        (out / "tokenizer" / "tokenizer_config.json").write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    for extra in tokdir.iterdir():
        if extra.name not in ("tokenizer.json", "tokenizer_config.json"):
            shutil.copy(extra, out / "tokenizer" / extra.name)

    meta = json.loads((final / "gowa-train.json").read_text())
    meta["markers"] = {k: new[v] for k, v in meta["markers"].items()}
    if "unk" in meta:
        meta["unk"] = new.get(meta["unk"], 0)
    meta["vocab_trim"] = {k: v for k, v in report.items() if k != "corpus"}

    if a.tokenizer_only:
        (out / "gowa-train.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
        (Path(a.out) / "trim_report.json").write_text(json.dumps(report, indent=2))
        print(f"tokenizer only: wrote {out / 'tokenizer'}")
        return

    import torch
    from transformers import AutoModel

    enc = AutoModel.from_pretrained(final / "encoder", attn_implementation="eager")
    emb = enc.get_input_embeddings()
    params_before = sum(x.numel() for x in enc.parameters())
    idx = torch.tensor(old_ids, dtype=torch.long)
    small = torch.nn.Embedding(len(old_ids), emb.weight.shape[1], padding_idx=new.get(enc.config.pad_token_id))
    small.weight.data = emb.weight.data[idx].clone()
    enc.set_input_embeddings(small)
    enc.config.vocab_size = len(old_ids)
    for k in ("pad_token_id", "bos_token_id", "eos_token_id", "cls_token_id", "sep_token_id", "mask_token_id", "unk_token_id"):
        v = getattr(enc.config, k, None)
        if isinstance(v, int) and v in new:
            setattr(enc.config, k, new[v])
    enc.save_pretrained(out / "encoder")
    shutil.copy(final / "head.pt", out / "head.pt")
    for extra in final.iterdir():
        if extra.is_file() and extra.name not in ("head.pt", "gowa-train.json"):
            shutil.copy(extra, out / extra.name)
    params_after = sum(x.numel() for x in enc.parameters())
    report["params_before"], report["params_after"] = params_before, params_after
    print(f"encoder parameters {params_before / 1e6:.1f}M -> {params_after / 1e6:.1f}M "
          f"(fp16 ≈ {params_after * 2 / 1e6:.0f} MB, int8 ≈ {params_after / 1e6:.0f} MB)")
    meta["vocab_trim"] = {k: v for k, v in report.items() if k != "corpus"}
    (out / "gowa-train.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    if a.check_data:
        report["model_check"] = model_check(final, out, a.check_data, a.check_n)
        r = report["model_check"]
        print(f"trimmed vs original model: argmax agreement {r['agreement'] * 100:.2f}%  max prob diff {r['max_diff']:.4f}  "
              f"(questions tokenized differently: {r['retokenized']})")
    (Path(a.out) / "trim_report.json").write_text(json.dumps(report, indent=2))


def model_check(orig_final: Path, new_final: Path, paths: list[str], n: int) -> dict:
    """Run both models on the same questions, each with its own tokenizer, and compare."""
    import torch
    from transformers import AutoTokenizer

    from export_onnx import check_questions, load_run
    from gowa import format as fmt

    qs = check_questions(paths, n)
    res = []
    for final in (orig_final, new_final):
        model, meta = load_run(final)
        model.eval()
        tok = AutoTokenizer.from_pretrained(final / "tokenizer")
        enc = lambda t: tok(t, add_special_tokens=False)["input_ids"]  # noqa: E731
        out = []
        for state, q, task in qs:
            s = fmt.build_sequence(state, q, enc, meta["markers"], meta["max_length"])
            with torch.no_grad():
                lg = model(torch.tensor([s.ids]), torch.ones(1, len(s.ids), dtype=torch.long), torch.tensor([s.option_index]), torch.tensor([s.decide_index]))[0].tolist()
            t = meta.get("temperatures", {}).get(task) or meta["temperature"]
            out.append((len(s.ids), fmt.softmax(lg, t)))
        res.append(out)
        del model
    agree = sum(int(max(range(len(p)), key=p.__getitem__) == max(range(len(q)), key=q.__getitem__)) for (_, p), (_, q) in zip(*res))
    worst = max(max(abs(x - y) for x, y in zip(p, q)) for (_, p), (_, q) in zip(*res))
    relen = sum(int(la != lb) for (la, _), (lb, _) in zip(*res))
    return {"n": len(qs), "agreement": round(agree / max(1, len(qs)), 5), "max_diff": round(worst, 5), "retokenized": relen}


if __name__ == "__main__":
    main()
