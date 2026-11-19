import { MarketingLayout } from "./marketing.jsx";

const PAGES = {
  "/connector-builder": {
    h1: "Build and deploy custom connectors",
    grad: "in minutes, not days",
    copy: "Describe a source once and publish it as a versioned connector your whole team can use.",
  },
  "/data-replication": {
    h1: "The open standard for data movement",
    copy: "One specification for how records move, so every connector behaves the same way.",
  },
  "/hybrid": {
    h1: "Run the data plane yourself. Skip the upkeep.",
    copy: "Keep the console in your cloud while Wayline keeps the connectors current.",
  },
  "/mcp": {
    h1: "The Wayline MCP Server",
    copy: "Agents read the same layer your analysts read, through one model context protocol.",
  },
  "/context-layer": {
    h1: "One context layer for every agent, across every business system",
    copy: "Give every agent the same trusted copy of the business.",
  },
  "/why-open-source": {
    h1: "Own your context.",
    copy: "Open code, open specs, and no lock-in.",
  },
  "/compare": {
    h1: "Compare the data movement tools",
    copy: "A plain look at where Wayline fits.",
  },
  "/data-engineering-resources": {
    h1: "All Data Engineering Resources",
    copy: "Guides and articles from the Wayline team.",
  },
};

export default function MarketingTextPage({ path }) {
  const page = PAGES[path] || { h1: path, copy: "" };
  return (
    <MarketingLayout>
      <section className="section wrap">
        <span className="eyebrow">Wayline</span>
        <h1>{page.h1}{page.grad && <> <span className="grad">{page.grad}</span></>}</h1>
        <p style={{ maxWidth: "64ch", marginTop: "1rem" }}>{page.copy}</p>
        {path === "/connector-builder" && (
          <div className="card card-pad" style={{ maxWidth: "620px", marginTop: "1.5rem" }}>
            <div className="log-dots" aria-hidden="true"><span /><span /><span /></div>
            <pre style={{ margin: 0, fontFamily: "var(--code)", fontSize: "0.85rem", color: "var(--ink)", overflowX: "auto" }}>{`base_url: /mock-api/v1
auth:
  type: api_key
  header: X-Api-Key
streams:
  - name: invoices
    path: /invoices
    primary_key: [id]
    record_selector: data
    paginator:
      page_size: 3`}</pre>
            <span style={{ display: "inline-block", color: "var(--violet)", marginTop: "0.6rem" }}
              className="label-mono" aria-hidden="true">
              <span style={{ animation: "caret 1.1s steps(1) infinite" }}>▌</span> AI ASSISTANT
            </span>
          </div>
        )}
        {path === "/mcp" && (
          <div className="card card-pad" style={{ maxWidth: "620px", marginTop: "1.5rem" }}>
            <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.8rem" }} aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} style={{
                  width: 8, height: 8, borderRadius: "50%", background: "var(--violet)",
                  animation: `typing 1.2s ${i * 0.15}s ease-in-out infinite`,
                }} />
              ))}
            </div>
            <p style={{ margin: 0 }}>Wayline, which tables hold last quarter's orders?</p>
            <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true"
              style={{ display: "block", margin: "1rem auto" }}>
              <circle cx="100" cy="100" r="70" fill="none" stroke="var(--line-2)" />
              <g style={{ transformOrigin: "100px 100px", animation: "orbit 12s linear infinite" }}>
                <circle cx="170" cy="100" r="6" fill="var(--violet)" />
              </g>
              <circle cx="100" cy="100" r="40" fill="none" stroke="var(--lavender)" />
            </svg>
          </div>
        )}
        {(path === "/compare" || path === "/data-engineering-resources") && (
          <div className="grid-3" style={{ marginTop: "2rem" }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <article className="card card-pad" key={i}>
                <h3 style={{ fontSize: "1rem" }}>
                  {path === "/compare" ? `Alternative ${i}` : `Guide ${i}`}
                </h3>
                <p style={{ fontSize: "0.88rem", marginBottom: 0 }}>
                  {path === "/compare"
                    ? "A placeholder comparison card."
                    : "A placeholder article card."}
                </p>
              </article>
            ))}
          </div>
        )}
        {path === "/why-open-source" && (
          <div style={{ marginTop: "2rem" }}>
            <div className="grid-3">
              {[["The licence", "Every connector and the spec ship under open terms."],
                ["The guarantees", "You can always read, fork and run the code you depend on."],
                ["The community", "Hundreds of contributions land each quarter."]].map(([t, c]) => (
                <div className="card card-pad" key={t}>
                  <h3 style={{ fontSize: "1.02rem" }}>{t}</h3>
                  <p style={{ marginBottom: 0 }}>{c}</p>
                </div>
              ))}
            </div>
            <p style={{ marginTop: "1.5rem" }}>
              Community figures: <strong>14.8K</strong> stars and <strong>900+</strong> contributors.
            </p>
          </div>
        )}
      </section>
    </MarketingLayout>
  );
}
