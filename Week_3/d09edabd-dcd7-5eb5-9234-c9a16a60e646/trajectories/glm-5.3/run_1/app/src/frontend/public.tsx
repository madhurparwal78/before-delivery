import { useEffect, useRef, useState } from 'react';
import { COPY } from '../shared/copy.js';
import { api, fieldErrors } from './api.js';
import { hasWebGL } from './stage-math.js';
import { Stage3D } from './stage3d.js';
import { multiply, orbitView, perspective } from './stage-math.js';
import type { Placement, Room } from '../shared/types.js';

/** The built-in public Vault copy (belongs to no workspace). */
const VAULT: Room = {
  id: 'vault-tour', name: 'Vault', starter: true,
  widthMm: 3000, depthMm: 3000, heightMm: 2400,
  version: 1, revision: 0,
  stats: { solved: 0, total: 6, longestRun: 6, props: 3 },
  thumbnailUrl: null,
};

const VAULT_PLACEMENTS: Placement[] = [
  { id: 'p1', kind: 'door', label: 'Entry door', propId: null, entry: true, xMm: 1050, yMm: 0, zMm: 0, rotationDeg: 0, widthMm: 900, depthMm: 80, heightMm: 2000, version: 1 },
  { id: 'p2', kind: 'box', label: 'Safe', propId: null, entry: false, xMm: 200, yMm: 0, zMm: 2000, rotationDeg: 0, widthMm: 700, depthMm: 600, heightMm: 900, version: 1 },
  { id: 'p3', kind: 'box', label: 'Desk', propId: null, entry: false, xMm: 1900, yMm: 0, zMm: 2400, rotationDeg: 0, widthMm: 1400, depthMm: 700, heightMm: 750, version: 1 },
  { id: 'p4', kind: 'cylinder', label: 'Keypad pillar', propId: null, entry: false, xMm: 1500, yMm: 0, zMm: 1200, rotationDeg: 0, widthMm: 400, depthMm: 400, heightMm: 2200, version: 1 },
];

const VAULT_NODES = [
  'Ledger cipher', 'Drawer sensor', 'Maglock 3', 'Blacklight cue', 'Safe dial', 'Vault door',
];

