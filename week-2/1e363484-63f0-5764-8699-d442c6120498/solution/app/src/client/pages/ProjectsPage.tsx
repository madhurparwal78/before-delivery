import { useCallback, useEffect, useState } from "react";
import { request } from "../api";
import { COPY } from "../copy";
import { signed } from "../format";
import { useRefresh } from "../hooks";
import { Link } from "../router";
import type { ProjectListItem } from "../types";
import { Cell, DataTable, Num } from "../ui/tables";

const COLUMNS = [
  { label: "Project" }, { label: "Kind" }, { label: "Sealed net tCO2e", numeric: true }, { label: "Buffer tCO2e", numeric: true },
  { label: "Intact", numeric: true }, { label: "Broken", numeric: true }, { label: "Superseded", numeric: true },
];

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [lostAccess] = useState(() => (history.state as { lostAccess?: boolean } | null)?.lostAccess === true);

  const load = useCallback(async () => {
    const r = await request<{ projects: ProjectListItem[] }>("GET", "/api/projects");
    if (r.status === 200) setProjects(r.data.projects);
  }, []);
  useEffect(() => void load(), [load]);
  useRefresh(() => void load(), () => false);

  return (
    <main className="page page-wide">
      <header className="page-header">
        <h1>Projects</h1>
        {/* Always one line tall, so the table below never moves when the count arrives. */}
        <p className="page-sub num">
          {projects === null ? "\u00a0" : `${projects.length} ${projects.length === 1 ? "project" : "projects"} you can open`}
        </p>
      </header>
      {lostAccess && <p role="alert" className="alert">{COPY.lostAccess}</p>}
      {projects === null ? (
        <p className="loading num">Loading…</p>
      ) : (
        <DataTable name="Projects" columns={COLUMNS} className="projects-table">
          {projects.map((p) => (
            <tr role="row" key={p.slug}>
              <Cell label="Project"><Link href={`/projects/${p.slug}`} className="project-link">{p.name}</Link></Cell>
              <Cell label="Kind">{p.kind}</Cell>
              <Cell label="Sealed net tCO2e" numeric><Num>{signed(p.summary.sealed_net_tco2e)}</Num></Cell>
              <Cell label="Buffer tCO2e" numeric><Num>{p.summary.buffer_tco2e}</Num></Cell>
              <Cell label="Intact" numeric><Num>{p.summary.intact_count}</Num></Cell>
              <Cell label="Broken" numeric><Num className={p.summary.broken_count ? "broken-count" : ""}>{p.summary.broken_count}</Num></Cell>
              <Cell label="Superseded" numeric><Num>{p.summary.superseded_count}</Num></Cell>
            </tr>
          ))}
        </DataTable>
      )}
    </main>
  );
}
