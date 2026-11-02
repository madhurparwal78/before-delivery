"""Every page rendered as HTML on the server, plus its markdown twin."""
import html
import json
import math
import os
from urllib.parse import quote

from aiohttp import web

from . import pricing
from .config import PUBLIC_URL
from .handlers import SESSION_COOKIE, check_password, hash_password
from .textutil import dt_to_str, format_cents, is_plain_console_path, now

VOID = "#08090c"
PANEL = "#0d0f14"
RAISED = "#12151c"
HAIRLINE = "#171a21"
LINE_STRONG = "#22262f"
INK = "#ffffff"
INK60 = "rgba(255,255,255,0.6)"
MUTED = "#8a8f9a"
FAINT = "#5b6069"
SIGNAL = "#ff9d2b"
SIGNAL_HOVER = "#ffb257"
AMBER = "#ffd75e"


def esc(v):
    return html.escape(str(v), quote=True)


def head(title, description, path, console=False):
    canon = PUBLIC_URL + path
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(canon)}">
<link rel="stylesheet" href="/static/tessel.css">
<script src="/static/tessel.js" defer></script>
</head>
<body>"""


def skip_link():
    return '<a class="skip" href="#main">Skip to main content</a>'


async def session_member(pool, request):
    import hashlib
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    digest = hashlib.sha256(("t1:" + token).encode("utf-8")).hexdigest()
    row = await pool.fetchrow(
        "SELECT s.id AS session_id, m.id, m.email, m.role, m.organization_id, o.name AS org, "
        "o.plan FROM app.sessions s JOIN app.members m ON m.id = s.member_id "
        "JOIN app.organizations o ON o.id = m.organization_id "
        "WHERE s.token_digest = $1 AND s.revoked_at IS NULL", digest)
    if row is None:
        return None
    return dict(row)


def render_404(request):
    body = head("Page not found - Tessel", "This page does not exist", "/404") + skip_link()
    body += f"""<main id="main" class="wrap narrow">
<h1>Page not found</h1>
<p>The address {esc(request.path)} does not match any page of this site.</p>
<p><a class="inline" href="/">Go home</a></p>
</main>
</body></html>"""
    return body


def footer():
    return f"""
<footer class="footer">
  <div class="wrap">
    <p class="mission">Our mission is to make AI stateful</p>
    <div class="cols">
      <div><h3>Home</h3><ul>
        <li><a class="inline" href="/#why">Why Tessel? Manifesto</a></li>
        <li><a class="inline" href="/#architecture">Architecture</a></li>
        <li><a class="inline" href="/contact">Contact</a></li>
      </ul></div>
      <div><h3>Use cases</h3><ul>
        <li>Company brain</li><li>Code</li><li>Memory</li><li>Finance</li>
        <li>Beyond vector databases</li>
      </ul></div>
      <div><h3>Compare</h3><ul>
        <li>Tessel vs FalkorDB</li><li>Tessel vs Neo4j</li><li>Tessel vs Memgraph</li>
        <li>Tessel vs Dgraph</li><li>Tessel vs Amazon Neptune</li>
        <li>Tessel vs ApertureDB</li>
      </ul></div>
      <div><h3>Legal</h3><ul>
        <li>Trust center</li><li>Privacy policy</li><li>Terms of Service</li>
      </ul></div>
    </div>
    <div class="stats"><span>13k</span> stars<span>1M</span> retrievals per month
      <span>4x</span> improvement in agent recall<span>2k</span> devs</div>
    <div class="badges"><span class="capsule">SOC 2</span> <span class="capsule">GDPR</span>
      <span class="capsule">HIPAA</span></div>
    <p class="copyright">(c) 2026 Tessel Labs, Inc</p>
  </div>
</footer>"""


def header(current=None):
    return f"""
<a class="skip" href="#main">Skip to main content</a>
<div class="announce" role="region" aria-label="Announcement">Announcement
  <a class="inline" href="https://example.code/tessel-labs/tessel">Tessel is open source</a>
  <a class="inline" href="https://example.code/tessel-labs/tessel">View on code host</a>
</div>
<header class="pub-header" id="top">
  <nav class="pub-nav" aria-label="Main">
    <a class="wordmark" href="/">Tessel</a>
    <a class="navlink{' current' if current == 'architecture' else ''}" href="#architecture">Architecture</a>
    <a class="navlink{' current' if current == 'benchmarks' else ''}" href="#benchmarks">Benchmarks</a>
    <a class="navlink{' current' if current == 'pricing' else ''}" href="#pricing">Pricing</a>
    <div class="menu-wrap">
      <button class="menu-btn" aria-expanded="false" aria-haspopup="true" id="resources-btn">Resources <span class="chev" aria-hidden="true">▾</span></button>
      <div class="menu" id="resources-menu" hidden>
        <a class="menu-item" href="#faq"><strong>FAQs</strong><span>Common questions</span></a>
        <a class="menu-item" href="#faq"><strong>Blog</strong><span>Engineering and product notes</span></a>
        <a class="menu-item" href="#faq"><strong>Alternatives</strong><span>How Tessel compares</span></a>
        <a class="menu-item" href="#faq"><strong>Join Community</strong><span>Connect with us on chat</span></a>
      </div>
    </div>
    <a class="navlink" href="#docs">Docs</a>
    <span class="star-chip" id="star-chip" data-count="">
      <span class="star-icon" aria-hidden="true">★</span><span id="star-num">Star</span>
    </span>
    <a class="navlink" href="/login">Log in</a>
    <a class="btn capsule primary" href="/login">Sign up</a>
  </nav>
</header>"""


HERO_NODES = ["Tessel", "stores", "decisions", "facts", "docs", "relationships",
              "knowledge", "how it all evolves", "including", "what changed", "when",
              "why", "so", "agents", "can understand and act on", "the right context",
              "built on", "object storage", "for", "10-100x lower costs",
              "with assisted graph creation"]

HERO_EDGES = [("Tessel", "stores"), ("Tessel", "built on"), ("Tessel", "with assisted graph creation"),
              ("stores", "decisions"), ("stores", "facts"), ("stores", "docs"),
              ("stores", "relationships"), ("stores", "knowledge"),
              ("stores", "how it all evolves"), ("how it all evolves", "including"),
              ("including", "what changed"), ("including", "when"), ("including", "why"),
              ("why", "so"), ("so", "agents"), ("agents", "can understand and act on"),
              ("can understand and act on", "the right context"), ("built on", "object storage"),
              ("object storage", "for"), ("for", "10-100x lower costs")]

HERO_SENTENCE = ("Tessel stores decisions, facts, docs, relationships, knowledge, and how it "
                 "all evolves, including what changed, when, and why, so your agents can "
                 "understand and act on the right context, always. At any scale or complexity")

HERO_SUB = ("The fast and scalable graph database, built on object storage for 10-100x lower "
            "costs, with assisted graph creation to save you time building and organizing your "
            "graph. Built for intelligent agents that deserve fast, accurate retrieval")


def hero_graph_svg():
    cols = 4
    rows = math.ceil(len(HERO_NODES) / cols)
    w, h = 760, 420
    cw = w / (cols + 1)
    pos = {}
    for i, node in enumerate(HERO_NODES):
        col = i % cols
        row = i // cols
        pos[node] = (cw * (col + 1), 60 + row * ((h - 80) / max(1, rows - 1)))
    lines = []
    order = {n: i for i, n in enumerate(HERO_NODES)}
    for i, (a, b) in enumerate(HERO_EDGES):
        x1, y1 = pos[a]
        x2, y2 = pos[b]
        lines.append(f'<path class="hero-edge" style="--i:{i}" d="M{x1:.0f},{y1:.0f} '
                     f'L{x2:.0f},{y2:.0f}" stroke="{LINE_STRONG}" stroke-width="1" fill="none"/>')
    dots = []
    for i, node in enumerate(HERO_NODES):
        x, y = pos[node]
        fill = SIGNAL if node == "Tessel" else PANEL
        stroke = SIGNAL if node == "Tessel" else LINE_STRONG
        dots.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="7" fill="{fill}" stroke="{stroke}"/>'
                    f'<text x="{x:.0f}" y="{y:.0f}" dy="-12" class="hero-label" '
                    f'text-anchor="middle">{esc(node)}</text>')
    return ('<svg viewBox="0 0 %d %d" role="img" aria-label="%s" class="hero-svg">'
            '%s%s</svg>') % (w, h, esc(HERO_SENTENCE), "".join(lines), "".join(dots))


def landing_page(request):
    title = "Tessel - Give agents ability to retrieve the most accurate context"
    description = ("Tessel stores decisions, facts, docs, relationships, knowledge, and how it "
                   "all evolves, so your agents always act on the right context.")
    out = [head(title, description, "/"), header()]
    out.append(f"""
<main id="main">
<section class="hero" id="hero">
  <h1 class="hero-heading"><span class="rise" style="--i:0">Give agents ability to retrieve</span>
  <span class="rise" style="--i:1">the most accurate context</span></h1>
  <fieldset class="view-switch" role="radiogroup" aria-label="Hero view">
    <label><input type="radio" name="hero-view" value="text" checked>Text</label>
    <label><input type="radio" name="hero-view" value="graph">Graph</label>
  </fieldset>
  <div class="hero-panel" id="hero-panel">
    <div class="hero-text" id="hero-text">
      <p>{esc(HERO_SENTENCE)}</p>
      <p>{esc(HERO_SUB)}</p>
      <p class="sr-only">{esc(HERO_SENTENCE)}</p>
    </div>
    <div class="hero-graph" id="hero-graph" hidden>{hero_graph_svg()}</div>
  </div>
  <div class="hero-cta">
    <a class="btn capsule primary" href="/login">Sign up</a>
    <a class="btn capsule secondary" href="/contact">Talk to us</a>
  </div>
