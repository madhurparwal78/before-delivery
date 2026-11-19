import type { ReactNode } from "react";
import { Link, type Route, collectionPath } from "../router.js";

const COLLECTION_SECTIONS: [string, string, string][] = [
  ["documents", "Documents", ""],
  ["queries", "Query", "/queries"],
  ["pipeline", "Pipeline", "/pipeline"],
  ["indexes", "Indexes", "/indexes"],
  ["schema", "Schema", "/schema"],
  ["rules", "Rules", "/rules"],
];

export function SectionNav({ route }: { route: Extract<Route, { name: "project" | "members" | "collection" }> }): ReactNode {
  const members = (
    <Link to={`/p/${route.pid}/members`} className="section-link" aria-current={route.name === "members" ? "page" : undefined}>
      Members
    </Link>
  );
  return (
    <nav className="section-nav" aria-label="Sections">
      {route.name === "collection"
        ? COLLECTION_SECTIONS.map(([key, label, tail]) => (
            <Link key={key} to={collectionPath(route.pid, route.cid, tail)} className="section-link" aria-current={route.section === key ? "page" : undefined}>
              {label}
            </Link>
          ))
        : null}
      {members}
    </nav>
  );
}
