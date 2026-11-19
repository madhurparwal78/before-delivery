import type { VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { loadClassroom, loadClassroomExports } from '../api.js';
import { openStream } from '../live.js';
import { say, savedTimeLabel, shortBytes } from '../status.js';
import { M, STATE_LABELS } from '../copy.js';
import type { Classroom, ClassroomExport, StudentSummary } from '../../shared/types.js';
import { JoinCodeDialog, ClassroomTimesDialog, RenameDialog, RemoveStudentDialog, RemoveEducatorDialog, HandInAllDialog } from './classroomDialogs.js';
import { Glancet, topLevelsOf, type GlancetSnapshot } from '../viewers/glancet.js';

type SortMode = 'nickname' | 'recent';

function nickCollator(): (a: string, b: string) => number {
  const stripAccents = (s: string) => s.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '');
  return (a, b) => {
    const an = stripAccents(a).toLowerCase();
    const bn = stripAccents(b).toLowerCase();
    const ar = an.split(/(\d+)/);
    const br = bn.split(/(\d+)/);
    for (let i = 0; i < Math.max(ar.length, br.length); i++) {
      const av = ar[i], bv = br[i];
      if (av === undefined || bv === undefined) return av ? 1 : -1;
      if (av === bv) continue;
      const bothNum = /^\d+$/.test(av) && /^\d+$/.test(bv);
      if (bothNum) {
        const na = parseInt(av, 10), nb = parseInt(bv, 10);
        if (na !== nb) return na - nb;
      } else {
        return av < bv ? -1 : 1;
      }
    }
    return 0;
  };
}

function sortStudents(students: StudentSummary[], mode: SortMode): StudentSummary[] {
  const byNick = nickCollator();
  const copy = [...students];
  if (mode === 'nickname') {
    copy.sort((a, b) => {
      const c = byNick(a.nickname, b.nickname);
      return c !== 0 ? c : a.id.localeCompare(b.id);
    });
  } else {
    copy.sort((a, b) => {
      const at = a.latestProject?.savedAt ?? '';
      const bt = b.latestProject?.savedAt ?? '';
      if (at === '' && bt === '') return byNick(a.nickname, b.nickname);
      if (at === '') return 1;
      if (bt === '') return -1;
      if (at !== bt) return at < bt ? 1 : -1;
      return byNick(a.nickname, b.nickname);
    });
  }
  return copy;
}

async function fetchSnapshot(projectId: string): Promise<GlancetSnapshot | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return null;
    const data = await res.json() as { snapshot?: GlancetSnapshot };
    return data.snapshot ?? null;
  } catch {
    return null;
  }
}

