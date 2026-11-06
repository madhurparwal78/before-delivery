"""The read-only graph query language: lexer, parser and evaluator."""
import re

from .. import textutil
from ..errors import TesselError
from . import graph

WRITE_KEYWORDS = frozenset(
    ("CREATE", "MERGE", "DELETE", "DETACH", "SET", "REMOVE", "CALL", "LOAD")
)
KEYWORDS = frozenset(
    (
        "MATCH",
        "WHERE",
        "AND",
        "NOT",
        "RETURN",
        "ORDER",
        "BY",
        "ASC",
        "DESC",
        "LIMIT",
        "DISTINCT",
        "STARTS",
        "ENDS",
        "WITH",
        "CONTAINS",
    )
)

VAR = re.compile(r"^[a-z][a-z0-9_]*$")
PREDICATE = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")
WORD_CHARS = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

PUNCT = ("]->", "<-[", "-[", "]-", "..", "(", ")", "{", "}", ":", ",", ".", "*", "=")

ROW_CAP = 1000
MAX_RELATIONSHIPS = 3


def syntax():
    return TesselError("CYPHER_SYNTAX", field="cypher")


def semantic():
    return TesselError("CYPHER_SEMANTIC", field="cypher")


def _strip_strings(text):
    """Replace every single quoted literal with a blank of the same shape."""
    out = []
    index = 0
    size = len(text)
    while index < size:
        char = text[index]
        if char == "'":
            index += 1
            while index < size:
                if text[index] == "\\" and index + 1 < size:
                    index += 2
                    continue
                if text[index] == "'":
                    index += 1
                    break
                index += 1
            out.append(" ")
        else:
            out.append(char)
            index += 1
    return "".join(out)


def check_read_only(text):
    outside = _strip_strings(text)
    for word in WORD_CHARS.findall(outside):
        if word.upper() in WRITE_KEYWORDS:
            raise TesselError("READ_ONLY_QUERY", field="cypher")


class Token:
    def __init__(self, kind, value):
        self.kind = kind
        self.value = value


def lex(text):
    tokens = []
    index = 0
    size = len(text)
    while index < size:
        char = text[index]
        if char.isspace():
            index += 1
            continue
        if char == "'":
            index += 1
            literal = []
            closed = False
            while index < size:
                if text[index] == "\\" and index + 1 < size and text[index + 1] == "'":
                    literal.append("'")
                    index += 2
                    continue
                if text[index] == "'":
                    index += 1
                    closed = True
                    break
                literal.append(text[index])
                index += 1
            if not closed:
                raise syntax()
            tokens.append(Token("STRING", "".join(literal)))
            continue
        matched = None
        for symbol in PUNCT:
            if text.startswith(symbol, index):
                matched = symbol
                break
        if matched:
            tokens.append(Token("PUNCT", matched))
            index += len(matched)
            continue
        if char.isdigit():
            start = index
            while index < size and text[index].isdigit():
                index += 1
            tokens.append(Token("NUMBER", text[start:index]))
            continue
        word = WORD_CHARS.match(text, index)
        if word:
            tokens.append(Token("WORD", word.group(0)))
            index = word.end()
            continue
        raise syntax()
    return tokens


class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.at = 0

    def peek(self, offset=0):
        position = self.at + offset
        return self.tokens[position] if position < len(self.tokens) else None

    def done(self):
        return self.at >= len(self.tokens)

    def take_keyword(self, *names):
        token = self.peek()
        if token and token.kind == "WORD" and token.value.upper() in names:
            self.at += 1
            return token.value.upper()
        return None

    def expect_keyword(self, *names):
        value = self.take_keyword(*names)
        if value is None:
            raise syntax()
        return value

    def take_punct(self, symbol):
        token = self.peek()
        if token and token.kind == "PUNCT" and token.value == symbol:
            self.at += 1
            return True
        return False

    def expect_punct(self, symbol):
        if not self.take_punct(symbol):
            raise syntax()

    def expect_var(self):
        token = self.peek()
        if token is None or token.kind != "WORD" or not VAR.match(token.value):
            raise syntax()
        if token.value.upper() in KEYWORDS or token.value.upper() in WRITE_KEYWORDS:
            raise syntax()
        self.at += 1
        return token.value

    def expect_string(self):
        token = self.peek()
        if token is None or token.kind != "STRING":
            raise syntax()
        self.at += 1
        return token.value

    def expect_number(self):
        token = self.peek()
        if token is None or token.kind != "NUMBER":
            raise syntax()
        self.at += 1
        return int(token.value)


