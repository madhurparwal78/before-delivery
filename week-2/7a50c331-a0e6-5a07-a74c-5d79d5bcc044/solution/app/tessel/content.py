"""The copy and figures of the public pages (brief: Public screens and controls)."""

HERO_NODES = [  # label, x, y in a 1000 x 560 drawing
    ("Tessel", 110, 280), ("stores", 300, 140), ("decisions", 520, 40), ("facts", 520, 84), ("docs", 520, 128),
    ("relationships", 520, 172), ("knowledge", 520, 216), ("how it all evolves", 560, 262), ("including", 730, 262),
    ("what changed", 885, 202), ("when", 885, 262), ("why", 885, 322), ("so", 885, 382), ("agents", 885, 442),
    ("can understand and act on", 680, 442), ("the right context", 680, 506), ("built on", 250, 430),
    ("object storage", 410, 430), ("for", 410, 506), ("10-100x lower costs", 230, 506),
    ("with assisted graph creation", 270, 352),
]
HERO_EDGE_ORDER = [
    ("Tessel", "stores"), ("Tessel", "built on"), ("Tessel", "with assisted graph creation"),
    ("stores", "decisions"), ("stores", "facts"), ("stores", "docs"), ("stores", "relationships"),
    ("stores", "knowledge"), ("stores", "how it all evolves"), ("how it all evolves", "including"),
    ("including", "what changed"), ("including", "when"), ("including", "why"), ("why", "so"), ("so", "agents"),
    ("agents", "can understand and act on"), ("can understand and act on", "the right context"),
    ("built on", "object storage"), ("object storage", "for"), ("for", "10-100x lower costs"),
]
_AT = {label: (x, y) for label, x, y in HERO_NODES}
HERO_EDGES = [(_AT[a], _AT[b]) for a, b in HERO_EDGE_ORDER]
HERO_SENTENCE = ("Tessel stores decisions, facts, docs, relationships, knowledge, and how it all evolves, including "
                 "what changed, when, and why, so your agents can understand and act on the right context, always. "
                 "At any scale or complexity")
HERO_SECOND = ("The fast and scalable graph database, built on object storage for 10-100x lower costs, with assisted "
               "graph creation to save you time building and organizing your graph. Built for intelligent agents that "
               "deserve fast, accurate retrieval")

CHART_TICKS = [("8K", 8), ("32K", 32), ("64K", 64), ("96K", 96), ("115K", 115)]
CHART_SERIES = [("Tessel", [94.2, 93.1, 92.3, 91.5, 90.79], "90.79%"),
                ("VectorDB", [83.0, 79.4, 76.1, 73.2, 71.0], "71%"),
                ("Full context", [86.5, 71.2, 57.0, 45.1, 38.0], "38%")]


def _chart():
    left, right, top, bottom = 56, 600, 20, 236
    span = CHART_TICKS[-1][1] - CHART_TICKS[0][1]

    def x(tokens):
        return round(left + (tokens - CHART_TICKS[0][1]) / span * (right - left), 1)

    def y(value):
        return round(bottom - (value - 30) / 70 * (bottom - top), 1)

    return {"ticks": [(label, x(k)) for label, k in CHART_TICKS],
            "grid": [(v, y(v)) for v in (40, 60, 80, 100)],
            "series": [{"name": name, "points": " ".join(f"{x(k)},{y(v)}" for (_, k), v in zip(CHART_TICKS, values)),
                        "values": values, "end": end, "end_y": y(values[-1])} for name, values, end in CHART_SERIES]}


