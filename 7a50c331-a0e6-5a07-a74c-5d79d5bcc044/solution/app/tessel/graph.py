"""The graph: live facts, supersession, entities and the read-only graph query language."""
import re
from datetime import datetime

from . import text
from .refusals import ApiError

LIVE_FACTS = (
    "SELECT f.subject, f.subject_key, f.predicate, f.object, f.object_key, f.valid_from, f.reason, "
    "f.source_id, f.lsn, f.position FROM facts f JOIN sources s ON s.database_id = f.database_id "
    "AND s.collection = f.collection AND s.id = f.source_id "
    "WHERE f.database_id = :db AND NOT s.deleted ORDER BY f.lsn, f.position")


class Graph:
    """Every live fact of one database, and what is active at a moment."""

    def __init__(self, facts: list[dict]):
        self.facts = facts
        self.names: dict[str, str] = {}
        for f in facts:
            self.names.setdefault(f["subject_key"], text.display(f["subject"]))
            self.names.setdefault(f["object_key"], text.display(f["object"]))

    @classmethod
    def load(cls, t, database_id: int) -> "Graph":
        return cls(t.rows(LIVE_FACTS, db=database_id))

    def moments(self) -> list[str]:
        """The distinct valid_from moments of the live facts, ascending (the Explore timeline)."""
        return sorted({text.ts(f["valid_from"]) for f in self.facts})

    def predicates(self) -> list[str]:
        return sorted({f["predicate"] for f in self.facts})

    def active(self, at: datetime) -> list[dict]:
        best: dict[tuple, dict] = {}
        for f in self.facts:
            if f["valid_from"] > at:
                continue
            k = (f["subject_key"], f["predicate"])
            cur = best.get(k)
            if cur is None or (f["valid_from"], f["lsn"], f["position"]) > (cur["valid_from"], cur["lsn"], cur["position"]):
                best[k] = f
        return list(best.values())

    def name(self, k: str) -> str:
        return self.names.get(k, k)

    def label(self, k: str, typed: str) -> str:
        return self.names[k] if k in self.names else text.display(typed)

    def relations(self, entity: str, at: datetime) -> dict:
        k = text.key(entity)
        live = self.active(at)
        out = [{"predicate": f["predicate"], "other": self.name(f["object_key"]),
                "valid_from": text.ts(f["valid_from"]), "reason": f["reason"], "source_id": f["source_id"],
                "_k": f["object_key"]} for f in live if f["subject_key"] == k]
        inc = [{"predicate": f["predicate"], "other": self.name(f["subject_key"]),
                "valid_from": text.ts(f["valid_from"]), "reason": f["reason"], "source_id": f["source_id"],
                "_k": f["subject_key"]} for f in live if f["object_key"] == k]
        for lst in (out, inc):
            lst.sort(key=lambda r: (r["predicate"], r["_k"]))
            for r in lst:
                del r["_k"]
        return {"entity": self.label(k, entity), "as_of": text.ts(at), "outgoing": out, "incoming": inc}

    def history(self, entity: str, predicate: str) -> dict:
        k = text.key(entity)
        rows = sorted((f for f in self.facts if f["subject_key"] == k and f["predicate"] == predicate),
                      key=lambda f: (f["valid_from"], f["lsn"], f["position"]))
        facts = []
        for i, f in enumerate(rows):
            nxt = rows[i + 1]["valid_from"] if i + 1 < len(rows) else None
            facts.append({"object": self.name(f["object_key"]), "valid_from": text.ts(f["valid_from"]),
                          "superseded_at": text.ts(nxt), "reason": f["reason"], "source_id": f["source_id"],
                          "lsn": f["lsn"]})
        return {"entity": self.label(k, entity), "predicate": predicate, "facts": facts}

    def edges(self, at: datetime, predicates: list[str] | None) -> dict:
        live = [f for f in self.active(at) if not predicates or f["predicate"] in predicates]
        live.sort(key=lambda f: (f["subject_key"], f["predicate"]))
        live = live[:1000]
        keys = sorted({f["subject_key"] for f in live} | {f["object_key"] for f in live})
        return {"as_of": text.ts(at), "nodes": [self.name(k) for k in keys],
                "edges": [{"subject": self.name(f["subject_key"]), "predicate": f["predicate"],
                           "object": self.name(f["object_key"]), "valid_from": text.ts(f["valid_from"]),
                           "source_id": f["source_id"]} for f in live]}


# ---- the query language -------------------------------------------------------------------------