def parse_node(parser):
    parser.expect_punct("(")
    var = parser.expect_var()
    name = None
    if parser.take_punct("{"):
        token = parser.peek()
        if token is None or token.kind != "WORD" or token.value != "name":
            raise syntax()
        parser.at += 1
        parser.expect_punct(":")
        name = parser.expect_string()
        parser.expect_punct("}")
    parser.expect_punct(")")
    return {"var": var, "name": name}


def parse_relationship(parser):
    token = parser.peek()
    if token is None or token.kind != "PUNCT":
        return None
    if token.value == "-[":
        direction = "out"
        closing = "]->"
    elif token.value == "<-[":
        direction = "in"
        closing = "]-"
    else:
        return None
    parser.at += 1
    parser.expect_punct(":")
    name = parser.peek()
    if name is None or name.kind != "WORD" or not PREDICATE.match(name.value):
        raise syntax()
    parser.at += 1
    low, high = 1, 1
    if parser.take_punct("*"):
        low = parser.expect_number()
        parser.expect_punct("..")
        high = parser.expect_number()
        if not 1 <= low <= high <= 5:
            raise syntax()
    parser.expect_punct(closing)
    return {"direction": direction, "predicate": name.value, "min": low, "max": high}


def parse_condition(parser):
    if parser.take_keyword("NOT"):
        return {"negate": True, "inner": parse_condition(parser)}
    var = parser.expect_var()
    parser.expect_punct(".")
    field = parser.peek()
    if field is None or field.kind != "WORD" or field.value != "name":
        raise syntax()
    parser.at += 1
    if parser.take_punct("="):
        operator = "="
    else:
        word = parser.expect_keyword("STARTS", "ENDS", "CONTAINS")
        if word == "CONTAINS":
            operator = "CONTAINS"
        else:
            parser.expect_keyword("WITH")
            operator = "STARTS WITH" if word == "STARTS" else "ENDS WITH"
    value = parser.expect_string()
    return {"negate": False, "var": var, "operator": operator, "value": value}


def parse_item(parser):
    var = parser.expect_var()
    if parser.take_punct("."):
        field = parser.peek()
        if field is None or field.kind != "WORD" or field.value != "name":
            raise syntax()
        parser.at += 1
        return {"var": var, "written": var + ".name"}
    return {"var": var, "written": var}


def parse(statement):
    parser = Parser(lex(statement))
    parser.expect_keyword("MATCH")
    nodes = [parse_node(parser)]
    relationships = []
    while True:
        relationship = parse_relationship(parser)
        if relationship is None:
            break
        if len(relationships) >= MAX_RELATIONSHIPS:
            raise syntax()
        relationships.append(relationship)
        nodes.append(parse_node(parser))
    conditions = []
    if parser.take_keyword("WHERE"):
        conditions.append(parse_condition(parser))
        while parser.take_keyword("AND"):
            conditions.append(parse_condition(parser))
    parser.expect_keyword("RETURN")
    distinct = parser.take_keyword("DISTINCT") is not None
    items = []
    counts = 0
    while True:
        token = parser.peek()
        following = parser.peek(1)
        if (
            token
            and token.kind == "WORD"
            and token.value.lower() == "count"
            and following
            and following.kind == "PUNCT"
            and following.value == "("
        ):
            parser.at += 2
            parser.expect_punct("*")
            parser.expect_punct(")")
            items.append({"var": None, "written": "count(*)"})
            counts += 1
        else:
            items.append(parse_item(parser))
        if not parser.take_punct(","):
            break
    order = None
    if parser.take_keyword("ORDER"):
        parser.expect_keyword("BY")
        order_item = parse_item(parser)
        descending = parser.take_keyword("ASC", "DESC") == "DESC"
        order = {"item": order_item, "descending": descending}
    limit = None
    if parser.take_keyword("LIMIT"):
        limit = parser.expect_number()
        if not 1 <= limit <= ROW_CAP:
            raise syntax()
    if not parser.done():
        raise syntax()
    return {
        "nodes": nodes,
        "relationships": relationships,
        "conditions": conditions,
        "distinct": distinct,
        "items": items,
        "counts": counts,
        "order": order,
        "limit": limit,
    }