LANDING = {
    "title": "Tessel · The graph database for agent context",
    "description": "Tessel stores decisions, facts, docs, relationships and how they evolve, so agents retrieve the "
                   "right context as of any moment.",
    "hero_heading": "Give agents ability to retrieve the most accurate context",
    "hero_sentence": HERO_SENTENCE, "hero_second": HERO_SECOND,
    "hero_nodes": HERO_NODES, "hero_edges": HERO_EDGES,
    "customers": ["toptal", "composio", "smallest.ai", "hsv.digital", "gio", "confida", "clinsight", "klubi", "Pocket",
                  "Distyl"],
    "lanes": [1180, 1360, 1240, 1420, 1300, 1460, 1220],
    "use_cases": [
        {"name": "Company brain", "description": "Give your agents the context to move work forward",
         "heading": "Agents are as smart as the context they have",
         "points": ["Every decision, owner and blocker in one graph", "Answers as of any past moment",
                    "Each fact traced to the source that stated it"]},
        {"name": "Multiplayer agent apps", "description": "Let many agents and people share one working memory",
         "heading": "One graph every agent reads and writes",
         "points": ["Every write lands in one numbered write log", "Reads see every accepted write at once",
                    "Viewers read and ask; only editors write"]},
        {"name": "Ontologies", "description": "Shape your domain as entities and predicates",
         "heading": "A vocabulary your agents can reason over",
         "points": ["Predicates such as OWNED_BY and BLOCKED_BY", "Entities keyed the same way every time",
                    "History for every subject and predicate"]},
        {"name": "Agent memory", "description": "Remember what changed, when, and why",
         "heading": "Memory that knows newer facts replace older ones",
         "points": ["Each fact holds the moment it became true", "Earlier answers stay one query away",
                    "Deleted sources come back exactly as they were"]},
        {"name": "Knowledge graphs", "description": "Query relationships, not only similar text",
         "heading": "Paths, not just neighbours",
         "points": ["Read-only graph queries with ranged paths", "Keyword search with phrases and exclusions",
                    "Exports that import back to the same answers"]},
    ],
    "benchmarks": [("90.79", "%", "Overall accuracy", "LONGMEMEVAL-S"), ("90.73", "", "Score out of 100", "CODEWIKI-BENCH"),
                   ("88.7", "", "Overall score", "ENTERPRISE RAG BENCH"), ("82", "%", "Overall, 10 dimensions", "BEAM 1M"),
                   ("91.4", "%", "Recall@10", "FINANCEBENCH")],
    "chart": _chart(),
    "compare": [
        ("Vector databases", [("Similar is not relevant", "Relevant, stateful context"),
                              ("Missed relationships", "A full structured view"),
                              ("Forgotten sessions", "Personalized recall"),
                              ("Four stitched systems", "One unified layer")]),
        ("SQL databases", [("Similar is not relevant", "Relevant, stateful context"),
                           ("Missed relationships", "A full structured view"),
                           ("Forgotten sessions", "Personalized recall"),
                           ("Four stitched systems", "One unified layer")]),
    ],
    "plans": [
        {"name": "Open Source", "price": "Self host",
         "lines": ["Run Tessel yourself", "S3-compatible storage", "Existing Neo4j drivers and openCypher",
                   "Import graphs", "Community support"]},
        {"name": "Ship", "price": "$25/mo min usage",
         "lines": ["Fully managed", "Storage: $0.50/GB-month", "Ontology engine $5 per 1M tokens ingested",
                   "100+ app connectors", "Advanced logs and monitoring"]},
        {"name": "Scale", "price": "$300/mo min usage",
         "lines": ["Everything in Ship", "Dedicated infrastructure", "Storage: $0.25/GB-month",
                   "$5 per 1M tokens ingested", "Uptime SLA", "Private chat channel", "SOC 2 and GDPR"]},
        {"name": "Enterprise", "price": "Custom",
         "lines": ["Your cloud or a dedicated cloud", "Forward-deployed engineer", "99% uptime SLA", "HIPAA BAA"]},
    ],
    "faqs": [
        ("What makes Tessel different?",
         "Tessel keeps every fact with the moment it became true, so one query answers what is true now and what was "
         "true at any earlier moment, from a numbered write log you can inspect."),
        ("Who is Tessel for?",
         "Engineering teams running software agents that need exact, current context about their own work."),
        ("Why can't I just use Postgres for this? Or pgGraph?",
         "You can store rows there. Tessel adds supersession, as-of graph queries and a deterministic keyword score "
         "on top of a write log, so the same question always returns the same answer."),
        ("When should I use Tessel instead of a vector database?",
         "When relationships and change over time matter more than textual similarity: owners, blockers, "
         "dependencies and decisions."),
        ("Does Tessel work with GraphRAG?",
         "Yes. Graph queries return the entities and paths a GraphRAG pipeline hands to its model, as of any moment."),
    ],
    "testimonials": [
        ("@riya.builds", "RB", "Our agents finally know who owns what this week."),
        ("@kofi_ops", "KO", "As-of queries ended our arguments about last quarter."),
        ("@linnea.dev", "LD", "The write log makes every answer explainable."),
        ("@marcus.ai", "MA", "Compaction never changed a result. That is the point."),
        ("@sana_k", "SK", "Keyword scores we can actually reason about."),
        ("@teo.graph", "TG", "Importing an export gave the exact same answers."),
        ("@ines_ml", "IM", "Scoped keys let each agent see only its database."),
        ("@dev.harper", "DH", "The console reads like a notebook, not a dashboard."),
    ],
}

CONTACT_PAGE = {
    "title": "Contact sales · Tessel",
    "description": "Talk to the Tessel team about a complete graph of context for your agents.",
    "metrics": [("88.7%", "EnterpriseRAG"), ("90.79%", "LongMemEval"), ("91.4%", "FinanceBench")],
    "included": ["99% SLA", "Dedicated cloud or BYOC", "HIPAA BAA", "Private Slack, dedicated FDE"],
}