function TileRender(props: { projectId: string | null; revision: number }): VNode {
  const [scene, setScene] = useState<GlancetSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    if (!props.projectId) { setScene(null); return; }
    void fetchSnapshot(props.projectId).then((s) => { if (alive) setScene(s); });
    return () => { alive = false; };
  }, [props.projectId, props.revision]);
  const { items } = topLevelsOf(scene);
  if (items.length === 0) {
    return (
      <svg viewBox="-25 -25 50 50" style="width:100%;height:100%" aria-hidden="true">
        <rect x="-10" y="-10" width="20" height="20" rx="3" fill="#e2e8f5" />
      </svg>
    );
  }
  // Still top-view render of the saved snapshot.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const halfW = (it.mesh.positions.reduce((m, v, i) => i % 3 === 0 ? Math.max(m, Math.abs(v)) : m, 0));
    void halfW;
  }
  const simple: Array<{ kind: string; x: number; y: number; z: number; w: number; d: number; h: number; color: string; mode: string }> =
    scene && scene.kind !== 'circuit'
      ? (scene.kind === '3d' ? scene.objects : scene.objects)
      : [];
  for (const o of simple) {
    minX = Math.min(minX, o.x - o.w / 2); maxX = Math.max(maxX, o.x + o.w / 2);
    minY = Math.min(minY, o.y - o.d / 2); maxY = Math.max(maxY, o.y + o.d / 2);
  }
  if (!simple.length) { minX = -15; maxX = 15; minY = -15; maxY = 15; }
  const pad = 6;
  const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  return (
    <svg viewBox={`${minX - pad} ${-maxY - pad} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" aria-hidden="true">
      {simple.map((o, i) => o.kind === 'box'
        ? <rect x={o.x - o.w / 2} y={-o.y - o.d / 2} width={o.w} height={o.d} rx="1" fill={o.mode === 'hole' ? '#aab' : o.color} key={i} />
        : <circle cx={o.x} cy={-o.y} r={o.w / 2} fill={o.mode === 'hole' ? '#aab' : o.color} key={i} />)}
    </svg>
  );
}

export function ClassroomPage(props: { ctx: AppCtx; id: string }): VNode {
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [exportsList, setExportsList] = useState<ClassroomExport[]>([]);
  const [sort, setSort] = useState<SortMode>('nickname');
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  const [handInOpen, setHandInOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [renameFor, setRenameFor] = useState<StudentSummary | null>(null);
  const [removeFor, setRemoveFor] = useState<StudentSummary | null>(null);
  const [removeEduFor, setRemoveEduFor] = useState<{ id: string; displayName: string } | null>(null);
  const [assistantEmail, setAssistantEmail] = useState('');
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [glancetFor, setGlancetFor] = useState<StudentSummary | null>(null);
  const [glancetSnap, setGlancetSnap] = useState<GlancetSnapshot | null>(null);
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const openersRef = useRef<Map<string, HTMLElement>>(new Map());
  const renameResultRef = useRef<string | null>(null);
  const glancetOpenerRef = useRef<HTMLElement | null>(null);

  const reload = async () => {
    const [clsRes, expRes] = await Promise.all([loadClassroom(props.id), loadClassroomExports(props.id)]);
    if (clsRes.ok) setClassroom(clsRes.data);
    if (expRes.ok) setExportsList(expRes.data.exports);
  };

  useEffect(() => {
    if (props.ctx.account && props.ctx.account.kind !== 'educator') {
      props.ctx.navigate(props.ctx.account.kind === 'student' ? '/class' : '/projects');
      return;
    }
    void reload();
  }, [props.ctx.account]);

  // Live updates for the roster.
  useEffect(() => {
    if (!classroom) return;
    const handle = openStream({
      onStudentJoined: (classroomId: string, student: { id: string; nickname: string }) => {
        if (classroomId !== props.id) return;
        say(M.studentJoined(student.nickname));
        void reload();
      },
      onStudentRenamed: (classroomId: string, _studentId: string, nickname: string) => {
        if (classroomId !== props.id) return;
        void reload();
        say(M.renamed(nickname));
      },
      onStudentRemoved: (classroomId: string, _studentId: string, nickname: string) => {
        if (classroomId !== props.id) return;
        say(M.removedStudent(nickname));
        if (glancetFor && glancetFor.nickname === nickname) {
          setGlancetFor(null);
          say(M.glancetRemoved(nickname, classroomRef.current?.name ?? ''));
        }
        void reload();
      },
      onProjectSaved: (ev: { classroomId: string | null; ownerId: string; revision: number }) => {
        if (ev.classroomId !== props.id) return;
        const nick = classroomRef.current?.students.find((st) => st.id === ev.ownerId)?.nickname;
        if (nick) say(M.studentSaved(nick, ev.revision));
        void reload();
      },
      onProjectHandedIn: (ev: { classroomId: string | null; ownerId: string }) => {
        if (ev.classroomId !== props.id) return;
        const nick = classroomRef.current?.students.find((st) => st.id === ev.ownerId)?.nickname;
        if (nick) say(M.studentHandedIn(nick));
        void reload();
      },
      onClassroomState: (ev: { classroomId: string }) => {
        if (ev.classroomId !== props.id) return;
        void reload();
      },
      onAccessEnded: (ev: { classroomId: string }) => {
        if (ev.classroomId !== props.id) return;
        setRemovalNotice(M.removedNotice(classroomRef.current?.name ?? ''));
        setClassroom(null);
      },
    });
    return () => handle.close();
  }, [classroom?.id, glancetFor?.id]);

  const classroomRef = useRef<Classroom | null>(null);
  classroomRef.current = classroom;

  // Load the watched student's snapshot when Glancet opens.
  useEffect(() => {
    if (!glancetFor?.latestProject) { setGlancetSnap(null); return; }
    let alive = true;
    void fetchSnapshot(glancetFor.latestProject.id).then((s) => { if (alive) setGlancetSnap(s); });
    return () => { alive = false; };
  }, [glancetFor?.latestProject?.id, glancetFor?.latestProject?.revision]);

  const sorted = useMemo(() => classroom ? sortStudents(classroom.students, sort) : [], [classroom, sort]);

  const closeGlancet = () => {
    setGlancetFor(null);
    glancetOpenerRef.current?.focus();
  };

  if (props.ctx.account === null) {
    return <main><div class="auth-card"><h1>Sign in to see this classroom</h1><a class="pill" href="/signin">Sign in</a></div></main>;
  }
  if (removalNotice) {
    return (
      <main>
        <div class="auth-card">
          <h1>{removalNotice}</h1>
          <a class="pill" href="/dashboard">Back to dashboard</a>
        </div>
      </main>
    );
  }
  if (!classroom) {
    return <main><div class="wrap" style="padding-top:32px"><h1>Project not found</h1><a class="pill" href="/dashboard">Go home</a></div></main>;
  }

  const isOwner = classroom.role === 'owner';

  const archive = async () => {
    const res = await fetch(`/api/classrooms/${classroom.id}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (res.ok) {
      say(M.classroomArchived);
      await reload();
    } else {
      const err = await res.json() as { message: string };
      say(err.message);
    }
    setArchiveOpen(false);
  };

  const addAssistant = async () => {
    setAssistantError(null);
    const res = await fetch(`/api/classrooms/${classroom.id}/educators`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: assistantEmail }),
    });
    if (res.ok) {
      const data = await res.json() as { displayName: string };
      say(M.assistantAdded(data.displayName));
      setAssistantEmail('');
      await reload();
    } else {
      const err = await res.json() as { error: string };
      setAssistantError(err.error === 'already_added' ? M.alreadyAdded : err.error === 'no_such_educator' ? M.noSuchEducator : err.error === 'validation' ? M.validation : M.notFound);
    }
  };

  return (
    <main>
      <div class="wrap" style="padding-top:32px">
        <h1
          tabIndex={-1}
          ref={(el) => {
            if (el && sessionStorage.getItem('qy-focus-classroom-heading') === classroom.id) {
              sessionStorage.removeItem('qy-focus-classroom-heading');
              el.focus();
            }
          }}
        >
          {classroom.name}
        </h1>
        <p><strong>{STATE_LABELS[classroom.state]}</strong></p>
        <p>{M.joinWindow(classroom.joinOpensLocal.replace('T', ' '), classroom.joinClosesLocal.replace('T', ' '), classroom.timeZone)}</p>
        <p>{M.handInLine(classroom.handInLocal.replace('T', ' '), classroom.timeZone)}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 24px">
          <button class="pill ghost" onClick={(e) => { openersRef.current.set('join', e.currentTarget as HTMLElement); setJoinCodeOpen(true); }}>Show join code</button>
          {isOwner && <button class="pill ghost" onClick={(e) => { openersRef.current.set('times', e.currentTarget as HTMLElement); setTimesOpen(true); }}>Edit times</button>}
          <button class="pill ghost" onClick={(e) => { openersRef.current.set('handin', e.currentTarget as HTMLElement); setHandInOpen(true); }}>Hand in all projects</button>
          {isOwner && <button class="pill ghost" onClick={(e) => { openersRef.current.set('archive', e.currentTarget as HTMLElement); setArchiveOpen(true); }}>Archive classroom</button>}
        </div>

        <div style="display:flex;align-items:center;gap:14px;margin:18px 0 12px">
          <h2 style="margin:0">Classroom roster</h2>
          <label for="sort-roster" class="qy-hidden">Sort roster</label>
          <select
            id="sort-roster"
            value={sort === 'nickname' ? 'Nickname (A–Z)' : 'Most recently saved'}
            onChange={(e) => setSort((e.target as HTMLSelectElement).value === 'Nickname (A–Z)' ? 'nickname' : 'recent')}
            style="min-width:200px"
          >
            <option value="Nickname (A–Z)">Nickname (A–Z)</option>
            <option value="Most recently saved">Most recently saved</option>
          </select>
        </div>

        {sorted.length === 0 ? (
          <div class="empty">
            <div class="doodle">
              <svg width="120" height="70" viewBox="0 0 120 70" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <ellipse cx="35" cy="30" rx="18" ry="14" />
                <ellipse cx="35" cy="30" rx="8" ry="6" />
                <path d="M62 55 C 72 25, 84 25, 94 55" />
                <path d="M60 62 H 98" stroke-dasharray="4 4" />
              </svg>
            </div>
            <p>Share the join code and students will appear here.</p>
            <button class="pill" onClick={(e) => { openersRef.current.set('join', e.currentTarget as HTMLElement); setJoinCodeOpen(true); }}>Show join code</button>
          </div>
        ) : (
          <ul class="roster-grid" role="list" aria-label="Classroom roster" style="list-style:none;padding:0;margin:0">
            {sorted.map((s) => (
              <li class="tile" key={s.id} data-student-id={s.id} role="listitem" aria-label={s.nickname}>
                <div class="render">
                  <TileRender projectId={s.latestProject?.id ?? null} revision={s.latestProject?.revision ?? 0} />
                  <button
                    class="play-overlay"
                    aria-label={`Watch ${s.nickname} live`}
                    onClick={(e) => {
                      glancetOpenerRef.current = e.currentTarget as HTMLElement;
                      setGlancetFor(s);
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                  </button>
                </div>
                <div class="meta">
                  <span class="nickname">{s.nickname}</span>
                  {s.handedIn && <span class="handed-in">{M.handedInLabel}</span>}
                  <br />
                  <span class="rev num">Rev {s.latestProject?.revision ?? 0}</span>{' '}
                  <span class="saved">{s.latestProject ? savedTimeLabel(s.latestProject.savedAt, classroom.timeZone) : 'Not saved yet'}</span>
                </div>
                <div class="tile-actions">
                  <button class="btn" aria-label={`Rename ${s.nickname}`} onClick={(e) => { openersRef.current.set(`rename-${s.id}`, e.currentTarget as HTMLElement); setRenameFor(s); }}>Rename</button>
                  <button class="btn" aria-label={`Remove ${s.nickname}`} onClick={(e) => { openersRef.current.set(`remove-${s.id}`, e.currentTarget as HTMLElement); setRemoveFor(s); }}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <section aria-label="Instructors" style="margin-top:36px">
          <h2 id="instructors-heading">Instructors</h2>
          <ul id="instructors-list" aria-labelledby="instructors-heading" class="file-list" role="list" aria-label="Instructors">
            {classroom.educators.map((edu) => (
              <li key={edu.id}>
                <span class="nick">{edu.displayName}</span>
                <span class="meta">{edu.email} · {edu.role === 'owner' ? 'Owner' : 'Assistant'}</span>
                {isOwner && edu.role === 'assistant' && (
                  <button
                    class="btn"
                    aria-label={`Remove ${edu.displayName}`}
                    onClick={(e) => { openersRef.current.set(`removeEdu-${edu.id}`, e.currentTarget as HTMLElement); setRemoveEduFor({ id: edu.id, displayName: edu.displayName }); }}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-top:14px">
              <div class="field" style="margin:0;flex:1;min-width:220px">
                <label htmlFor="assistant-email">Assistant's email</label>
                <input id="assistant-email" value={assistantEmail} onInput={(e) => setAssistantEmail((e.target as HTMLInputElement).value)} aria-describedby={assistantError ? 'assistant-email-err' : undefined} />
                {assistantError && <span class="err" id="assistant-email-err" role="alert">{assistantError}</span>}
              </div>
              <button class="pill" style="margin-top:26px" onClick={() => void addAssistant()}>Add assistant</button>
            </div>
          )}
        </section>

        <section aria-label="Hand-in files" style="margin-top:36px">
          <h2 id="files-heading">Hand-in files</h2>
          {exportsList.length === 0 ? (
            <p style="color:var(--slate)">No exports yet.</p>
          ) : (
            <ul class="file-list" role="list" aria-label="Hand-in files">
              {exportsList.map((e) => (
                <li key={e.id}>
                  <span class="nick">{e.nickname}</span>
                  <a href={e.downloadUrl}>Download {e.fileName}</a>
                  <span class="meta">{e.format.toUpperCase()} · {e.unit} · {shortBytes(e.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {joinCodeOpen && (
        <JoinCodeDialog classroom={classroom} opener={openersRef.current.get('join') ?? null} onClose={() => setJoinCodeOpen(false)} />
      )}
      {timesOpen && (
        <ClassroomTimesDialog
          classroom={classroom}
          opener={openersRef.current.get('times') ?? null}
          onClose={() => setTimesOpen(false)}
          onSaved={() => void reload()}
        />
      )}
      {handInOpen && (
        <HandInAllDialog
          classroomName={classroom.name}
          classroomId={classroom.id}
          opener={openersRef.current.get('handin') ?? null}
          onClose={() => setHandInOpen(false)}
          onDone={() => void reload()}
        />
      )}
      {archiveOpen && (
        <div class="overlay" role="alertdialog" aria-modal="true" aria-label="Archive classroom?">
          <div class="dialog alertd">
            <h2>Archive this classroom?</h2>
            <p style="color:var(--slate)">Student sessions end and the classroom becomes read-only forever.</p>
            <div class="row">
              <button class="pill ghost" onClick={() => setArchiveOpen(false)}>Cancel</button>
              <button class="pill" onClick={() => void archive()}>Archive classroom</button>
            </div>
          </div>
        </div>
      )}
      {renameFor && (
        <RenameDialog
          nickname={renameFor.nickname}
          classroomId={classroom.id}
          studentId={renameFor.id}
          opener={openersRef.current.get(`rename-${renameFor.id}`) ?? null}
          onClose={(saved) => {
            const newNick = renameResultRef.current;
            renameResultRef.current = null;
            setRenameFor(null);
            if (saved) {
              void reload().then(() => {
                // Focus lands on that tile's Rename button for the new nickname.
                const btn = document.querySelector<HTMLButtonElement>(`[aria-label="Rename ${newNick}"]`);
                btn?.focus();
              });
            }
          }}
          onSaved={(nick) => {
            renameResultRef.current = nick;
            say(M.renamed(nick));
          }}
        />
      )}
      {removeFor && (
        <RemoveStudentDialog
          nickname={removeFor.nickname}
          classroomId={classroom.id}
          studentId={removeFor.id}
          opener={openersRef.current.get(`remove-${removeFor.id}`) ?? null}
          onClose={(removed) => {
            setRemoveFor(null);
            if (removed) {
              const removedIndex = sorted.findIndex((st) => st.id === removeFor.id);
              say(M.removedStudent(removeFor.nickname));
              void reload().then(() => {
                // Focus goes to the next tile's Watch button in the current
                // sort order; when the removed tile was last, the tile that
                // is now last; when no tiles remain, Show join code. Wait
                // for React to re-render the shorter roster first.
                const order = sorted.filter((st) => st.id !== removeFor.id);
                const next = order[Math.min(removedIndex, order.length - 1)];
                const selector = next ? `[aria-label="Watch ${next.nickname} live"]` : 'button[aria-label="Show join code"]';
                const waitForButton = (tries: number) => {
                  const btn = document.querySelector<HTMLButtonElement>(selector);
                  if (btn) { btn.focus(); return; }
                  if (tries > 0) requestAnimationFrame(() => waitForButton(tries - 1));
                };
                waitForButton(60);
              });
            }
          }}
        />
      )}
      {removeEduFor && (
        <RemoveEducatorDialog
          name={removeEduFor.displayName}
          classroomId={classroom.id}
          educatorId={removeEduFor.id}
          opener={openersRef.current.get(`removeEdu-${removeEduFor.id}`) ?? null}
          onClose={(removed) => {
            const target = removeEduFor;
            setRemoveEduFor(null);
            if (removed) {
              say(M.removedStudent(target.displayName));
              void reload();
              setTimeout(() => {
                (document.getElementById('assistant-email') as HTMLInputElement | null)?.focus();
              }, 60);
            }
          }}
        />
      )}
      {glancetFor && (
        <Glancet
          studentId={glancetFor.id}
          nickname={glancetFor.nickname}
          revision={glancetFor.latestProject?.revision ?? 0}
          snapshot={glancetSnap}
          onClose={closeGlancet}
          fadeMs={props.ctx.config?.glancetFadeMs ?? 150}
          openerButton={glancetOpenerRef.current}
          classroomId={classroom.id}
        />
      )}
    </main>
  );
}
