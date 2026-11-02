#!/usr/bin/env python3
"""Generate and check fictional fixed-shape identifiers for the redaction gold set.

All values are random and fictional, but carry VALID checksums so a model cannot
learn "invalid checksum == not real". The check_* functions are imported by
validate_gold.py.

Usage: python3 make_ids.py [--seed N] [--n K]
"""
import argparse
import datetime as dt
import random
import string

# ---------------------------------------------------------------- IBAN
IBAN_LEN = {"DE": 22, "AT": 20, "CZ": 24, "SK": 24, "PL": 28, "RO": 24, "FR": 27,
            "HU": 28, "GB": 22, "IE": 22, "CH": 21, "IT": 27, "NL": 18, "BE": 16}


def _iban_num(s):
    return int("".join(str(int(c, 36)) for c in s))


def iban_check_digits(cc, bban):
    return "%02d" % (98 - _iban_num(bban + cc + "00") % 97)


def check_iban(s):
    s = s.replace(" ", "").upper()
    if len(s) < 5 or s[:2] not in IBAN_LEN or len(s) != IBAN_LEN[s[:2]]:
        return False
    if not s.isalnum():
        return False
    return _iban_num(s[4:] + s[:4]) % 97 == 1


def fr_rib_key(bank, branch, acct):
    return "%02d" % (97 - (89 * int(bank) + 15 * int(branch) + 3 * int(acct)) % 97)


def make_iban(cc, r):
    d = lambda n: "".join(r.choice(string.digits) for _ in range(n))
    L = lambda n: "".join(r.choice(string.ascii_uppercase) for _ in range(n))
    if cc == "DE":
        bban = d(8) + d(10)
    elif cc == "AT":
        bban = d(5) + d(11)
    elif cc in ("CZ", "SK"):
        bban = r.choice(["0800", "1100", "0900", "0200", "7500", "3100"]) + d(6) + d(10)
    elif cc == "PL":
        bban = d(8) + d(16)
    elif cc == "RO":
        bban = r.choice(["BTRL", "RNCB", "BRDE", "INGB", "RZBR"]) + d(16)
    elif cc == "FR":
        bank, branch, acct = d(5), d(5), d(11)
        bban = bank + branch + acct + fr_rib_key(bank, branch, acct)
    elif cc == "HU":
        bban = d(3) + d(4) + "0" + d(15) + d(1)
    elif cc in ("GB", "IE"):
        bban = r.choice(["NWBK", "BARC", "AIBK", "BOFI", "LOYD", "MIDL"]) + d(6) + d(8)
    elif cc == "CH":
        bban = d(5) + d(12)
    elif cc == "IT":
        bban = L(1) + d(5) + d(5) + d(12)
    elif cc == "NL":
        bban = r.choice(["ABNA", "RABO", "INGB"]) + d(10)
    else:
        raise ValueError(cc)
    s = cc + iban_check_digits(cc, bban) + bban
    assert check_iban(s), s
    return " ".join(s[i:i + 4] for i in range(0, len(s), 4))


# ---------------------------------------------------------------- CZ/SK rodne cislo
def check_rc(s):
    s = s.replace("/", "").replace(" ", "")
    if not s.isdigit() or len(s) != 10:
        return False
    if int(s) % 11 != 0:
        return False
    yy, mm, dd = int(s[:2]), int(s[2:4]), int(s[4:6])
    if mm > 50:
        mm -= 50
    if mm > 20:  # +20 extension (since 2004) is allowed
        mm -= 20
    year = 1900 + yy if yy >= 54 else 2000 + yy
    try:
        dt.date(year, mm, dd)
    except ValueError:
        return False
    return True


def make_rc(r, female=None, born=None):
    female = r.random() < 0.5 if female is None else female
    born = born or _rand_date(r, 1955, 2003)
    while True:
        mm = born.month + (50 if female else 0)
        n9 = "%02d%02d%02d%03d" % (born.year % 100, mm, born.day, r.randint(0, 999))
        c = int(n9) % 11
        if c == 10:
            continue
        s = n9 + str(c)
        # make whole number divisible by 11: n9*10 + c ≡ 0 (mod 11) -> c ≡ n9 (mod 11)
        if int(s) % 11 != 0:
            continue
        assert check_rc(s)
        return s[:6] + "/" + s[6:], born


# ---------------------------------------------------------------- PL
PESEL_W = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]


def check_pesel(s):
    if not (s.isdigit() and len(s) == 11):
        return False
    c = (10 - sum(int(a) * w for a, w in zip(s[:10], PESEL_W)) % 10) % 10
    if c != int(s[10]):
        return False
    yy, mm, dd = int(s[:2]), int(s[2:4]), int(s[4:6])
    year = 1900 + yy
    if mm > 80:
        year, mm = 1800 + yy, mm - 80
    elif mm > 20:
        year, mm = 2000 + yy, mm - 20
    try:
        dt.date(year, mm, dd)
    except ValueError:
        return False
    return True


