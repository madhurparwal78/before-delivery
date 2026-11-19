import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { loadClassrooms, loadProjects, loadExports } from '../api.js';
import { say } from '../status.js';
import { M, STATE_LABELS } from '../copy.js';
import { savedTimeLabel, shortBytes } from '../status.js';
import type { Classroom, Export, Project } from '../../shared/types.js';
import { CreateClassroomDialog } from './classroomDialogs.js';

export function ClassroomCard(props: { classroom: Classroom }): VNode {
  const c = props.classroom;
  return (
    <div class="classroom-card">
      <a href={`/classrooms/${c.id}`}>{c.name}</a>
      <span class="state">{STATE_LABELS[c.state]}</span>
      <div class="count">{c.students.length} student{c.students.length === 1 ? '' : 's'}</div>
    </div>
  );
}

export function ProjectCards(props: { projects: Project[]; zone: string | null; emptyPillHref: string; emptyPillLabel: string }): VNode {
  if (props.projects.length === 0) {
    return (
      <div class="empty">
        <div class="doodle">
          <svg width="120" height="70" viewBox="0 0 120 70" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <ellipse cx="35" cy="30" rx="18" ry="14" />
            <ellipse cx="35" cy="30" rx="8" ry="6" />
            <path d="M62 55 C 72 25, 84 25, 94 55" />
            <path d="M60 62 H 98" stroke-dasharray="4 4" />
          </svg>
        </div>
        <p>Nothing here yet.</p>
        <a class="pill field" href={props.emptyPillHref}>{props.emptyPillLabel}</a>
      </div>
    );
  }
  return (
    <div class="grid-3" role="list" aria-label="My projects">
      {props.projects.map((p) => (
        <a class="card" href={`/editor/${p.id}`} key={p.id} role="listitem">
          <div class="render">
            <svg viewBox="-30 -30 60 60" style="width:100%;height:100%" aria-hidden="true">
              {p.kind === '3d' ? <rect x="-12" y="-12" width="24" height="24" rx="3" fill="#4caf50" />
                : p.kind === 'circuit' ? <circle cx="0" cy="0" r="12" fill="#1d48c9" />
                : <circle cx="-8" cy="6" r="7" fill="#8b3df0" />}
              {p.kind === 'blocks' && <circle cx="2" cy="-8" r="7" fill="#ff9800" />}
            </svg>
          </div>
          <div class="label">
            {p.name}<br />
            <span class="saved" style="color:var(--slate);font-weight:400">{savedTimeLabel(p.savedAt, props.zone)} · Rev {p.revision}</span>
          </div>
        </a>
      ))}
    </div>
  );
}

export function ExportList(props: { exports: Export[] }): VNode {
  if (props.exports.length === 0) return <p style="color:var(--slate)">No exports yet.</p>;
  return (
    <ul class="file-list" role="list" aria-label="My exports">
      {props.exports.map((e) => (
        <li key={e.id}>
          <a href={e.downloadUrl}>Download {e.fileName}</a>
          <span class="meta">{e.format.toUpperCase()} · {e.unit} · {shortBytes(e.bytes)}</span>
        </li>
      ))}
    </ul>
  );
}

export function EditorLaunchPills(props: { fieldClass?: string }): VNode {
  return (
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <a class={`pill field ${props.fieldClass ?? ''}`} href="/editor/new?kind=3d">New 3D design</a>
      <a class="pill field circuit" href="/editor/new?kind=circuit">New circuit</a>
      <a class="pill field blocks" href="/editor/new?kind=blocks">New block program</a>
    </div>
  );
}

export function Dashboard(props: { ctx: AppCtx }): VNode {
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [exports, setExports] = useState<Export[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createOpener, setCreateOpener] = useState<HTMLButtonElement | null>(null);

  const load = async () => {
    const [cls, prj, exp] = await Promise.all([loadClassrooms(), loadProjects(), loadExports()]);
    if (cls.ok) setClassrooms(cls.data.classrooms);
    if (prj.ok) setProjects(prj.data.projects);
    if (exp.ok) setExports(exp.data.exports);
  };

  useEffect(() => { void load(); }, []);

  if (props.ctx.account === null) {
    return <main><div class="auth-card"><h1>Sign in to see your dashboard</h1><a class="pill" href="/signin">Sign in</a></div></main>;
  }
  if (props.ctx.account.kind !== 'educator') {
    return <main><div class="auth-card"><h1>Educators only</h1><a class="pill" href="/projects">Go to your projects</a></div></main>;
  }

  return (
    <main>
      <div class="wrap" style="padding-top:32px">
        <h1>Dashboard</h1>
        {props.ctx.account.emailVerified ? null : (
          <p style="background:var(--band);padding:12px 16px;border-radius:10px">{M.unverifiedReminder(props.ctx.account.email ?? '')}</p>
        )}
        <section aria-label="Classrooms">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:18px 0 14px">
            <h2 style="margin:0">Classrooms</h2>
            <button
              class="pill"
              onClick={(e) => { setCreateOpener(e.currentTarget as HTMLButtonElement); setCreateOpen(true); }}
            >
              Create classroom
            </button>
          </div>
          {classrooms === null ? (
            <p style="color:var(--slate)">Loading…</p>
          ) : classrooms.length === 0 ? (
            <div class="empty">
              <div class="doodle">
                <svg width="120" height="70" viewBox="0 0 120 70" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <ellipse cx="35" cy="30" rx="18" ry="14" />
                  <ellipse cx="35" cy="30" rx="8" ry="6" />
                  <path d="M62 55 C 72 25, 84 25, 94 55" />
                  <path d="M60 62 H 98" stroke-dasharray="4 4" />
                </svg>
              </div>
              <p>No classrooms yet. Create your first one.</p>
              <button class="pill" onClick={(e) => { setCreateOpener(e.currentTarget as HTMLButtonElement); setCreateOpen(true); }}>Create classroom</button>
            </div>
          ) : (
            <ul role="list" aria-label="Classrooms" class="grid-3" style="list-style:none;padding:0;margin:0">
              {classrooms.map((c) => <li key={c.id}><ClassroomCard classroom={c} /></li>)}
            </ul>
          )}
        </section>
        <section aria-label="Editor launch">
          <h2>Open an editor</h2>
          <EditorLaunchPills />
        </section>
        <section aria-label="My projects">
          <h2>My projects</h2>
          <ProjectCards projects={projects} zone={null} emptyPillHref="/editor/new?kind=3d" emptyPillLabel="New 3D design" />
        </section>
        <section aria-label="My exports">
          <h2>My exports</h2>
          <ExportList exports={exports} />
        </section>
      </div>
      {createOpen && (
        <CreateClassroomDialog
          opener={createOpener}
          defaultTimeZone={classrooms?.[0]?.timeZone}
          onClose={(created) => {
            setCreateOpen(false);
            void load();
            if (created) say(M.classroomCreated(created));
          }}
          navigate={props.ctx.navigate}
        />
      )}
    </main>
  );
}
