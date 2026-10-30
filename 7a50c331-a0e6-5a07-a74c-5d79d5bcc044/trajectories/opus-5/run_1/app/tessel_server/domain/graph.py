"""Supersession, entities, relations, history and the graph route."""
from .. import textutil

GRAPH_EDGE_CAP = 1000

_LIVE_JOIN = """
  FROM facts f
  JOIN sources s ON s.database_id = f.database_id
               AND s.collection = f.collection AND s.id = f.source_id
 WHERE f.database_id = %s AND NOT s.deleted
"""


def display_names(cur, database_id):
    """Each entity key mapped to the casing of its earliest appearance."""
    rows = cur.all(
        """
        SELECT DISTINCT ON (key) key, name, lsn, position, side FROM (
            SELECT f.subject_key AS key, f.subject AS name, f.lsn, f.position, 0 AS side
            %(join)s
            UNION ALL
            SELECT f.object_key AS key, f.object AS name, f.lsn, f.position, 1 AS side
            %(join)s
        ) appearances
        ORDER BY key, lsn, position, side
        """
        % {"join": _LIVE_JOIN},
        (database_id, database_id),
    )
    return {row["key"]: row["name"] for row in rows}


def active_facts(cur, database_id, as_of, predicates=None):
    """The fact active at a moment for each subject and predicate."""
    sql = """
        SELECT DISTINCT ON (f.subject_key, f.predicate)
               f.subject_key, f.predicate, f.object_key, f.valid_from,
               f.reason, f.source_id, f.lsn, f.position
        %(join)s AND f.valid_from <= %%s
        ORDER BY f.subject_key, f.predicate, f.valid_from DESC, f.lsn DESC, f.position DESC
    """ % {"join": _LIVE_JOIN}
    rows = cur.all(sql, (database_id, as_of))
    if predicates:
        wanted = set(predicates)
        rows = [row for row in rows if row["predicate"] in wanted]
    return rows


def graph(cur, database_id, as_of, predicates=None):
    names = display_names(cur, database_id)
    rows = active_facts(cur, database_id, as_of, predicates)
    rows.sort(key=lambda row: (row["subject_key"], row["predicate"]))
    rows = rows[:GRAPH_EDGE_CAP]
    edges = [
        {
            "subject": names[row["subject_key"]],
            "predicate": row["predicate"],
            "object": names[row["object_key"]],
            "valid_from": textutil.format_timestamp(row["valid_from"]),
            "source_id": row["source_id"],
        }
        for row in rows
    ]
    keys = set()
    for row in rows:
        keys.add(row["subject_key"])
        keys.add(row["object_key"])
    nodes = [names[key] for key in sorted(keys)]
    return nodes, edges


def relations(cur, database_id, entity, as_of):
    names = display_names(cur, database_id)
    key = textutil.entity_key(entity)
    rows = active_facts(cur, database_id, as_of)
    outgoing = [
        {
            "predicate": row["predicate"],
            "other": names[row["object_key"]],
            "valid_from": textutil.format_timestamp(row["valid_from"]),
            "reason": row["reason"],
            "source_id": row["source_id"],
            "_key": row["object_key"],
        }
        for row in rows
        if row["subject_key"] == key
    ]
    incoming = [
        {
            "predicate": row["predicate"],
            "other": names[row["subject_key"]],
            "valid_from": textutil.format_timestamp(row["valid_from"]),
            "reason": row["reason"],
            "source_id": row["source_id"],
            "_key": row["subject_key"],
        }
        for row in rows
        if row["object_key"] == key
    ]
    for group in (outgoing, incoming):
        group.sort(key=lambda item: (item["predicate"], item["_key"]))
        for item in group:
            del item["_key"]
    return outgoing, incoming


def history(cur, database_id, entity, predicate):
    names = display_names(cur, database_id)
    key = textutil.entity_key(entity)
    rows = cur.all(
        """
        SELECT f.object_key, f.valid_from, f.reason, f.source_id, f.lsn, f.position
        %(join)s AND f.subject_key = %%s AND f.predicate = %%s
        ORDER BY f.valid_from, f.lsn, f.position
        """
        % {"join": _LIVE_JOIN},
        (database_id, key, predicate),
    )
    facts = []
    for index, row in enumerate(rows):
        following = rows[index + 1]["valid_from"] if index + 1 < len(rows) else None
        facts.append(
            {
                "object": names[row["object_key"]],
                "valid_from": textutil.format_timestamp(row["valid_from"]),
                "superseded_at": textutil.format_timestamp(following),
                "reason": row["reason"],
                "source_id": row["source_id"],
                "lsn": row["lsn"],
            }
        )
    return facts


def predicates_present(cur, database_id):
    rows = cur.all(
        "SELECT DISTINCT f.predicate %(join)s ORDER BY 1" % {"join": _LIVE_JOIN},
        (database_id,),
    )
    return [row["predicate"] for row in rows]


def valid_from_moments(cur, database_id):
    rows = cur.all(
        "SELECT DISTINCT f.valid_from %(join)s ORDER BY 1" % {"join": _LIVE_JOIN},
        (database_id,),
    )
    return [textutil.format_timestamp(row["valid_from"]) for row in rows]
