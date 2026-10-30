#!/usr/bin/env python3
"""Make GOWA training labels with an open LLM on PUBLIC texts — on a GPU
(RTX 3060 box or Colab), never on a lawyer's laptop and never on client data.

    python label_llm.py claim_support --corpus corpus/eurlex_de.jsonl --out data/claims_de.jsonl
    python label_llm.py clause_type   --corpus corpus/templates_cs.jsonl --out data/clauses_cs.jsonl
    python label_llm.py relevance     --corpus corpus/ris_at.jsonl --out data/relevance_de.jsonl
    python label_llm.py routing       --langs de en cs sk pl ro hu fr --out data/routing.jsonl

The corpus is JSONL {"source": <id>, "lang": "de", "text": "..."}; the
source must be a `corpus` entry with include: yes in datasets.yaml (public
law, public court decisions, public contract templates). Anything else is
refused. Labels are stamped source "openlex_llm_labels" and keep the input
source in "origin" (attribution).

Model: an Apache-2.0 open model (default Qwen/Qwen3-8B; check the exact
checkpoint's licence), served by vLLM when installed, else transformers.
Free to run: no API, no paid calls.
"""

from __future__ import annotations

import argparse
import json
import platform
import random
import re
import sys

from gowa.data import write_jsonl
from gowa.register import NotCleared, Register

REG = Register()
RNG = random.Random(7)
LANG_NAMES = {"de": "German", "en": "English", "cs": "Czech", "sk": "Slovak", "pl": "Polish", "ro": "Romanian", "hu": "Hungarian", "fr": "French"}
SUPPORT = {"supported": "the source states this", "partly": "the source states part of it, or something close but different in a detail",
           "not_supported": "the source contradicts it or states something else", "not_covered": "the source does not address it"}
ROUTES = {"question": "a question about the law or the document, answered in prose", "rewrite": "change, rewrite or redraft wording in the document",
          "review": "review the document for risks, issues or one-sided terms", "research": "look up current law, cases or online sources",
          "files": "create, export or organise files, lists or calendars", "firm": "find or follow the firm's own precedents or templates", "other": "none of these"}
CLAUSE_TYPES = ["governing_law", "disputes", "liability", "indemnity", "termination", "term", "confidentiality", "force_majeure", "ip", "data_protection",
                "payment", "warranty", "penalty", "non_compete", "assignment", "change_of_control", "notices", "severability", "entire_agreement", "insurance", "subcontracting", "other"]


def guard(a):
    if platform.system() == "Darwin" and not a.i_know:
        sys.exit("label_llm.py runs on a GPU machine (RTX 3060 box or Colab), not on a Mac. (--i-know overrides.)")
    try:
        import torch

        if not torch.cuda.is_available() and not a.allow_cpu:
            sys.exit("no CUDA GPU found. Run this on the GPU box or Colab (--allow-cpu for a tiny test only).")
    except ImportError:
        sys.exit("install torch first (see requirements.txt)")


class LLM:
    def __init__(self, model: str, max_new: int = 512):
        self.max_new = max_new
        try:
            from vllm import LLM as V, SamplingParams

            self.v = V(model=model, dtype="auto", max_model_len=8192, gpu_memory_utilization=0.9)
            self.sp = SamplingParams(temperature=0.0, max_tokens=max_new)
            self.mode = "vllm"
        except ImportError:
            from transformers import AutoModelForCausalLM, AutoTokenizer

            self.tok = AutoTokenizer.from_pretrained(model)
            self.m = AutoModelForCausalLM.from_pretrained(model, torch_dtype="auto", device_map="auto")
            self.mode = "hf"

    def chat(self, prompts: list[str]) -> list[str]:
        msgs = [[{"role": "user", "content": p}] for p in prompts]
        if self.mode == "vllm":
            outs = self.v.chat(msgs, self.sp, chat_template_kwargs={"enable_thinking": False})
            return [o.outputs[0].text for o in outs]
        res = []
        for m in msgs:
            ids = self.tok.apply_chat_template(m, add_generation_prompt=True, return_tensors="pt", enable_thinking=False).to(self.m.device)
            out = self.m.generate(ids, max_new_tokens=self.max_new, do_sample=False)
            res.append(self.tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True))
        return res


def first_json(s: str):
    m = re.search(r"[\[{][\s\S]*[\]}]", s)
    try:
        return json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        return None


def corpus(path, limit):
    n = 0
    for line in open(path, encoding="utf-8"):
        doc = json.loads(line)
        e = REG.require(doc["source"])
        if e["kind"] != "corpus":
            raise NotCleared(f"{doc['source']}: only public-text corpora can be labelled")
        for para in [p.strip() for p in doc["text"].split("\n") if 200 <= len(p.strip()) <= 3000]:
            yield doc["source"], doc.get("lang", "en"), para
            n += 1
            if limit and n >= limit:
                return


def stamp(ex, origin, lang):
    return {**ex, "lang": lang, "source": "openlex_llm_labels", "origin": origin}


