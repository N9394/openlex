#!/usr/bin/env python3
"""Validate the Redaction-check gold set (gold/*.jsonl).

Checks JSON shape, markup syntax, kinds/tags, stray brackets, word counts,
checksum validity of fixed-shape identifiers, possibly unmarked repeats of
marked personal data, and prints counts against the quotas.
Exit code 0 = pass, 1 = errors.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import make_ids as M  # noqa: E402

GOLD = Path(__file__).parent / "gold"
MARK = re.compile(r"\[\[(PERSON|ORG|ADDRESS|ID|IBAN|EMAIL|PHONE|DATE|OTHER|NOT|OPT)\|([a-z0-9,]*)\|([^\]]+)\]\]")
LOOSE = re.compile(r"\[\[([^|\]]*)\|([^|\]]*)\|([^\]]*)\]\]")
KINDS = {"PERSON", "ORG", "ADDRESS", "ID", "IBAN", "EMAIL", "PHONE", "DATE", "OTHER", "NOT", "OPT"}
TAGS = {"w1", "w2", "w3", "w4", "w5", "w6", "w8", "w9"}
DOCTYPES = {"contract", "court_letter", "judgment_excerpt", "email_thread", "power_of_attorney", "invoice",
            "minutes", "statement_of_claim", "employment", "lease", "notary_deed", "table_extract"}
EXPECTED = {"de": 10, "en": 8, "cs": 6, "sk": 6, "pl": 6, "ro": 5, "fr": 4, "hu": 3}
TAG_QUOTA = {"w1": 40, "w2": 40, "w3": 40, "w4": 50, "w5": 40, "w6": 30, "w8": 60, "w9": 20}
NOT_QUOTA, ENTITY_QUOTA, NOT_PER_DOC = 300, 700, 8


def strip(text):
    """Return plain text and list of (start, end, kind, tags, surface)."""
    out, spans, pos = [], [], 0
    cur = 0
    for m in MARK.finditer(text):
        out.append(text[pos:m.start()])
        cur += m.start() - pos
        surf = m.group(3)
        spans.append((cur, cur + len(surf), m.group(1), [t for t in m.group(2).split(",") if t], surf))
        out.append(surf)
        cur += len(surf)
        pos = m.end()
    out.append(text[pos:])
    return "".join(out), spans


def id_check(surf, lang, ctx):
    s = surf.strip()
    c = ctx.lower()
    if re.fullmatch(r"\d{6}/\d{3,4}", s) or (lang in ("cs", "sk") and re.fullmatch(r"\d{10}", s)):
        return "rodne_cislo", M.check_rc(s)
    if re.fullmatch(r"\d{11}", s):
        if lang == "pl" or "pesel" in c:
            return "pesel", M.check_pesel(s)
        if lang == "de" or "steuer" in c or "idnr" in c:
            return "steuer_id", M.check_steuerid(s)
    if re.fullmatch(r"\d{2} \d{3} \d{3} \d{3}", s):
        return "steuer_id", M.check_steuerid(s)
    if re.fullmatch(r"\d{4} \d{6}", s):
        return "svnr_at", M.check_svnr(s)
    labels = {k: c.rfind(k) for k in ("nip", "krs", "regon", "pesel")}
    last = max(labels, key=labels.get) if max(labels.values()) >= 0 else None
    if re.fullmatch(r"(PL ?)?\d{3}-\d{3}-\d{2}-\d{2}", s) or (last == "nip" and re.fullmatch(r"\d{10}", s)):
        return "nip", M.check_nip(s)
    if re.fullmatch(r"[1-8]\d{12}", s):
        return "cnp", M.check_cnp(s)
    if re.fullmatch(r"[12] \d{2} \d{2} \d{2} \d{3} \d{3} \d{2}", s):
        return "nir", M.check_nir(s)
    if re.fullmatch(r"[A-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]", s):
        return "nino", M.check_nino(s)
    if re.fullmatch(r"\d{7}[A-W][A-W]?", s) and ("pps" in c):
        return "ppsn", M.check_ppsn(s)
    if lang == "hu" and re.fullmatch(r"8\d{9}", s):
        return "hu_taxid", M.check_hu_taxid(s)
    if lang == "hu" and re.fullmatch(r"\d{3} \d{3} \d{3}", s) and "taj" in c:
        return "taj", M.check_taj(s)
    if re.fullmatch(r"\d{8}", s) and re.search(r"\bič(o)?\b|ičo", c):
        return "ico", M.check_ico(s)
    if lang == "pl" and re.fullmatch(r"\d{9}", s) and "regon" in c:
        return "regon", M.check_regon(s)
    if re.fullmatch(r"(RO)?\d{4,10}", s) and ("cui" in c or "cif" in c or "cod fiscal" in c):
        return "cui", M.check_cui(s)
    return None, True


def main():
    errors, warnings = [], []
    per_lang = defaultdict(Counter)
    per_tag = defaultdict(Counter)
    docs = Counter()
    checks = Counter()
    for lang, exp in EXPECTED.items():
        p = GOLD / f"{lang}.jsonl"
        if not p.exists():
            errors.append(f"{p.name}: missing")
            continue
        ids = set()
        for ln, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            where = f"{p.name}:{ln}"
            if not line.strip():
                errors.append(f"{where}: empty line")
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"{where}: bad JSON {e}")
                continue
            if set(d) != {"id", "lang", "doctype", "text"}:
                errors.append(f"{where}: keys {sorted(d)}")
                continue
            did = d["id"]
            where = f"{p.name}:{did}"
            if d["lang"] != lang or not re.fullmatch(lang + r"-\d{3}", did) or did in ids:
                errors.append(f"{where}: bad/duplicate id or lang")
            ids.add(did)
            if d["doctype"] not in DOCTYPES:
                errors.append(f"{where}: unknown doctype {d['doctype']}")
            text = d["text"]
            for m in LOOSE.finditer(text):
                if m.group(1) not in KINDS:
                    errors.append(f"{where}: unknown kind {m.group(1)!r}")
                for t in filter(None, m.group(2).split(",")):
                    if t not in TAGS:
                        errors.append(f"{where}: unknown tag {t!r} in {m.group(0)[:60]}")
                if not m.group(3):
                    errors.append(f"{where}: empty surface")
            rest = MARK.sub("", text)
            for tok in ("[[", "]]"):
                if tok in rest:
                    i = rest.index(tok)
                    errors.append(f"{where}: stray {tok!r} near {rest[max(0, i-40):i+40]!r}")
            plain, spans = strip(text)
            wc = len(plain.split())
            if not 150 <= wc <= 600:
                errors.append(f"{where}: {wc} words (need 150-600)")
            docs[lang] += 1
            n_not = 0
            for (a, b, kind, tags, surf) in spans:
                if surf != surf.strip():
                    errors.append(f"{where}: surface has outer whitespace {surf!r}")
                per_lang[lang][kind] += 1
                if kind == "NOT":
                    n_not += 1
                if kind not in ("NOT", "OPT"):
                    for t in tags:
                        per_tag[lang][t] += 1
                elif tags:
                    warnings.append(f"{where}: tags on {kind} {surf!r}")
                if kind == "IBAN":
                    checks["iban"] += 1
                    if not M.check_iban(surf):
                        errors.append(f"{where}: invalid IBAN {surf!r}")
                if kind == "ID":
                    name, ok = id_check(surf, lang, plain[max(0, a - 40):a])
                    if name:
                        checks[name] += 1
                        if not ok:
                            errors.append(f"{where}: invalid {name} {surf!r}")
                if kind == "OTHER" and re.fullmatch(r"[\d ]{16,19}", surf):
                    checks["card_luhn"] += 1
                    if not M.luhn_ok(surf):
                        errors.append(f"{where}: invalid card {surf!r}")
            if n_not < NOT_PER_DOC:
                errors.append(f"{where}: only {n_not} NOT spans (need >= {NOT_PER_DOC})")
            # possibly unmarked repeats of marked personal data
            masked = list(plain)
            for (a, b, *_r) in spans:
                for i in range(a, b):
                    masked[i] = "\0"
            masked = "".join(masked)
            seen = set()
            for (a, b, kind, tags, surf) in spans:
                if kind in ("NOT", "OPT", "DATE"):
                    continue
                cands = [surf]
                if kind == "PERSON":
                    cands += [w.strip(".,") for w in surf.split() if len(w.strip(".,")) >= 4]
                for c in cands:
                    if len(c) < 4 or c in seen:
                        continue
                    seen.add(c)
                    for m in re.finditer(r"(?<!\w)" + re.escape(c) + r"(?!\w)", masked):
                        ctxs = masked[max(0, m.start() - 30):m.end() + 30].replace("\0", "#")
                        errors.append(f"{where}: possibly unmarked {kind} {c!r} at {ctxs!r}")
        if docs[lang] != exp:
            errors.append(f"{lang}: {docs[lang]} documents, expected {exp}")

    kinds = ["PERSON", "ORG", "ADDRESS", "ID", "IBAN", "EMAIL", "PHONE", "DATE", "OTHER", "NOT", "OPT"]
    tags = sorted(TAGS)
    hdr = f"{'lang':5}{'docs':>5}" + "".join(f"{k[:6]:>7}" for k in kinds) + f"{'ENT':>6} |" + "".join(f"{t:>5}" for t in tags)
    print(hdr)
    tot_k, tot_t = Counter(), Counter()
    for lang in EXPECTED:
        k, t = per_lang[lang], per_tag[lang]
        ent = sum(v for kk, v in k.items() if kk not in ("NOT", "OPT"))
        tot_k.update(k)
        tot_t.update(t)
        print(f"{lang:5}{docs[lang]:>5}" + "".join(f"{k[x]:>7}" for x in kinds) + f"{ent:>6} |" + "".join(f"{t[x]:>5}" for x in tags))
    ent = sum(v for kk, v in tot_k.items() if kk not in ("NOT", "OPT"))
    print(f"{'ALL':5}{sum(docs.values()):>5}" + "".join(f"{tot_k[x]:>7}" for x in kinds) + f"{ent:>6} |" + "".join(f"{tot_t[x]:>5}" for x in tags))
    print("\nQuotas:")
    for t, q in TAG_QUOTA.items():
        ok = tot_t[t] >= q
        print(f"  {t}: {tot_t[t]:>4} / {q}  {'OK' if ok else 'FAIL'}")
        if not ok:
            errors.append(f"quota {t}: {tot_t[t]} < {q}")
    print(f"  NOT: {tot_k['NOT']:>4} / {NOT_QUOTA}  {'OK' if tot_k['NOT'] >= NOT_QUOTA else 'FAIL'}")
    print(f"  entities: {ent:>4} / {ENTITY_QUOTA}  {'OK' if ent >= ENTITY_QUOTA else 'FAIL'}")
    if tot_k["NOT"] < NOT_QUOTA:
        errors.append("quota NOT")
    if ent < ENTITY_QUOTA:
        errors.append("quota entities")
    print("\nChecksum-validated spans:", dict(checks))
    for w in warnings:
        print("WARN", w)
    for e in errors:
        print("ERROR", e)
    print("\nRESULT:", "PASS" if not errors else f"FAIL ({len(errors)} errors)")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
