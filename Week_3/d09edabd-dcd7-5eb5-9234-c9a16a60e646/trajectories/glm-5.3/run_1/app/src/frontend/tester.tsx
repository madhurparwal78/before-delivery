import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayNode, PlayPage } from '../shared/types.js';
import { COPY } from '../shared/copy.js';
import { mmss } from '../shared/index.js';
import { api, fetchPlay } from './api.js';
import { useEventStream, useServerClock } from './hooks.js';
import { hasWebGL } from './stage-math.js';
import { Stage3D } from './stage3d.js';
import { perspective, multiply } from './stage-math.js';
import { Dialog, Icon } from './ui.jsx';

/** The tester's page at /play/<token> (DP-32, DP-35, DP-38). */
export function TesterPage(props: { token: string }): JSX.Element {
  const [page, setPage] = useState<PlayPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'puzzles' | 'hints'>(null);
  const [status, setStatus] = useState('');
  const [name, setName] = useState('');
  const [pos, setPos] = useState({ x: 0, z: 0, yaw: 180 });
  const [resyncKey, setResyncKey] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async (): Promise<void> => {
    const r = await fetchPlay(props.token);
    if (r.status === 410) { setErr(COPY.inviteExpired); return; }
    if (r.status === 404) { setErr(COPY.linkInvalid); return; }
    if (r.status === 200) {
      const body = r.body as PlayPage;
      setPage(body);
      setResyncKey((k) => k + 1);
    }
  }, [props.token]);

  useEffect(() => { void load(); }, [load]);

  const session = page?.session ?? null;
  const remaining = useServerClock(
    session && session.state === 'running'
      ? { remainingSeconds: session.remainingSeconds, serverTime: session.serverTime }
      : null,
    resyncKey
  );

  useEventStream(session ? `/api/play/${props.token}/events` : null, (event, data) => {
    const d = data as Record<string, unknown>;
    if (event === 'session') {
      setPage((cur) => cur && ({ ...cur, session: (d.session as PlayPage['session']) }));
      setResyncKey((k) => k + 1);
    } else if (event === 'hint') {
      setPage((cur) => cur && ({ ...cur, hints: [...cur.hints, { text: (d as { text: string }).text, sentAt: (d as { sentAt: string }).sentAt }] }));
      setStatus(COPY.hintReceived((d as { text: string }).text));
    } else if (event === 'solve') {
      void load();
    } else if (event === 'tester') {
      // other testers' positions drawn as markers (no-op in this minimal renderer)
    }
  });

  /* walking */
  useEffect(() => {
    if (!page || page.session.state !== 'running' || !page.me.joined) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const step = 150;
      setPos((p) => {
        const rad = (p.yaw * Math.PI) / 180;
        let { x, z } = p;
        if (e.key === 'w' || e.key === 'ArrowUp') { x += Math.sin(rad) * step; z += Math.cos(rad) * step; }
        if (e.key === 's' || e.key === 'ArrowDown') { x -= Math.sin(rad) * step; z -= Math.cos(rad) * step; }
        if (e.key === 'a' || e.key === 'ArrowLeft') { x -= Math.cos(rad) * step; z += Math.sin(rad) * step; }
        if (e.key === 'd' || e.key === 'ArrowRight') { x += Math.cos(rad) * step; z -= Math.sin(rad) * step; }
        return { ...p, x: Math.round(x), z: Math.round(z) };
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page?.session.state, page?.me.joined]);

  // report position every 2 s while moving
  const lastPos = useRef({ x: 0, z: 0 });
  useEffect(() => {
    if (!page?.me.joined || page.session.state !== 'running') return;
    const t = setInterval(() => {
      if (pos.x !== lastPos.current.x || pos.z !== lastPos.current.z) {
        lastPos.current = { x: pos.x, z: pos.z };
        void api.post(`/api/play/${props.token}/position`, { xMm: pos.x, zMm: pos.z, headingDeg: pos.yaw });
      }
    }, 2000);
    return () => clearInterval(t);
  }, [pos, page?.me.joined, page?.session.state, props.token]);

  /* stage render (player height) */
  useEffect(() => {
    if (!page || !hasWebGL()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const render = (): void => {
      const stage = new Stage3D(canvas);
      const dpr = window.devicePixelRatio || 1;
      stage.resize(canvas.clientWidth, canvas.clientHeight, dpr);
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      const proj = perspective((60 * Math.PI) / 180, aspect, 50, 60000);
      const rad = (pos.yaw * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      // first-person: camera at eye height looking along yaw
      const m = new Float32Array(16);
      m[0] = cos; m[2] = sin;
      m[5] = 1;
      m[8] = -sin; m[10] = cos;
      m[12] = -(cos * pos.x - sin * pos.z);
      m[13] = -1600;
      m[14] = -(sin * pos.x + cos * pos.z);
      m[15] = 1;
      const view = { m };
      const mvp = multiply(proj, view);
      const roomModel = (() => {
        const rm = new Float32Array(16);
        rm[0] = page.room.widthMm; rm[5] = 1; rm[10] = page.room.depthMm; rm[15] = 1;
        rm[12] = page.room.widthMm / 2; rm[13] = -0.5; rm[14] = page.room.depthMm / 2;
        return rm;
      })();
      const model = (p: typeof page.room.placements[number]): Float32Array => {
        const mm = new Float32Array(16);
        const pr = (p.rotationDeg * Math.PI) / 180;
        const c2 = Math.cos(pr), s2 = Math.sin(pr);
        mm[0] = c2 * p.widthMm; mm[2] = s2 * p.widthMm;
        mm[5] = p.heightMm;
        mm[8] = -s2 * p.depthMm; mm[10] = c2 * p.depthMm;
        mm[12] = p.xMm + p.widthMm / 2;
        mm[13] = p.yMm + p.heightMm / 2;
        mm[14] = p.zMm + p.depthMm / 2;
        mm[15] = 1;
        return mm;
      };
      stage.render({
        room: { ...page.room, version: 1, revision: 0, stats: { solved: 0, total: 0, longestRun: 0, props: 0 }, starter: false, thumbnailUrl: null, name: page.room.name } as never,
        placements: page.room.placements,
        mvp: mvp.m,
        model,
        roomModel,
        eye: [pos.x, 1600, pos.z],
        selectedId: null,
      });
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [page, pos]);

  const join = useCallback(async (): Promise<void> => {
    if (!name.trim()) return;
    const r = await api.post<PlayPage>(`/api/play/${props.token}/join`, { displayName: name.trim() });
    if (r.status === 200) {
      setPage(r.body as PlayPage);
      setResyncKey((k) => k + 1);
    } else if (r.status === 410) {
      setErr(COPY.inviteExpired);
    }
  }, [name, props.token]);

  const solve = useCallback(async (node: PlayNode): Promise<void> => {
    const r = await api.post<{ nodes: PlayNode[] }>(`/api/play/${props.token}/solves`, {
      nodeId: node.id,
      answer: answers[node.id] ?? undefined,
    });
    const body = r.body as { nodes?: PlayNode[]; error?: string; errors?: Record<string, string> };
    if (r.status === 200 && body.nodes) {
      setPage((cur) => cur && ({ ...cur, nodes: body.nodes! }));
      setStatus(COPY.solved(node.title));
      void load();
    } else if (r.status === 422 && body.errors?.answer === 'incorrect') {
      setStatus(COPY.wrongAnswer);
    } else if (r.status === 409 && body.error === 'prerequisites_unsolved') {
      setStatus(COPY.prereqUnmet);
    } else if (r.status === 422 && body.errors?.nodeId) {
      setStatus(body.errors.nodeId);
    }
  }, [answers, props.token, load]);

  if (err) {
    return (
      <div className="ended-screen">
        <div className="box"><h2>{err}</h2></div>
      </div>
    );
  }
  if (!page) {
    return <div className="ended-screen"><div className="box"><h2>Loading…</h2></div></div>;
  }

  const state = page.session.state;
  const ended = state === 'ended' || state === 'cancelled';
  const joined = page.me.joined;

  return (
    <>
      {/* stage */}
      <div className="stage-region" role="region" aria-label="Room stage" tabIndex={0}>
        {hasWebGL() ? (
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', touchAction: 'none' }} />
        ) : (
          <div className="floorplan-notice">{COPY.noWebGL}</div>
        )}
      </div>

      {/* status */}
      <div className="visually-hidden" role="status" aria-live="polite">{status}</div>

      {/* pill */}
      <div className="tester-pill">
        <strong>{page.room.name}</strong>
        <span className="muted">{state === 'running' ? 'Running' : state === 'lobby' ? 'Lobby' : state === 'scheduled' ? 'Scheduled' : 'Ended'}</span>
        {state === 'running' && <span className="mono tnum" role="timer" aria-label="Playtest clock">{mmss(remaining)}</span>}
      </div>

      {/* join controls */}
      {!joined && !ended && (
        <div style={{ position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)', zIndex: 20, display: 'flex', gap: 10, flexDirection: 'column', alignItems: 'center' }}>
          <input
            aria-label="Display name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 10, padding: '10px 14px', minHeight: 44 }}
          />
          <p className="muted" style={{ textAlign: 'center', maxWidth: 320 }}>
            {state === 'scheduled' || state === 'lobby' ? COPY.lobbyWait : ''}
          </p>
        </div>
      )}

      {/* ended screen */}
      {ended && (
        <div className="ended-screen">
          <div className="box">
            <h2>{COPY.playtestEnded}</h2>
            <p className="muted">{COPY.inviteExpired}</p>
          </div>
        </div>
      )}

      {/* transport */}
      <div className="transport" role="toolbar" aria-label="Transport">
        <button className="cluster-btn" onClick={() => setSheet('puzzles')}>Puzzles</button>
        <button className="cluster-btn" onClick={() => setSheet('hints')}>Hints</button>
        {!joined && !ended ? (
          <button className="play-btn raised" aria-label="Join" onClick={() => void join()}>Join</button>
        ) : (
          <button className="play-btn raised" aria-label="Joined" disabled>Joined</button>
        )}
        <button className="cluster-btn" aria-label="Units" aria-pressed={false}>m</button>
        <button className="cluster-btn" onClick={() => setSheet('hints')} aria-label="Help"><Icon name="help-circle" /></button>
      </div>

      {/* puzzles sheet */}
      {sheet === 'puzzles' && (
        <Dialog label="Puzzles" onClose={() => setSheet(null)}>
          <div className="sheet-head">
            <h2>Puzzles</h2>
            <button className="cluster-btn" aria-label="Close" onClick={() => setSheet(null)}><Icon name="x" /></button>
          </div>
          {page.nodes.map((n) => {
            const st = n.solved ? 'solved' : n.available ? 'available' : 'waiting';
            return (
              <div key={n.id} className="version-card" style={{ padding: 10, marginBottom: 8 }}>
                <div className="head"><span className="num">{n.title}</span><span className="state">{st}</span></div>
                {n.available && (n.kind === 'puzzle' || n.kind === 'exit') && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    {n.needsAnswer && (
                      <input
                        aria-label={`Answer for ${n.title}`}
                        value={answers[n.id] ?? ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, [n.id]: e.target.value }))}
                        style={{ flex: 1, background: 'var(--ground)', border: '1px solid var(--hairline)', borderRadius: 8, padding: '0 10px', minHeight: 44 }}
                      />
                    )}
                    <button className="cluster-btn primary" onClick={() => void solve(n)}>Solve {n.title}</button>
                  </div>
                )}
              </div>
            );
          })}
        </Dialog>
      )}

      {/* hints sheet */}
      {sheet === 'hints' && (
        <Dialog label="Hints" onClose={() => setSheet(null)}>
          <div className="sheet-head">
            <h2>Hints</h2>
            <button className="cluster-btn" aria-label="Close" onClick={() => setSheet(null)}><Icon name="x" /></button>
          </div>
          {page.hints.length ? (
            page.hints.map((h, i) => <p key={i} className="muted">{h.text}</p>)
          ) : (
            <p className="muted">No hints yet.</p>
          )}
        </Dialog>
      )}
    </>
  );
}
