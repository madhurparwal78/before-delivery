import { Link } from "react-router-dom";
import { MarketingLayout } from "./Chrome";
import { Icon } from "../components/Icon";

function Plain({
  headline,
  tail,
  lede,
  children,
}: {
  headline: string;
  tail?: string;
  lede: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <MarketingLayout>
      <section className="band dotted">
        <h1>
          {headline}
          {tail ? <span className="gradient-line"> {tail}</span> : null}
        </h1>
        <p className="lede">{lede}</p>
      </section>
      {children}
    </MarketingLayout>
  );
}

export function ConnectorBuilderPage(): JSX.Element {
  return (
    <Plain
      headline="Build and deploy custom connectors"
      tail="in minutes, not days"
      lede="Describe an HTTP source in a manifest, test every page against the sandbox, and publish a versioned connector your sources can sync."
    >
      <div className="band two-column">
        <div className="terminal" style={{ position: "relative", overflow: "hidden" }}>
          <div className="terminal-dots" aria-hidden="true">
            <i style={{ background: "var(--status-succeeded)" }} />
            <i style={{ background: "var(--status-running)" }} />
            <i style={{ background: "var(--status-failed)" }} />
          </div>
          <pre style={{ margin: 0 }}>{`base_url: /mock-api/v1
auth:
  type: api_key
  header: X-Api-Key
streams:
  - name: invoices
    path: /invoices
    page_size: 3`}</pre>
          <span className="yaml-caret" aria-hidden="true">
            _
          </span>
          <span
            className="yaml-sweep"
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "30%",
              background: "linear-gradient(90deg, transparent, rgba(139,123,240,0.25), transparent)",
            }}
          />
        </div>
        <div>
          <p className="eyebrow">AI ASSISTANT</p>
          <p>Thinking through the manifest: paginator, record selector, primary key.</p>
          <ul>
            <li>Sandbox-only reads while you build</li>
            <li>Every stream tested before you publish</li>
            <li>Versions recorded so running jobs keep their manifest</li>
          </ul>
        </div>
      </div>
    </Plain>
  );
}

export function DataReplicationPage(): JSX.Element {
  return (
    <Plain
      headline="The open standard for data movement"
      lede="Full refresh and incremental syncs, one all-or-nothing commit at a time, with cursors you can read."
    >
      <div className="band story-grid">
        {["Exactly once", "Cursors you can read", "Schema changes absorbed"].map((heading) => (
          <article className="card" key={heading}>
            <h3>{heading}</h3>
            <p>Every sync lands its rows, its counts and its cursors together, or not at all.</p>
          </article>
        ))}
      </div>
    </Plain>
  );
}

export function HybridPage(): JSX.Element {
  return (
    <Plain
      headline="Run the data plane yourself. Skip the upkeep."
      lede="Keep records inside your own network. Wayline keeps the schedules, the catalog and the audit log."
    >
      <div className="band two-column">
        <div className="mock">
          <p className="eyebrow">Your network</p>
          <p>
            <Icon name="database" /> Sources, destinations and records
          </p>
        </div>
        <div className="mock">
          <p className="eyebrow">Wayline</p>
          <p>Metadata only</p>
        </div>
      </div>
    </Plain>
  );
}

export function McpPage(): JSX.Element {
  return (
    <Plain
      headline="The Wayline MCP Server"
      lede="Give an agent one tool surface for every system your company runs."
    >
      <div className="band two-column">
        <div className="card">
          <p className="eyebrow">Agent</p>
          <p>Find the orders table and copy today's rows.</p>
          <p aria-hidden="true">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="typing-dot"
                style={{ display: "inline-block", animationDelay: `${dot * 0.18}s` }}
              >
                ●
              </span>
            ))}
          </p>
        </div>
        <svg viewBox="0 0 200 200" role="img" aria-label="Orbit of connected systems around the MCP server" width="100%">
          <g className="orbit-ring" style={{ transformOrigin: "100px 100px" }}>
            <circle cx="100" cy="100" r="70" fill="none" stroke="var(--lavender)" strokeDasharray="4 8" />
            <circle cx="170" cy="100" r="5" fill="var(--violet)" />
          </g>
          <g className="orbit-ring" style={{ transformOrigin: "100px 100px", animationDuration: "26s" }}>
            <circle cx="100" cy="100" r="46" fill="none" stroke="var(--hairline)" strokeDasharray="3 6" />
            <circle cx="146" cy="100" r="4" fill="var(--pink)" />
          </g>
          <circle cx="100" cy="100" r="22" fill="url(#mcp-hub)" />
          <defs>
            <linearGradient id="mcp-hub" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--indigo-top)" />
              <stop offset="100%" stopColor="var(--indigo-bottom)" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </Plain>
  );
}

