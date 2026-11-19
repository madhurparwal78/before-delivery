import { ReactNode, useState } from "react";
import { Link, useNavigate } from "../lib/router";
import { User } from "../lib/api";
import { Dialog } from "./Dialog";

/**
 * The signed-in shell: top bar with product name, Invitations link and the
 * Account menu; the left rail with project, collections and the section tag;
 * the Sections navigation at the top of the content.
 */

export type Section = "documents" | "queries" | "pipeline" | "indexes" | "schema" | "rules" | "members";

export interface ShellProps {
  user: User | null;
  children: ReactNode;
  onSignOut: () => void;
  project?: { id: string; name: string } | null;
  collections?: { id: string; name: string; count: number }[];
  currentCollectionId?: string | null;
  section?: Section | null;
  outage?: boolean;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: "documents", label: "Documents" },
  { id: "queries", label: "Query" },
  { id: "pipeline", label: "Pipeline" },
  { id: "indexes", label: "Indexes" },
  { id: "schema", label: "Schema" },
  { id: "rules", label: "Rules" },
  { id: "members", label: "Members" },
];

export function TopBar(props: { user: User | null; onSignOut: () => void; onOpenCollections: () => void; showCollections: boolean; outage?: boolean }): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <header className="top-bar">
      <div className="top-bar-left">
        {props.showCollections && (
          <button className="btn" onClick={props.onOpenCollections}>Collections</button>
        )}
        <Link className="brand" to="/projects">Jarful</Link>
      </div>
      <nav className="top-bar-right">
        <Link className="link" to="/invites">Invitations</Link>
        {props.user !== null && (
          <div className="menu-anchor">
            <button
              className="btn"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              onClick={() => setMenuOpen(open => !open)}
            >
              Account
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label="Account"
                className="menu"
                onKeyDown={e => {
                  if (e.key === "Escape") {
                    setMenuOpen(false);
                    (e.currentTarget.parentElement?.querySelector("button") as HTMLElement | null)?.focus();
                  }
                }}
              >
                <div className="menu-user">{props.user.name}</div>
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    props.onSignOut();
                    navigate("/signin");
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </nav>
    </header>
  );
}

export function OutageBanner(): ReactNode {
  return (
    <div role="alert" className="outage-banner">
      File storage is unavailable. Try again later.
    </div>
  );
}

export function Rail(props: {
  project: { id: string; name: string } | null;
  collections: { id: string; name: string; count: number }[];
  currentCollectionId: string | null;
  section: Section | null;
  onNavigate: (path: string) => void;
}): ReactNode {
  if (props.project === null) return <aside className="rail rail-empty" aria-hidden="true" />;
  return (
    <aside className="rail">
      <nav aria-label="Project">
        <div className="rail-project">{props.project.name}</div>
        <ul className="rail-collections">
          {props.collections.map(c => (
            <li key={c.id}>
              <button
                className={c.id === props.currentCollectionId ? "rail-link current" : "rail-link"}
                aria-current={c.id === props.currentCollectionId ? "true" : undefined}
                onClick={() => props.onNavigate(`/p/${props.project?.id}/c/${c.id}`)}
              >
                <span className="rail-name">{c.name}</span>
                <span className="rail-count">{c.count}</span>
              </button>
            </li>
          ))}
        </ul>
        {props.section !== null && props.section !== undefined && (
          <div className="section-tag">{sectionLabel(props.section)}</div>
        )}
      </nav>
    </aside>
  );
}

export function sectionLabel(section: Section): string {
  return SECTIONS.find(s => s.id === section)?.label ?? "";
}

export function SectionsNav(props: { pid: string | null; cid: string | null; section: Section | null }): ReactNode {
  if (props.pid === null) return null;
  const href = (s: Section): string => {
    if (s === "members") return `/p/${props.pid}/members`;
    if (props.cid === null) return s === "documents" ? `/p/${props.pid}` : `/p/${props.pid}/members`;
    if (s === "documents") return `/p/${props.pid}/c/${props.cid}`;
    return `/p/${props.pid}/c/${props.cid}/${s === "queries" ? "queries" : s}`;
  };
  const visible = props.cid === null
    ? SECTIONS.filter(s => s.id === "members")
    : SECTIONS;
  return (
    <nav aria-label="Sections" className="sections-nav">
      {visible.map(s => (
        <Link
          key={s.id}
          to={href(s.id)}
          className={props.section === s.id ? "section-link current" : "section-link"}
          aria-current={props.section === s.id ? "page" : undefined}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

export function CollectionsDrawer(props: {
  open: boolean;
  onClose: () => void;
  project: { id: string; name: string } | null;
  collections: { id: string; name: string; count: number }[];
  currentCollectionId: string | null;
  onNavigate: (path: string) => void;
}): ReactNode {
  const navigate = useNavigate();
  return (
    <Dialog label="Collections" open={props.open} onClose={props.onClose}>
      <div className="drawer-head">
        <h2>{props.project?.name ?? "Collections"}</h2>
        <button className="btn" onClick={props.onClose}>Close collections</button>
      </div>
      <ul className="drawer-list">
        {props.collections.map(c => (
          <li key={c.id}>
            <button
              className={c.id === props.currentCollectionId ? "drawer-link current" : "drawer-link"}
              onClick={() => {
                if (props.project !== null) {
                  navigate(`/p/${props.project.id}/c/${c.id}`);
                }
                props.onClose();
              }}
            >
              {c.name} ({c.count})
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
