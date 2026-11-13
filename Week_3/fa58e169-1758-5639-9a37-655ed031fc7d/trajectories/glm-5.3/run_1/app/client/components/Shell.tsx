import type { ReactNode } from "react";
import { s } from "../../common/copy";
import type { JSX } from "react";

export function TopBar(props: {
  railOpen: boolean;
  onToggle: () => void;
  showNew: boolean;
  onLive: (value: string) => void;
}): JSX.Element {
  return (
    <header className="topbar">
      <button
        type="button"
        aria-label="Toggle workspace rail"
        aria-expanded={props.railOpen}
        className="rail-toggle"
        onClick={props.onToggle}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2 4.5h16M2 10h16M2 15.5h16" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </button>
      <span className="product-name">Twinrow</span>
      <span className="spacer" />
      {props.showNew ? (
        <button type="button" className="button-primary" onClick={() => window.dispatchEvent(new CustomEvent("open-new-pattern"))}>
          New pattern
        </button>
      ) : null}
    </header>
  );
}

export interface NavRoute {
  page: string;
  id?: string;
  query: URLSearchParams;
}

function NavIcon({ name }: { name: string }): JSX.Element {
  const paths: Record<string, string> = {
    patterns: "M3 5.5h14M3 10h14M3 14.5h9",
    settings: "M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 2.5v2M10 15.5v2M3.5 10h2M14.5 10h2",
    chart: "M3 16V4M3 16h14M6 13l3-4 3 2 4-6",
    instructions: "M4 5h12M4 9h12M4 13h8",
    versions: "M4 4h12v12H4zM7 8h6M7 12h4",
    testers: "M7 8a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM3 17c0-2.4 1.8-4 4-4s4 1.6 4 4M14.5 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13.5 17c0-2 .9-3.3 2.5-3.3s3 1.3 3 3.3",
    notes: "M4 3h9l3 3v11H4zM7 8h6M7 12h6",
  };
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={paths[name] ?? ""} stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

function navHref(route: NavRoute, row: string, layout: string): string | undefined {
  void layout;
  if (row === "Your patterns") return "/";
  if (row === "Settings") return "/settings";
  if (!route.id) return undefined;
  if (row === "Chart") return `/patterns/${route.id}#chart`;
  if (row === "Instructions") return `/patterns/${route.id}#instructions`;
  if (row === "Versions") return `/patterns/${route.id}#versions`;
  if (row === "Testers") return `/patterns/${route.id}#testers`;
  if (row === "Row notes") return `/patterns/${route.id}#notes`;
  return undefined;
}

export function WorkspaceNav(props: { route: NavRoute; layout: string; inline?: boolean }): JSX.Element {
  const onDesigner = props.route.page === "designer" || props.route.page === "compare";
  const rows = onDesigner
    ? ["Your patterns", "Settings", "Chart", "Instructions", "Versions", "Testers", "Row notes"]
    : ["Your patterns", "Settings"];
  return (
    <nav aria-label="Workspace" className={props.inline ? "nav-inline" : undefined}>
      {rows.map((row) => {
        const href = navHref(props.route, row, props.layout);
        const active =
          (row === "Your patterns" && (props.route.page === "patterns" || props.route.page === "follow")) ||
          (row === "Settings" && props.route.page === "settings");
        return (
          <a key={row} className="nav-row" href={href ?? "#"} data-active={active ? "true" : "false"} onClick={(event) => {
            if (onDesigner && ["Chart", "Instructions", "Versions", "Testers", "Row notes"].includes(row)) {
              event.preventDefault();
              window.dispatchEvent(new CustomEvent("nav-panel", { detail: row }));
            }
          }}>
            <NavIcon name={row === "Your patterns" ? "patterns" : row === "Settings" ? "settings" : row === "Chart" ? "chart" : row === "Instructions" ? "instructions" : row === "Versions" ? "versions" : row === "Testers" ? "testers" : "notes"} />
            <span>{row}</span>
          </a>
        );
      })}
    </nav>
  );
}

export function Panel(props: { title: string; id?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="panel" id={props.id} aria-label={props.title}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