</section>

<section class="logos" aria-label="Trusted by teams building world-class agents">
  <p>Trusted by teams building world-class agents</p>
  <div class="logo-track">
    <div class="logo-row">{''.join('<span>%s</span>' % n for n in
      ["toptal","composio","smallest.ai","hsv.digital","gio","confida","clinsight","klubi","Pocket","Distyl"])}</div>
    <div class="logo-row" aria-hidden="true">{''.join('<span>%s</span>' % n for n in
      ["toptal","composio","smallest.ai","hsv.digital","gio","confida","clinsight","klubi","Pocket","Distyl"])}</div>
  </div>
</section>

<section class="section" id="features">
  <h2 class="section-heading rise" style="--i:2">The GraphDB purpose-built for agents</h2>
  <div class="feature-grid">
    <div class="card feature"><h3>High recall accuracy</h3><p class="figure">94%</p>
      <p class="cap">Search accuracy</p></div>
    <div class="card feature"><h3>For cost efficiency and scale</h3>
      <div class="tiers" aria-label="Hot cache, warm storage, default storage">
        <div class="tier">Hot cache</div><div class="tier">Warm storage</div>
        <div class="tier">Default storage</div></div></div>
    <div class="card feature"><h3>Recall everything</h3>
      <p class="cap">Nothing your team writes is ever lost, superseded or not</p></div>
    <div class="card feature"><h3>Built for low latency</h3><p class="figure">&lt; 200ms</p>
      <p class="cap">So you can build real-time applications</p>
      <div class="lanes" aria-hidden="true">{''.join('<span class="lane"><span class="bar"></span></span>' for _ in range(7))}</div></div>
  </div>
</section>

<section class="section" id="architecture">
  <h2 class="section-heading rise" style="--i:3">Architecture</h2>
  <p>Built on object storage, with separate compute for writes, indexing, and reads. A graph core designed for speed, affordability, and scale</p>
  <div class="arch-panels">
    <div class="panelbox">
      <h3>Orchestration</h3>
      <div class="node">User</div>
      <div class="node"><strong>Request understanding</strong><p>routing · entity extraction · query rewrite · safety flags</p></div>
      <div class="node"><strong>Retrieval orchestrator</strong><p>Cypher reads / writes</p></div>
      <div class="node-row">
        <div class="node"><strong>Vectorstore</strong><p>semantic + bm25 + rerank</p></div>
        <div class="node"><strong>Connectors</strong><p>100+ sources: workspace, email, CRM</p></div>
        <div class="node"><strong>DB filters</strong><p>SQL / NoSQL</p></div>
      </div>
    </div>
    <div class="panelbox">
      <h3>Tessel core</h3>
      <div class="node"><strong>NAMESPACE</strong><p>multi-tenant isolation, auto-scalable</p></div>
      <div class="node"><strong>Writer node</strong><p>Cypher writes -&gt; WAL + value log</p></div>
      <div class="node"><strong>Indexer node</strong><p>reads WAL entries -&gt; builds index</p></div>
      <div class="node"><strong>Reader node</strong><p>Cypher queries -&gt; index + pending WAL = strongly consistent</p></div>
      <div class="node"><strong>Unified storage</strong>
        <p>namespace/data/wal · namespace/data/value · namespace/index · namespace/manifest.json</p></div>
      <div class="tier-row"><div class="tier">Hot - in-memory cache</div>
        <div class="tier">Warm - NVMe SSD</div><div class="tier">Cold - object storage</div></div>
    </div>
  </div>
  <p class="sr-only">The user request reaches request understanding, then the retrieval
  orchestrator, which uses the vectorstore, connectors and database filters. Writes go through
  the writer node to the write-ahead log and value log; the indexer node reads the log entries
  and builds the index; the reader node answers Cypher queries from the index plus the pending
  log, strongly consistent, over unified storage with hot, warm and cold tiers.</p>
</section>

<section class="section" id="usecases">
  <h2 class="section-heading rise" style="--i:4">What do you use graphs for?</h2>
  <div class="tabs" role="tablist" aria-label="Use cases">
    <button class="tab" role="tab" aria-selected="true" id="uc0">Company brain</button>
    <button class="tab" role="tab" aria-selected="false" id="uc1">Multiplayer agent apps</button>
    <button class="tab" role="tab" aria-selected="false" id="uc2">Ontologies</button>
    <button class="tab" role="tab" aria-selected="false" id="uc3">Agent memory</button>
    <button class="tab" role="tab" aria-selected="false" id="uc4">Knowledge graphs</button>
  </div>
  <div class="tab-panels">
    <div class="tab-panel" role="tabpanel" data-panel="0">
      <h3>Give your agents the context to move work forward</h3>
      <p>Agents are as smart as the context they have.</p>
      <ul><li>Every decision and fact, with the moment it became true</li>
      <li>Answers as of any past moment, not just the latest write</li>
      <li>One place your whole team writes into</li></ul></div>
    <div class="tab-panel" role="tabpanel" data-panel="1" hidden>
      <h3>Coordinate agents on shared state</h3>
      <p>Graphs make concurrent work legible.</p>
      <ul><li>Isolated context databases per team</li><li>A numbered write log of every change</li>
      <li>Safe retries with idempotency keys</li></ul></div>
    <div class="tab-panel" role="tabpanel" data-panel="2" hidden>
      <h3>Model your domain as it is</h3>
      <p>Predicates, not prose.</p>
      <ul><li>Declared facts at ingest</li><li>Supersession by valid_from</li>
      <li>History for every subject and predicate</li></ul></div>
    <div class="tab-panel" role="tabpanel" data-panel="3" hidden>
      <h3>Remember what happened, and when</h3>
      <p>Memory with timestamps beats memory without.</p>
      <ul><li>Facts carry valid_from</li><li>Explore any moment on a timeline</li>
      <li>Restore deleted sources exactly</li></ul></div>
    <div class="tab-panel" role="tabpanel" data-panel="4" hidden>
      <h3>Query knowledge as a graph</h3>
      <p>A small read-only query language.</p>
      <ul><li>Pattern matching with ranged paths</li><li>WHERE conditions and counts</li>
      <li>Deterministic row order</li></ul></div>
  </div>
</section>

<section class="section" id="benchmarks">
  <h2 class="section-heading rise" style="--i:5">SOTA for agent applications</h2>
  <div class="bench-grid">""")
    cells = [("90.79%", "Overall accuracy", "LONGMEMEVAL-S"),
             ("90.73", "Score out of 100", "CODEWIKI-BENCH"),
             ("88.7", "Overall score", "ENTERPRISE RAG BENCH"),
             ("82%", "Overall, 10 dimensions", "BEAM 1M"),
             ("91.4%", "Recall@10", "FINANCEBENCH")]
    for figure, caption, label in cells:
        out.append(f"""
    <div class="bench-cell" tabindex="0">
      <div class="bench-glow" aria-hidden="true"></div>
      <p class="figure">{esc(figure)}</p>
      <p class="cap">{esc(caption)}</p>
      <p class="label">{esc(label)}</p>
      <span class="arrow" aria-hidden="true">↗</span>
    </div>""")
    out.append(f"""
  </div>
</section>

<section class="section" id="chart">
  <h2 class="section-heading rise" style="--i:6">Accuracy vs context length</h2>
  <p class="axis-cap">conversation tokens</p>
  <div class="chart" role="img" aria-label="Accuracy against context length">
    <div class="ticks"><span>8K</span><span>32K</span><span>64K</span><span>96K</span><span>115K</span></div>
    <svg viewBox="0 0 640 240" class="chart-svg">
      <polyline fill="none" stroke="{SIGNAL}" stroke-width="2" points="20,40 620,40"/>
      <polyline fill="none" stroke="{MUTED}" stroke-width="2" points="20,120 620,120"/>
      <polyline fill="none" stroke="{FAINT}" stroke-width="2" points="20,180 620,180"/>
    </svg>
    <p class="chart-legend"><span class="sw" style="background:{SIGNAL}"></span>Tessel 90.79%
      <span class="sw" style="background:{MUTED}"></span>VectorDB 71%
      <span class="sw" style="background:{FAINT}"></span>Full context 38%</p>
  </div>
  <table class="chart-table"><caption>Accuracy by context length</caption>
    <thead><tr><th>Context</th><th>Tessel</th><th>VectorDB</th><th>Full context</th></tr></thead>
    <tbody><tr><td>8K</td><td>90.79%</td><td>71%</td><td>38%</td></tr>
    <tr><td>32K</td><td>90.79%</td><td>71%</td><td>38%</td></tr>
    <tr><td>64K</td><td>90.79%</td><td>71%</td><td>38%</td></tr>
    <tr><td>96K</td><td>90.79%</td><td>71%</td><td>38%</td></tr>
    <tr><td>115K</td><td>90.79%</td><td>71%</td><td>38%</td></tr></tbody></table>
</section>