def check_meaning(plan):
    if plan["counts"]:
        if plan["counts"] > 1 or len(plan["items"]) > 1 or plan["distinct"]:
            raise semantic()
    bound = {node["var"] for node in plan["nodes"]}
    used = list(plan["conditions"])
    while used:
        condition = used.pop()
        if condition["negate"]:
            used.append(condition["inner"])
        elif condition["var"] not in bound:
            raise semantic()
    for item in plan["items"]:
        if item["var"] is not None and item["var"] not in bound:
            raise semantic()
    if plan["order"] and plan["order"]["item"]["var"] not in bound:
        raise semantic()


class Index:
    """The edges active at one moment, arranged for pattern traversal."""

    def __init__(self, rows):
        self.entities = set()
        self.out = {}
        self.inward = {}
        for row in rows:
            subject = row["subject_key"]
            obj = row["object_key"]
            predicate = row["predicate"]
            self.entities.add(subject)
            self.entities.add(obj)
            self.out.setdefault((subject, predicate), []).append(obj)
            self.inward.setdefault((obj, predicate), []).append(subject)

    def step(self, key, relationship):
        table = self.out if relationship["direction"] == "out" else self.inward
        return table.get((key, relationship["predicate"]), ())


def _walk(index, start, relationship, visited):
    """Every end key reachable by this relationship, one entry per path."""
    results = []

    def descend(current, depth, path):
        for nxt in index.step(current, relationship):
            if nxt in path:
                continue
            if depth + 1 >= relationship["min"]:
                results.append(nxt)
            if depth + 1 < relationship["max"]:
                descend(nxt, depth + 1, path | {nxt})

    descend(start, 0, visited | {start})
    return results


def _bindings(plan, index):
    nodes = plan["nodes"]
    relationships = plan["relationships"]
    rows = []

    def place(position, key, binding):
        node = nodes[position]
        if node["name"] is not None and textutil.entity_key(node["name"]) != key:
            return
        existing = binding.get(node["var"])
        if existing is not None and existing != key:
            return
        updated = dict(binding)
        updated[node["var"]] = key
        if position == len(nodes) - 1:
            rows.append(updated)
            return
        relationship = relationships[position]
        for nxt in _walk(index, key, relationship, set()):
            place(position + 1, nxt, updated)

    first = nodes[0]
    if first["name"] is not None:
        start_keys = [textutil.entity_key(first["name"])]
        if start_keys[0] not in index.entities:
            start_keys = []
    else:
        start_keys = sorted(index.entities)
    for key in start_keys:
        place(0, key, {})
    return rows


def _holds(condition, binding):
    if condition["negate"]:
        return not _holds(condition["inner"], binding)
    key = binding[condition["var"]]
    wanted = textutil.nfc(condition["value"]).lower()
    operator = condition["operator"]
    if operator == "=":
        return key == wanted
    if operator == "STARTS WITH":
        return key.startswith(wanted)
    if operator == "ENDS WITH":
        return key.endswith(wanted)
    return wanted in key


def run(cur, database_row, statement, as_of):
    """Answer one statement, refusing in the pinned order."""
    check_read_only(statement)
    plan = parse(statement)
    check_meaning(plan)

    rows = graph.active_facts(cur, database_row["id"], as_of)
    names = graph.display_names(cur, database_row["id"])
    index = Index(rows)
    bindings = _bindings(plan, index)
    bindings = [
        binding
        for binding in bindings
        if all(_holds(condition, binding) for condition in plan["conditions"])
    ]

    columns = [item["written"] for item in plan["items"]]
    if plan["counts"]:
        total = len(bindings)
        if plan["limit"] is not None:
            total = min(total, plan["limit"])
        return {"columns": columns, "rows": [[min(total, ROW_CAP)]]}

    answers = [
        [names[binding[item["var"]]] for item in plan["items"]] for binding in bindings
    ]
    if plan["order"]:
        order_variable = plan["order"]["item"]["var"]
        paired = list(zip([names[binding[order_variable]] for binding in bindings], answers))
        paired.sort(key=lambda pair: pair[1])
        paired.sort(key=lambda pair: pair[0], reverse=plan["order"]["descending"])
        answers = [row for _, row in paired]
    else:
        answers.sort()
    if plan["distinct"]:
        seen = set()
        unique = []
        for row in answers:
            marker = tuple(row)
            if marker not in seen:
                seen.add(marker)
                unique.append(row)
        answers = unique
    if plan["limit"] is not None:
        answers = answers[: plan["limit"]]
    return {"columns": columns, "rows": answers[:ROW_CAP]}
