import type { VNode } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { getJson, postJson, putJson } from '../api.js';
import { openStream } from '../live.js';
import { say } from '../status.js';
import { M } from '../copy.js';
import type { Project } from '../../shared/types.js';
import type { ProjectSnapshot } from '../../shared/scene.js';
import type { Scene3D, CircuitSnapshot, BlocksSnapshot } from '../../shared/scene.js';
import { setNotices } from '../main.js';
import { Workshop3D } from '../editors/workshop3d.js';
import { ExportDialog } from './exportDialog.js';
import { CircuitBench } from '../editors/circuitBench.js';
import { BlockLab } from '../editors/blockLab.js';

export interface EditorHandle {
  // The editor exposes its current snapshot and name for the save pipeline.
  getSnapshot: () => ProjectSnapshot;
  getName: () => string;
  setSnapshot: (s: ProjectSnapshot) => void;
  markSaved: (revision: number) => void;
  isDirty: () => boolean;
}

export interface EditorSaves {
  save: () => Promise<void>;
  state: SaveState;
  setEditorHandle: (h: EditorHandle) => void;
  project: Project | null;
  readOnly: boolean;
  studentNotice: string | null;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'unsaved';

function localStorageKey(projectId: string): string {
  return `qy-kept-${projectId}`;
}

export function EditorPage(props: { ctx: AppCtx }): VNode {
  const isNew = location.pathname === '/editor/new';
  const kindParam = new URLSearchParams(location.search).get('kind') ?? '3d';
  const starterParam = new URLSearchParams(location.search).get('starter');
  const projectId = isNew ? null : location.pathname.split('/')[2]!;

  const [project, setProject] = useState<Project | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [name, setName] = useState<string>('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [revision, setRevision] = useState(1);
  const [notFound, setNotFound] = useState(false);
  const [storageNotice, setStorageNotice] = useState(false);
  const [staleNotice, setStaleNotice] = useState(false);
  const [handInNotice, setHandInNotice] = useState<string | null>(null);
  const [keptEdits, setKeptEdits] = useState<ProjectSnapshot | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isStudent, setIsStudent] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [handInConfirm, setHandInConfirm] = useState(false);
  const [exportOpener, setExportOpener] = useState<HTMLElement | null>(null);
  const exportHiddenRef = useRef<{ format: string; unit: string }>({ format: 'stl', unit: 'mm' });
  const handleRef = useRef<EditorHandle | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const idemCounter = useRef(0);

  const [urlKind, setUrlKind] = useState<'3d' | 'circuit' | 'blocks'>(
    kindParam === 'circuit' ? 'circuit' : kindParam === 'blocks' ? 'blocks' : '3d',
  );
  const kind: Project['kind'] = project?.kind ?? urlKind;
  const defaultName = kind === '3d' ? 'Untitled 3D design' : kind === 'circuit' ? 'Untitled circuit' : 'Untitled block program';

  const setEditorHandle = useCallback((h: EditorHandle) => { handleRef.current = h; }, []);

  // Load an existing project.
  useEffect(() => {
    if (isNew) {
      setSnapshot(starterSnapshot(kind, starterParam));
      setName(defaultName);
      return;
    }
    let alive = true;
    void (async () => {
      const res = await getJson<{ project: Project; snapshot: ProjectSnapshot }>(`/api/projects/${projectId}`);
      if (!alive) return;
      if (!res.ok) {
        if (res.error.error === 'storage_unavailable') {
          setStorageNotice(true);
          setNotFound(false);
        } else {
          setNotFound(true);
          say(M.notFoundProject);
        }
        return;
      }
      setProject(res.data.project);
      setSnapshot(res.data.snapshot);
      setUrlKind(res.data.project.kind);
      setName(res.data.project.name);
      setRevision(res.data.project.revision);
      if (res.data.project.state === 'handed_in') setHandInNotice(M.projectHandedIn);
      const kept = localStorage.getItem(localStorageKey(projectId!));
      if (kept) {
        try {
          const parsed = JSON.parse(kept) as ProjectSnapshot;
          setKeptEdits(parsed);
        } catch { /* ignore */ }
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  // Student countdown and classroom state.
  useEffect(() => {
    if (props.ctx.account?.kind !== 'student') return;
    setIsStudent(true);
    void getJson<{ secondsToHandIn: number; state: string }>('/api/class').then((res) => {
      if (res.ok) setCountdown(res.data.secondsToHandIn);
    });
  }, [props.ctx.account]);

  const readOnly = (project?.state ?? 'editing') === 'handed_in' || handInNotice !== null;

  const persistKept = (snap: ProjectSnapshot) => {
    if (!projectId) return;
    try { localStorage.setItem(localStorageKey(projectId), JSON.stringify(snap)); } catch { /* full */ }
  };
  const clearKept = () => {
    if (!projectId) return;
    localStorage.removeItem(localStorageKey(projectId));
  };

  const save = async () => {
    const handle = handleRef.current;
    if (!handle) return;
    if (savingRef.current) return;
    if (!projectId && !isNew) return;
    savingRef.current = true;
    setSaveState('saving');
    const snap = handle.getSnapshot();
    const projectName = handle.getName();
    persistKept(snap);

    if (isNew) {
      const res = await postJson<{ project: Project }>('/api/projects', { kind, name: projectName, snapshot: snap });
      savingRef.current = false;
      if (!res.ok) {
        handleSaveError(res);
        return;
      }
      clearKept();
      setSaveState('saved');
      setProject(res.data.project);
      setRevision(res.data.project.revision);
      handle.markSaved(res.data.project.revision);
      history.replaceState(null, '', `/editor/${res.data.project.id}`);
      say(M.saved(res.data.project.revision));
      return;
    }

    const idemKey = `save-${projectId}-${Date.now()}-${idemCounter.current++}`;
    const res = await putJson<{ project: Project }>(`/api/projects/${projectId}`, {
      baseRevision: revision, snapshot: snap, name: projectName,
    }, idemKey);
    savingRef.current = false;
    if (!res.ok) {
      handleSaveError(res);
      return;
    }
    clearKept();
    setSaveState('saved');
    setRevision(res.data.project.revision);
    setProject(res.data.project);
    handle.markSaved(res.data.project.revision);
    dirtyRef.current = false;
    say(M.saved(res.data.project.revision));
  };

  const handleSaveError = (res: { ok: false; error: { error: string; message: string } }) => {
    const code = res.error.error;
    if (code === 'storage_unavailable') {
      setSaveState('unsaved');
      setStorageNotice(true);
      say(M.saveStorageFailed);
      setNotices([M.saveStorageFailed, M.storageStanding]);
      return;
    }
    if (code === 'stale_revision') {
      setSaveState('unsaved');
      setStaleNotice(true);
      say(M.staleRevision);
      setNotices([M.staleRevision], [{ label: 'Reload', onClick: () => location.reload() }]);
      return;
    }
    if (code === 'classroom_handed_in') {
      setSaveState('unsaved');
      setHandInNotice(M.classroomHandedIn);
      say(M.classroomHandedIn);
      setNotices([M.classroomHandedIn]);
      return;
    }
    if (code === 'project_handed_in') {
      setSaveState('unsaved');
      setHandInNotice(M.projectHandedIn);
      say(M.projectHandedIn);
      setNotices([M.projectHandedIn]);
      return;
    }
    if (code === 'email_unverified') {
      setSaveState('unsaved');
      say(M.unverifiedSave);
      setNotices([M.unverifiedReminder(props.ctx.account?.email ?? '')]);
      return;
    }
    if (code === 'removed' || code === 'signed_out') {
      setSaveState('unsaved');
      setHandInNotice(res.error.message);
      setNotices([res.error.message]);
      return;
    }
    if (code === 'idempotency_conflict') {
      say(M.idempotencyConflict);
      return;
    }
    setSaveState('unsaved');
    say(res.error.message);
  };

  // Autosave after the configured interval of no edits.
  const markDirty = () => {
    dirtyRef.current = true;
    setSaveState('unsaved');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    const ms = props.ctx.config?.autosaveMs ?? 1500;
    if (readOnly) return;
    autosaveTimer.current = setTimeout(() => { void save(); }, ms);
  };

  // Live stream: stale tabs, hand-in freezes, removals.
  useEffect(() => {
    if (!project) return;
    const handle = openStream({
      onProjectSaved: (ev) => {
        if (ev.projectId !== project.id) return;
        if (ev.revision > revisionRef.current) {
          if (!dirtyRef.current) {
            // Load the newer revision in place.
            void getJson<{ project: Project; snapshot: ProjectSnapshot }>(`/api/projects/${project.id}`).then((res) => {
              if (res.ok) {
                setSnapshot(res.data.snapshot);
                setName(res.data.project.name);
                setRevision(res.data.project.revision);
                handleRef.current?.setSnapshot(res.data.snapshot);
              }
            });
          }
        }
      },
      onProjectHandedIn: (ev) => {
        if (ev.projectId !== project.id) return;
        setHandInNotice(M.projectHandedIn);
        setNotices([M.projectHandedIn]);
      },
      onClassroomState: (ev) => {
        if (project.classroomId !== ev.classroomId) return;
        setCountdown(ev.secondsToHandIn);
        if (ev.state === 'handed_in' || ev.state === 'archived') {
          setHandInNotice(M.classroomHandedIn);
          setNotices([M.classroomHandedIn]);
        }
      },
      onAccessEnded: (ev) => {
        if (project.classroomId !== ev.classroomId) return;
        setHandInNotice(ev.message);
        setNotices([ev.message]);
      },
    });
    return () => handle.close();
  }, [project?.id]);

  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const snapshotOfRef = useRef<ProjectSnapshot | null>(snapshot);
  snapshotOfRef.current = snapshot;

  const resetExportHidden = () => {
    const el = document.getElementById('qy-export');
    if (!el) return;
    const isCircuit = kind === 'circuit';
    el.dataset.state = 'idle';
    el.dataset.format = isCircuit ? 'svg' : 'stl';
    el.dataset.unit = 'mm';
    el.dataset.triangleCount = '';
    el.dataset.bytes = '';
  };

  const handIn = async () => {
    if (!project) return;
    const res = await postJson<{ project: Project }>(`/api/projects/${project.id}/hand-in`, {});
    if (res.ok) {
      say(M.handedInProject(res.data.project.name));
      setHandInNotice(M.projectHandedIn);
      setNotices([M.projectHandedIn]);
      setProject(res.data.project);
    } else {
      say(res.error.message);
    }
  };

  if (notFound) {
    return (
      <main>
        <div class="wrap" style="padding-top:100px">
          <h1>Project not found</h1>
          <a class="pill" href={props.ctx.account?.kind === 'educator' ? '/dashboard' : props.ctx.account?.kind === 'student' ? '/class' : '/projects'}>Go home</a>
        </div>
      </main>
    );
  }

  if (storageNotice && !snapshot) {
    return (
      <main>
        <div class="wrap" style="padding-top:100px">
          <h1>Storage is unavailable</h1>
          <p>{M.openStorageFailed}</p>
          <button class="pill" onClick={() => location.reload()}>Try again</button>
        </div>
      </main>
    );
  }

  if (snapshot === null) {
    return <main><div class="wrap" style="padding-top:100px"><p>Loading…</p></div></main>;
  }

  const notices: string[] = [];
  if (storageNotice) { notices.push(M.storageStanding); }
  if (staleNotice) { notices.push(M.staleRevision); }
  if (handInNotice) { notices.push(handInNotice); }
  const noticeActions: { label: string; onClick: () => void }[] = [];
  if (staleNotice) noticeActions.push({ label: 'Reload', onClick: () => location.reload() });

  const isViewer = project !== null && props.ctx.account !== null && project.ownerId !== props.ctx.account.id;

  return (
    <>
      <div class="editor">
        <div class="editor-toolbar">
          <label class="qy-hidden" htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            class="name"
            value={name}
            disabled={readOnly || isViewer}
            onInput={(e) => { setName((e.target as HTMLInputElement).value); markDirty(); }}
            onBlur={() => {
              const trimmed = name.trim();
              if (trimmed.length < 1 || trimmed.length > 60) {
                setName(project?.name ?? defaultName);
              }
            }}
          />
          <span class="save-ind" aria-live="polite">
            {saveState === 'saving' ? M.saving : saveState === 'saved' ? M.savedRev(revision) : M.unsaved}
          </span>
          <button class="btn" aria-label="Undo" disabled={readOnly}>Undo</button>
          <button class="btn" aria-label="Redo" disabled={readOnly}>Redo</button>
          <button class="pill" onClick={() => { void save(); }} disabled={readOnly || isViewer}>Save</button>
          <button class="btn" id="export-btn" onClick={(e) => { setExportOpener(e.currentTarget as HTMLElement); setExportOpen(true); resetExportHidden(); }}>Export</button>
          {isStudent && project && (
            <button class="pill" onClick={() => setHandInConfirm(true)} disabled={readOnly}>Hand in</button>
          )}
          {countdown !== null && <span class="countdown num">{formatCountdownText(countdown)}</span>}
        </div>
        <div class="editor-body col-stack">
          {kind === '3d' && (
            <Workshop3D
              snapshot={snapshot as Scene3D}
              readOnly={readOnly}
              markDirty={markDirty}
              onHandle={setEditorHandle}
              name={name}
              setName={setName}
            />
          )}
          {kind === 'circuit' && (
            <CircuitBench
              snapshot={snapshot as CircuitSnapshot}
              readOnly={readOnly}
              markDirty={markDirty}
              onHandle={setEditorHandle}
              name={name}
              setName={setName}
              simTickMs={props.ctx.config?.simTickMs ?? 100}
            />
          )}
          {kind === 'blocks' && (
            <BlockLab
              snapshot={snapshot as BlocksSnapshot}
              readOnly={readOnly}
              markDirty={markDirty}
              onHandle={setEditorHandle}
              name={name}
              setName={setName}
              stepMs={props.ctx.config?.blocksStepMs ?? 400}
            />
          )}
        </div>
      </div>
      {notices.length > 0 && (
        <div class="notice" role="region" aria-label="Notice" style="margin-top:64px">
          {notices.map((n, i) => (
            <span class="item" key={i}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16.5v.01"/></svg>
              {n}
            </span>
          ))}
          {noticeActions.map((a, i) => <button class="pill ghost" key={i} onClick={a.onClick}>{a.label}</button>)}
        </div>
      )}
      {exportOpen && (
        <ExportDialog
          projectName={name}
          kind={kind}
          snapshot={snapshotOfRef.current}
          projectId={project?.id ?? null}
          readOnly={readOnly}
          opener={exportOpener}
          onClose={() => setExportOpen(false)}
          onExported={() => { setSaveState('saved'); }}
          hiddenStateRef={exportHiddenRef}
        />
      )}
      <div id="qy-export" class="qy-hidden" aria-hidden="true" data-state="idle" data-format="stl" data-unit="mm" data-triangle-count="" data-bytes="" />
      {handInConfirm && project && (
        <div class="overlay" role="alertdialog" aria-modal="true" aria-label={`Hand in ${project.name}?`}>
          <div class="dialog alertd">
            <h2>Hand in {project.name}?</h2>
            <p style="color:var(--slate)">This project becomes read-only. This can't be undone.</p>
            <div class="row">
              <button class="pill ghost" onClick={() => setHandInConfirm(false)}>Cancel</button>
              <button
                class="pill"
                onClick={() => {
                  setHandInConfirm(false);
                  void handIn();
                }}
              >
                Hand in now
              </button>
            </div>
          </div>
        </div>
      )}
      {keptEdits && (
        <div class="notice" role="region" aria-label="Notice" style="margin-top:64px">
          <span class="item">{M.keptEdits}</span>
          <button class="pill ghost" onClick={() => {
            handleRef.current?.setSnapshot(keptEdits);
            setKeptEdits(null);
            markDirty();
          }}>Restore</button>
          <button class="pill ghost" onClick={() => { clearKept(); setKeptEdits(null); }}>Discard</button>
        </div>
      )}
    </>
  );
}

function formatCountdownText(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return M.countdown(d, h, m);
}

function starterSnapshot(kind: Project['kind'], starter: string | null): ProjectSnapshot {
  if (kind === 'circuit') return { kind: 'circuit', components: [], wires: [] };
  if (kind === 'blocks') return { kind: 'blocks', program: [], objects: [] };
  return blankScene(starter);
}

export function blankScene(starter: string | null): Scene3D {
  const starters: Record<string, () => Scene3D> = {
    'desk-name-tag': () => ({
      kind: '3d',
      objects: [
        obj('box', 60, 28, 4, 0, 0, 2, 'solid', '#4caf50'),
        obj('cylinder', 6, 6, 10, -24, 0, 5, 'hole', '#9c27b0'),
        obj('box', 4, 4, 4, -10, 0, 6, 'solid', '#ff9800'),
        obj('box', 4, 4, 4, -4, 0, 6, 'solid', '#2196f3'),
        obj('box', 4, 4, 4, 2, 0, 6, 'solid', '#4caf50'),
        obj('box', 4, 4, 4, 8, 0, 6, 'solid', '#9c27b0'),
      ],
      workplane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    }),
    'pencil-cup': () => ({
      kind: '3d',
      objects: [
        obj('cylinder', 44, 44, 56, 0, 0, 28, 'solid', '#4caf50'),
        obj('cylinder', 36, 36, 56, 0, 0, 28, 'hole', '#9c27b0'),
      ],
      workplane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    }),
    'rainbow-lamp': () => ({
      kind: '3d',
      objects: [
        obj('cylinder', 46, 46, 20, 0, 0, 10, 'solid', '#ff9800'),
        obj('cylinder', 36, 36, 20, 0, 0, 30, 'solid', '#9c27b0'),
        obj('cylinder', 28, 28, 20, 0, 0, 50, 'solid', '#4caf50'),
        obj('sphere', 34, 34, 34, 0, 0, 77, 'solid', '#2196f3'),
      ],
      workplane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    }),
    'spiral-tower': () => ({
      kind: '3d',
      objects: Array.from({ length: 6 }, (_, i) =>
        obj('box', 40 - i * 3, 40 - i * 3, 8, 0, 0, 4 + i * 8, 'solid', ['#4caf50', '#9c27b0', '#ff9800', '#2196f3', '#4caf50', '#9c27b0'][i]!, i * 15)),
      workplane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    }),
  };
  if (starter && starters[starter]) return starters[starter]!();
  return { kind: '3d', objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } };
}

function obj(kind: 'box' | 'cylinder' | 'sphere', w: number, d: number, h: number, x: number, y: number, z: number, mode: 'solid' | 'hole', color: string, rotationZ = 0): Scene3D['objects'][number] {
  return {
    id: `o${Math.random().toString(36).slice(2, 9)}`,
    kind, mode, x, y, z, w, d, h, rotationZ, color, children: [],
  } as Scene3D['objects'][number];
}