<section class="section" id="compare">
  <h2 class="section-heading rise" style="--i:7">Similarity isn't relevance</h2>
  <div class="tabs" role="tablist" aria-label="Comparison">
    <button class="tab" role="tab" aria-selected="true" id="cmp0">Vector databases</button>
    <button class="tab" role="tab" aria-selected="false" id="cmp1">SQL databases</button>
  </div>
  <div class="tab-panels">
    <div class="tab-panel" role="tabpanel" data-panel="cmp0">
      <div class="compare-row"><div class="cmp-old">Similar is not relevant</div>
        <span class="cmp-arrow" aria-hidden="true">→</span>
        <div class="cmp-new">Relevant, stateful context</div></div>
      <div class="compare-row"><div class="cmp-old">Missed relationships</div>
        <span class="cmp-arrow" aria-hidden="true">→</span>
        <div class="cmp-new">A full structured view</div></div>
      <div class="compare-row"><div class="cmp-old">Forgotten sessions</div>
        <span class="cmp-arrow" aria-hidden="true">→</span>
        <div class="cmp-new">Personalized recall</div></div>
      <div class="compare-row"><div class="cmp-old">Four stitched systems</div>
        <span class="cmp-arrow" aria-hidden="true">→</span>
        <div class="cmp-new">One unified layer</div></div>
    </div>
    <div class="tab-panel" role="tabpanel" data-panel="cmp1" hidden>
      <div class="compare-row"><div class="cmp-old">Similar is not relevant</div>
        <span class="cmp-arrow" aria-hidden="true">→</span>
        <div class="cmp-new">Relevant, stateful context</div></div>
      <div class="compare-row"><div class="cmp-old">Missed relationships</div>
        <span class="cmp-arrow" aria-hidden="true">→</span>
        <div class="cmp-new">A full structured view</div></div>
      <div class="compare-row"><div class="cmp-old">Forgotten sessions</div>
        <span class="cmp-arrow" aria-hidden="true">→</span>
        <div class="cmp-new">Personalized recall</div></div>
      <div class="compare-row"><div class="cmp-old">Four stitched systems</div>
        <span class="cmp-arrow" aria-hidden="true">→</span>
        <div class="cmp-new">One unified layer</div></div>
    </div>
  </div>
</section>
""")
    out.append(pricing_section())
    out.append(faq_section())
    out.append(testimonials_section())
    out.append("</main>")
    out.append(view_switch("/"))
    out.append(footer())
    out.append("</body></html>")
    return "".join(out)


def pricing_section():
    return f"""
<section class="section" id="pricing">
  <h2 class="section-heading rise" style="--i:8">Pricing</h2>
  <div class="plan-grid">
    <div class="card plan"><h3>Open Source</h3><p class="price">Self host</p>
      <ul><li>Run Tessel yourself</li><li>S3-compatible storage</li>
      <li>Existing Neo4j drivers and openCypher</li><li>Import graphs</li>
      <li>Community support</li></ul></div>
    <div class="card plan"><h3>Ship</h3><p class="price">$25/mo min usage</p>
      <ul><li>Fully managed</li><li>Storage: $0.50/GB-month</li>
      <li>Ontology engine $5 per 1M tokens ingested</li><li>100+ app connectors</li>
      <li>Advanced logs and monitoring</li></ul></div>
    <div class="card plan"><h3>Scale</h3><p class="price">$300/mo min usage</p>
      <ul><li>Everything in Ship</li><li>Dedicated infrastructure</li>
      <li>Storage: $0.25/GB-month</li><li>$5 per 1M tokens ingested</li>
      <li>Uptime SLA</li><li>Private chat channel</li><li>SOC 2 and GDPR</li></ul></div>
    <div class="card plan"><h3>Enterprise</h3><p class="price">Custom</p>
      <ul><li>Your cloud or a dedicated cloud</li><li>Forward-deployed engineer</li>
      <li>99% uptime SLA</li><li>HIPAA BAA</li>
      <li><a class="inline" href="/contact">Talk to us</a></li></ul></div>
  </div>
  <div class="card calculator" id="calculator">
    <h3>Price calculator</h3>
    <div class="calc-row">
      <label for="calc-gb">Storage (GB)</label>
      <input id="calc-gb" type="text" inputmode="decimal" value="3.2" autocomplete="off">
    </div>
    <div class="calc-row">
      <label for="calc-mt">Tokens ingested per month (millions)</label>
      <input id="calc-mt" type="text" inputmode="decimal" value="2.4" autocomplete="off">
    </div>
    <p class="calc-error" id="calc-error" role="alert" hidden></p>
    <dl class="calc-out">
      <div><dt>Open Source</dt><dd id="calc-os">$0.00</dd></div>
      <div><dt>Ship</dt><dd id="calc-ship">$25.00 <span class="min-applies">minimum applies</span></dd></div>
      <div><dt>Scale</dt><dd id="calc-scale">$300.00 <span class="min-applies">minimum applies</span></dd></div>
      <div><dt>Enterprise</dt><dd>Custom</dd></div>
    </dl>
  </div>
</section>"""


FAQ_ITEMS = [
    ("What makes Tessel different?",
     "Tessel keeps the moment every fact became true, so answers follow the timeline "
     "instead of the latest write."),
    ("Who is Tessel for?",
     "Agent teams who need their working knowledge to answer questions as of any moment."),
    ("Why can't I just use Postgres for this? Or pgGraph?",
     "You can store facts anywhere. Tessel adds the supersession rule, the write log, "
     "compaction and a query language that all agree on one answer per moment."),
    ("When should I use Tessel instead of a vector database?",
     "When relationships and time matter more than similarity. Similarity finds neighbours; "
     "Tessel finds the fact that holds at the moment you ask."),
    ("Does Tessel work with GraphRAG?",
     "Yes. Declare your facts at ingest and query them as a graph, as of any moment."),
]


def faq_section():
    out = ['<section class="section" id="faq"><h2 class="section-heading rise" '
           'style="--i:9">FAQs</h2>']
    for i, (q, a) in enumerate(FAQ_ITEMS):
        out.append(f"""
  <div class="faq-item">
    <button class="faq-q" aria-expanded="false" aria-controls="faq-a{i}" id="faq-q{i}">
      <span>{esc(q)}</span><span class="plus" aria-hidden="true">+</span></button>
    <div class="faq-a" id="faq-a{i}" role="region" aria-labelledby="faq-q{i}" hidden>{esc(a)}</div>
  </div>""")
    out.append("</section>")
    return "".join(out)


TESTIMONIALS = [
    ("The timeline is the thing. Our launch reviews finally agree on one past.", "priya@atlas"),
    ("We stopped guessing which answer is current. The graph tells us.", "marco@ledger"),
    ("Compaction changed nothing for our queries, exactly as promised.", "dana@platform"),
    ("Idempotent retries let our agents write without fear.", "sam@recon"),
    ("The write log is our changelog. Numbered, gapless, honest.", "jules@notes"),
    ("As-of queries answered questions our old tool could not even ask.", "lena@review"),
    ("One database per team, isolated, the way it should be.", "rico@ops"),
    ("The bill matches the stats to the cent. That is rare.", "nadia@fin"),
]


def testimonials_section():
    out = ['<section class="section" id="testimonials"><h2 class="section-heading rise" '
           'style="--i:10">What teams say</h2><div class="quote-grid">']
    for text, handle in TESTIMONIALS:
        initials = "".join(w[0] for w in handle.split("@")[0].split("-")[:2]).upper()
        out.append(f"""
  <figure class="card quote"><span class="avatar" aria-hidden="true">{esc(initials)}</span>
    <blockquote>{esc(text)}</blockquote><figcaption>{esc(handle)}</figcaption></figure>""")
    out.append("</div></section>")
    return "".join(out)


def view_switch(path):
    md_path = path + "?md"
    return f"""
<div class="view-switch-fixed" role="radiogroup" aria-label="View this page as"
     id="view-as" data-path="{esc(path)}">
  <span class="vs-indicator" aria-hidden="true"></span>
  <label><input type="radio" name="view-as" value="human" checked>Human</label>
  <label><input type="radio" name="view-as" value="ai">AI</label>
