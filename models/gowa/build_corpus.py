"""Build a small public-text corpus (JSONL: source, lang, text) for the redaction and injection
converters, from official law texts mirrored by github.com/legalize-dev (one git repo per country).

Only a sample of files is fetched (partial clone, blobs on demand), front matter is stripped,
and each record names its licence-register source so convert.py can check it. Public texts only.

    python build_corpus.py --out data/corpus.jsonl --per-repo 300
"""
import argparse
import json
import random
import re
import subprocess
from pathlib import Path

from gowa.register import Register

# repo → (language, licence-register source id)
REPOS = {
    "legalize-at": ("de", "ris_at"),
    "legalize-de": ("de", "official_laws_de_cz_sk_pl_ro_hu"),
    "legalize-cz": ("cs", "official_laws_de_cz_sk_pl_ro_hu"),
    "legalize-sk": ("sk", "official_laws_de_cz_sk_pl_ro_hu"),
    "legalize-pl": ("pl", "official_laws_de_cz_sk_pl_ro_hu"),
    "legalize-ro": ("ro", "official_laws_de_cz_sk_pl_ro_hu"),
    "legalize-fr": ("fr", "legifrance_fr"),
    "legalize-eu": ("en", "eurlex_texts"),
}
FRONT = re.compile(r"\A---\n.*?\n---\n", re.S)


def sample_files(repo: str, workdir: Path, n: int, seed: str) -> list[Path]:
    dest = workdir / repo
    if not dest.exists():
        subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout",
                        f"https://github.com/legalize-dev/{repo}.git", str(dest)], check=True)
    names = subprocess.run(["git", "-C", str(dest), "ls-tree", "-r", "--name-only", "HEAD"], check=True,
                           capture_output=True, text=True).stdout.split()
    names = [x for x in names if x.endswith(".md") and "/" in x and not x.startswith(".")]
    pick = random.Random(f"{seed}:{repo}").sample(names, min(n, len(names)))
    for i in range(0, len(pick), 100):
        subprocess.run(["git", "-C", str(dest), "checkout", "-q", "HEAD", "--", *pick[i:i + 100]], check=True)
    return [dest / x for x in pick]


def clean(md: str) -> str:
    md = FRONT.sub("", md)
    lines = []
    for ln in md.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith(("|", ">", "```")):
            lines.append("")
            continue
        lines.append(re.sub(r"^#+\s*", "", ln).replace("**", ""))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True)
    p.add_argument("--per-repo", type=int, default=300)
    p.add_argument("--workdir", default="third_party/corpora")
    p.add_argument("--repos", nargs="+", default=list(REPOS))
    p.add_argument("--seed", default="openlex-gowa-corpus")
    a = p.parse_args(argv)
    reg = Register()
    work = Path(a.workdir)
    work.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(a.out, "w", encoding="utf-8") as out:
        for repo in a.repos:
            lang, source = REPOS[repo]
            reg.require(source)
            for f in sample_files(repo, work, a.per_repo, a.seed):
                text = clean(f.read_text(encoding="utf-8", errors="replace"))
                if len(text) >= 400:
                    out.write(json.dumps({"source": source, "lang": lang, "repo": repo, "file": f.name, "text": text}, ensure_ascii=False) + "\n")
                    n += 1
            print(f"{repo}: done ({lang}, {source})")
    print(f"{n} documents → {a.out}")


if __name__ == "__main__":
    main()
