import { Link } from "react-router-dom";
import { ArrowUpRight } from "./Icons.jsx";
import Logo from "./Logo.jsx";

const COLUMNS = [
  { title: "Product", links: [["/connectors", "Connectors"], ["/connector-builder", "Connector Builder"], ["/data-replication", "Data replication"], ["/mcp", "MCP Server"]] },
  { title: "Resources", links: [["/data-engineering-resources", "Engineering resources"], ["/compare", "Tool comparisons"], ["/pricing", "Pricing"]] },
  { title: "Developers", links: [["/connector-builder", "Builder manifests"], ["/why-open-source", "Open source"], ["/context-layer", "Context layer"]] },
  { title: "Legal", links: [["/hybrid", "Data residency"], ["/why-open-source", "Licence"], ["/signin", "Account access"]] },
];

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="build-band">
        <div className="container">
          <div>
            <h2>Build with Wayline</h2>
            <p>Ship agents and pipelines in minutes, not days.</p>
          </div>
          <Link to="/login" className="btn btn-primary">Start building <ArrowUpRight width="16" height="16" /></Link>
        </div>
      </div>
      <div className="container">
        <div className="footer-columns">
          <div className="footer-brand">
            <Logo />
            <p>The data movement layer for teams that keep every system in step.</p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3>{column.title}</h3>
              <ul>{column.links.map(([to, label]) => <li key={label}><Link to={to}>{label}</Link></li>)}</ul>
            </nav>
          ))}
        </div>
        <p className="footer-base">(c) 2026 Wayline. All rights reserved.</p>
      </div>
    </footer>
  );
}
