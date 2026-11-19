import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { createContext, drawScene, hexToRgb, meshFor, DEFAULT_CAMERA, type CameraState, type DrawItem } from '../gl.js';

export interface PreviewScene { objects: Array<{ kind: string; w: number; d: number; h: number; x: number; y: number; z: number; color: string; mode?: 'solid' | 'hole'; rotationZ?: number }> }

export function useReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function SceneSvg(props: { scene: PreviewScene }): VNode {
  const all = props.scene.objects;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of all) {
    minX = Math.min(minX, o.x - o.w / 2); maxX = Math.max(maxX, o.x + o.w / 2);
    minY = Math.min(minY, o.y - o.d / 2); maxY = Math.max(maxY, o.y + o.d / 2);
  }
  if (!all.length) { minX = -20; maxX = 20; minY = -20; maxY = 20; }
  const pad = 8;
  const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  return (
    <svg viewBox={`${minX - pad} ${-maxY - pad} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%">
      {all.map((o, i) => {
        const cx = o.x, cy = -o.y;
        if (o.kind === 'sphere') return <circle cx={cx} cy={cy} r={o.w / 2} fill={o.mode === 'hole' ? '#aab' : o.color} key={i} />;
        if (o.kind === 'cylinder') return <circle cx={cx} cy={cy} r={o.w / 2} fill={o.mode === 'hole' ? '#aab' : o.color} key={i} />;
        return <rect x={cx - o.w / 2} y={cy - o.d / 2} width={o.w} height={o.d} rx="2" fill={o.mode === 'hole' ? '#aab' : o.color} key={i} />;
      })}
    </svg>
  );
}

export function SceneCanvas(props: {
  scene: PreviewScene;
  turnMs?: number;
  playing?: boolean;
  camera?: Partial<CameraState>;
  className?: string;
}): VNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hasGl, setHasGl] = useState(true);
  const playing = props.playing ?? true;
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !hasGl) return;
    const ctx = createContext(canvas);
    if (!ctx) { setHasGl(false); return; }
    const items: DrawItem[] = props.scene.objects.map((o) => ({
      mesh: meshFor(o.kind, o.w, o.d, o.h, o.rotationZ ?? 0),
      x: o.x, y: o.y, z: o.z,
      color: hexToRgb(o.color),
      mode: (o.mode ?? 'solid') as 'solid' | 'hole',
    }));
    let raf = 0;
    const draw = (t: number) => {
      const camera: CameraState = {
        ...DEFAULT_CAMERA, ...props.camera,
        azimuth: props.turnMs && playing && !reduced ? ((t / props.turnMs) * 360) % 360 : (props.camera?.azimuth ?? 45),
      };
      drawScene(ctx, items, camera, [1, 1, 1, 1]);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [props.scene, playing, reduced, props.turnMs]);

  if (!hasGl) return <SceneSvg scene={props.scene} />;
  return <canvas ref={ref} class={props.className} aria-hidden="true" />;
}

// Hero toy scene: green wedge, purple cylinder, orange box with a carved hole.
const HERO_SCENE: PreviewScene = {
  objects: [
    { kind: 'box', w: 30, d: 30, h: 18, x: -26, y: -8, z: 9, color: '#7ef29d' },
    { kind: 'cylinder', w: 22, d: 22, h: 34, x: 4, y: 14, z: 17, color: '#9c6bff' },
    { kind: 'box', w: 34, d: 34, h: 26, x: 26, y: -10, z: 13, color: '#ff8c42' },
    { kind: 'cylinder', w: 16, d: 16, h: 30, x: 26, y: -10, z: 13, color: '#cccccc', mode: 'hole' },
  ],
};

function HeroScene(): VNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hasGl, setHasGl] = useState(true);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = createContext(canvas);
    if (!ctx) { setHasGl(false); return; }
    const items: DrawItem[] = HERO_SCENE.objects.map((o) => ({
      mesh: meshFor(o.kind, o.w, o.d, o.h, 0),
      x: o.x, y: o.y, z: o.z,
      color: hexToRgb(o.color),
      mode: (o.mode ?? 'solid') as 'solid' | 'hole',
    }));
    let raf = 0;
    const draw = () => {
      drawScene(ctx, items, { azimuth: 45, elevation: 35, distance: 150, target: [0, 0, 12] }, [0.184, 0.42, 1, 1]);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!hasGl) return <SceneSvg scene={HERO_SCENE} />;
  return <canvas ref={ref} aria-hidden="true" style="width:100%;height:320px;display:block" />;
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// Poster card: a procedural looping build of the hero scene.
function PosterCard(): VNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const [hasGl, setHasGl] = useState(true);
  const reduced = useReducedMotion();

  useEffect(() => { if (reduced) setPaused(true); }, [reduced]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = createContext(canvas);
    if (!ctx) { setHasGl(false); return; }
    const LOOP = 8000;
    let raf = 0;
    let t0 = -1;
    const draw = (t: number) => {
      if (t0 < 0) t0 = t;
      const elapsed = paused || reduced ? LOOP - 1 : (t - t0) % LOOP;
      const items: DrawItem[] = [];
      const wedgeT = Math.min(1, elapsed / 1600);
      const wedgeDrop = (1 - ease(wedgeT)) * 80;
      items.push({ mesh: meshFor('box', 30, 30, 18, 0), x: -26, y: -8, z: 9 + wedgeDrop, color: hexToRgb('#7ef29d'), mode: 'solid' });
      if (elapsed > 2000) {
        const cylT = Math.min(1, (elapsed - 2000) / 1600);
        items.push({ mesh: meshFor('cylinder', 22, 22, 34 * ease(cylT) + 0.01, 0), x: 4, y: 14, z: (34 * ease(cylT)) / 2, color: hexToRgb('#9c6bff'), mode: 'solid' });
      }
      if (elapsed > 4200) {
        const boxT = Math.min(1, (elapsed - 4200) / 1200);
        items.push({ mesh: meshFor('box', 34 * boxT + 0.01, 34 * boxT + 0.01, 26, 0), x: 26, y: -10, z: 13, color: hexToRgb('#ff8c42'), mode: 'solid' });
      }
      if (elapsed > 6000) {
        const holeT = Math.min(1, (elapsed - 6000) / 1200);
        items.push({ mesh: meshFor('cylinder', 16, 16, 30, 0), x: 26, y: -10, z: 13, color: hexToRgb('#cccccc'), mode: holeT > 0.05 ? 'hole' : 'solid' });
      }
      drawScene(ctx, items, { azimuth: 45, elevation: 35, distance: 160, target: [0, 0, 12] }, [0.965, 0.973, 0.996, 1]);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [paused, reduced]);

  const stagePlaying = !(paused || reduced);
  return (
    <div class="poster-card">
      <div class="stage" data-playing={String(stagePlaying)}>
        {hasGl ? <canvas ref={ref} aria-hidden="true" /> : <SceneSvg scene={HERO_SCENE} />}
        <div class="play-controls">
          {stagePlaying ? (
            <button class="play-btn small" aria-label="Pause build preview" aria-pressed="true" onClick={() => setPaused(true)} style="position:absolute;top:12px;right:12px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
            </button>
          ) : (
            <button class="play-btn" aria-label="Play build preview" data-playing="false" onClick={() => setPaused(false)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </button>
          )}
        </div>
      </div>
      <div class="caption">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2v4M5 9l3 3l-3 3M19 9l-3 3l3 3" /><circle cx="12" cy="14" r="4" /></svg>
        Watch a part take shape, hole and all
      </div>
    </div>
  );
}

const EDITORS = [
  { name: '3D Workshop', color: 'var(--field-3d)', desc: 'Push shapes around a workplane, carve holes, group parts and export a printable file.', icon: 'box', explore: 'Explore 3D Workshop', kind: '3d' },
  { name: 'Circuit Bench', color: 'var(--field-circuit)', desc: 'Wire batteries, LEDs, resistors and switches, then watch the live simulation solve it.', icon: 'zap', explore: 'Explore Circuit Bench', kind: 'circuit' },
  { name: 'Block Lab', color: 'var(--field-blocks)', desc: 'Snap blocks together into a program that stacks 3D objects one step at a time.', icon: 'blocks', explore: 'Explore Block Lab', kind: 'blocks' },
];

const FEATURES = [
  { editor: '3D Workshop', color: 'var(--field-3d)', eyebrow: 'SOLID AND HOLE', title: 'Carve a shape you can actually print', text: 'Boxes, cylinders and spheres snap to the workplane. Turn one into a hole, group them, and the mesh is a closed solid ready for the printer — in millimetres or inches.', media: 'part' },
  { editor: 'Circuit Bench', color: 'var(--field-circuit)', eyebrow: 'LIVE READOUTS', title: 'Watch the current the moment you change it', text: 'The solver runs while you type. Add the 330 Ω resistor before the LED burns out, or reset it and try again.', media: 'led' },
  { editor: 'Block Lab', color: 'var(--field-blocks)', eyebrow: 'STEP BY STEP', title: 'Programs that build towers one block at a time', text: 'Repeat a body, move the cursor, and the viewer stacks the result one step per tick. Save it and your instructor sees it live.', media: 'blocks' },
];

const STARTERS = [
  { id: 'desk-name-tag', name: 'Desk Name Tag' },
  { id: 'pencil-cup', name: 'Pencil Cup' },
  { id: 'rainbow-lamp', name: 'Rainbow Lamp' },
  { id: 'spiral-tower', name: 'Spiral Tower' },
];

export const STARTER_SHAPES: Record<string, Array<{ kind: string; w: number; d: number; h: number; x: number; y: number; z: number; rotationZ?: number; color?: string; mode?: 'solid' | 'hole' }>> = { // eslint-disable-line
  'desk-name-tag': [
    { kind: 'box', w: 60, d: 28, h: 4, x: 0, y: 0, z: 2, color: '#4caf50' },
    { kind: 'cylinder', w: 6, d: 6, h: 10, x: -24, y: 0, z: 5, color: '#9c27b0', mode: 'hole' },
    { kind: 'box', w: 4, d: 4, h: 4, x: -10, y: 0, z: 6, color: '#ff9800' },
    { kind: 'box', w: 4, d: 4, h: 4, x: -4, y: 0, z: 6, color: '#2196f3' },
    { kind: 'box', w: 4, d: 4, h: 4, x: 2, y: 0, z: 6, color: '#4caf50' },
    { kind: 'box', w: 4, d: 4, h: 4, x: 8, y: 0, z: 6, color: '#9c27b0' },
  ],
  'pencil-cup': [
    { kind: 'cylinder', w: 44, d: 44, h: 56, x: 0, y: 0, z: 28, color: '#4caf50' },
    { kind: 'cylinder', w: 36, d: 36, h: 56, x: 0, y: 0, z: 28, color: '#9c27b0', mode: 'hole' },
  ],
  'rainbow-lamp': [
    { kind: 'cylinder', w: 46, d: 46, h: 20, x: 0, y: 0, z: 10, color: '#ff9800' },
    { kind: 'cylinder', w: 36, d: 36, h: 20, x: 0, y: 0, z: 30, color: '#9c27b0' },
    { kind: 'cylinder', w: 28, d: 28, h: 20, x: 0, y: 0, z: 50, color: '#4caf50' },
    { kind: 'sphere', w: 34, d: 34, h: 34, x: 0, y: 0, z: 77, color: '#2196f3' },
  ],
  'spiral-tower': Array.from({ length: 6 }, (_, i) => {
    const size = 40 - i * 3;
    return { kind: 'box', w: size, d: size, h: 8, x: 0, y: 0, z: 4 + i * 8, rotationZ: i * 15, color: ['#4caf50', '#9c27b0', '#ff9800', '#2196f3', '#4caf50', '#9c27b0'][i] };
  }),
};

function FeatureMedia(props: { kind: string }): VNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const [hasGl, setHasGl] = useState(true);
  const reduced = useReducedMotion();
  useEffect(() => { if (reduced) setPaused(true); }, [reduced]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = createContext(canvas);
    if (!ctx) { setHasGl(false); return; }
    const LOOP = 6000;
    let raf = 0;
    let t0 = -1;
    const draw = (t: number) => {
      if (t0 < 0) t0 = t;
      const e = paused || reduced ? 0.25 : (t - t0) % LOOP / LOOP;
      const items: DrawItem[] = [];
      if (props.kind === 'part') {
        items.push({ mesh: meshFor('box', 40, 40, 20, 0), x: 0, y: 0, z: 10, color: hexToRgb('#4caf50'), mode: 'solid' });
        items.push({ mesh: meshFor('box', 48, 48, 28, 0), x: 0, y: 0, z: 14, color: hexToRgb('#ff8c42'), mode: 'solid' });
      } else if (props.kind === 'led') {
        const pulse = (Math.sin(e * Math.PI * 2) + 1) / 2;
        items.push({ mesh: meshFor('box', 46, 20, 20, 0), x: 0, y: 0, z: 10, color: hexToRgb('#1d48c9'), mode: 'solid' });
        items.push({ mesh: meshFor('sphere', 18 + 10 * pulse, 18, 18, 0), x: 0, y: 0, z: 10, color: [1, 0.85 * pulse + 0.15, 0.4 * pulse], mode: 'solid' });
      } else {
        for (let i = 0; i < 4; i++) {
          const appear = Math.min(1, Math.max(0, e * 4 - i));
          if (appear > 0.05) {
            items.push({ mesh: meshFor('box', 20, 20, 20, 0), x: i * 22 - 33, y: 0, z: 10, color: hexToRgb(['#4caf50', '#9c27b0', '#ff9800', '#2196f3'][i]!), mode: 'solid' });
          }
        }
      }
      drawScene(ctx, items, { azimuth: 40 + e * 40, elevation: 35, distance: 170, target: [0, 0, 12] }, [0.965, 0.973, 0.996, 1]);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [props.kind, paused, reduced]);

  const name = props.kind === 'part' ? '3D Workshop' : props.kind === 'led' ? 'Circuit Bench' : 'Block Lab';
  return (
    <div class="media" data-playing={String(!paused)}>
      {hasGl ? <canvas ref={ref} aria-hidden="true" /> : null}
      <button class="play-btn small" style="position:absolute;top:10px;right:10px;" aria-pressed={paused} aria-label={`Pause ${name} preview`} onClick={() => setPaused(!paused)}>
        {paused ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        )}
      </button>
    </div>
  );
}

function StarterCard(props: { id: string; name: string; signedIn: boolean }): VNode {
  const shapes = (STARTER_SHAPES[props.id] ?? []).map((s) => ({ ...s, color: s.color ?? '#4caf50' }));
  const [paused, setPaused] = useState(false);
  const [hasGl, setHasGl] = useState(true);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (reduced) setPaused(true); }, [reduced]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = createContext(canvas);
    if (!ctx) { setHasGl(false); return; }
    const items: DrawItem[] = shapes.map((s) => ({
      mesh: meshFor(s.kind, s.w, s.d, s.h, s.rotationZ ?? 0),
      x: s.x, y: s.y, z: s.z,
      color: hexToRgb(s.color ?? '#4caf50'),
      mode: (s.mode ?? 'solid') as 'solid' | 'hole',
    }));
    const TURN = 25000;
    let raf = 0;
    let t0 = -1;
    const draw = (t: number) => {
      if (t0 < 0) t0 = t;
      const az = paused || reduced ? 300 : ((t - t0) / TURN * 360) % 360;
      drawScene(ctx, items, { azimuth: az, elevation: 35, distance: 210, target: [0, 0, 20] }, [1, 1, 1, 1]);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shapes, paused, reduced]);
  const href = props.signedIn ? `/editor/new?kind=3d&starter=${props.id}` : '/signup';
  return (
    <a class="card" href={href} data-playing={String(!paused)}>
      <div class="render">{hasGl ? <canvas ref={ref} aria-hidden="true" /> : <SceneSvg scene={{ objects: shapes }} />}</div>
      <div class="label">{props.name}</div>
    </a>
  );
}

export function Landing(props: { ctx: AppCtx }): VNode {
  const [starterPaused, setStarterPaused] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => { if (reduced) setStarterPaused(true); }, [reduced]);
  const signedIn = props.ctx.account !== null;
  return (
    <main>
      <section class="hero" style="padding-top:100px">
        <svg class="grid-bg" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
          <g stroke="white" stroke-width="1" fill="none" opacity="0.35">
            {Array.from({ length: 14 }, (_, i) => <line x1={500 + (i - 7) * 30} y1="400" x2={500 + (i - 7) * 180} y2="0" />)}
            {Array.from({ length: 8 }, (_, i) => <line x1={-100 + i * 300} y1="400" x2={500 + (i - 4) * 60} y2="0" />)}
            {Array.from({ length: 10 }, (_, i) => <line x1="0" y1={40 + i * 40} x2="1000" y2={40 + i * 40} />)}
          </g>
        </svg>
        <div class="wrap">
          <div>
            <p class="eyebrow">Hollowbrook Maker Co.</p>
            <h1>Make a thing you can hold by Friday.</h1>
            <p class="sub">One browser studio for 3D design, beginner electronics and block coding — built for one-person after-school STEM businesses.</p>
          </div>
          <HeroScene />
        </div>
      </section>

      <PosterCard />

      <div class="intro" id="classrooms-info">
        <h2>Three editors, one class code, no passwords.</h2>
        <p>Children join with the code you read out and a nickname. You watch every build live from your roster.</p>
        <div class="actions">
          <a class="pill" href={signedIn ? '/dashboard' : '/signup?type=educator'}>Start a classroom</a>
          <a class="pill outline" href="/join">Join a class</a>
        </div>
      </div>

      <section>
        <div class="wrap">
          <div class="editors-row" id="editors">
            {EDITORS.map((e) => (
              <div class="editor-card" key={e.name}>
                <span class="chip" style={`background:${e.color}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconPath(e.icon) }} />
                </span>
                <h3>{e.name}</h3>
                <p>{e.desc}</p>
                <a class="pill" style={`background:${e.color}`} href={`/editor/new?kind=${e.kind}`}>{e.explore}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section class="band">
        <div class="wrap">
          <div class="stats" role="region" aria-label="Classroom stats">
            <div class="stat"><span class="num">12–20</span><span class="label">makers per class</span></div>
            <div class="stat"><span class="num">10</span><span class="label">week terms</span></div>
            <div class="stat"><span class="num">0</span><span class="label">password resets</span></div>
            <div class="stat"><span class="num">1</span><span class="label">instructor, every room</span></div>
          </div>
        </div>
      </section>

      <section>
        <div class="wrap">
          {FEATURES.map((f, i) => (
            <div class={`feature-row ${i % 2 === 1 ? 'alt' : ''}`} key={f.title}>
              <div class="text">
                <p class="eyebrow" style={{ color: f.color }}>{f.eyebrow}</p>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                <a class="pill" style={{ background: f.color }} href={`/editor/new?kind=${f.media === 'part' ? '3d' : f.media === 'led' ? 'circuit' : 'blocks'}`}>Open {f.editor}</a>
              </div>
              <FeatureMedia kind={f.media} />
            </div>
          ))}
        </div>
      </section>

      <section class="band" id="starter">
        <div class="wrap">
          <h2>Starter projects</h2>
          <p style="color:var(--slate)">Open one in the 3D Workshop and make it yours.</p>
          <div class="starter-grid" style="margin-top:24px">
            {STARTERS.map((s) => <StarterCard key={s.id} id={s.id} name={s.name} signedIn={signedIn} />)}
          </div>
          <div style="margin-top:24px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
            <button class="pill ghost" aria-pressed={starterPaused} aria-label="Pause starter previews" onClick={() => setStarterPaused(!starterPaused)}>
              Pause starter previews
            </button>
            <a class="pill outline" href={signedIn ? '/editor/new?kind=3d' : '/signup'}>Start a blank 3D design</a>
          </div>
        </div>
      </section>

      <section class="closing">
        <h2>Set up your first class in an afternoon</h2>
        <p>Create a classroom, read out the code, and start watching builds.</p>
        <a class="pill" href={signedIn ? '/dashboard' : '/signup?type=educator'}>Set up your first class</a>
      </section>

      <footer class="site" role="contentinfo">
        <div class="wrap">
          <span>© Hollowbrook Maker Co.</span>
          <nav class="links" aria-label="Footer">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Student data</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

function iconPath(name: string): string {
  const paths: Record<string, string> = {
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    blocks: '<rect width="7" height="7" x="14" y="3" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1"/>',
  };
  return paths[name] ?? '';
}
