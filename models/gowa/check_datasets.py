#!/usr/bin/env python3
"""Check the licence register (datasets.yaml) and, optionally, that every
example in some JSONL files comes from an included source.

    python check_datasets.py                    # the register itself
    python check_datasets.py data/*.jsonl       # plus every example's source
"""

import json
import sys
from collections import Counter

from gowa.register import NotCleared, Register


def main(argv):
    try:
        reg = Register()
    except ValueError as e:
        print(e)
        return 1
    inc = reg.included()
    print(f"licence register OK: {len(reg.entries)} sources, {len(inc)} included")
    for e in reg.entries:
        print(f"  {'IN ' if e['include'] == 'yes' else 'out'}  {e['id']:<34} {e['licence'][:60]}")
    bad = 0
    for path in argv:
        counts = Counter()
        with open(path, encoding="utf-8") as f:
            for n, line in enumerate(f, 1):
                if not line.strip():
                    continue
                src = json.loads(line).get("source", "")
                try:
                    reg.require(src)
                    counts[src] += 1
                except NotCleared as err:
                    print(f"{path}:{n}: {err}")
                    bad += 1
        print(f"{path}: {sum(counts.values())} examples from {dict(counts)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