/** The public page at / (DP-08). */
export function PublicPage(props: { navigate: (path: string) => void }): JSX.Element {
  const [progress, setProgress] = useState(0);
  const [lit, setLit] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    document.body.classList.add('scrolling');
    return () => document.body.classList.remove('scrolling');
  }, []);

  /* camera tied to scroll */
  useEffect(() => {
    const onScroll = (): void => {
      const max = document.body.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      setProgress(p);
      const k = Math.floor(p * 7);
      setLit(Math.max(0, Math.min(6, k)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* stage render */
  useEffect(() => {
    if (!hasWebGL()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const render = (): void => {
      const stage = new Stage3D(canvas);
      const dpr = window.devicePixelRatio || 1;
      stage.resize(canvas.clientWidth, canvas.clientHeight, dpr);
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      const proj = perspective((50 * Math.PI) / 180, aspect, 50, 60000);
      // path: overview -> through the door -> player height
      const distance = 6500 * (1 - progress * 0.9);
      const pitch = 35 + (progress * 45);
      const yaw = 30 + progress * 150;
      const view = orbitView({ yaw, pitch, distance, targetY: 900 }, { x: VAULT.widthMm / 2, z: VAULT.depthMm / 2 });
      const mvp = multiply(proj, view);
      const roomModel = (() => {
        const m = new Float32Array(16);
        m[0] = VAULT.widthMm; m[5] = 1; m[10] = VAULT.depthMm; m[15] = 1;
        m[12] = VAULT.widthMm / 2; m[13] = -0.5; m[14] = VAULT.depthMm / 2;
        return m;
      })();
      const model = (p: Placement): Float32Array => {
        const m = new Float32Array(16);
        m[0] = p.widthMm; m[5] = p.heightMm; m[10] = p.depthMm; m[15] = 1;
        m[12] = p.xMm + p.widthMm / 2; m[13] = p.yMm + p.heightMm / 2; m[14] = p.zMm + p.depthMm / 2;
        return m;
      };
      stage.render({
        room: VAULT,
        placements: VAULT_PLACEMENTS,
        mvp: mvp.m,
        model,
        roomModel,
        eye: [VAULT.widthMm / 2, VAULT.heightMm * 3, -VAULT.depthMm * 2],
        selectedId: null,
      });
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  const signup = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const r = await api.post('/api/auth/signup', {
      email, password, displayName, venueName,
    });
    if (r.status === 201) {
      props.navigate('/app');
      return;
    }
    if (r.status === 409) {
      setStatus(COPY.emailTaken);
      return;
    }
    const errs = fieldErrors(r.body);
    setErrors(errs);
    const first = Object.values(errs)[0];
    if (first) setStatus(first);
  };

  return (
    <>
      {hasWebGL() && (
        <canvas
          ref={canvasRef}
          style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
          aria-hidden="true"
        />
      )}
      <div className="public-page" style={{ position: 'relative', zIndex: 5 }}>
        <header className="public-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mark" aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--accent)', display: 'inline-block' }} />
            <strong style={{ fontSize: 17 }}>Keyway <span className="muted" style={{ fontWeight: 400 }}>bench</span></strong>
          </span>
          <a href="/signin" className="link-hit">Sign in</a>
        </header>

        <div className="chain-side">
          <ol aria-label="Vault chain">
            {VAULT_NODES.map((t, i) => (
              <li key={t} className={i < lit ? 'lit' : ''} style={{ marginLeft: i < lit ? 0 : 0 }}>{t}</li>
            ))}
          </ol>
          <p className="muted tnum" role="status" aria-live="polite" style={{ marginTop: 8 }}>{lit} of 6 cues lit</p>
        </div>

        <section className="public-panel">
          <div className="panel-body">
            <h1>Walk the room before you build it.</h1>
            <p>
              Keyway Bench is a 3D bench for escape-room owners. Lay out the room to true scale in millimetres,
              wire the puzzle chain as trigger nodes, walk in at player height, and run remote playtests
              before you pay for a physical build.
            </p>
            <p className="muted">Scroll to tour the Vault. Each cue lights as you go.</p>
          </div>
        </section>

        <section className="public-panel">
          <div className="panel-body">
            <h2>True scale in millimetres.</h2>
            <p>Rooms, placements and props are whole millimetres. The Inspector and the build pack show the same strings, in metres or in feet, inches and sixteenths.</p>
          </div>
        </section>

        <section className="public-panel">
          <div className="panel-body">
            <h2>Wire the chain, read the bottleneck.</h2>
            <p>The Trigger graph wires puzzles, locks, cues and the exit. The chain figures show the longest linear run, so one long chain that leaves a team idle is visible before the carpentry.</p>
          </div>
        </section>

        <section className="public-panel">
          <div className="panel-body">
            <h2>Remote playtests with a server-owned clock.</h2>
            <p>Invite testers by email, watch from the game-master view, send hints with a cooldown, and get a debrief with each puzzle's time and the choke point.</p>
          </div>
        </section>

        <section className="public-panel">
          <div className="panel-body">
            <h2>Freeze a build pack for the carpenter.</h2>
            <p>Every freeze keeps a byte-identical snapshot and copies of each prop file. The fabricator reads the pack in metres, or in feet, inches and reduced sixteenths.</p>
          </div>
        </section>

        <div className="signup-sheet">
          <form
            aria-label="Create your venue"
            className="sheet"
            onSubmit={(e) => void signup(e)}
          >
            <h2>Open your bench</h2>
            <div className="field">
              <label htmlFor="su-email">Email</label>
              <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {errors.email && <span className="error">{errors.email}</span>}
            </div>
            <div className="field">
              <label htmlFor="su-pw">Password</label>
              <input id="su-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {errors.password && <span className="error">{errors.password}</span>}
            </div>
            <div className="field">
              <label htmlFor="su-name">Your name</label>
              <input id="su-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              {errors.displayName && <span className="error">{errors.displayName}</span>}
            </div>
            <div className="field">
              <label htmlFor="su-venue">Venue name</label>
              <input id="su-venue" value={venueName} onChange={(e) => setVenueName(e.target.value)} />
              {errors.venueName && <span className="error">{errors.venueName}</span>}
            </div>
            <button className="cluster-btn primary" type="submit" style={{ width: '100%' }}>Create venue</button>
            {status && <p className="muted" role="status" aria-live="polite" style={{ marginTop: 8 }}>{status}</p>}
          </form>
        </div>
      </div>
    </>
  );
}