def make_pesel(r, female=None, born=None):
    female = r.random() < 0.5 if female is None else female
    born = born or _rand_date(r, 1950, 2004)
    mm = born.month + (20 if born.year >= 2000 else 0)
    serial = "%03d" % r.randint(0, 999)
    sex = r.choice([0, 2, 4, 6, 8] if female else [1, 3, 5, 7, 9])
    s10 = "%02d%02d%02d%s%d" % (born.year % 100, mm, born.day, serial, sex)
    c = (10 - sum(int(a) * w for a, w in zip(s10, PESEL_W)) % 10) % 10
    s = s10 + str(c)
    assert check_pesel(s)
    return s, born


NIP_W = [6, 5, 7, 2, 3, 4, 5, 6, 7]


def check_nip(s):
    s = s.replace("-", "").replace(" ", "")
    if s.upper().startswith("PL"):
        s = s[2:]
    if not (s.isdigit() and len(s) == 10):
        return False
    c = sum(int(a) * w for a, w in zip(s, NIP_W)) % 11
    return c != 10 and c == int(s[9])


def make_nip(r):
    while True:
        s9 = str(r.randint(1, 9)) + "".join(r.choice(string.digits) for _ in range(8))
        c = sum(int(a) * w for a, w in zip(s9, NIP_W)) % 11
        if c == 10:
            continue
        s = s9 + str(c)
        assert check_nip(s)
        return "%s-%s-%s-%s" % (s[:3], s[3:6], s[6:8], s[8:])


REGON_W = [8, 9, 2, 3, 4, 5, 6, 7]


def check_regon(s):
    if not (s.isdigit() and len(s) == 9):
        return False
    c = sum(int(a) * w for a, w in zip(s, REGON_W)) % 11 % 10
    return c == int(s[8])


def make_regon(r):
    s8 = "".join(r.choice(string.digits) for _ in range(8))
    c = sum(int(a) * w for a, w in zip(s8, REGON_W)) % 11 % 10
    return s8 + str(c)


# ---------------------------------------------------------------- RO
CNP_W = [int(x) for x in "279146358279"]


def check_cnp(s):
    if not (s.isdigit() and len(s) == 13 and s[0] in "12345678"):
        return False
    c = sum(int(a) * w for a, w in zip(s[:12], CNP_W)) % 11
    c = 1 if c == 10 else c
    if c != int(s[12]):
        return False
    cent = {"1": 1900, "2": 1900, "3": 1800, "4": 1800, "5": 2000, "6": 2000, "7": 1900, "8": 1900}[s[0]]
    try:
        dt.date(cent + int(s[1:3]), int(s[3:5]), int(s[5:7]))
    except ValueError:
        return False
    return True


def make_cnp(r, female=None, born=None):
    female = r.random() < 0.5 if female is None else female
    born = born or _rand_date(r, 1950, 2004)
    if born.year >= 2000:
        sx = "6" if female else "5"
    else:
        sx = "2" if female else "1"
    s12 = "%s%02d%02d%02d%02d%03d" % (sx, born.year % 100, born.month, born.day,
                                      r.randint(1, 46), r.randint(1, 999))
    c = sum(int(a) * w for a, w in zip(s12, CNP_W)) % 11
    s = s12 + str(1 if c == 10 else c)
    assert check_cnp(s)
    return s, born


CUI_W = [7, 5, 3, 2, 1, 7, 5, 3, 2]


def check_cui(s):
    s = s.upper().replace(" ", "")
    if s.startswith("RO"):
        s = s[2:]
    if not (s.isdigit() and 2 <= len(s) <= 10):
        return False
    body = s[:-1].rjust(9, "0")
    c = sum(int(a) * w for a, w in zip(body, CUI_W)) * 10 % 11 % 10
    return c == int(s[-1])


def make_cui(r):
    body = str(r.randint(1000000, 49999999))
    c = sum(int(a) * w for a, w in zip(body.rjust(9, "0"), CUI_W)) * 10 % 11 % 10
    return body + str(c)


# ---------------------------------------------------------------- DE / AT
def _steuerid_check(d10):
    product = 10
    for ch in d10:
        s = (int(ch) + product) % 10
        if s == 0:
            s = 10
        product = (s * 2) % 11
    c = 11 - product
    return 0 if c == 10 else c