WRITE_WORDS = {"CREATE", "MERGE", "DELETE", "DETACH", "SET", "REMOVE", "CALL", "LOAD"}
_STRING = r"'(?:\\.|[^'\\])*'"
_TOKEN = re.compile(r"\s+|(" + _STRING + r")|(\.\.)|([A-Za-z_][A-Za-z0-9_]*)|(\d+)|([(){}\[\]:,.\-<>*=])")
VAR_RE = re.compile(r"^[a-z][a-z0-9_]*$")
PRED_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")


def syntax():
    return ApiError("CYPHER_SYNTAX", field="cypher")


def semantic():
    return ApiError("CYPHER_SEMANTIC", field="cypher")


def read_only_check(statement: str) -> None:
    outside = re.sub(_STRING, " ", statement)
    outside = re.sub(r"'.*", " ", outside)
    for word in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", outside):
        if word.upper() in WRITE_WORDS:
            raise ApiError("READ_ONLY_QUERY", field="cypher")


def tokenize(statement: str) -> list[tuple[str, str]]:
    out, pos = [], 0
    while pos < len(statement):
        m = _TOKEN.match(statement, pos)
        if not m:
            raise syntax()
        pos = m.end()
        s, dots, word, num, punct = m.groups()
        if s is not None:
            out.append(("str", re.sub(r"\\(.)", r"\1", s[1:-1])))
        elif dots:
            out.append(("p", ".."))
        elif word:
            out.append(("w", word))
        elif num:
            out.append(("n", num))
        elif punct:
            out.append(("p", punct))
    return out


class Parser:
    def __init__(self, toks):
        self.t, self.i = toks, 0

    def peek(self, k=0):
        return self.t[self.i + k] if self.i + k < len(self.t) else (None, None)

    def take(self):
        tok = self.peek()
        if tok[0] is None:
            raise syntax()
        self.i += 1
        return tok

    def p(self, ch):
        if self.peek() != ("p", ch):
            raise syntax()
        self.i += 1

    def kw(self, word, optional=False):
        kind, val = self.peek()
        if kind == "w" and val.upper() == word:
            self.i += 1
            return True
        if optional:
            return False
        raise syntax()

    def var(self):
        kind, val = self.take()
        if kind != "w" or not VAR_RE.match(val):
            raise syntax()
        return val

    def node(self):
        self.p("(")
        var = self.var()
        name = None
        if self.peek() == ("p", "{"):
            self.i += 1
            if self.take() != ("w", "name"):
                raise syntax()
            self.p(":")
            kind, val = self.take()
            if kind != "str":
                raise syntax()
            name = val
            self.p("}")
        self.p(")")
        return {"var": var, "name": name}

    def rel(self):
        if self.peek() == ("p", "<"):
            self.i += 1
            direction = "in"
        else:
            direction = "out"
        self.p("-")
        self.p("[")
        self.p(":")
        kind, pred = self.take()
        if kind != "w" or not PRED_RE.match(pred):
            raise syntax()
        lo = hi = 1
        ranged = False
        if self.peek() == ("p", "*"):
            self.i += 1
            ranged = True
            k1, a = self.take()
            self.p("..")
            k2, b = self.take()
            if k1 != "n" or k2 != "n":
                raise syntax()
            lo, hi = int(a), int(b)
            if not 1 <= lo <= hi <= 5:
                raise syntax()
        self.p("]")
        self.p("-")
        if direction == "out":
            self.p(">")
        return {"pred": pred, "dir": direction, "lo": lo, "hi": hi, "ranged": ranged}

    def item(self):
        var = self.var()
        if self.peek() == ("p", "."):
            self.i += 1
            if self.take() != ("w", "name"):
                raise syntax()
            return {"var": var, "text": f"{var}.name"}
        return {"var": var, "text": var}

    def cond(self):
        if self.kw("NOT", optional=True):
            c = self.cond()
            return {"not": c}
        var = self.var()
        self.p(".")
        if self.take() != ("w", "name"):
            raise syntax()
        if self.peek() == ("p", "="):
            self.i += 1
            op = "="
        elif self.kw("STARTS", optional=True):
            self.kw("WITH")
            op = "starts"
        elif self.kw("ENDS", optional=True):
            self.kw("WITH")
            op = "ends"
        elif self.kw("CONTAINS", optional=True):
            op = "contains"
        else:
            raise syntax()
        kind, val = self.take()
        if kind != "str":
            raise syntax()
        return {"var": var, "op": op, "value": val}

    def statement(self):
        self.kw("MATCH")
        nodes, rels = [self.node()], []
        while self.peek() in (("p", "-"), ("p", "<")):
            if len(rels) == 3:
                raise syntax()
            rels.append(self.rel())
            nodes.append(self.node())
        conds = []
        if self.kw("WHERE", optional=True):
            conds.append(self.cond())
            while self.kw("AND", optional=True):
                conds.append(self.cond())
        self.kw("RETURN")
        distinct = self.kw("DISTINCT", optional=True)
        items, count = [], False
        while True:
            if self.peek()[0] == "w" and self.peek()[1].lower() == "count" and self.peek(1) == ("p", "("):
                self.i += 2
                self.p("*")
                self.p(")")
                count = True
                items.append(None)
            else:
                items.append(self.item())
            if self.peek() == ("p", ","):
                self.i += 1
                continue
            break
        order = None
        if self.kw("ORDER", optional=True):
            self.kw("BY")
            order = {"item": self.item(), "desc": False}
            if self.kw("DESC", optional=True):
                order["desc"] = True
            else:
                self.kw("ASC", optional=True)
        limit = 1000
        if self.kw("LIMIT", optional=True):
            kind, val = self.take()
            if kind != "n" or not 1 <= int(val) <= 1000:
                raise syntax()
            limit = int(val)
        if self.peek()[0] is not None:
            raise syntax()
        if count and (len(items) > 1 or distinct):
            raise semantic()
        bound = {n["var"] for n in nodes}
        used = [it["var"] for it in items if it] + [c_var(c) for c in conds] + ([order["item"]["var"]] if order else [])
        if any(v not in bound for v in used):
            raise semantic()
        return {"nodes": nodes, "rels": rels, "conds": conds, "distinct": distinct, "items": items,
                "count": count, "order": order, "limit": limit}