</div>"""


def md_twin(title, description, sections):
    """The markdown twin: front matter, body, navigation tail."""
    out = ["---", 'title: "%s"' % title.replace('"', '\\"'),
           "description: " + description, "---", ""]
    out.extend(sections)
    out.extend(["---", "", "## Navigation",
                "- [Architecture](/#architecture)",
                "- [Benchmarks](/#benchmarks)",
                "- [Pricing](/#pricing)",
                "- [FAQs Common questions](/#faq)",
                "- [Contact](/contact)", ""])
    return "\n".join(out)


# ---------------------------------------------------------------- page routes

async def p_landing(request):
    if wants_markdown(request):
        twin = landing_markdown()
        size = len(twin.encode("utf-8")) / 1024
        tokens_est = int(len(twin) / 4)
        return web.Response(text=twin, content_type="text/markdown", charset="utf-8",
                            headers={"Vary": "Accept"})
    body = landing_page(request)
    if "view=ai" in request.query_string or request.query.get("view") == "ai":
        body = body.replace("</body>", ai_reader_html("/", landing_markdown()) + "</body>")
    return html_response(body)


def wants_markdown(request):
    if "md" in request.query:
        return True
    accept = request.headers.get("Accept", "")
    return "text/markdown" in accept


def html_response(body, status=200, headers=None):
    hdrs = {"X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "X-Frame-Options": "DENY", "Cache-Control": "no-store"}
    if headers:
        hdrs.update(headers)
    return web.Response(text=body, status=status, content_type="text/html",
                        charset="utf-8", headers=hdrs)


def landing_markdown():
    title = "Tessel - Give agents ability to retrieve the most accurate context"
    description = ("Tessel stores decisions, facts, docs, relationships, knowledge, and how "
                   "it all evolves, so your agents always act on the right context.")
    sections = [
        "# " + HERO_HEADING_MD,
        "",
        HERO_SENTENCE_MD,
        "",
        HERO_SUB,
        "",
        "## The GraphDB purpose-built for agents",
        "",
        "94% Search accuracy. Hot cache, warm storage and default storage tiers, "
        "recall everything, and under 200ms latency.",
        "",
        "## Architecture",
        "",
        "Built on object storage, with separate compute for writes, indexing, and reads. "
        "A graph core designed for speed, affordability, and scale",
        "",
        "## What do you use graphs for?",
        "",
        "Company brain: Give your agents the context to move work forward. "
        "Agents are as smart as the context they have.",
        "",
        "## SOTA for agent applications",
        "",
        "- 90.79% Overall accuracy (LONGMEMEVAL-S)",
        "- 90.73 Score out of 100 (CODEWIKI-BENCH)",
        "- 88.7 Overall score (ENTERPRISE RAG BENCH)",
        "- 82% Overall, 10 dimensions (BEAM 1M)",
        "- 91.4% Recall@10 (FINANCEBENCH)",
        "",
        "## Accuracy vs context length",
        "",
        "Tessel ends at 90.79%, VectorDB at 71% and full context at 38% across "
        "8K, 32K, 64K, 96K and 115K conversation tokens.",
        "",
        "## Similarity isn't relevance",
        "",
        "Similar is not relevant -> Relevant, stateful context. Missed relationships -> "
        "A full structured view. Forgotten sessions -> Personalized recall. "
        "Four stitched systems -> One unified layer.",
        "",
        "## Pricing",
        "",
        "- Open Source: Self host",
        "- Ship: $25/mo min usage. Storage: $0.50/GB-month, ontology engine $5 per 1M "
        "tokens ingested",
        "- Scale: $300/mo min usage. Storage: $0.25/GB-month, $5 per 1M tokens ingested",
        "- Enterprise: Custom",
        "",
        "## FAQs",
        "",
    ]
    for q, a in FAQ_ITEMS:
        sections.append("### " + q)
        sections.append("")
        sections.append(a)
        sections.append("")
    sections.extend(["## What teams say", ""])
    for text, handle in TESTIMONIALS:
        sections.append('"%s" - %s' % (text, handle))
        sections.append("")
    return md_twin(title, description, sections)


HERO_HEADING_MD = "Give agents ability to retrieve the most accurate context"
HERO_SENTENCE_MD = HERO_SENTENCE
HERO_SUB_MD = HERO_SUB


def ai_reader_html(path, twin):
    size_kb = len(twin.encode("utf-8")) / 1024
    size_line = "%.1f" % (math.floor(size_kb * 10 + 0.5) / 10)
    char_tokens = len(twin) // 4
    if char_tokens >= 1000:
        tokens_line = "%.1fk" % (math.floor((char_tokens / 1000) * 10) / 10)
    else:
        tokens_line = str(char_tokens)
    lines = twin.split("\n")
    rows = []
    for i, line in enumerate(lines, start=1):
        cls = ' class="md-heading"' if line.startswith("#") else ""
        rows.append('<div class="md-line"><span class="md-num">%d</span>'
                    '<span%s>%s</span></div>' % (i, cls, esc(line)))
    return f"""
<div class="reader" id="reader" role="dialog" aria-label="Markdown reader">
  <div class="reader-bar">
    <code>GET {esc(path)}?md</code>
    <code>Accept: text/markdown</code>
    <span>{size_line} KB . ~{tokens_line} tokens</span>
    <button class="btn capsule secondary" id="reader-copy">Copy</button>
    <a class="btn capsule secondary" id="reader-raw" href="{esc(path)}?md">Raw</a>
    <button class="btn capsule secondary" id="reader-close">Close</button>
  </div>
  <div class="reader-body">{''.join(rows)}</div>
</div>"""


CONTACT_MD_TITLE = "Contact sales - Tessel"
CONTACT_MD_DESC = ("A complete graph of context for your agents. We make your knowledge "
                   "agent-ready so your AI keeps working in production.")


def contact_markdown():
    sections = [
        "# Contact sales",
        "",
        "A complete graph of context for your agents. We make your knowledge agent-ready "
        "so your AI keeps working in production.",
        "",
        "Agent benchmarks: 88.7% EnterpriseRAG, 90.79% LongMemEval, 91.4% FinanceBench.",
        "",
        "Open source: tessel-labs/tessel",
        "",
        "Included with Enterprise: 99% SLA, dedicated cloud or BYOC, HIPAA BAA, "
        "private Slack with a dedicated forward-deployed engineer.",
        "",
        "Book a call, or send the form with your work email and a message of between "
        "10 and 4000 characters.",
        "",
    ]
    return md_twin(CONTACT_MD_TITLE, CONTACT_MD_DESC, sections)


async def p_contact(request):
    if wants_markdown(request):
        return web.Response(text=contact_markdown(), content_type="text/markdown",
                            charset="utf-8", headers={"Vary": "Accept"})
    error = None
    thanks = False
    values = {"email": "", "message": ""}
    if request.method == "POST":
        form = await request.post()
        email = form.get("email", "")
        message = form.get("message", "")
        website = form.get("website", "")
        values = {"email": email, "message": message}
        from .textutil import cp_len, valid_email
        if website:
            thanks = True
        elif not valid_email(email):
            error = "email"
        elif not (10 <= cp_len(message) <= 4000):
            error = "message"
        else:
            pool = request.app["db"]["pool"]
            stored = await pool.fetchval(
                "SELECT count(*) FROM app.contact_messages WHERE email = $1 "
                "AND created_at > now() - interval '60 minutes'", email)
            if stored >= 3:
                error = "rate"
            else:
                await pool.execute(
                    "INSERT INTO app.contact_messages (email, message, created_at) "
                    "VALUES ($1,$2,now())", email, message)
                thanks = True
    body = head("Contact sales - Tessel", CONTACT_MD_DESC, "/contact") + header()
    body += """
<main id="main" class="wrap narrow">
<h1>Contact sales</h1>
<p>A complete graph of context for your agents. We make your knowledge agent-ready so your AI keeps working in production.</p>
<div class="card bench-links" id="benchmarks-link">
  <h2>Agent benchmarks</h2>
  <a class="metric" href="#benchmarks">88.7% EnterpriseRAG <span>Read results</span></a>
  <a class="metric" href="#benchmarks">90.79% LongMemEval <span>Read results</span></a>
  <a class="metric" href="#benchmarks">91.4% FinanceBench <span>Read results</span></a>
</div>
<div class="card oss-card">
  <h2>Open source</h2>
  <a class="inline" href="https://example.code/tessel-labs/tessel">tessel-labs/tessel
    <span class="arrow" aria-hidden="true">↗</span></a>
</div>
<div class="card ent-card">
  <h2>Included with Enterprise</h2>
  <ul>
    <li><span class="plus-dot" aria-hidden="true">+</span>99% SLA</li>
    <li><span class="plus-dot" aria-hidden="true">+</span>Dedicated cloud or BYOC</li>
    <li><span class="plus-dot" aria-hidden="true">+</span>HIPAA BAA</li>
    <li><span class="plus-dot" aria-hidden="true">+</span>Private Slack, dedicated FDE</li>
  </ul>
  <a class="book-call" href="#contact-form">Book a call</a>
</div>
"""
    if thanks:
        body += "<p class='thanks' role='status'>Thanks. We will reply within one business day.</p>"
    else:
        rate_note = ('<p class="form-error-top" role="alert">Too many requests. '
                     'Try again in 60 seconds.</p>') if error == "rate" else ""
        body += f"""
{rate_note}
<form method="post" action="/contact" class="card contact-form" id="contact-form">
  <div class="field">
    <label for="cf-email">Work email</label>
    <input id="cf-email" name="email" type="email" value="{esc(values['email'])}"
      {'aria-invalid="true"' if error == 'email' else ''} autocomplete="email">
    <p class="field-error" role="alert"
       {'hidden' if error != 'email' else ''}>Enter a valid email address</p>
  </div>
  <div class="field">
    <label for="cf-message">Message</label>
    <textarea id="cf-message" name="message"
      {'aria-invalid="true"' if error == 'message' else ''}>{esc(values['message'])}</textarea>
    <p class="field-error" role="alert"
       {'hidden' if error != 'message' else ''}>Write between 10 and 4000 characters</p>
  </div>
  <input type="text" name="website" class="honeypot" tabindex="-1"
         autocomplete="off" aria-hidden="true">
  <button type="submit" class="btn capsule send">Send message</button>
</form>
"""
    body += "</main>" + view_switch("/contact") + footer() + "</body></html>"
    if request.method == "POST" and error:
        return html_response(body, status=400 if error != "rate" else 429)
    return html_response(body)


async def p_login(request):
    pool = request.app["db"]["pool"]
    expired = request.query.get("expired") == "1"
    if request.method == "POST":
        import hashlib
        import secrets as _secrets
        form = await request.post()
        email = (form.get("email") or "").strip().lower()
        password = form.get("password") or ""
        next_value = form.get("next") or ""
        member = await pool.fetchrow(
            "SELECT m.id, m.email, m.role, m.password_hash, o.name AS org, o.plan "
            "FROM app.members m JOIN app.organizations o ON o.id = m.organization_id "
            "WHERE lower(m.email) = $1", email)
        target = next_value if is_plain_console_path(next_value) else "/console"
        if member is None or not check_password(password, member["password_hash"]):
            return login_page(request, error="Email or password is incorrect",
                             email=email, next_value=next_value, status=401,
                             expired=expired)
        token = _secrets.token_urlsafe(32)
        digest = hashlib.sha256(("t1:" + token).encode("utf-8")).hexdigest()
        await pool.execute(
            "INSERT INTO app.sessions (member_id, token_digest, created_at) "
            "VALUES ($1,$2,now())", member["id"], digest)
        resp = web.HTTPSeeOther(target)
        resp.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="Lax", path="/")
        return resp
    return login_page(request, expired=expired)


def login_page(request, error=None, email="", next_value="", status=200,
                notice=None, expired=False):
    body = head("Sign in - Tessel", "Sign in to the Tessel console", "/login")
    ended = ('<p class="form-error-top" role="alert">Your session has ended. '
             'Sign in again.</p>') if expired else ""
    body += f"""
