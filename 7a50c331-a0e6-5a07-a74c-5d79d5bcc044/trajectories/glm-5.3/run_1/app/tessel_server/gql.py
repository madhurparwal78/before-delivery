"""The small read-only graph query language.

Checks run in the pinned order: READ_ONLY_QUERY, CYPHER_SYNTAX, CYPHER_SEMANTIC.
Rows are deterministic: without ORDER BY, column by column ascending as text.
"""
import re

from .textutil import ApiError, entity_key

WRITE_KEYWORDS = ("CREATE", "MERGE", "DELETE", "DETACH", "SET", "REMOVE", "CALL", "LOAD")
VAR_RE = re.compile(r"^[a-z][a-z0-9_]*$")
PRED_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")
KEYWORD_RE = re.compile(r"[A-Za-z_]+")

# token kinds: STR, KW (identifier), SYM, INT, COUNTSTAR, EOF
TOKEN_RE = re.compile(
    r"""'(?:(?:\\'|[^'\\]))*'"""      # single-quoted string with \' escapes
    r"""|count\(\*\)"""
    r"""|[A-Za-z_][A-Za-z0-9_]*"""
    r"""|\.\.|\*|\(|\)|\{|\}|\[|\]|<|>|:|,|\.|=|\-"""
    r"""|\d+"""
    r"""|\s+""")


class Syntax(ApiError):
    def __init__(self):
        super().__init__(400, "CYPHER_SYNTAX", "The statement does not follow the query grammar")


class Semantic(ApiError):
    def __init__(self):
        super().__init__(400, "CYPHER_SEMANTIC",
                         "The statement returns a variable it never bound")


def strip_strings(stmt):
    """Blank string literals so the read-only keyword check ignores them."""
    out = []
    i, n = 0, len(stmt)
    while i < n:
        if stmt[i] == "'":
            j = stmt.find("'", i + 1)
            if j == -1:
                out.append(" ")
                break
            out.append("''")
            i = j + 1
        else:
            out.append(stmt[i])
            i += 1
    return "".join(out)


def check_read_only(stmt):
    for m in KEYWORD_RE.finditer(strip_strings(stmt)):
        if m.group(0).upper() in WRITE_KEYWORDS:
            raise ApiError(400, "READ_ONLY_QUERY", "Graph queries are read-only")


def tokenize(stmt):
    toks = []
    i, n = 0, len(stmt)
    while i < n:
        m = TOKEN_RE.match(stmt, i)
        if m is None:
            raise Syntax()
        i = m.end()
        t = m.group(0)
        if t.isspace():
            continue
        toks.append(t)
    return toks


class Parser:
    def __init__(self, toks):
        self.toks = toks
        self.i = 0

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self):
        t = self.peek()
        if t is None:
            raise Syntax()
        self.i += 1
        return t

    def accept(self, tok):
        if self.peek() == tok:
            self.i += 1
            return True
        return False

    def keyword(self, word):
        t = self.peek()
        if t is not None and t.upper() == word:
            self.i += 1
            return True
        return False

    def expect(self, tok):
        if not self.accept(tok):
            raise Syntax()

    def var(self):
        t = self.peek()
        if t is None or not VAR_RE.match(t):
            raise Syntax()
        self.i += 1
        return t

    def name_string(self):
        t = self.take()
        if len(t) < 2 or not t.startswith("'") or not t.endswith("'"):
            raise Syntax()
        inner = t[1:-1]
        out = []
        i = 0
        while i < len(inner):
            if inner[i] == "\\" and i + 1 < len(inner) and inner[i + 1] == "'":
                out.append("'")
                i += 2
            else:
                out.append(inner[i])
                i += 1
        value = "".join(out)
        if "'" in value:
            raise Syntax()
        return value

    def int(self):
        t = self.take()
        if not t.isdigit():
            raise Syntax()
        return int(t)


class Query:
    def __init__(self):
        self.nodes = []       # (var, name_or_None)
        self.rels = []        # (direction, predicate, lo, hi)
        self.conds = []       # (var, op, value, negated)
        self.items = []       # ("count",) or ("item", var, with_name)
        self.distinct = False
        self.order = None     # (var, with_name, desc)
        self.limit = None
        self.count_star = False


def parse(stmt):
    p = Parser(tokenize(stmt))
    q = Query()
    if not p.keyword("MATCH"):
        raise Syntax()

    def node():
        p.expect("(")
        v = p.var()
        name = None
        if p.accept("{"):
            if p.take() != "name":
                raise Syntax()
            p.expect(":")
            name = p.name_string()
            p.expect("}")
        p.expect(")")
        q.nodes.append((v, name))

    def rel():
        direction = "fwd"
        if p.peek() == "<":
            p.take()
            direction = "rev"
        p.expect("-")
        p.expect("[")
        p.expect(":")
        pred = p.take()
        if not PRED_RE.match(pred):
            raise Syntax()
        lo = hi = 1
        if p.accept("*"):
            lo = p.int()
            p.expect("..")
            hi = p.int()
            if not (1 <= lo <= hi <= 5):
                raise Syntax()
        p.expect("]")
        p.expect("-")
        if direction == "fwd":
            p.expect(">")
        q.rels.append((direction, pred, lo, hi))

    node()
    while p.peek() in ("-", "<"):
        rel()
        node()

    if p.keyword("WHERE"):

        def cond():
            negated = False
            if p.keyword("NOT"):
                negated = True
            v = p.var()
            p.expect(".")
            if p.take() != "name":
                raise Syntax()
            op = p.take()
            if op == "STARTS":
                if not p.keyword("WITH"):
                    raise Syntax()
            elif op == "ENDS":
                if not p.keyword("WITH"):
                    raise Syntax()
            elif op not in ("=", "CONTAINS"):
                raise Syntax()
            value = p.name_string()
            q.conds.append((v, op, value, negated))

        cond()
        while p.keyword("AND"):
            cond()

    if not p.keyword("RETURN"):
        raise Syntax()
    q.distinct = p.keyword("DISTINCT")

    def ritem():
        t = p.peek()
        if t == "count(*)":
            p.take()
            q.count_star = True
            q.items.append(("count",))
            return
        v = p.var()
        if p.accept("."):
            if p.take() != "name":
                raise Syntax()
            q.items.append(("item", v, True))
        else:
            q.items.append(("item", v, False))

    ritem()
    while p.accept(","):
        ritem()

    if p.keyword("ORDER"):
        p.expect("BY")
        v = p.var()
        with_name = False
        if p.accept("."):
            if p.take() != "name":
                raise Syntax()
            with_name = True
        desc = False
        if p.keyword("DESC"):
            desc = True
        elif p.keyword("ASC"):
            desc = False
        q.order = (v, with_name, desc)

    if p.keyword("LIMIT"):
        n = p.int()
        if not (1 <= n <= 1000):
            raise Syntax()
        q.limit = n
    if p.peek() is not None:
        raise Syntax()
    return q