def check_steuerid(s):
    s = s.replace(" ", "")
    if not (s.isdigit() and len(s) == 11 and s[0] != "0"):
        return False
    counts = sorted((s[:10].count(d) for d in set(s[:10])), reverse=True)
    if counts[0] not in (2, 3) or counts[1:] .count(counts[0]) != 0:
        return False
    return _steuerid_check(s[:10]) == int(s[10])


def make_steuerid(r):
    while True:
        digits = r.sample(string.digits, 9)  # 9 distinct digits
        dup = r.choice(digits)
        d = digits + [dup]
        r.shuffle(d)
        if d[0] == "0":
            continue
        d10 = "".join(d)
        s = d10 + str(_steuerid_check(d10))
        if check_steuerid(s):
            return "%s %s %s %s" % (s[:2], s[2:5], s[5:8], s[8:])


SVNR_W = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6]


def check_svnr(s):
    s = s.replace(" ", "")
    if not (s.isdigit() and len(s) == 10 and s[0] != "0"):
        return False
    c = sum(int(a) * w for a, w in zip(s, SVNR_W)) % 11
    return c != 10 and c == int(s[3])


def make_svnr(r, born=None):
    born = born or _rand_date(r, 1950, 2004)
    while True:
        serial = str(r.randint(100, 999))
        date = born.strftime("%d%m%y")
        tmp = serial + "0" + date
        c = sum(int(a) * w for a, w in zip(tmp, SVNR_W)) % 11
        if c == 10:
            continue
        s = serial + str(c) + date
        assert check_svnr(s)
        return s[:4] + " " + s[4:], born


# ---------------------------------------------------------------- UK / IE
NINO_BAD_PREFIX = {"BG", "GB", "NK", "KN", "TN", "NT", "ZZ"}


def check_nino(s):
    s = s.replace(" ", "").upper()
    if len(s) != 9 or not (s[:2].isalpha() and s[2:8].isdigit() and s[8] in "ABCD"):
        return False
    if s[0] in "DFIQUV" or s[1] in "DFIQUVO" or s[:2] in NINO_BAD_PREFIX:
        return False
    return True


def make_nino(r):
    while True:
        a = r.choice([c for c in string.ascii_uppercase if c not in "DFIQUV"])
        b = r.choice([c for c in string.ascii_uppercase if c not in "DFIQUVO"])
        if a + b in NINO_BAD_PREFIX:
            continue
        n = "".join(r.choice(string.digits) for _ in range(6))
        s = "%s%s %s %s %s %s" % (a, b, n[:2], n[2:4], n[4:], r.choice("ABCD"))
        assert check_nino(s)
        return s


PPS_LET = "WABCDEFGHIJKLMNOPQRSTUV"


def check_ppsn(s):
    s = s.replace(" ", "").upper()
    if len(s) not in (8, 9) or not s[:7].isdigit() or not s[7].isalpha():
        return False
    tot = sum(int(d) * (8 - i) for i, d in enumerate(s[:7]))
    if len(s) == 9:
        tot += (ord(s[8]) - 64) * 9 if s[8] != "W" else 0
    return PPS_LET[tot % 23] == s[7]


def make_ppsn(r):
    d7 = "".join(r.choice(string.digits) for _ in range(7))
    tot = sum(int(d) * (8 - i) for i, d in enumerate(d7))
    return d7 + PPS_LET[tot % 23]


# ---------------------------------------------------------------- FR
def check_nir(s):
    s = s.replace(" ", "")
    if len(s) != 15 or not s.isdigit():
        return False
    return 97 - int(s[:13]) % 97 == int(s[13:])


def make_nir(r, female=None, born=None):
    female = r.random() < 0.5 if female is None else female
    born = born or _rand_date(r, 1950, 2004)
    dep = "%02d" % r.choice([13, 31, 33, 44, 59, 67, 69, 75, 92, 93])
    s13 = "%d%02d%02d%s%03d%03d" % (2 if female else 1, born.year % 100, born.month, dep,
                                     r.randint(1, 400), r.randint(1, 999))
    key = 97 - int(s13) % 97
    s = s13 + "%02d" % key
    assert check_nir(s)
    return "%s %s %s %s %s %s %s" % (s[0], s[1:3], s[3:5], s[5:7], s[7:10], s[10:13], s[13:]), born


def luhn_ok(s):
    s = s.replace(" ", "")
    tot = 0
    for i, ch in enumerate(reversed(s)):
        n = int(ch)
        if i % 2:
            n *= 2
            if n > 9:
                n -= 9
        tot += n
    return tot % 10 == 0


def make_luhn(r, n, prefix=""):
    while True:
        body = prefix + "".join(r.choice(string.digits) for _ in range(n - 1 - len(prefix)))
        for c in string.digits:
            if luhn_ok(body + c):
                return body + c


