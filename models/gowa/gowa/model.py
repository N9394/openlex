"""GOWA: mmBERT-small + ONE Kev-style decision (pointer) head.

The head scores each option's </opt> vector against the question's
<decide> vector (scaled dot product of two small projections). A softmax
over a question's options, divided by a fitted temperature, gives the
calibrated probabilities. There is no token-tagging head: every OpenLex
feature is a typed question to this one head.
"""

from __future__ import annotations

import math

import torch
from torch import nn


class GowaModel(nn.Module):
    def __init__(self, encoder: nn.Module, hidden: int, head_dim: int = 256):
        super().__init__()
        self.encoder = encoder
        self.q = nn.Linear(hidden, head_dim)
        self.k = nn.Linear(hidden, head_dim)
        self.scale = 1.0 / math.sqrt(head_dim)

    @classmethod
    def from_pretrained(cls, base: str, tokenizer_len: int | None = None, head_dim: int = 256, attn_implementation: str | None = None):
        from transformers import AutoModel

        kw = {"attn_implementation": attn_implementation} if attn_implementation else {}
        enc = AutoModel.from_pretrained(base, **kw)
        if tokenizer_len and tokenizer_len != enc.get_input_embeddings().num_embeddings:
            enc.resize_token_embeddings(tokenizer_len)
        return cls(enc, enc.config.hidden_size, head_dim)

    def forward(self, input_ids, attention_mask, option_index, decide_index):
        """input_ids, attention_mask [B,L]; option_index [B,K]; decide_index [B] → option logits [B,K]."""
        h = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state  # B,L,H
        b = torch.arange(h.size(0), device=h.device)
        d = h[b, decide_index]  # B,H
        o = torch.gather(h, 1, option_index.unsqueeze(-1).expand(-1, -1, h.size(-1)))  # B,K,H
        return (self.k(o) * self.q(d).unsqueeze(1)).sum(-1) * self.scale

    def head_state(self) -> dict:
        return {"q": self.q.state_dict(), "k": self.k.state_dict(), "scale": self.scale}

    def load_head_state(self, s: dict):
        self.q.load_state_dict(s["q"])
        self.k.load_state_dict(s["k"])
        self.scale = s["scale"]


def masked_logits(logits: torch.Tensor, counts: torch.Tensor) -> torch.Tensor:
    """Padding options (beyond each question's own count) get -inf."""
    k = logits.size(1)
    mask = torch.arange(k, device=logits.device).unsqueeze(0) >= counts.unsqueeze(1)
    return logits.masked_fill(mask, float("-inf"))


# ── calibration ──────────────────────────────────────────────────────────


def fit_temperature(logit_rows: list[list[float]], answers: list[int], lo: float = 0.05, hi: float = 20.0, iters: int = 60) -> float:
    """One temperature minimising the negative log-likelihood on held-out
    questions (each row may have its own number of options). Golden-section
    search on log T — robust, no gradients needed."""
    if not logit_rows:
        return 1.0

    def nll(t: float) -> float:
        s = 0.0
        for row, a in zip(logit_rows, answers):
            z = [x / t for x in row]
            m = max(z)
            s += math.log(sum(math.exp(x - m) for x in z)) + m - z[a]
        return s / len(logit_rows)

    a, b = math.log(lo), math.log(hi)
    g = (math.sqrt(5) - 1) / 2
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = nll(math.exp(c)), nll(math.exp(d))
    for _ in range(iters):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = nll(math.exp(c))
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = nll(math.exp(d))
    return round(math.exp((a + b) / 2), 4)


def threshold_for(confidences: list[float], correct: list[bool], max_error: float = 0.02, min_n: int = 30) -> dict:
    """The lowest probability threshold at which the answers at or above it
    are wrong at most `max_error` of the time ("automate" above, "escalate"
    below), with the share of decisions it automates (coverage). With fewer
    than `min_n` held-out answers no threshold is trusted (1.0 = never automate)."""
    pairs = sorted(zip(confidences, correct), key=lambda x: -x[0])
    if len(pairs) < min_n:
        return {"threshold": 1.0, "coverage": 0.0, "error": None, "n": len(pairs)}
    best = {"threshold": 1.0, "coverage": 0.0, "error": None, "n": len(pairs)}
    wrong = 0
    for i, (p, ok) in enumerate(pairs, 1):
        wrong += 0 if ok else 1
        # Only cut between distinct probabilities.
        if i < len(pairs) and pairs[i][0] == p:
            continue
        err = wrong / i
        if err <= max_error and i >= min_n:
            best = {"threshold": round(p, 4), "coverage": round(i / len(pairs), 4), "error": round(err, 4), "n": len(pairs)}
    return best


def ece(confidences: list[float], correct: list[bool], bins: int = 10) -> float:
    """Expected calibration error (equal-width bins)."""
    if not confidences:
        return 0.0
    tot = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        idx = [i for i, p in enumerate(confidences) if (lo < p <= hi) or (b == 0 and p == 0)]
        if not idx:
            continue
        acc = sum(correct[i] for i in idx) / len(idx)
        conf = sum(confidences[i] for i in idx) / len(idx)
        tot += len(idx) / len(confidences) * abs(acc - conf)
    return round(tot, 4)
