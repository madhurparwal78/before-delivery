"""The exact keyword score, with phrases and exclusions."""
import math
from decimal import ROUND_HALF_UP, Decimal

from .. import textutil
from ..errors import validation_error

K1 = 2.2
B_FLOOR = 0.25
B_SCALE = 0.75
SCORE_PLACES = Decimal("0.0001")


def parse_query(raw):
    """Split a query into phrases, distinct positive terms and exclusions."""
    phrases = []
    positives = []
    negatives = []
    index = 0
    size = len(raw)
    while index < size:
        char = raw[index]
        if char == '"':
            closing = raw.find('"', index + 1)
            if closing == -1:
                closing = size
            inside = textutil.terms(raw[index + 1 : closing])
            if inside:
                phrases.append(inside)
                positives.extend(inside)
            index = closing + 1
        elif char.isspace():
            index += 1
        else:
            end = index
            while end < size and not raw[end].isspace() and raw[end] != '"':
                end += 1
            word = raw[index:end]
            if word.startswith("-"):
                negatives.extend(textutil.terms(word[1:]))
            else:
                positives.extend(textutil.terms(word))
            index = end
    return (
        phrases,
        list(dict.fromkeys(positives)),
        list(dict.fromkeys(negatives)),
    )


def round_score(value):
    return float(Decimal(str(value)).quantize(SCORE_PLACES, rounding=ROUND_HALF_UP))


def _positions(cur, database_id, collections, terms):
    if not terms:
        return {}
    rows = cur.all(
        """
        SELECT t.collection, t.source_id, t.term, t.tf, t.positions
          FROM source_terms t
          JOIN sources s ON s.database_id = t.database_id
                        AND s.collection = t.collection AND s.id = t.source_id
         WHERE t.database_id = %s AND t.collection = ANY(%s)
           AND t.term = ANY(%s) AND NOT s.deleted
        """,
        (database_id, list(collections), list(terms)),
    )
    found = {}
    for row in rows:
        found.setdefault((row["collection"], row["source_id"]), {})[row["term"]] = {
            "tf": row["tf"],
            "positions": row["positions"],
        }
    return found


def run(cur, database_row, raw_query, collections, max_results):
    """Score the latest version of every live source in the named collections."""
    phrases, positives, negatives = parse_query(raw_query)
    if not positives:
        raise validation_error("query", "Write at least one word that is not a stopword")
    database_id = database_row["id"]
    totals = cur.one(
        """
        SELECT count(*) AS count, coalesce(avg(term_count), 0) AS average
          FROM sources
         WHERE database_id = %s AND collection = ANY(%s) AND NOT deleted
        """,
        (database_id, list(collections)),
    )
    population = int(totals["count"])
    if population == 0:
        return []
    average = float(totals["average"])

    document_counts = {
        row["term"]: int(row["holders"])
        for row in cur.all(
            """
            SELECT t.term, count(*) AS holders
              FROM source_terms t
              JOIN sources s ON s.database_id = t.database_id
                            AND s.collection = t.collection AND s.id = t.source_id
             WHERE t.database_id = %s AND t.collection = ANY(%s)
               AND t.term = ANY(%s) AND NOT s.deleted
             GROUP BY t.term
            """,
            (database_id, list(collections), positives),
        )
    }

    wanted = set(positives)
    for phrase in phrases:
        wanted.update(phrase)
    matches = _positions(cur, database_id, collections, sorted(wanted))
    excluded = set(
        _positions(cur, database_id, collections, negatives).keys()
    )

    candidates = []
    for scope, terms in matches.items():
        if scope in excluded:
            continue
        if not any(term in terms for term in positives):
            continue
        if not all(_phrase_present(terms, phrase) for phrase in phrases):
            continue
        candidates.append(scope)
    if not candidates:
        return []

    rows = cur.all(
        """
        SELECT collection, id, title, text, term_count FROM sources
         WHERE database_id = %s AND collection = ANY(%s) AND NOT deleted
        """,
        (database_id, list(collections)),
    )
    by_scope = {(row["collection"], row["id"]): row for row in rows}

    results = []
    for scope in candidates:
        source = by_scope[scope]
        length = source["term_count"]
        normalised = B_FLOOR + B_SCALE * (length / average if average else 0.0)
        score = 0.0
        for term in positives:
            holders = document_counts.get(term, 0)
            frequency = matches[scope].get(term)
            if holders == 0 or frequency is None:
                continue
            count = frequency["tf"]
            idf = math.log(1 + (population - holders + 0.5) / (holders + 0.5))
            score += idf * count * K1 / (count + 1.2 * normalised)
        rounded = round_score(score)
        if rounded <= 0:
            continue
        results.append(
            {
                "id": source["id"],
                "collection": source["collection"],
                "title": source["title"],
                "score": rounded,
                "snippet": textutil.snippet(source["text"]),
            }
        )
    results.sort(key=lambda item: (-item["score"], item["id"], item["collection"]))
    return results[:max_results]


def _phrase_present(terms, phrase):
    """True when the phrase's terms sit next to each other, in that order."""
    places = []
    for term in phrase:
        holder = terms.get(term)
        if holder is None:
            return False
        places.append(set(holder["positions"]))
    return any(
        all(start + offset in places[offset] for offset in range(len(phrase)))
        for start in places[0]
    )