def c_var(c):
    return c_var(c["not"]) if "not" in c else c["var"]


def parse(statement: str) -> dict:
    read_only_check(statement)
    return Parser(tokenize(statement)).statement()


def _holds(c, binding):
    if "not" in c:
        return not _holds(c["not"], binding)
    k, v = binding[c["var"]], text.lower(c["value"])
    if c["op"] == "=":
        return k == v
    if c["op"] == "starts":
        return k.startswith(v)
    if c["op"] == "ends":
        return k.endswith(v)
    return v in k


def run(graph: Graph, q: dict, at: datetime) -> dict:
    live = graph.active(at)
    out: dict[str, list] = {}
    inc: dict[str, list] = {}
    for f in live:
        out.setdefault(f["subject_key"], []).append((f["predicate"], f["object_key"]))
        inc.setdefault(f["object_key"], []).append((f["predicate"], f["subject_key"]))
    entities = sorted(graph.names)
    nodes, rels = q["nodes"], q["rels"]

    def steps(u, rel):
        adj = out if rel["dir"] == "out" else inc
        return [v for p, v in adj.get(u, ()) if p == rel["pred"]]

    def paths(u, rel):
        """Every end entity reached by a path of lo..hi edges with no entity repeated."""
        found = []

        def walk(cur, seen, depth):
            if depth >= rel["lo"]:
                found.append(cur)
            if depth == rel["hi"]:
                return
            for v in steps(cur, rel):
                if v not in seen:
                    walk(v, seen | {v}, depth + 1)

        if rel["ranged"]:
            for v in steps(u, rel):
                if v != u:
                    walk(v, {u, v}, 1)
        else:
            found = steps(u, rel)
        return found

    def fits(node, k, binding):
        if node["name"] is not None and k != text.key(node["name"]):
            return False
        bound = binding.get(node["var"])
        return bound is None or bound == k

    results = []

    def extend(i, binding):
        if i == len(rels):
            results.append(dict(binding))
            return
        u = binding[nodes[i]["var"]]
        nxt = nodes[i + 1]
        for v in paths(u, rels[i]):
            if fits(nxt, v, binding):
                fresh = nxt["var"] not in binding
                binding[nxt["var"]] = v
                extend(i + 1, binding)
                if fresh:
                    del binding[nxt["var"]]

    first = nodes[0]
    starts = [text.key(first["name"])] if first["name"] is not None else entities
    for k in starts:
        if k in graph.names:
            extend(0, {first["var"]: k})

    results = [b for b in results if all(_holds(c, b) for c in q["conds"])]
    if q["count"]:
        rows = [[min(len(results), q["limit"], 1000)]]
        columns = ["count(*)"]
    else:
        columns = [it["text"] for it in q["items"]]
        o = q["order"]
        pairs = [(graph.name(b[o["item"]["var"]]) if o else "", [graph.name(b[it["var"]]) for it in q["items"]])
                 for b in results]
        if q["distinct"]:
            seen, uniq = set(), []
            for p in pairs:
                t = tuple(p[1])
                if t not in seen:
                    seen.add(t)
                    uniq.append(p)
            pairs = uniq
        pairs.sort(key=lambda p: p[1])
        if o:
            pairs.sort(key=lambda p: p[0], reverse=o["desc"])
        rows = [p[1] for p in pairs][:min(q["limit"], 1000)]
    return {"columns": columns, "rows": rows}
