import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Discs, Tick } from "../components/Icons.jsx";

function Hero({ eyebrow, title, line, lede }) {
  return (
    <section className="page-hero dots">
      <div className="container">
        <div className="section-head">
        <span className="label eyebrow">{eyebrow}</span>
        <h1 className="display">
          <span className="line">{title}</span>
          {line && <>{" "}<span className="line grad-text">{line}</span></>}
        </h1>
        {lede && <p className="lede">{lede}</p>}
        <div className="hero-actions" style={{ justifyContent: "flex-start" }}>
          <Link to="/login" className="btn btn-primary">Try it free</Link>
          <Link to="/connectors" className="btn btn-outline">Browse connectors</Link>
        </div>
        </div>
      </div>
    </section>
  );
}

function Cards({ items }) {
  return (
    <div className="grid-3">
      {items.map(([title, body]) => (
        <article className="card" key={title}><h3>{title}</h3><p>{body}</p></article>
      ))}
    </div>
  );
}

const DRAFT = `streams:
  - name: invoices
    path: /invoices
    primary_key: [id]
    record_selector: data
    paginator:
      page_size: 3`;

export function ConnectorBuilderPage() {
  const [thinking, setThinking] = useState(false);
  const [drafted, setDrafted] = useState(false);
  useEffect(() => {
    if (!thinking) return undefined;
    const done = setTimeout(() => { setThinking(false); setDrafted(true); }, 2400);
    return () => clearTimeout(done);
  }, [thinking]);
  return (
    <>
      <Hero eyebrow="Connector Builder" title="Build and deploy custom connectors" line="in minutes, not days"
        lede="Describe an HTTP API in a short manifest, test every page against a sandbox, and publish a versioned source your whole workspace can sync." />
      <section className="section container two-col" data-reveal>
        <div className="mock">
          <div className="terminal-bar" aria-hidden="true"><i /><i /><i /></div>
          <pre className={`mock-yaml sweep ${thinking ? "thinking" : ""}`}>
            {`base_url: /mock-api/v1\nauth:\n  type: api_key\n  header: X-Api-Key\n`}{drafted ? DRAFT : "streams: "}
            <span className="caret" aria-hidden="true" />
          </pre>
        </div>
        <div className="section-head">
          <span className="label eyebrow">AI ASSISTANT</span>
          <h2 className="h2">Draft the stream, then test it</h2>
          <p>The assistant proposes the paths, keys and paging from a sample response. You review every line before it is saved.</p>
          <p role="status" className="status-line">{thinking ? "Drafting the invoices stream…" : drafted ? "Draft ready for review" : ""}</p>
          <button type="button" className="btn btn-outline" disabled={thinking} onClick={() => setThinking(true)}>Draft a stream</button>
        </div>
      </section>
    </>
  );
}

export function DataReplicationPage() {
  return (
    <>
      <Hero eyebrow="Data replication" title="The open standard for data movement"
        lede="Full refresh or incremental, appended or deduplicated: every sync lands in one all-or-nothing commit." />
      <section className="section container" data-reveal>
        <Cards items={[
          ["Full refresh", "Replace or append the whole table on each run when the source has no reliable cursor."],
          ["Incremental append", "Read only rows newer than the stored cursor; the cursor moves only when the commit lands."],
          ["Incremental dedup", "Keep the newest row per primary key so the warehouse mirrors the source exactly."],
        ]} />
      </section>
    </>
  );
}

export function HybridPage() {
  return (
    <>
      <Hero eyebrow="Hybrid" title="Run the data plane yourself. Skip the upkeep."
        lede="Syncs run inside your network; the control plane schedules, versions and audits them without ever reading a row." />
      <section className="section container" data-reveal>
        <Cards items={[
          ["Your network", "Connectors and warehouse writes stay behind your firewall."],
          ["Our upkeep", "Upgrades, connector fixes and schema handling arrive as versioned releases."],
          ["One audit trail", "Every change is attributed and chained so it cannot be quietly rewritten."],
        ]} />
      </section>
    </>
  );
}

