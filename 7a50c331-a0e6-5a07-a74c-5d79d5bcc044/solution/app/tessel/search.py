"""Keyword search: the brief's BM25 variant, quoted phrases and excluded words."""
import math
import re
from decimal import ROUND_HALF_UP, Decimal

from . import text
from .refusals import invalid


def parse_query(q: str):
    phrases = [text.terms(p) for p in re.findall(r'"([^"]*)"', q)]
    rest = re.sub(r'"[^"]*"', " ", q)
    plain, excluded = [], []
    for word in rest.split():
        if word.startswith("-") and len(word) > 1:
            excluded += text.terms(word[1:])
        else:
            plain += text.terms(word)
    phrases = [p for p in phrases if p]
    scoring = list(dict.fromkeys(plain + [t for p in phrases for t in p]))
    if not scoring:
        raise invalid("query", "Type at least one word that is not a stopword")
    return scoring, phrases, set(excluded)


def _has_phrase(bag: list[str], phrase: list[str]) -> bool:
    n = len(phrase)
    return any(bag[i:i + n] == phrase for i in range(len(bag) - n + 1))


def round_half_up(value: float) -> float:
    return float(Decimal(repr(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def search(docs: list[dict], query: str, max_results: int) -> list[dict]:
    scoring, phrases, excluded = parse_query(query)
    bags = [(d, text.terms(d["title"] + " " + d["text"])) for d in docs]
    n = len(bags)
    if not n:
        return []
    avgdl = sum(len(b) for _, b in bags) / n
    holders = {t: sum(1 for _, b in bags if t in b) for t in scoring}
    ranked = []
    for d, bag in bags:
        if excluded and excluded.intersection(bag):
            continue
        if any(not _has_phrase(bag, p) for p in phrases):
            continue
        total = 0.0
        for t in scoring:
            f = bag.count(t)
            if not f:
                continue
            idf = math.log(1 + (n - holders[t] + 0.5) / (holders[t] + 0.5))
            total += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * len(bag) / avgdl))
        if total > 0:
            ranked.append((total, d))
    ranked.sort(key=lambda p: (-p[0], p[1]["id"], p[1]["collection"]))
    return [{"id": d["id"], "collection": d["collection"], "title": d["title"], "score": round_half_up(s),
             "snippet": text.snippet(d["text"])} for s, d in ranked[:max_results]]