<main id="main" class="wrap narrow auth">
<h1>Sign in</h1>
{ended}
{('<p class="form-error-top shake" role="alert">' + esc(notice) + '</p>') if notice else ''}
{('<p class="form-error-top shake" role="alert">' + esc(error) + '</p>') if error else ''}
<form method="post" action="/login" class="card auth-form" id="login-form">
  <input type="hidden" name="next" value="{esc(next_value)}">
  <div class="field">
    <label for="li-email">Email</label>
    <input id="li-email" name="email" type="email" value="{esc(email)}"
           autocomplete="username" {'aria-invalid="true"' if error else ''}>
  </div>
  <div class="field">
    <label for="li-password">Password</label>
    <input id="li-password" name="password" type="password" autocomplete="current-password"
           {'aria-invalid="true"' if error else ''}>
  </div>
  <button type="submit" class="btn capsule primary">Sign in</button>
  <p><a class="inline" href="/forgot">Forgot password?</a></p>
</form>
</main>
</body></html>"""
    return html_response(body, status=status)


async def p_forgot(request):
    expired = request.query.get("expired") == "1"
    if request.method == "POST":
        import hashlib
        import secrets as _secrets
        form = await request.post()
        email = (form.get("email") or "").strip().lower()
        from .textutil import valid_email
        sent = False
        if valid_email(email):
            member = await request.app["db"]["pool"].fetchrow(
                "SELECT m.id, m.email FROM app.members m WHERE lower(m.email) = $1", email)
            if member is not None:
                sent_count = await request.app["db"]["pool"].fetchval(
                    "SELECT count(*) FROM app.reset_emails WHERE member_id = $1 "
                    "AND at > now() - interval '60 minutes'", member["id"])
                if sent_count < 3:
                    token = _secrets.token_hex(32)
                    digest = hashlib.sha256(("t1:" + token).encode("utf-8")).hexdigest()
                    pool = request.app["db"]["pool"]
                    async with pool.acquire() as conn:
                        async with conn.transaction():
                            await conn.execute(
                                "UPDATE app.reset_tokens SET used_at = now() "
                                "WHERE member_id = $1 AND used_at IS NULL", member["id"])
                            await conn.execute(
                                "INSERT INTO app.reset_tokens (member_id, digest, created_at) "
                                "VALUES ($1,$2,now())", member["id"], digest)
                            await conn.execute(
                                "INSERT INTO app.reset_emails (member_id, at) "
                                "VALUES ($1, now())", member["id"])
                    from . import mail
                    link = PUBLIC_URL + "/reset?token=" + token
                    await mail.send(request.app, member["email"],
                                   "Reset your Tessel password",
                                   link + "\n\nUse this link once to set a new password.")
        body = head("Reset link sent - Tessel", "A reset link is on its way", "/forgot")
        body += """<main id="main" class="wrap narrow auth">
<h1>Check your email</h1>
<p role="status">If that email belongs to a member, a reset link is on its way.</p>
<p><a class="inline" href="/login">Back to sign in</a></p>
</main></body></html>"""
        return html_response(body)
    body = head("Forgot password - Tessel", "Ask for a password reset link", "/forgot")
    body += """
<main id="main" class="wrap narrow auth">
<h1>Forgot password</h1>
<form method="post" action="/forgot" class="card auth-form">
  <div class="field">
    <label for="fg-email">Email</label>
    <input id="fg-email" name="email" type="email" autocomplete="username" required>
  </div>
  <button type="submit" class="btn capsule primary">Send reset link</button>
</form>
</main>
</body></html>"""
    return html_response(body)


async def p_reset(request):
    import hashlib
    pool = request.app["db"]["pool"]
    token = request.query.get("token") or ""
    if request.method == "POST":
        form = await request.post()
        password = form.get("password") or ""
        confirm = form.get("confirm") or ""
        token = form.get("token") or token
        from .textutil import cp_len
        if password != confirm:
            return reset_page(request, token, confirm_error=True)
        if cp_len(password) < 12:
            return reset_page(request, token, short=True)
        digest = hashlib.sha256(("t1:" + token).encode("utf-8")).hexdigest()
        row = await pool.fetchrow(
            "SELECT r.id, r.member_id, r.used_at, m.email FROM app.reset_tokens r "
            "JOIN app.members m ON m.id = r.member_id WHERE r.digest = $1", digest)
        if row is None or row["used_at"] is not None:
            return reset_page(request, token, invalid=True)
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("UPDATE app.reset_tokens SET used_at = now() WHERE id = $1",
                                   row["id"])
                await conn.execute(
                    "UPDATE app.members SET password_hash = $2 WHERE id = $1",
                    row["member_id"], hash_password(password))
                await conn.execute(
                    "UPDATE app.sessions SET revoked_at = now() WHERE member_id = $1 "
                    "AND revoked_at IS NULL", row["member_id"])
                await conn.execute("DELETE FROM app.signin_attempts WHERE email = $1",
                                   row["email"])
                await conn.execute(
                    "INSERT INTO app.audit_events (organization_id, at, actor, action, "
                    "target, detail) SELECT m.organization_id, now(), m.email, "
                    "'member.password_reset', m.email, '' FROM app.members m "
                    "WHERE m.id = $1", row["member_id"])
        from . import mail
        await mail.send(request.app, row["email"], "Your Tessel password was reset",
                        "Your Tessel password was reset. If this was not you, "
                        "contact your owner.")
        resp = login_page(request, notice="Your password was reset. Sign in with the new one.")
        return resp
    return reset_page(request, token)


def reset_page(request, token, confirm_error=False, short=False, invalid=False):
    body = head("Set a new password - Tessel", "Set a new Tessel password", "/reset")
    if invalid:
        body += """
<main id="main" class="wrap narrow auth">
<h1>Set a new password</h1>
<p class="form-error-top" role="alert">This reset link is no longer valid</p>
<p><a class="inline" href="/forgot">Request a new link</a></p>
</main></body></html>"""
        return html_response(body, status=400)
    body += f"""
<main id="main" class="wrap narrow auth">
<h1>Set a new password</h1>
<form method="post" action="/reset" class="card auth-form">
  <input type="hidden" name="token" value="{esc(token)}">
  <div class="field">
    <label for="rs-password">New password</label>
    <input id="rs-password" name="password" type="password" autocomplete="new-password"
      {'aria-invalid="true"' if short else ''}>
    <p class="field-error" role="alert" {'hidden' if not short else ''}>
      Passwords are at least 12 characters</p>
  </div>
  <div class="field">
    <label for="rs-confirm">Confirm new password</label>
    <input id="rs-confirm" name="confirm" type="password" autocomplete="new-password"
      {'aria-invalid="true"' if confirm_error else ''}>
    <p class="field-error" role="alert" {'hidden' if not confirm_error else ''}>
      The passwords do not match</p>
  </div>
  <button type="submit" class="btn capsule primary">Set password</button>
</form>
</main>
</body></html>"""
    return html_response(body)


def page_routes():
    return [
        ("GET", "/", p_landing),
        ("POST", "/contact", p_contact),
        ("GET", "/contact", p_contact),
        ("GET", "/login", p_login),
        ("POST", "/login", p_login),
        ("GET", "/forgot", p_forgot),
        ("POST", "/forgot", p_forgot),
        ("GET", "/reset", p_reset),
        ("POST", "/reset", p_reset),
    ] + console_routes()


# ---------------------------------------------------------------- console

def console_shell(title, member, active, content, extra_head=""):
    role = member["role"]
    org = member["org"]
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<link rel="stylesheet" href="/static/tessel.css">
<script src="/static/console.js" defer></script>
</head>
<body class="console">
{extra_head}
<div class="console-layout">
<aside class="rail">
  <a class="wordmark" href="/">Tessel</a>
  <nav aria-label="Console">
    <a class="rail-link" href="/console" {'aria-current="page"' if active == 'db' else ''}>Databases</a>
    <a class="rail-link" href="/console/settings" {'aria-current="page"' if active == 'settings' else ''}>Settings</a>
    {'<a class="rail-link" href="/console/settings/keys">API keys</a>' if role == 'owner' else ''}
    {'<a class="rail-link" href="/console/settings/billing">Billing</a>' if role == 'owner' else ''}
    {'<a class="rail-link" href="/console/settings/audit">Audit</a>' if role == 'owner' else ''}
  </nav>
  <div class="rail-meta">
    <p class="org">{esc(org)}</p>
    <p class="who">{esc(member['email'])}</p>
    <span class="badge role">{esc(role)}</span>
  </div>
  <form method="post" action="/console/signout" class="signout-form">
    <button type="submit" class="btn capsule secondary">Sign out</button>
  </form>
</aside>
<main id="main" class="console-main">
<a class="skip" href="#main">Skip to main content</a>
{content}
<div class="live-region" role="status" aria-live="polite" aria-label="Console announcements" id="live"></div>
<div class="toasts" id="toasts" aria-live="polite"></div>
</main>
</div>
</body></html>"""