def check_semantics(q):
    bound = set(v for v, name in q.nodes)
    used = set()
    for (v, op, val, neg) in q.conds:
        used.add(v)
    for item in q.items:
        if item[0] == "item":
            used.add(item[1])
    if q.order:
        used.add(q.order[0])
    if used - bound:
        raise Semantic()
    if q.count_star:
        if len(q.items) > 1 or q.distinct:
            raise Semantic()


def compile_query(stmt):
    check_read_only(stmt)
    q = parse(stmt)
    check_semantics(q)
    return q


def cond_holds(display, key, op, value):
    lowered = value.lower()
    if op == "=":
        return key == entity_key(value)
    if op == "STARTS":
        return display.lower().startswith(lowered)
    if op == "ENDS":
        return display.lower().endswith(lowered)
    return lowered in display.lower()


def eval_query(q, edges, displays):
    """edges: list of active fact rows; displays: entity key -> display name."""
    fwd = {}
    rev = {}
    for e in edges:
        fwd.setdefault(e["subject_key"], []).append(e)
        rev.setdefault(e["object_key"], []).append(e)

    def paths_from(start_key, rel):
        """Ends of every path of lo..hi edges without a repeated entity."""
        direction, pred, lo, hi = rel
        index = fwd if direction == "fwd" else rev
        ends = []
        stack = [(start_key, [start_key])]
        while stack:
            key, visited = stack.pop()
            depth = len(visited) - 1
            if depth >= lo:
                ends.append(visited[-1])
            if depth >= hi:
                continue
            for e in index.get(key, []):
                if e["predicate"] != pred:
                    continue
                dest = e["object_key"] if direction == "fwd" else e["subject_key"]
                if dest in visited:
                    continue
                stack.append((dest, visited + [dest]))
        return ends

    results = []

    def expand(idx, binding):
        if idx + 1 >= len(q.nodes):
            results.append(dict(binding))
            return
        rel = q.rels[idx]
        src_key = binding[q.nodes[idx][0]]
        var2, _ = q.nodes[idx + 1]
        for dest in paths_from(src_key, rel):
            if var2 in binding:
                if binding[var2] == dest:
                    expand(idx + 1, binding)
                continue
            nb = dict(binding)
            nb[var2] = dest
            expand(idx + 1, nb)

    start_var, start_name = q.nodes[0]
    if start_name is not None:
        expand(0, {start_var: entity_key(start_name)})
    else:
        for key in sorted(displays):
            expand(0, {start_var: key})

    kept = []
    for binding in results:
        ok = True
        for (v, op, value, neg) in q.conds:
            key = binding.get(v)
            if key is None or key not in displays:
                ok = False
                break
            holds = cond_holds(displays[key], key, op, value)
            if neg:
                holds = not holds
            if not holds:
                ok = False
                break
        if ok:
            kept.append(binding)

    if q.count_star:
        return ["count(*)"], [[len(kept)]]

    columns = []
    for item in q.items:
        if item[0] == "count":
            columns.append("count(*)")
        else:
            columns.append(item[1] + (".name" if item[2] else ""))

    rows = [[displays.get(b.get(item[1]), None) if item[0] == "item" else None
             for item in q.items] for b in kept]

    if q.distinct:
        seen = set()
        uniq = []
        for r in rows:
            k = tuple(r)
            if k not in seen:
                seen.add(k)
                uniq.append(r)
        rows = uniq

    def text_key(values):
        return tuple((1, "") if v is None else (0, str(v)) for v in values)

    if q.order:
        v, with_name, desc = q.order
        try:
            oi = next(i for i, item in enumerate(q.items)
                      if item[0] == "item" and item[1] == v and item[2] == with_name)
        except StopIteration:
            oi = None
        rest = [i for i in range(len(q.items)) if i != oi]
        if desc:
            rows.sort(key=lambda r: (_reverse_text(r[oi]),
                                     text_key([r[i] for i in rest])))
        else:
            rows.sort(key=lambda r: (text_key([r[oi]]),
                                     text_key([r[i] for i in rest])))
    else:
        rows.sort(key=text_key)

    if q.limit is not None:
        rows = rows[:q.limit]
    if len(rows) > 1000:
        rows = rows[:1000]
    return columns, rows


def _reverse_text(v):
    return "".join(chr(0x10FFFF - ord(c)) for c in (str(v) if v is not None else ""))


def run(stmt, facts, as_of, displays):
    from .domain import active_edges
    q = compile_query(stmt)
    edges = active_edges(facts, as_of)
    columns, rows = eval_query(q, edges, displays)
    return q, columns, rows
