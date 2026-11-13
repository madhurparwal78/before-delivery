import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { GitBranch, Languages } from "lucide-preact";
import { api, type WorkspaceStats } from "../api";
import { StatsBand } from "../illustrations";
import { LinkButton, EmptyState, Skeleton, Stat, cx, reducedMotion, useHeadingFocus } from "../ui";
import { projectHref } from "../router";
import { dateTime, projectsStore, useLoad, useStore } from "../store";

/** Client names as muted wordmarks; they scroll twice, and only when they overflow the strip. */
function Wordmarks({ clients }: { clients: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const t = track.current, b = box.current;
      if (t && b) setOverflows(t.scrollWidth > b.clientWidth + 1 && !reducedMotion());
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [clients.join("|")]);
  const items = clients.map((c) => <li key={c} className="wordmark">{c}</li>);
  return (
    <div className={cx("marquee", overflows && "is-running")} ref={box}>
      <div className="marquee-track">
        <ul className="wordmarks" ref={track}>{items}</ul>
        {overflows && <ul className="wordmarks" aria-hidden="true">{clients.map((c) => <li key={c} className="wordmark">{c}</li>)}</ul>}
      </div>
    </div>
  );
}

export function Desk() {
  useHeadingFocus("Your desk");
  const projects = useStore(projectsStore);
  const stats = useLoad(() => api<WorkspaceStats>("GET", "/api/workspace/stats"), [projects?.length]);
  const clients = [...new Set((projects ?? []).map((p) => p.client))];
  const s = stats.data;
  return (
    <>
      <h1 className="display page-title">Your desk</h1>

      <section className="client-strip" aria-label="Client apps">
        <p>Client apps on this desk: {projects?.length ?? 0}</p>
        <Wordmarks clients={clients} />
      </section>

      <section className="stats-band" aria-label="Workspace analytics">
        <StatsBand />
        <div className="stats-card card">
          {s ? (
            <div className="stats-grid">
              <Stat value={s.exact_matches_reused} caption="Exact matches reused" />
              <Stat value={s.conflicts_open} caption="Conflicts open" />
              <Stat value={s.below_threshold} caption="Below MQM threshold" />
              <Stat value={s.publishes_confirmed} caption="Publishes confirmed" />
            </div>
          ) : <Skeleton lines={2} className="stats-skeleton" />}
          <div className="center"><LinkButton variant="outline" arrow href="/audit">Open audit log</LinkButton></div>
        </div>
      </section>

      <section className="project-grid" aria-label="Projects">
        {projects === null && <><div className="card"><Skeleton lines={4} /></div><div className="card"><Skeleton lines={4} /></div></>}
        {(projects ?? []).map((p) => (
          <article key={p.id} className="card project-card">
            <div>
              <p className="eyebrow">{p.client}</p>
              <h2 className="h3">{p.name}</h2>
            </div>
            <ul className="meta-list">
              <li><GitBranch size={18} strokeWidth={1.5} aria-hidden="true" />{p.repository}</li>
              <li><Languages size={18} strokeWidth={1.5} aria-hidden="true" />{p.source_language} → {p.target_languages.join(", ")}</li>
            </ul>
            <dl className="facts">
              <div><dt>MQM threshold</dt><dd>{p.mqm_threshold}</dd></div>
              <div><dt>Open branches</dt><dd>{(p.branches ?? []).length}</dd></div>
              <div><dt>Created</dt><dd>{dateTime(p.created_at).slice(0, 10)}</dd></div>
            </dl>
            <LinkButton variant="outline" arrow href={projectHref(p.slug)} aria-label={`Open ${p.name}`}>Open {p.name}</LinkButton>
          </article>
        ))}
        {projects?.length === 0 && <div className="card span-all"><EmptyState heading="No projects yet" text="Create a project to start importing translation memory." /></div>}
      </section>
    </>
  );
}

interface AuditEntry { id: number; at: string; actor: string; action: string; project: string; detail: string }

export function Audit() {
  useHeadingFocus("Audit log");
  const entries = useLoad(() => api<{ entries: AuditEntry[] }>("GET", "/api/audit"), []);
  const list = entries.data?.entries;
  return (
    <>
      <div className="title-row">
        <h1 className="display page-title">Audit log</h1>
        <LinkButton variant="outline" arrow href="/api/audit.csv" external download="audit-log.csv">Download CSV</LinkButton>
      </div>
      {!list && <div className="card"><Skeleton lines={6} /></div>}
      {list && list.length === 0 && <div className="card"><EmptyState heading="Nothing in the audit log yet" text="Every state change on the desk will be listed here." /></div>}
      {list && list.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll" tabIndex={0} role="group" aria-label="Scrollable table">
            <table className="table" aria-label="Audit log">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Project</th><th>Detail</th></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{dateTime(e.at)}</td><td>{e.actor}</td><td><code>{e.action}</code></td><td>{e.project}</td><td>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
