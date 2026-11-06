"""The pinned copy and figures of the public pages, recast for Tessel."""

COMPANY = "Tessel Labs, Inc"
COPYRIGHT = "(c) 2026 Tessel Labs, Inc"

HERO_HEADING = "Give agents ability to retrieve the most accurate context"
HERO_TEXT_ONE = (
    "Tessel stores decisions, facts, docs, relationships, knowledge, and how it all "
    "evolves, including what changed, when, and why, so your agents can understand and "
    "act on the right context, always. At any scale or complexity"
)
HERO_TEXT_TWO = (
    "The fast and scalable graph database, built on object storage for 10-100x lower "
    "costs, with assisted graph creation to save you time building and organizing your "
    "graph. Built for intelligent agents that deserve fast, accurate retrieval"
)

HERO_NODES = (
    "Tessel",
    "stores",
    "decisions",
    "facts",
    "docs",
    "relationships",
    "knowledge",
    "how it all evolves",
    "including",
    "what changed",
    "when",
    "why",
    "so",
    "agents",
    "can understand and act on",
    "the right context",
    "built on",
    "object storage",
    "for",
    "10-100x lower costs",
    "with assisted graph creation",
)

HERO_EDGES = (
    ("Tessel", "stores"),
    ("Tessel", "built on"),
    ("Tessel", "with assisted graph creation"),
    ("stores", "decisions"),
    ("stores", "facts"),
    ("stores", "docs"),
    ("stores", "relationships"),
    ("stores", "knowledge"),
    ("stores", "how it all evolves"),
    ("how it all evolves", "including"),
    ("including", "what changed"),
    ("including", "when"),
    ("including", "why"),
    ("why", "so"),
    ("so", "agents"),
    ("agents", "can understand and act on"),
    ("can understand and act on", "the right context"),
    ("built on", "object storage"),
    ("object storage", "for"),
    ("for", "10-100x lower costs"),
)

RESOURCES = (
    ("FAQs", "Common questions", "/#faq"),
    ("Blog", "Engineering and product notes", "/#faq"),
    ("Alternatives", "How Tessel compares", "/#faq"),
    ("Join Community", "Connect with us on chat", "/#faq"),
)

HEADER_LINKS = (
    ("Architecture", "architecture"),
    ("Benchmarks", "benchmarks"),
    ("Pricing", "pricing"),
)

LOGOS = (
    "toptal",
    "composio",
    "smallest.ai",
    "hsv.digital",
    "gio",
    "confida",
    "clinsight",
    "klubi",
    "Pocket",
    "Distyl",
)

FEATURE_CARDS = (
    {
        "title": "High recall accuracy",
        "figure": "94%",
        "caption": "Search accuracy",
        "kind": "figure",
    },
    {
        "title": "For cost efficiency and scale",
        "tiers": ("Hot cache", "Warm storage", "Default storage"),
        "kind": "tiers",
    },
    {"title": "Recall everything", "kind": "plain"},
    {
        "title": "Built for low latency",
        "figure": "< 200ms",
        "caption": "So you can build real-time applications",
        "kind": "lanes",
    },
)

ARCHITECTURE_LINE = (
    "Built on object storage, with separate compute for writes, indexing, and reads. "
    "A graph core designed for speed, affordability, and scale"
)

ORCHESTRATION_PANEL = (
    {"label": "User", "detail": ""},
    {
        "label": "Request understanding",
        "detail": "routing, entity extraction, query rewrite, safety flags",
    },
    {"label": "Retrieval orchestrator", "detail": "Cypher reads / writes"},
    {"label": "Vectorstore", "detail": "semantic + bm25 + rerank"},
    {"label": "Connectors", "detail": "100+ sources: workspace, email, CRM"},
    {"label": "DB filters", "detail": "SQL / NoSQL"},
)

CORE_PANEL = (
    {"label": "NAMESPACE", "detail": "multi-tenant isolation, auto-scalable"},
    {"label": "Writer node", "detail": "Cypher writes -> WAL + value log"},
    {"label": "Indexer node", "detail": "reads WAL entries -> builds index"},
    {
        "label": "Reader node",
        "detail": "Cypher queries -> index + pending WAL = strongly consistent",
    },
    {
        "label": "Unified storage",
        "detail": "namespace/data/wal, namespace/data/value, namespace/index, "
        "namespace/manifest.json",
    },
)

