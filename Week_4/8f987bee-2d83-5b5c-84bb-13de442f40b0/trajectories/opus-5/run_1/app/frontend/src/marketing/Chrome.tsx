import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Header } from "./Header";

const CONSENT_KEY = "wayline.consent-dismissed";

const FOOTER_COLUMNS: { heading: string; links: { label: string; to: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Data replication", to: "/data-replication" },
      { label: "Connector Builder", to: "/connector-builder" },
      { label: "Context layer", to: "/context-layer" },
      { label: "Pricing", to: "/pricing" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Data engineering resources", to: "/data-engineering-resources" },
      { label: "Connector catalog", to: "/connectors" },
      { label: "Compare the tools", to: "/compare" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "MCP server", to: "/mcp" },
      { label: "Hybrid deployment", to: "/hybrid" },
      { label: "Why open source", to: "/why-open-source" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms of service", to: "/why-open-source" },
      { label: "Privacy notice", to: "/why-open-source" },
      { label: "Sign in", to: "/login" },
    ],
  },
];

function Consent(): JSX.Element | null {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    setDismissed(window.localStorage.getItem(CONSENT_KEY) === "true");
  }, []);
  if (dismissed) return null;
  return (
    <section className="consent" aria-label="Cookie consent">
      <p>
        Wayline keeps no analytics identifier. We store only what the console needs to run your
        pipelines.
      </p>
      <div className="consent-actions">
        <Link to="/why-open-source" className="button outline">
          Manage preferences
        </Link>
        <button
          type="button"
          className="button"
          onClick={() => {
            window.localStorage.setItem(CONSENT_KEY, "true");
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

export function Footer(): JSX.Element {
  return (
    <footer className="site-footer">
      <div className="band footer-band">
        <h2>Build with Wayline</h2>
        <p>Ship agents and pipelines in minutes, not days.</p>
      </div>
      <div className="band">
        <div className="footer-columns">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading}>
              <h3>{column.heading}</h3>
              {column.links.map((link) => (
                <Link key={link.label} to={link.to}>
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <p style={{ marginTop: "2rem", color: "var(--muted)" }}>(c) 2026 Wayline. All rights reserved.</p>
      </div>
    </footer>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="marketing">
      <Header />
      <main>{children}</main>
      <Footer />
      <Consent />
    </div>
  );
}