export function McpPage() {
  return (
    <>
      <Hero eyebrow="MCP" title="The Wayline MCP Server"
        lede="Give agents a typed, permissioned view of your pipelines: which tables are fresh, which syncs failed, and why." />
      <section className="section container two-col" data-reveal>
        <div className="mock">
          <div className="terminal-bar" aria-hidden="true"><i /><i /><i /></div>
          <div className="chat">
            <p className="bubble me">Which syncs need attention today?</p>
            <p className="bubble them">One connection failed at 06:10 with auth_failed. The other twelve are healthy.</p>
            <span className="typing" role="img" aria-label="Agent is typing"><i /><i /><i /></span>
          </div>
        </div>
        <svg viewBox="0 0 240 240" className="orbits" aria-hidden="true">
          <circle cx="120" cy="120" r="34" fill="url(#mcp-hub)" />
          <defs><linearGradient id="mcp-hub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b3abff" /><stop offset="1" stopColor="#4536c4" /></linearGradient></defs>
          <g className="orbit"><circle cx="120" cy="120" r="70" fill="none" stroke="#a299ff" strokeDasharray="4 6" /><circle cx="190" cy="120" r="7" fill="#6e4bea" /></g>
          <g className="orbit" style={{ animationDuration: "36s" }}><circle cx="120" cy="120" r="104" fill="none" stroke="#d0d0d0" /><circle cx="120" cy="16" r="6" fill="#d4489f" /></g>
        </svg>
      </section>
    </>
  );
}

export function ContextLayerPage() {
  return (
    <>
      <Hero eyebrow="Context layer" title="One context layer for every agent, across every business system"
        lede="Agents read the same synced tables your analysts trust, with the freshness of each figure stated alongside it." />
      <section className="section container" data-reveal>
        <Cards items={[
          ["Same records", "Every agent answers from the warehouse copy, not its own export."],
          ["Stated freshness", "Each answer carries when its table last committed."],
          ["Scoped access", "Roles decide what an agent may read, exactly as for people."],
        ]} />
      </section>
    </>
  );
}

export function WhyOpenSourcePage() {
  return (
    <>
      <Hero eyebrow="Open source" title="Own your context."
        lede="The connectors, the manifest format and the sync engine are open code you can read, fork and run anywhere." />
      <section className="section container" data-reveal>
        <ul className="checklist">
          {["Every connector's code is public and versioned", "Your manifests stay portable between deployments",
            "No lock-in: export the warehouse and the run history at any time"].map((item) => <li key={item}><Tick />{item}</li>)}
        </ul>
        <div className="stat-row">
          {[["14.8K", "stars"], ["1,100+", "contributors"], ["300+", "connectors"], ["9,000+", "teams"]].map(([value, label]) => (
            <div className="metric" key={label}><strong className="grad-text">{value}</strong><span>{label}</span></div>
          ))}
        </div>
      </section>
    </>
  );
}

const TOOLS = ["Batch ETL suites", "Hosted copy tools", "Streaming platforms", "Reverse ETL tools", "Script collections", "Warehouse-native loaders"];

export function ComparePage() {
  return (
    <>
      <Hero eyebrow="Compare" title="Compare the data movement tools"
        lede="How the common approaches handle cursors, partial failures, schema changes and where your data lives." />
      <section className="section container" data-reveal>
        <ul className="catalog-grid">
          {TOOLS.map((tool) => (
            <li key={tool}>
              <article className="card">
                <span className="label eyebrow">Comparison</span>
                <h3>Wayline vs {tool}</h3>
                <p>Where each one fits, and what changes when a sync must land all or nothing.</p>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const ARTICLES = [
  ["Guide", "Choosing between full refresh and incremental syncs"],
  ["Field notes", "What a half-landed sync costs a data team"],
  ["Guide", "Designing cursors that survive restarts"],
  ["Reference", "Schema change policies, compared"],
  ["Field notes", "Running the data plane in your own cloud"],
  ["Guide", "Giving agents a trustworthy context layer"],
];

export function ResourcesPage() {
  return (
    <>
      <Hero eyebrow="Resources" title="All Data Engineering Resources"
        lede="Guides, references and field notes from teams that keep their warehouses honest." />
      <section className="section container" data-reveal>
        <ul className="catalog-grid">
          {ARTICLES.map(([kind, title]) => (
            <li key={title}>
              <article className="card">
                <span className="label eyebrow"><Discs width="14" height="14" style={{ display: "inline", marginRight: 6 }} />{kind}</span>
                <h3>{title}</h3>
                <p>Wayline Labs · 6 min read <ArrowUpRight width="14" height="14" style={{ display: "inline" }} /></p>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