async def p_signout(request):
    pool = request.app["db"]["pool"]
    member = await session_member(pool, request)
    if member is None:
        return web.HTTPSeeOther("/login?next=/console")
    import hashlib
    token = request.cookies.get(SESSION_COOKIE)
    digest = hashlib.sha256(("t1:" + token).encode("utf-8")).hexdigest()
    await pool.execute("UPDATE app.sessions SET revoked_at = now() WHERE token_digest = $1",
                       digest)
    resp = web.HTTPSeeOther("/")
    resp.del_cookie(SESSION_COOKIE, path="/")
    return resp


def login_redirect(request):
    target = "/login?next=" + quote(request.path)
    if request.query_string:
        target = "/login?next=" + quote(request.path + "?" + request.query_string)
    return web.HTTPSeeOther(target)


async def p_console(request):
    pool = request.app["db"]["pool"]
    member = await session_member(pool, request)
    if member is None:
        return login_redirect(request)
    rows = await pool.fetch(
        "SELECT name, created_at, ready_at, last_lsn, indexed_lsn, index_generation "
        "FROM app.databases WHERE organization_id = $1 ORDER BY name", member["organization_id"])
    is_owner = member["role"] == "owner"
    counts = {}
    for r in rows:
        s = await pool.fetchval(
            "SELECT count(*) FROM app.sources WHERE database_id = "
            "(SELECT id FROM app.databases WHERE organization_id = $1 AND name = $2) AND live",
            member["organization_id"], r["name"])
        counts[r["name"]] = s
    trs = []
    for r in rows:
        status = "provisioning" if now() < r["ready_at"] else "ready"
        status_cls = "amber" if status == "provisioning" else ""
        pending = r["last_lsn"] - r["indexed_lsn"]
        del_btn = ('<button class="btn capsule secondary js-delete-db" '
                   'data-name="%s">Delete</button>' % esc(r["name"])) if is_owner else ""
        trs.append(f"""
<tr class="db-row" data-name="{esc(r['name'])}" data-status="{status}">
  <td><a class="inline" href="/console/db/{esc(r['name'])}">{esc(r['name'])}</a></td>
  <td><span class="badge {status_cls} js-status">{status}</span></td>
  <td>1</td>
  <td>{counts[r['name']]}</td>
  <td>{pending}</td>
  <td>{r['index_generation']}</td>
  <td>{esc(dt_to_str(r['created_at']))}</td>
  <td>{del_btn}</td>
</tr>""")
    create_row = ""
    import_row = ""
    if is_owner:
        create_row = """
<tr class="create-row" id="create-row">
  <td colspan="8" class="create-cell">
    <form class="inline-create" id="create-db-form">
      <label class="sr-only" for="new-db-name">Name</label>
      <input id="new-db-name" name="name" placeholder="Name"
        aria-describedby="new-db-help" autocomplete="off">
      <span class="help" id="new-db-help">Lowercase letters, digits and underscores;
        3 to 32 characters; starts with a letter</span>
      <button type="submit" class="btn capsule primary js-wait"
        data-wait="Creating...">Create</button>
      <span class="field-error" id="create-db-error" role="alert" hidden></span>
    </form>
  </td>
</tr>"""
        import_row = """
<div class="toolbar">
<button class="btn capsule secondary" id="import-open" aria-expanded="false"
  aria-controls="import-panel">Import database</button>
<form class="import-form card" id="import-panel" hidden>
  <div class="field">
    <label for="imp-doc">Export document</label>
    <textarea id="imp-doc" name="document" rows="4"></textarea>
  </div>
  <div class="field">
    <label for="imp-name">New name</label>
    <input id="imp-name" name="name" autocomplete="off">
  </div>
  <span class="field-error" id="import-error" role="alert" hidden></span>
  <button type="button" class="btn capsule primary js-wait" id="import-go"
    data-wait="Importing...">Import</button>
</form>
</div>"""
    empty = '<p class="empty">No databases yet</p>'
    table = f"""
<table class="tbl" id="db-table">
  <thead><tr><th>Name</th><th>Status</th><th>Collections</th><th>Sources</th>
    <th>Pending log entries</th><th>Index generation</th><th>Created</th>
    <th class="sr-only">Actions</th></tr></thead>
  <tbody>{create_row}{''.join(trs)}</tbody>
</table>"""
    content = f"""
<h1>Databases</h1>
{import_row}
{table if rows else (create_row and table or empty)}
{import_row}
"""
    if not rows:
        content = f"""
<h1>Databases</h1>
{import_row}
<table class="tbl" id="db-table"><thead><tr><th>Name</th><th>Status</th>
<th>Collections</th><th>Sources</th><th>Pending log entries</th>
<th>Index generation</th><th>Created</th><th class="sr-only">Actions</th></tr></thead>
<tbody>{create_row}</tbody></table>
{import_row}"""
    return html_response(console_shell("Databases - Tessel", member, "db", content))


TAB_NAMES = [("sources", "Sources"), ("graph", "Graph query"), ("search", "Search"),
             ("entity", "Entity"), ("stats", "Stats"), ("explore", "Explore")]


async def p_workspace(request):
    pool = request.app["db"]["pool"]
    member = await session_member(pool, request)
    if member is None:
        return login_redirect(request)
    name = request.match_info["name"]
    dbrow = await pool.fetchrow(
        "SELECT id, name, ready_at, last_lsn, indexed_lsn, index_generation "
        "FROM app.databases WHERE organization_id = $1 AND name = $2",
        member["organization_id"], name)
    if dbrow is None:
        content = ('<h1>' + esc(name) + '</h1><p class="empty" role="alert">'
                   'Database not found</p>')
        return html_response(console_shell(name + " - Tessel", member, "db", content))
    tab = request.query.get("tab", "sources")
    if tab not in [t[0] for t in TAB_NAMES]:
        tab = "sources"
    role = member["role"]
    can_edit = role in ("editor", "owner")
    tabs_html = "".join(
        '<a class="ws-tab%s" href="/console/db/%s?tab=%s">%s</a>'
        % (" active" if t[0] == tab else "", esc(name), t[0], t[1]) for t in TAB_NAMES)
    panel = ""
    if tab == "sources":
        panel = sources_panel(pool, request, member, dbrow, can_edit)
    elif tab == "graph":
        panel = graph_panel(request, name)
    elif tab == "search":
        panel = search_panel(request, name)
    elif tab == "entity":
        panel = entity_panel(request, name)
    elif tab == "stats":
        panel = await stats_panel(pool, request, member, dbrow, role)
    elif tab == "explore":
        panel = await explore_panel(pool, request, dbrow)
    status = "provisioning" if now() < dbrow["ready_at"] else "ready"
    content = f"""
<div class="ws-head">
  <h1>{esc(name)}</h1>
  <span class="badge {'amber' if status == 'provisioning' else ''}">{status}</span>
</div>
<nav class="ws-tabs" aria-label="Workspace tabs">{tabs_html}</nav>
<div class="ws-panel" id="ws-panel">{panel}</div>"""
    return html_response(console_shell(name + " - Tessel", member, "db", content))


def sources_panel(pool, request, member, dbrow, can_edit):  # returns str
    name = dbrow["name"]
    collection = request.query.get("collection", "default")
    sort = request.query.get("sort", "id")
    flt = request.query.get("filter", "")
    return f"""
<section class="panel" id="sources-panel" aria-label="Sources">
  <div class="toolbar">
    <label>Collection <select id="src-collection" class="input">
      <option value="default">default</option></select></label>
    <input class="input" id="src-filter" placeholder="Filter sources"
      value="{esc(flt)}" aria-label="Filter sources">
  </div>
  <table class="tbl" id="sources-table">
    <thead><tr>
      <th><button class="sort-btn" data-key="id" aria-sort="none">ID</button></th>
      <th><button class="sort-btn" data-key="title" aria-sort="None">Title</button></th>
      <th><button class="sort-btn" data-key="version" aria-sort="None">Version</button></th>
      <th><button class="sort-btn" data-key="token_count" aria-sort="None">Tokens</button></th>
      <th>Facts</th><th>Status</th>
      <th><button class="sort-btn" data-key="ingested_at" aria-sort="None">Ingested</button></th>
      <th class="sr-only">Actions</th></tr></thead>
    <tbody id="sources-body"></tbody>
  </table>
  <p class="empty" id="sources-empty" hidden>No sources in this collection</p>
  {'''
  <div class="toolbar">
    <button class="btn capsule secondary" id="ingest-open" aria-expanded="false"
      aria-controls="ingest-row">Ingest source</button>
  </div>
  ''' if can_edit else ''}
</section>"""


def graph_panel(request, name):
    stmt = request.query.get("statement", "")
    as_of = request.query.get("as_of", "")
    examples = [
        "MATCH (a {name: 'Atlas Launch'})-[:OWNED_BY]->(o) RETURN o.name",
        "MATCH (a {name: 'atlas launch'})-[:BLOCKED_BY]->(b)-[:OWNED_BY]->(o) RETURN b.name, o.name",
        "MATCH (m {name: 'Marco Silva'})<-[:OWNED_BY]-(w) RETURN w",
    ]
    return f"""
<section class="panel" id="graph-panel" aria-label="Graph query">
  <div class="field">
    <label for="gq-statement">Statement</label>
    <textarea id="gq-statement" class="input" rows="3">{esc(stmt)}</textarea>
  </div>
  <div class="toolbar">
    <label for="gq-as-of">As of</label>
    <input id="gq-as-of" class="input" value="{esc(as_of)}" placeholder="YYYY-MM-DDTHH:MM:SSZ">
    <button class="btn capsule primary js-wait" id="gq-run" data-wait="Running...">Run</button>
  </div>
  <div class="examples">
    {''.join('<button class="btn capsule secondary example" data-stmt="%s">%s</button>'
             % (esc(e), esc(e)) for e in examples)}
  </div>
  <p class="field-error" id="gq-error" role="alert" hidden></p>
  <table class="tbl" id="gq-results"><thead id="gq-head"></thead><tbody id="gq-body"></tbody></table>
  <p class="served-from" id="gq-served"></p>
</section>"""