export function ContextLayerPage(): JSX.Element {
  return (
    <Plain
      headline="One context layer for every agent, across every business system"
      lede="Copy once, then let every agent read the same records with the same meanings."
    />
  );
}

export function WhyOpenSourcePage(): JSX.Element {
  return (
    <Plain
      headline="Own your context."
      lede="Read the connector code, fork it, run it anywhere. Nothing about your pipelines is a black box."
    >
      <div className="band story-grid">
        {[
          { heading: "Readable connectors", copy: "Every connector ships as code you can read and change." },
          { heading: "No lock-in", copy: "Take your manifests and your warehouse with you." },
          { heading: "Community first", copy: "9,000+ teams and 300+ connectors maintained in the open." },
        ].map((card) => (
          <article className="card" key={card.heading}>
            <h3>{card.heading}</h3>
            <p>{card.copy}</p>
          </article>
        ))}
      </div>
      <div className="band metrics">
        {[
          ["14.8K", "stars"],
          ["2,400", "contributors"],
          ["300+", "connectors"],
          ["9,000+", "teams"],
        ].map(([figure, label]) => (
          <div key={label}>
            <p className="metric-figure gradient-line">{figure}</p>
            <p className="eyebrow">{label}</p>
          </div>
        ))}
      </div>
    </Plain>
  );
}

export function ComparePage(): JSX.Element {
  return (
    <Plain
      headline="Compare the data movement tools"
      lede="How Wayline sits beside the other ways teams move records into a warehouse."
    >
      <div className="band story-grid">
        {["Wayline vs Hand-rolled scripts", "Wayline vs Managed ELT", "Wayline vs Streaming only"].map(
          (heading) => (
            <article className="card" key={heading}>
              <h3>{heading}</h3>
              <p>Placeholder comparison card for the marketing hierarchy.</p>
              <Link to="/data-replication">Read the comparison</Link>
            </article>
          ),
        )}
      </div>
    </Plain>
  );
}

export function ResourcesPage(): JSX.Element {
  const articles = [
    "Why half-landed syncs break trust",
    "Cursors, generations and the all-or-nothing commit",
    "Designing a connector manifest",
    "Schema changes without a pager",
    "Reading an audit chain",
    "Paging by position, not offset",
  ];
  return (
    <Plain
      headline="All Data Engineering Resources"
      lede="Guides, notes and references from the Wayline Labs team."
    >
      <div className="band story-grid">
        {articles.map((title) => (
          <article className="card" key={title}>
            <p className="eyebrow">Guide</p>
            <h3>{title}</h3>
            <p>Placeholder article card by A. Placeholder.</p>
          </article>
        ))}
      </div>
    </Plain>
  );
}

export function SignInChooser(): JSX.Element {
  return (
    <MarketingLayout>
    <div className="chooser">
      <div style={{ maxWidth: "54rem", margin: "0 auto" }}>
        <h1>Sign in to your Wayline account</h1>
        <p>Choose the surface you work in.</p>
      </div>
      <div className="chooser-grid">
        <article className="chooser-card">
          <h2>Wayline Cloud</h2>
          <p>The hosted console: connections, jobs and the warehouse.</p>
          <Link to="/login" className="button">
            Continue to sign in
          </Link>
        </article>
        <article className="chooser-card">
          <h2>Self-managed</h2>
          <p>Sign in to a data plane you run yourself.</p>
          <Link to="/login" className="button outline">
            Continue to sign in
          </Link>
        </article>
      </div>
    </div>
    </MarketingLayout>
  );
}

export function NotFound(): JSX.Element {
  return (
    <MarketingLayout>
      <section className="band dotted">
        <h1>This page does not exist</h1>
        <p className="lede">The address you opened is not part of Wayline.</p>
        <Link to="/" className="button">
          Back to the home page
        </Link>
      </section>
    </MarketingLayout>
  );
}