STORAGE_PATHS = (
    "namespace/data/wal",
    "namespace/data/value",
    "namespace/index",
    "namespace/manifest.json",
)

TIERS = (
    ("Hot", "in-memory cache"),
    ("Warm", "NVMe SSD"),
    ("Cold", "object storage"),
)

USE_CASES = (
    {
        "name": "Company brain",
        "description": "Give your agents the context to move work forward",
        "heading": "Agents are as smart as the context they have",
        "points": (
            "Every decision, document and owner in one graph",
            "Answers that know when a fact became true",
            "One retrieval layer for every internal agent",
        ),
    },
    {
        "name": "Multiplayer agent apps",
        "description": "Many agents, one shared memory",
        "heading": "Shared state without stitched systems",
        "points": (
            "Agents read each other's writes at once",
            "Write log numbering keeps every change ordered",
            "Reads stay strongly consistent under load",
        ),
    },
    {
        "name": "Ontologies",
        "description": "Model your domain and keep it honest",
        "heading": "Structure your knowledge on purpose",
        "points": (
            "Declared predicates instead of guessed labels",
            "Supersession keeps the history intact",
            "Queries read as sentences about your domain",
        ),
    },
    {
        "name": "Agent memory",
        "description": "Memory that survives the session",
        "heading": "Personalized recall for every user",
        "points": (
            "Facts carry the moment they became true",
            "Ask any question as of any past moment",
            "Nothing is forgotten when a session ends",
        ),
    },
    {
        "name": "Knowledge graphs",
        "description": "Graphs that scale with your corpus",
        "heading": "A full structured view of what you know",
        "points": (
            "Entities resolved across every source",
            "Relationships you can walk, not guess",
            "Keyword search and graph reads side by side",
        ),
    },
)

BENCHMARKS = (
    ("90.79%", "Overall accuracy", "LONGMEMEVAL-S"),
    ("90.73", "Score out of 100", "CODEWIKI-BENCH"),
    ("88.7", "Overall score", "ENTERPRISE RAG BENCH"),
    ("82%", "Overall, 10 dimensions", "BEAM 1M"),
    ("91.4%", "Recall@10", "FINANCEBENCH"),
)

CHART_TICKS = ("8K", "32K", "64K", "96K", "115K")
CHART_SERIES = (
    ("Tessel", 90.79, "90.79%"),
    ("VectorDB", 71.0, "71%"),
    ("Full context", 38.0, "38%"),
)
CHART_ROWS = (
    ("8K", "92.10%", "86.00%", "78.00%"),
    ("32K", "91.80%", "82.00%", "66.00%"),
    ("64K", "91.40%", "78.00%", "54.00%"),
    ("96K", "91.00%", "74.00%", "45.00%"),
    ("115K", "90.79%", "71%", "38%"),
)

COMPARISON_TABS = (
    {
        "name": "Vector databases",
        "pairs": (
            ("Similar is not relevant", "Relevant, stateful context"),
            ("Missed relationships", "A full structured view"),
            ("Forgotten sessions", "Personalized recall"),
            ("Four stitched systems", "One unified layer"),
        ),
    },
    {
        "name": "SQL databases",
        "pairs": (
            ("Similar is not relevant", "Relevant, stateful context"),
            ("Missed relationships", "A full structured view"),
            ("Forgotten sessions", "Personalized recall"),
            ("Four stitched systems", "One unified layer"),
        ),
    },
)

PLANS = (
    {
        "name": "Open Source",
        "price": "Self host",
        "points": (
            "Run Tessel yourself",
            "S3-compatible storage",
            "Existing Neo4j drivers and openCypher",
            "Import graphs",
            "Community support",
        ),
    },
    {
        "name": "Ship",
        "price": "$25/mo min usage",
        "points": (
            "Fully managed",
            "Storage: $0.50/GB-month",
            "Ontology engine $5 per 1M tokens ingested",
            "100+ app connectors",
            "Advanced logs and monitoring",
        ),
    },
    {
        "name": "Scale",
        "price": "$300/mo min usage",
        "points": (
            "Everything in Ship",
            "Dedicated infrastructure",
            "Storage: $0.25/GB-month",
            "$5 per 1M tokens ingested",
            "Uptime SLA",
            "Private chat channel",
            "SOC 2 and GDPR",
        ),
    },
    {
        "name": "Enterprise",
        "price": "Custom",
        "points": (
            "Your cloud or a dedicated cloud",
            "Forward-deployed engineer",
            "99% uptime SLA",
            "HIPAA BAA",
            "Talk to us",
        ),
    },
)