def claim_support(a, llm):
    out, batch = [], []
    for src, lang, para in corpus(a.corpus, a.limit):
        batch.append((src, lang, para))
        if len(batch) < a.batch:
            continue
        out += _claims(batch, llm)
        batch = []
    if batch:
        out += _claims(batch, llm)
    return out


def _claims(batch, llm):
    prompts = [f"""Here is a passage of public law text in {LANG_NAMES.get(lang, lang)}:
<<<{para}>>>
Write four short claims in {LANG_NAMES.get(lang, lang)} that a lawyer's assistant might make about it, one of each kind:
supported (the passage states it), partly (close, but one detail such as a number, deadline, party or section differs),
not_supported (contradicts the passage), not_covered (about the same topic but the passage does not address it).
Reply with JSON only: {{"supported": "...", "partly": "...", "not_supported": "...", "not_covered": "..."}}""" for _, lang, para in batch]
    rows = []
    for (src, lang, para), reply in zip(batch, llm.chat(prompts)):
        j = first_json(reply)
        if not isinstance(j, dict):
            continue
        for kind in SUPPORT:
            claim = str(j.get(kind) or "").strip()
            if 15 <= len(claim) <= 600:
                rows.append(stamp({"task": "claim_support", "type": "choice", "state": para, "instructions": f"Does the source support this claim? Claim: {claim}", "criteria": SUPPORT, "answer": kind}, src, lang))
    return rows


def clause_type(a, llm):
    rows = []
    items = list(corpus(a.corpus, a.limit))
    for i in range(0, len(items), a.batch):
        part = items[i:i + a.batch]
        prompts = [f"""Which type of contract clause is this? Choose exactly one of: {", ".join(CLAUSE_TYPES)}.
Clause:
<<<{para}>>>
Reply with JSON only: {{"type": "<one of the list>", "sure": true|false}}""" for _, _, para in part]
        for (src, lang, para), reply in zip(part, llm.chat(prompts)):
            j = first_json(reply)
            if isinstance(j, dict) and j.get("type") in CLAUSE_TYPES and j.get("sure") is True:
                rows.append(stamp({"task": "clause_type", "type": "choice", "state": para, "instructions": "Which type of contract clause is this?", "criteria": {t: None for t in CLAUSE_TYPES}, "answer": j["type"]}, src, lang))
    return rows


def relevance(a, llm):
    items = list(corpus(a.corpus, a.limit))
    rows = []
    for i in range(0, len(items), a.batch):
        part = items[i:i + a.batch]
        prompts = [f"""Write one search query in {LANG_NAMES.get(lang, lang)} that a lawyer would type to find this passage (use statutory terms, no section numbers).
<<<{para}>>>
Reply with JSON only: {{"query": "..."}}""" for _, lang, para in part]
        for (src, lang, para), reply in zip(part, llm.chat(prompts)):
            j = first_json(reply)
            q = str((j or {}).get("query") or "").strip() if isinstance(j, dict) else ""
            if not q:
                continue
            ins = f"Is this passage relevant to the search: {q}?"
            rows.append(stamp({"task": "relevance", "type": "noul", "state": para, "instructions": ins, "answer": True}, src, lang))
            other = RNG.choice(items)
            if other[2] != para:
                rows.append(stamp({"task": "relevance", "type": "noul", "state": other[2], "instructions": ins, "answer": False}, other[0], other[1]))
    return rows


def routing(a, llm):
    rows = []
    prompts, keys = [], []
    for lang in a.langs:
        for route, desc in ROUTES.items():
            prompts.append(f"""Write {a.per_route} different short requests in {LANG_NAMES.get(lang, lang)} that a lawyer might type to a legal assistant, all of this kind: {desc}.
Use invented names only. Reply with JSON only: ["...", "..."]""")
            keys.append((lang, route))
    for (lang, route), reply in zip(keys, llm.chat(prompts)):
        j = first_json(reply)
        for req in (j if isinstance(j, list) else [])[: a.per_route]:
            if isinstance(req, str) and 5 <= len(req) <= 500:
                rows.append({"task": "routing", "lang": lang, "source": "openlex_llm_labels", "origin": "generated", "type": "choice", "state": req, "instructions": "What does the lawyer want done?", "criteria": ROUTES, "answer": route})
    return rows


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("task", choices=["claim_support", "clause_type", "relevance", "routing"])
    p.add_argument("--out", required=True)
    p.add_argument("--corpus", default=None)
    p.add_argument("--model", default="Qwen/Qwen3-8B")
    p.add_argument("--langs", nargs="+", default=list(LANG_NAMES))
    p.add_argument("--per-route", type=int, default=40)
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--allow-cpu", action="store_true")
    p.add_argument("--i-know", action="store_true", help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    if a.task != "routing" and not a.corpus:
        sys.exit("--corpus is required")
    guard(a)
    REG.require("openlex_llm_labels")
    llm = LLM(a.model)
    rows = globals()[a.task](a, llm)
    print(f"{a.task}: {write_jsonl(a.out, rows)} examples → {a.out}")


if __name__ == "__main__":
    main()