def search_panel(request, name):
    words = request.query.get("words", "")
    return f"""
<section class="panel" id="search-panel" aria-label="Search">
  <div class="toolbar">
    <label for="sr-words">Words</label>
    <input id="sr-words" class="input" value="{esc(words)}">
    <label for="sr-collections">Collections</label>
    <select id="sr-collections" class="input"><option value="default">default</option></select>
    <label for="sr-limit">Result limit</label>
    <input id="sr-limit" class="input" value="5" inputmode="numeric">
    <button class="btn capsule primary js-wait" id="sr-go" data-wait="Searching...">Search</button>
  </div>
  <p class="field-error" id="sr-error" role="alert" hidden></p>
  <div id="sr-results"></div>
  <p class="empty" id="sr-empty" hidden>No sources match these words</p>
</section>"""


def entity_panel(request, name):
    entity = request.query.get("entity", "")
    as_of = request.query.get("as_of", "")
    return f"""
<section class="panel" id="entity-panel" aria-label="Entity">
  <div class="toolbar">
    <label for="en-name">Entity name</label>
    <input id="en-name" class="input" value="{esc(entity)}">
    <label for="en-as-of">As of</label>
    <input id="en-as-of" class="input" value="{esc(as_of)}"
      placeholder="YYYY-MM-DDTHH:MM:SSZ">
    <button class="btn capsule primary js-wait" id="en-go" data-wait="Looking up...">Look up</button>
  </div>
  <p class="field-error" id="en-error" role="alert" hidden></p>
  <div id="en-results"></div>
  <p class="empty" id="en-empty" hidden>No facts mention this entity</p>
</section>"""


async def stats_panel(pool, request, member, dbrow, role):
    name = dbrow["name"]
    stats = await pool.fetchrow(
        "SELECT (SELECT count(*) FROM app.sources WHERE database_id = $1 AND live) AS sources,"
        " (SELECT count(*) FROM app.facts WHERE database_id = $1 AND source_live) AS facts,"
        " (SELECT count(*) FROM (SELECT subject_key FROM app.facts WHERE database_id = $1"
        "  AND source_live UNION SELECT object_key FROM app.facts WHERE database_id = $1"
        "  AND source_live) e) AS entities,"
        " last_lsn, indexed_lsn, index_generation,"
        " (SELECT coalesce(sum(token_count),0) FROM app.source_versions WHERE database_id = $1)"
        " AS tokens_ingested,"
        " (SELECT coalesce(sum(octet_length(s.title) + octet_length(s.text) +"
        "  (SELECT count(*) FROM app.facts f WHERE f.database_id = s.database_id"
        "   AND f.source_id = s.source_id AND f.source_live) * 64), 0)"
        "  FROM app.sources s WHERE s.database_id = $1 AND s.live) AS storage_bytes"
        " FROM app.databases WHERE id = $1", dbrow["id"])
    pending = stats["last_lsn"] - stats["indexed_lsn"]
    cells = [("Sources", stats["sources"]), ("Facts", stats["facts"]),
             ("Entities", stats["entities"]), ("Last LSN", stats["last_lsn"]),
             ("Indexed LSN", stats["indexed_lsn"]), ("WAL pending", pending),
             ("Index generation", stats["index_generation"]),
             ("Tokens ingested", stats["tokens_ingested"]),
             ("Storage bytes", stats["storage_bytes"])]
    cards = "".join('<div class="stat"><p class="cap">%s</p><p class="figure">%s</p></div>'
                    % (esc(label), esc(value)) for label, value in cells)
    compact = ""
    export = ""
    if role in ("editor", "owner"):
        compact = ('<button class="btn capsule primary js-wait" id="compact-go" '
                   'data-wait="Compacting...">Compact</button>')
    if role == "owner":
        export = ('<button class="btn capsule secondary" id="export-go">Export</button>'
                  '<a class="btn capsule secondary" id="export-download" hidden>Download</a>')
    return f"""
<section class="panel" id="stats-panel" aria-label="Stats">
  <div class="stat-grid">{cards}</div>
  <div class="toolbar">{compact}{export}</div>
  <p class="field-error" id="stats-error" role="alert" hidden></p>
</section>"""


async def explore_panel(pool, request, dbrow):
    as_of = request.query.get("as_of", "")
    node = request.query.get("node", "")
    facts = await pool.fetch(
        "SELECT lsn, position, subject, subject_key, object, object_key, predicate, "
        "valid_from FROM app.facts WHERE database_id = $1 AND source_live "
        "ORDER BY lsn, position", dbrow["id"])
    from .domain import display_names
    displays = display_names(facts)
    moments = sorted({f["valid_from"] for f in facts})
    return f"""
<section class="panel" id="explore-panel" aria-label="Explore">
  <div class="explore-grid">
    <div class="explore-left">
      <div class="field">
        <label for="ex-find">Find entity</label>
        <input id="ex-find" class="input" autocomplete="off">
        <p id="ex-match-count" class="cap"></p>
      </div>
      <fieldset class="pred-group"><legend>Predicate</legend>
        <div id="ex-preds"></div>
      </fieldset>
      <div class="field">
        <label id="ex-slider-label" for="ex-slider">As of moment</label>
        <input type="range" id="ex-slider" class="input" min="0" max="0" value="0"
          aria-labelledby="ex-slider-label">
      </div>
      <div id="ex-summary"></div>
    </div>
    <div class="explore-right">
      <div id="ex-graph" class="graph-area" aria-label="Graph"></div>
      <div id="ex-inspect" class="inspect" hidden></div>
      <p class="empty" id="ex-empty" hidden>No facts at this moment</p>
    </div>
  </div>
  <table class="tbl" id="ex-table"><thead><tr><th>Subject</th><th>Predicate</th>
    <th>Object</th><th>Valid from</th><th>Source</th></tr></thead>
    <tbody id="ex-body"></tbody></table>
</section>"""


async def p_settings(request):
    pool = request.app["db"]["pool"]
    member = await session_member(pool, request)
    if member is None:
        return login_redirect(request)
    rows = await pool.fetch(
        "SELECT email, role FROM app.members WHERE organization_id = $1 ORDER BY email",
        member["organization_id"])
    is_owner = member["role"] == "owner"
    member_rows = []
    for r in rows:
        role_cell = esc(r["role"])
        if is_owner:
            role_cell = (f"""<select class="input role-select" data-email="{esc(r['email'])}">
              <option value="owner" {'selected' if r['role'] == 'owner' else ''}>owner</option>
              <option value="editor" {'selected' if r['role'] == 'editor' else ''}>editor</option>
              <option value="viewer" {'selected' if r['role'] == 'viewer' else ''}>viewer</option>
            </select> <button class="btn capsule secondary js-remove-member"
              data-email="{esc(r['email'])}">Remove</button>""")
        member_rows.append(f"<tr><td>{esc(r['email'])}</td><td>{role_cell}</td></tr>")
    add_form = ""
    if is_owner:
        add_form = """
<form class="card inline-form" id="add-member-form">
  <div class="field"><label for="am-email">Email</label>
    <input id="am-email" name="email" type="email" autocomplete="off"></div>
  <div class="field"><label for="am-role">Role</label>
    <select id="am-role" name="role" class="input">
      <option value="viewer">viewer</option><option value="editor">editor</option>
      <option value="owner">owner</option></select></div>
  <div class="field"><label for="am-password">Initial password</label>
    <input id="am-password" name="password" type="password" autocomplete="new-password"></div>
  <button class="btn capsule primary js-wait" data-wait="Adding...">Add member</button>
  <p class="field-error" id="add-member-error" role="alert" hidden></p>
</form>"""
    content = f"""
<h1>Members</h1>
{add_form}
<table class="tbl" id="members-table">
  <thead><tr><th>Email</th><th>Role</th></tr></thead>
  <tbody>{''.join(member_rows)}</tbody>
</table>
<section class="panel" aria-label="Security controls">
  <h2>Your security</h2>
  <div class="toolbar">
    <button class="btn capsule secondary" id="logout-all">Sign out everywhere</button>
  </div>
  <form class="card inline-form" id="pw-form">
    <div class="field"><label for="pw-current">Current password</label>
      <input id="pw-current" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="pw-new">New password</label>
      <input id="pw-new" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="pw-confirm">Confirm new password</label>
      <input id="pw-confirm" type="password" autocomplete="new-password">
      <p class="field-error" id="pw-mismatch" hidden>The passwords do not match</p></div>
    <button class="btn capsule primary js-wait" data-wait="Changing...">Change password</button>
    <p class="field-error" id="pw-error" role="alert" hidden></p>
  </form>
  <div class="totp-box" id="totp-box">
    <p>Two-step sign-in: <span id="totp-state">Off</span></p>
    <button class="btn capsule secondary" id="totp-setup"
      hidden>Set up two-step sign-in</button>
    <div id="totp-setup-panel" hidden>
      <p class="setup-key" id="totp-key"></p>
      <p class="key-uri" id="totp-uri"></p>
      <div class="field"><label for="totp-code">Code from your app</label>
        <input id="totp-code" class="input" inputmode="numeric"></div>
      <button class="btn capsule primary" id="totp-enable">Turn on</button>
      <p class="field-error" id="totp-error" role="alert" hidden></p>
    </div>
    <div id="totp-codes" hidden>
      <p class="setup-key" id="totp-codes-list"></p>
      <p>Save these recovery codes now. Each works once.</p>
    </div>
  </div>
</section>"""
    return html_response(console_shell("Settings - Tessel", member, "settings", content))


