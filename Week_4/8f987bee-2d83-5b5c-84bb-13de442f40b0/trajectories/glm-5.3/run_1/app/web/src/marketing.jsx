import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Alert, Icon, Logo, Menu, Overlay, Switch } from "./components.jsx";
import { readToken, writeToken } from "./api.js";

const PRODUCT_LINKS = [
  { to: "/connector-builder", label: "Connector Builder" },
  { to: "/data-replication", label: "Data Replication" },
  { to: "/mcp", label: "MCP Server" },
  { to: "/context-layer", label: "Context Layer" },
];

const SOLUTIONS_LINKS = [
  { to: "/hybrid", label: "Hybrid deployment" },
  { to: "/compare", label: "Compare tools" },
  { to: "/pricing", label: "Pricing" },
];

const RESOURCES_LINKS = [
  { to: "/docs-home", label: "Docs", to2: "/data-engineering-resources" },
  { to: "/data-engineering-resources", label: "Data engineering resources" },
  { to: "/why-open-source", label: "Why open source" },
];

function ConsentCard() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem("wayline_consent") !== "dismissed");
    } catch {
      setVisible(false);
    }
  }, []);
  if (!visible) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem("wayline_consent", "dismissed");
    } catch {
      /* private mode */
    }
    setVisible(false);
  };
  return (
    <section className="consent" role="region" aria-label="Cookie consent">
      <p style={{ fontSize: "0.86rem", marginTop: 0 }}>
        Wayline sets no analytics cookies and stores no identifiers.
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={dismiss}>
          Manage preferences
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}

function HeaderMenu({ label, items }) {
  return (
    <Menu label={label} trigger={<span>{label}</span>}>
      {({ close }) =>
        items.map((item) => (
          <Link key={item.to} to={item.to} className="menu-item" role="menuitem"
            onClick={close}>
            {item.label}
          </Link>
        ))
      }
    </Menu>
  );
}

export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 992px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 992px)");
    const onChange = () => {
      setWide(mq.matches);
      if (mq.matches) setMenuOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <>
      <header className="mk-header">
        <div className="mk-header-inner">
          <Link to="/" aria-label="Wayline home">
            <Logo />
          </Link>
          <nav className="mk-links" aria-label="Main">
            <HeaderMenu label="Product" items={PRODUCT_LINKS} />
            <HeaderMenu label="Solutions" items={SOLUTIONS_LINKS} />
            <HeaderMenu label="Resources"
              items={RESOURCES_LINKS.map((i) => ({ to: i.to2 || i.to, label: i.label }))} />
            <NavLink to="/connectors" className="mk-link">Connectors</NavLink>
            <NavLink to="/data-engineering-resources" className="mk-link">Docs</NavLink>
            <NavLink to="/pricing" className="mk-link">Pricing</NavLink>
          </nav>
          <div className="mk-actions">
            <Link to="/login" className="mk-link">Sign in</Link>
            <Link to="/login" className="btn btn-outline btn-sm mk-hide-narrow">
              Talk to sales
            </Link>
            <Link to="/login" className="btn btn-primary btn-sm">Try it free</Link>
            <button type="button" className="btn btn-outline btn-sm mk-menu-btn"
              aria-haspopup="dialog" aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}>
              <Icon name="menu" />
              <span className="visually-hidden">Menu</span>
            </button>
          </div>
        </div>
      </header>
      {menuOpen && !wide && (
        <Overlay title="menu" onClose={() => setMenuOpen(false)}>
          {PRODUCT_LINKS.concat(SOLUTIONS_LINKS, RESOURCES_LINKS).map((item) => (
            <Link key={item.label} className="overlay-link" to={item.to2 || item.to}
              onClick={() => setMenuOpen(false)}>
              {item.label}
            </Link>
          ))}
          <Link className="overlay-link" to="/connectors" onClick={() => setMenuOpen(false)}>
            Connectors
          </Link>
          <Link className="overlay-link" to="/data-engineering-resources"
            onClick={() => setMenuOpen(false)}>
            Docs
          </Link>
          <Link className="overlay-link" to="/pricing" onClick={() => setMenuOpen(false)}>
            Pricing
          </Link>
          <Link className="overlay-link" to="/login" onClick={() => setMenuOpen(false)}>
            Sign in
          </Link>
          <Link className="overlay-link" to="/login" onClick={() => setMenuOpen(false)}>
            Talk to sales
          </Link>
          <Link className="overlay-link" to="/login" onClick={() => setMenuOpen(false)}>
            Try it free
          </Link>
        </Overlay>
      )}
    </>
  );
}

export function MarketingFooter() {
  const columns = [
    { title: "Product", links: [
      { to: "/connector-builder", label: "Connector Builder" },
      { to: "/data-replication", label: "Data Replication" },
      { to: "/mcp", label: "MCP Server" },
      { to: "/context-layer", label: "Context Layer" },
    ] },
    { title: "Resources", links: [
      { to: "/data-engineering-resources", label: "Data engineering resources" },
      { to: "/connectors", label: "Connector catalog" },
      { to: "/compare", label: "Compare tools" },
    ] },
    { title: "Developers", links: [
      { to: "/why-open-source", label: "Why open source" },
      { to: "/hybrid", label: "Hybrid deployment" },
      { to: "/signin", label: "Sign in" },
    ] },
    { title: "Legal", links: [
      { to: "/why-open-source", label: "Licence" },
      { to: "/", label: "Privacy" },
    ] },
  ];
  return (
    <footer className="mk-footer">
      <div className="wrap">
        <div className="mk-footer-band">
          <h2>Build with Wayline</h2>
          <p style={{ color: "var(--muted)" }}>Ship agents and pipelines in minutes, not days.</p>
        </div>
        <div className="mk-footer-cols">
          {columns.map((col) => (
            <div key={col.title} className="mk-footer-col">
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((link) => (
                  <li key={link.label}><Link to={link.to}>{link.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mk-footer-base">(c) 2026 Wayline. All rights reserved.</div>
      </div>
    </footer>
  );
}

export function MarketingLayout({ children }) {
  return (
    <>
      <MarketingHeader />
      <main id="main">{children}</main>
      <MarketingFooter />
      <ConsentCard />
    </>
  );
}