FAQS = (
    (
        "What makes Tessel different?",
        "Tessel stores the facts themselves with the moment each became true, so a "
        "question asked as of a past moment returns the answer that was true then. "
        "Every write shows in a numbered write log, and reads see pending writes at once.",
    ),
    (
        "Who is Tessel for?",
        "Engineering teams running software agents that need accurate, ordered context: "
        "company brains, multiplayer agent apps, ontologies, agent memory and knowledge "
        "graphs.",
    ),
    (
        "Why can't I just use Postgres for this? Or pgGraph?",
        "You can store rows, but you then own supersession, entity resolution, the write "
        "log, compaction and a read-only query language with as-of reads. Tessel decides "
        "those once, the same way for every caller.",
    ),
    (
        "When should I use Tessel instead of a vector database?",
        "When relevance depends on relationships and time rather than similarity. "
        "Similar is not relevant: an owner changes, a dependency is added, a block is "
        "cleared, and only a graph with validity carries that.",
    ),
    (
        "Does Tessel work with GraphRAG?",
        "Yes. Tessel answers keyword searches and graph queries over the same store, so a "
        "retrieval step can read scored passages and walk the graph in the same pass.",
    ),
)

TESTIMONIALS = (
    ("@ravi_builds", "RB", "Our agents stopped contradicting themselves the week we moved to Tessel."),
    ("@dana_ops", "DO", "As-of reads turned our incident reviews from guesswork into reading."),
    ("@priya_eng", "PE", "The write log is the first audit trail my team actually trusts."),
    ("@marco_s", "MS", "Compaction changed the filing and not one answer. Exactly as promised."),
    ("@lena_b", "LB", "One retrieval layer replaced four stitched systems for us."),
    ("@jordan_lee", "JL", "Scoring is pinned to the character, so our tests finally hold."),
    ("@amara_k", "AK", "Scoped API keys let each agent see only the database it owns."),
    ("@tomas_v", "TV", "The bill reads in cents and matches our own counting."),
)

FOOTER_MISSION = "Our mission is to make AI stateful"

FOOTER_COLUMNS = (
    ("Home", ("Why Tessel? Manifesto", "Architecture", "Contact")),
    (
        "Use cases",
        ("Company brain", "Code", "Memory", "Finance", "Beyond vector databases"),
    ),
    (
        "Compare",
        (
            "Tessel vs FalkorDB",
            "Tessel vs Neo4j",
            "Tessel vs Memgraph",
            "Tessel vs Dgraph",
            "Tessel vs Amazon Neptune",
            "Tessel vs ApertureDB",
        ),
    ),
    ("Legal", ("Trust center", "Privacy policy", "Terms of Service")),
)

FOOTER_STATS = (
    ("13k", "stars"),
    ("1M", "retrievals per month"),
    ("4x", "improvement in agent recall"),
    ("2k", "devs"),
)

FOOTER_BADGES = ("SOC 2", "GDPR", "HIPAA")

CONTACT_HEADING = "Contact sales"
CONTACT_LINE = (
    "A complete graph of context for your agents. We make your knowledge agent-ready so "
    "your AI keeps working in production."
)
CONTACT_METRICS = (
    ("88.7%", "EnterpriseRAG"),
    ("90.79%", "LongMemEval"),
    ("91.4%", "FinanceBench"),
)
CONTACT_ENTERPRISE = (
    "99% SLA",
    "Dedicated cloud or BYOC",
    "HIPAA BAA",
    "Private Slack, dedicated FDE",
)

LANDING_TITLE = "Tessel - Give agents ability to retrieve the most accurate context"
LANDING_DESCRIPTION = (
    "Tessel is a graph database console for software agents: facts with validity, a "
    "numbered write log, keyword search and as-of graph queries."
)
CONTACT_TITLE = "Contact sales - Tessel"
CONTACT_DESCRIPTION = (
    "Talk to Tessel about a managed context graph for your agents, with a 99% SLA, a "
    "dedicated cloud and a HIPAA BAA."
)

NAVIGATION_TAIL = (
    ("Architecture", "/#architecture"),
    ("Benchmarks", "/#benchmarks"),
    ("Pricing", "/#pricing"),
    ("FAQs Common questions", "/#faq"),
    ("Contact", "/contact"),
)