async def p_keys(request):
    pool = request.app["db"]["pool"]
    member = await session_member(pool, request)
    if member is None:
        return login_redirect(request)
    if member["role"] != "owner":
        content = ('<h1>API keys</h1><p class="empty" role="alert">'
                   'You do not have access to this page</p>')
        return html_response(console_shell("API keys - Tessel", member, "settings", content))
    rows = await pool.fetch(
        "SELECT id, name, role, prefix, created_at, revoked_at FROM app.api_keys "
        "WHERE organization_id = $1 ORDER BY id", member["organization_id"])
    dbs = await pool.fetch(
        "SELECT name FROM app.databases WHERE organization_id = $1 ORDER BY name",
        member["organization_id"])
    options = "".join('<option value="%s">%s</option>' % (esc(d["name"]), esc(d["name"]))
                      for d in dbs)
    key_rows = "".join(f"""
<tr data-id="{r['id']}"><td>{esc(r['name'])}</td><td>{esc(r['role'])}</td>
  <td>{esc(r['prefix'])}</td><td>{esc(dt_to_str(r['created_at']))}</td>
  <td><button class="btn capsule secondary js-rotate-key" data-id="{r['id']}">Rotate</button>
      <button class="btn capsule secondary js-revoke-key" data-id="{r['id']}">Revoke</button>
  </td></tr>""" for r in rows)
    content = f"""
<h1>API keys</h1>
<form class="card inline-form" id="key-form">
  <div class="field"><label for="k-name">Key name</label>
    <input id="k-name" class="input" autocomplete="off"></div>
  <div class="field"><label for="k-role">Key role</label>
    <select id="k-role" class="input"><option value="viewer">viewer</option>
      <option value="editor">editor</option></select></div>
  <div class="field"><label for="k-scope">Scope</label>
    <select id="k-scope" class="input"><option value="all">All databases</option>
      <option value="chosen">Chosen databases</option></select></div>
  <div class="field" id="k-dbs-wrap" hidden><label for="k-dbs">Databases</label>
    <select id="k-dbs" class="input" multiple size="4">{options}</select></div>
  <button class="btn capsule primary js-wait" data-wait="Creating...">Create key</button>
  <p class="field-error" id="key-error" role="alert" hidden></p>
</form>
<div class="secret-box" id="key-secret" hidden>
  <code id="key-secret-value"></code>
  <p>Copy this key now. It will not be shown again.</p>
</div>
<table class="tbl" id="keys-table">
  <thead><tr><th>Name</th><th>Role</th><th>Prefix</th><th>Created</th><th>Actions</th></tr></thead>
  <tbody>{key_rows}</tbody>
</table>"""
    return html_response(console_shell("API keys - Tessel", member, "settings", content))


async def p_billing(request):
    pool = request.app["db"]["pool"]
    member = await session_member(pool, request)
    if member is None:
        return login_redirect(request)
    if member["role"] != "owner":
        content = ('<h1>Billing</h1><p class="empty" role="alert">'
                   'You do not have access to this page</p>')
        return html_response(console_shell("Billing - Tessel", member, "settings", content))
    from . import pricing as pricing_mod
    org = await pool.fetchrow("SELECT name, plan FROM app.organizations WHERE id = $1",
                              member["organization_id"])
    usage = await pool.fetchval(
        "SELECT coalesce(sum(token_count),0) FROM app.source_versions "
        "WHERE organization_id = $1 AND ingested_at >= date_trunc('month', now())",
        member["organization_id"])
    storage = await pool.fetchval(
        "SELECT coalesce(sum(octet_length(s.title) + octet_length(s.text) + "
        "(SELECT count(*) FROM app.facts f WHERE f.database_id = s.database_id "
        "AND f.source_id = s.source_id AND f.source_live) * 64), 0) "
        "FROM app.sources s JOIN app.databases d ON d.id = s.database_id "
        "WHERE d.organization_id = $1 AND s.live", member["organization_id"])
    bill = pricing_mod.bill_cents(usage, storage, org["plan"])
    daily = await pool.fetch(
        "SELECT date_trunc('day', ingested_at) AS day, sum(token_count) AS tokens "
        "FROM app.source_versions WHERE organization_id = $1 "
        "AND ingested_at >= date_trunc('month', now()) GROUP BY 1",
        member["organization_id"])
    by_day = {r["day"].date().isoformat(): r["tokens"] for r in daily}
    import datetime as _dt
    t = now()
    start = _dt.datetime(t.year, t.month, 1, tzinfo=_dt.timezone.utc)
    days = []
    d = start.date()
    today = t.date()
    peak = max([by_day.get(x.isoformat(), 0) for x in
                [start.date() + _dt.timedelta(days=i)
                 for i in range((today - start.date()).days + 1)]] or [1])
    while d <= today:
        tokens = by_day.get(d.isoformat(), 0)
        height = int(140 * tokens / peak) if tokens else 2
        is_today = " today" if d == today else ""
        days.append('<div class="bar-day%s" data-day="%s"><div class="bar" '
                    'style="height:%dpx"></div><span>%d</span></div>'
                    % (is_today, d.isoformat(), height, tokens))
        d += _dt.timedelta(days=1)
    rows = "".join('<tr><td>%s</td><td>%s</td></tr>' % (esc(dd), esc(tt))
                   for dd, tt in by_day.items())
    total = sum(by_day.values())
    content = f"""
<h1>Plan and usage</h1>
<div class="card plan-card">
  <p>Current plan: <strong>{esc(org['plan'])}</strong></p>
  <div class="toolbar">
    <button class="btn capsule secondary" id="plan-ship"
      {'hidden' if org['plan'] == 'ship' else ''}>Switch to Ship</button>
    <button class="btn capsule secondary" id="plan-scale"
      {'hidden' if org['plan'] == 'scale' else ''}>Switch to Scale</button>
  </div>
  <p class="field-error" id="plan-error" role="alert" hidden></p>
</div>
<div class="card bill-card">
  <h2>This month's bill</h2>
  <dl class="bill">
    <div><dt>Tokens ingested</dt><dd>{usage}</dd></div>
    <div><dt>Storage bytes</dt><dd>{storage}</dd></div>
    <div><dt>Ontology charge</dt><dd>{format_cents(bill['ontology_cents'])}</dd></div>
    <div><dt>Storage charge</dt><dd>{format_cents(bill['storage_cents'])}</dd></div>
    <div><dt>Usage</dt><dd>{format_cents(bill['usage_cents'])}</dd></div>
    <div><dt>Minimum</dt><dd>{format_cents(bill['minimum_cents'])}</dd></div>
    <div><dt>Billed</dt><dd><strong>{format_cents(bill['billed_cents'])}</strong></dd></div>
  </dl>
</div>
<div class="card chart-card">
  <h2>Tokens ingested by day</h2>
  <div class="daily-chart" id="daily-chart">{''.join(days)}</div>
  <table class="tbl" id="daily-table">
    <thead><tr><th>Day</th><th>Tokens</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <p>{total} tokens this month</p>
</div>"""
    return html_response(console_shell("Billing - Tessel", member, "settings", content))


async def p_audit(request):
    pool = request.app["db"]["pool"]
    member = await session_member(pool, request)
    if member is None:
        return login_redirect(request)
    if member["role"] != "owner":
        content = ('<h1>Audit</h1><p class="empty" role="alert">'
                   'You do not have access to this page</p>')
        return html_response(console_shell("Audit - Tessel", member, "settings", content))
    action = request.query.get("action", "")
    actor = request.query.get("actor", "")
    actions = ["", "database.create", "database.delete", "database.import", "member.add",
               "member.role", "member.remove", "member.password", "member.password_reset",
               "member.totp_on", "member.totp_off", "session.logout_all", "key.create",
               "key.rotate", "key.revoke", "plan.change", "export.request"]
    options = "".join('<option value="%s"%s>%s</option>'
                      % (esc(a), " selected" if a == action else "", esc(a or "All actions"))
                      for a in actions)
    content = f"""
<h1>Audit log</h1>
<div class="toolbar">
  <label for="au-action">Action</label>
  <select id="au-action" class="input">{options}</select>
  <label for="au-actor">Actor</label>
  <input id="au-actor" class="input" value="{esc(actor)}">
  <a class="btn capsule secondary" id="au-csv" href="/api/v2/audit?format=csv">CSV</a>
</div>
<table class="tbl" id="audit-table">
  <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
  <tbody id="audit-body"></tbody>
</table>
<p class="empty" id="audit-empty" hidden>No audit events match these filters</p>
<button class="btn capsule secondary js-wait" id="audit-more" data-wait="Loading..."
  hidden>Load more</button>"""
    return html_response(console_shell("Audit - Tessel", member, "settings", content))


def console_routes():
    return [
        ("GET", "/console", p_console),
        ("POST", "/console/signout", p_signout),
        ("GET", "/console/settings", p_settings),
        ("GET", "/console/settings/keys", p_keys),
        ("GET", "/console/settings/billing", p_billing),
        ("GET", "/console/settings/audit", p_audit),
        ("GET", "/console/db/{name}", p_workspace),
    ]