def make_siren(r):
    s = make_luhn(r, 9, str(r.randint(3, 9)))
    return "%s %s %s" % (s[:3], s[3:6], s[6:])


# ---------------------------------------------------------------- CZ/SK ICO
def check_ico(s):
    s = s.replace(" ", "")
    if not (s.isdigit() and len(s) == 8):
        return False
    rr = sum(int(a) * w for a, w in zip(s[:7], range(8, 1, -1))) % 11
    c = {0: 1, 1: 0}.get(rr, 11 - rr)
    return c == int(s[7])


def make_ico(r):
    while True:
        s7 = str(r.randint(1, 9)) + "".join(r.choice(string.digits) for _ in range(6))
        rr = sum(int(a) * w for a, w in zip(s7, range(8, 1, -1))) % 11
        c = {0: 1, 1: 0}.get(rr, 11 - rr)
        if c < 10:
            return s7 + str(c)


# ---------------------------------------------------------------- HU
def check_hu_taxid(s):
    s = s.replace(" ", "")
    if not (s.isdigit() and len(s) == 10 and s[0] == "8"):
        return False
    c = sum(int(d) * (i + 1) for i, d in enumerate(s[:9])) % 11
    return c != 10 and c == int(s[9])


def make_hu_taxid(r, born=None):
    born = born or _rand_date(r, 1950, 2004)
    days = (born - dt.date(1867, 1, 1)).days
    while True:
        s9 = "8%05d%03d" % (days, r.randint(0, 999))
        c = sum(int(d) * (i + 1) for i, d in enumerate(s9)) % 11
        if c != 10:
            return s9 + str(c), born


def check_taj(s):
    s = s.replace(" ", "")
    if not (s.isdigit() and len(s) == 9):
        return False
    c = sum(int(d) * (3 if i % 2 == 0 else 7) for i, d in enumerate(s[:8])) % 10
    return c == int(s[8])


def make_taj(r):
    s8 = "".join(r.choice(string.digits) for _ in range(8))
    c = sum(int(d) * (3 if i % 2 == 0 else 7) for i, d in enumerate(s8)) % 10
    s = s8 + str(c)
    return "%s %s %s" % (s[:3], s[3:6], s[6:])


# ---------------------------------------------------------------- helpers
def _rand_date(r, y0, y1):
    start = dt.date(y0, 1, 1).toordinal()
    end = dt.date(y1, 12, 28).toordinal()
    return dt.date.fromordinal(r.randint(start, end))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261102)
    ap.add_argument("--n", type=int, default=6)
    a = ap.parse_args()
    r = random.Random(a.seed)
    n = a.n
    for cc in ["DE", "AT", "CZ", "SK", "PL", "RO", "FR", "HU", "GB", "IE", "CH", "IT", "NL"]:
        print("IBAN", cc, " | ".join(make_iban(cc, r) for _ in range(n)))
    print("RC female", " | ".join("%s (%s)" % make_rc(r, True) for _ in range(n)))
    print("RC male  ", " | ".join("%s (%s)" % make_rc(r, False) for _ in range(n)))
    print("PESEL F", " | ".join("%s (%s)" % make_pesel(r, True) for _ in range(n)))
    print("PESEL M", " | ".join("%s (%s)" % make_pesel(r, False) for _ in range(n)))
    print("NIP", " | ".join(make_nip(r) for _ in range(n)))
    print("REGON", " | ".join(make_regon(r) for _ in range(n)))
    print("CNP F", " | ".join("%s (%s)" % make_cnp(r, True) for _ in range(n)))
    print("CNP M", " | ".join("%s (%s)" % make_cnp(r, False) for _ in range(n)))
    print("CUI", " | ".join(make_cui(r) for _ in range(n)))
    print("SteuerID", " | ".join(make_steuerid(r) for _ in range(n)))
    print("SVNR", " | ".join("%s (%s)" % make_svnr(r) for _ in range(n)))
    print("NINO", " | ".join(make_nino(r) for _ in range(n)))
    print("PPSN", " | ".join(make_ppsn(r) for _ in range(n)))
    print("NIR F", " | ".join("%s (%s)" % make_nir(r, True) for _ in range(n)))
    print("NIR M", " | ".join("%s (%s)" % make_nir(r, False) for _ in range(n)))
    print("SIREN", " | ".join(make_siren(r) for _ in range(n)))
    print("ICO", " | ".join(make_ico(r) for _ in range(n)))
    print("HU taxid", " | ".join("%s (%s)" % make_hu_taxid(r) for _ in range(n)))
    print("TAJ", " | ".join(make_taj(r) for _ in range(n)))
    print("CARD(Luhn16)", " | ".join(make_luhn(r, 16, "4") for _ in range(n)))


if __name__ == "__main__":
    main()
