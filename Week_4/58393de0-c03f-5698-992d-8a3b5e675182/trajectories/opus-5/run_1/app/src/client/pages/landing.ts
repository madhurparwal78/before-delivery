import type { SceneObject } from '../../shared/types.js';
import { el, icon, reducedMotion } from '../dom.js';
import { loopPreview } from '../preview.js';
import { stillSvg } from '../gl/still.js';
import { STARTERS } from '../starters.js';
import { account } from '../runtime.js';
import { colorForIndex } from '../../shared/palette.js';
import { Viewer, type ViewerObject } from '../gl/renderer.js';
import { primitiveWorldMesh, computeGroupResult } from '../geom/scene.js';
import type { Mesh, Vec3 } from '../geom/mesh.js';

const shape = (
  id: string,
  kind: 'box' | 'cylinder' | 'sphere',
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  mode: 'solid' | 'hole' = 'solid',
  color = colorForIndex(0),
): SceneObject => ({ id, kind, mode, x, y, z, w, d, h, rotationZ: 0, color, children: [] });

/** The hero's toy scene: a green wedge, a purple cylinder and an orange box with a hole. */
const heroObjects = (): SceneObject[] => [
  shape('hero-wedge', 'box', -34, 10, 9, 30, 26, 18, 'solid', '#3fa34d'),
  shape('hero-cyl', 'cylinder', 0, -6, 16, 24, 24, 32, 'solid', '#7b3ff2'),
  shape('hero-box', 'box', 34, 8, 12, 28, 28, 24, 'solid', '#f08a24'),
  shape('hero-hole', 'cylinder', 34, 8, 12, 12, 12, 26, 'hole', '#f08a24'),
];

const wedgeMesh = (w: number, d: number, h: number): Mesh => {
  const x = w / 2;
  const y = d / 2;
  const z = h / 2;
  const corners: Vec3[] = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, y, -z],
    [-x, y, -z],
    [-x, -y, z],
    [-x, y, z],
  ];
  const faces: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 4, 5],
    [0, 5, 3],
    [1, 4, 0],
    [1, 2, 5],
    [1, 5, 4],
    [2, 3, 5],
  ];
  return { triangles: faces.map(([a, b, c]) => ({ a: corners[a], b: corners[b], c: corners[c] })) };
};

const positionsOf = (mesh: Mesh): Float32Array => {
  const data = new Float32Array(mesh.triangles.length * 9);
  let at = 0;
  for (const triangle of mesh.triangles) {
    for (const corner of [triangle.a, triangle.b, triangle.c]) {
      data[at] = corner[0];
      data[at + 1] = corner[1];
      data[at + 2] = corner[2];
      at += 3;
    }
  }
  return data;
};

const heroScene = (): HTMLElement => {
  const objects = heroObjects();
  const holder = el('div', { class: 'qy-hero-scene' });
  const canvas = el('canvas', { class: 'qy-hero-canvas', 'aria-hidden': 'true' });
  holder.append(canvas);
  const viewer = new Viewer(canvas);
  if (!viewer.hasWebgl) {
    holder.replaceChildren();
    holder.innerHTML = stillSvg(objects, { width: 420, height: 260, grid: false });
    return holder;
  }
  const wedge = objects[0];
  const moved = wedgeMesh(wedge.w, wedge.d, wedge.h);
  const viewerObjects: ViewerObject[] = [
    {
      id: wedge.id,
      mode: 'solid',
      color: wedge.color,
      positions: positionsOf({
        triangles: moved.triangles.map((triangle) => ({
          a: [triangle.a[0] + wedge.x, triangle.a[1] + wedge.y, triangle.a[2] + wedge.z] as Vec3,
          b: [triangle.b[0] + wedge.x, triangle.b[1] + wedge.y, triangle.b[2] + wedge.z] as Vec3,
          c: [triangle.c[0] + wedge.x, triangle.c[1] + wedge.y, triangle.c[2] + wedge.z] as Vec3,
        })),
      }),
    },
    { id: objects[1].id, mode: 'solid', color: objects[1].color, positions: positionsOf(primitiveWorldMesh(objects[1])) },
    {
      id: objects[2].id,
      mode: 'solid',
      color: objects[2].color,
      positions: positionsOf(computeGroupResult([objects[2], objects[3]]).mesh),
    },
  ];
  viewer.setObjects(viewerObjects);
  viewer.camera = { azimuth: 38, elevation: 28, distance: 230, target: [0, 0, 12] };
  requestAnimationFrame(() => viewer.render());
  window.addEventListener('resize', () => viewer.render());
  return holder;
};

const posterCard = (): HTMLElement => {
  const region = el('section', { class: 'qy-poster', role: 'region', 'aria-label': 'Build preview' });
  const preview = loopPreview({
    pauseLabel: 'Pause build preview',
    loopMs: 8000,
    className: 'qy-poster-preview',
    draw: (stage, progress) => {
      const base = heroObjects();
      const wedgeDrop = Math.min(1, progress / 0.25);
      const cylinderRise = Math.max(0, Math.min(1, (progress - 0.25) / 0.25));
      const boxIn = Math.max(0, Math.min(1, (progress - 0.5) / 0.2));
      const carve = Math.max(0, Math.min(1, (progress - 0.7) / 0.3));
      const frame: SceneObject[] = [];
      frame.push({ ...base[0], z: 9 + (1 - wedgeDrop) * 60 });
      if (cylinderRise > 0) frame.push({ ...base[1], h: 32 * cylinderRise, z: 16 * cylinderRise });
      if (boxIn > 0) frame.push({ ...base[2], w: 28 * boxIn, d: 28 * boxIn, h: 24 * boxIn, z: 12 * boxIn });
      if (carve > 0) frame.push({ ...base[3], w: 12, d: 12, h: 26, z: 12 });
      stage.innerHTML = stillSvg(frame, { width: 420, height: 236 });
    },
  });
  const play = el('button', { type: 'button', class: 'qy-poster-play', 'aria-label': 'Play build preview' }, [
    icon('play'),
  ]);
  play.addEventListener('click', () => preview.setPlaying(true));
  region.append(
    el('div', { class: 'qy-poster-body' }, [preview.element, play]),
    el('div', { class: 'qy-poster-foot' }, [
      el('p', { class: 'qy-eyebrow', text: 'Live build' }),
      el('p', { text: 'A carved block, drawn by the same code your class uses.' }),
      preview.toggle,
    ]),
  );
  return region;
};

const editorIntroRow = (): HTMLElement =>
  el('section', { class: 'qy-intro-row', role: 'region', 'aria-label': 'Editors', id: 'editors' }, [
    el('div', { class: 'qy-intro-grid' }, [
      introCard('3D Workshop', 'Solid and hole shapes, grouping and print-ready exports.', 'Explore 3D Workshop', '#feature-3d', 'box', 'qy-tone-3d'),
      introCard('Circuit Bench', 'Batteries, LEDs, resistors and switches with a live solve.', 'Explore Circuit Bench', '#feature-circuit', 'zap', 'qy-tone-circuit'),
      introCard('Block Lab', 'Block programs that build real 3D objects, step by step.', 'Explore Block Lab', '#feature-blocks', 'blocks', 'qy-tone-blocks'),
    ]),
  ]);

const introCard = (
  heading: string,
  body: string,
  linkLabel: string,
  href: string,
  glyph: string,
  tone: string,
): HTMLElement =>
  el('article', { class: `qy-intro-card ${tone}` }, [
    el('span', { class: 'qy-intro-glyph' }, [icon(glyph)]),
    el('h3', { class: 'qy-intro-heading', text: heading }),
    el('p', { class: 'qy-muted', text: body }),
    el('a', { href, class: 'qy-link', text: linkLabel }),
  ]);

const statsBand = (): HTMLElement =>
  el('section', { class: 'qy-stats', role: 'region', 'aria-label': 'Classroom stats', id: 'for-classrooms' }, [
    el('div', { class: 'qy-stats-grid' }, [
      stat('18', 'children in one room, one roster'),
      stat('0', 'passwords for children to forget'),
      stat('10', 'weeks of work kept on the server'),
      stat('3', 'editors, one join code'),
    ]),
  ]);

const stat = (figure: string, caption: string): HTMLElement =>
  el('div', { class: 'qy-stat' }, [
    el('p', { class: 'qy-stat-figure', text: figure }),
    el('p', { class: 'qy-stat-caption', text: caption }),
  ]);

const featureRow = (options: {
  id: string;
  eyebrow: string;
  heading: string;
  body: string;
  linkLabel: string;
  href: string;
  tone: string;
  pauseLabel: string;
  draw: (stage: HTMLElement, progress: number) => void;
  flip: boolean;
}): HTMLElement => {
  const preview = loopPreview({
    pauseLabel: options.pauseLabel,
    loopMs: 6000,
    className: 'qy-feature-preview',
    draw: options.draw,
  });
  const text = el('div', { class: 'qy-feature-text' }, [
    el('p', { class: `qy-eyebrow ${options.tone}`, text: options.eyebrow }),
    el('h2', { class: `qy-section-heading ${options.tone}`, text: options.heading }),
    el('p', { class: 'qy-muted', text: options.body }),
    el('a', { href: options.href, class: `qy-pill qy-pill-solid ${options.tone}-pill`, text: options.linkLabel }),
  ]);
  const media = el('div', { class: 'qy-feature-media' }, [preview.element, preview.toggle]);
  return el('section', { class: `qy-feature-row ${options.flip ? 'qy-feature-flip' : ''}`, id: options.id }, [
    text,
    media,
  ]);
};

const starterGrid = (): HTMLElement => {
  const signedIn = account() !== null;
  const preview = loopPreview({
    pauseLabel: 'Pause starter previews',
    loopMs: 24000,
    className: 'qy-starter-previews',
    draw: (stage, progress) => {
      stage.replaceChildren();
      for (const starter of STARTERS) {
        const card = document.getElementById(`starter-art-${starter.id}`);
        if (card) card.innerHTML = stillSvg(starter.objects(), { width: 220, height: 150, azimuth: progress * 360 });
      }
    },
  });
  const grid = el('div', { class: 'qy-starter-grid' });
  for (const starter of STARTERS) {
    const href = signedIn ? `/editor/new?kind=3d&starter=${starter.id}` : '/signup';
    grid.append(
      el('article', { class: 'qy-card qy-starter-card' }, [
        el('div', {
          class: 'qy-card-art',
          id: `starter-art-${starter.id}`,
          html: stillSvg(starter.objects(), { width: 220, height: 150 }),
        }),
        el('a', { href, class: 'qy-card-label qy-link', text: starter.name }),
      ]),
    );
  }
  return el(
    'section',
    { class: 'qy-starters', role: 'region', 'aria-label': 'Starter projects', id: 'starter-projects' },
    [
      el('div', { class: 'qy-starters-head' }, [
        el('h2', { class: 'qy-section-heading', text: 'Starter projects' }),
        preview.toggle,
      ]),
      grid,
      preview.element,
      el('a', {
        href: signedIn ? '/editor/new?kind=3d' : '/signup',
        class: 'qy-pill qy-pill-outline',
        text: 'Start a blank 3D design',
      }),
    ],
  );
};

const footer = (): HTMLElement =>
  el('footer', { class: 'qy-footer', role: 'contentinfo' }, [
    el('div', { class: 'qy-footer-inner' }, [
      el('p', { class: 'qy-footer-mark', text: 'Quarkyard · Hollowbrook Maker Co.' }),
      el('nav', { class: 'qy-footer-links', 'aria-label': 'Footer' }, [
        el('a', { href: '#privacy', class: 'qy-link', text: 'Privacy' }),
        el('a', { href: '#terms', class: 'qy-link', text: 'Terms' }),
        el('a', { href: '#student-data', class: 'qy-link', text: 'Student data' }),
      ]),
      el('div', { class: 'qy-footer-notes' }, [
        el('section', { id: 'privacy' }, [
          el('h3', { text: 'Privacy' }),
          el('p', { class: 'qy-muted', text: 'Children join with a class code and a nickname. No child email, ever.' }),
        ]),
        el('section', { id: 'terms' }, [
          el('h3', { text: 'Terms' }),
          el('p', { class: 'qy-muted', text: 'One instructor account runs every classroom in your programme.' }),
        ]),
        el('section', { id: 'student-data' }, [
          el('h3', { text: 'Student data' }),
          el('p', {
            class: 'qy-muted',
            text: 'Snapshots and exports stay on your Quarkyard server and are removed with the roster entry.',
          }),
        ]),
      ]),
    ]),
  ]);

export const landingPage = (main: HTMLElement): void => {
  const hero = el('section', { class: 'qy-hero' }, [
    el('div', { class: 'qy-hero-grid', 'aria-hidden': 'true' }),
    el('div', { class: 'qy-hero-inner' }, [
      el('p', { class: 'qy-hero-eyebrow', text: 'After-school maker studio' }),
      el('h1', { class: 'qy-hero-headline', text: 'Make a thing you can hold by Friday.' }),
      el('p', {
        class: 'qy-hero-sub',
        text: 'Quarkyard runs your 3D design, electronics and block-coding classes from one instructor account.',
      }),
      heroScene(),
    ]),
  ]);

  const intro = el('section', { class: 'qy-column qy-intro' }, [
    el('p', {
      class: 'qy-intro-copy',
      text: 'Children join in seconds with a class code and a nickname. You watch every design come together live, and term ends with files that actually print.',
    }),
    el('div', { class: 'qy-pill-row' }, [
      el('a', { href: '/signup?type=educator', class: 'qy-pill qy-pill-solid', text: 'Start a classroom' }),
      el('a', { href: '/join', class: 'qy-pill qy-pill-outline', text: 'Join a class' }),
    ]),
  ]);

  const featureRows = el('div', { class: 'qy-column qy-features' }, [
    featureRow({
      id: 'feature-3d',
      eyebrow: '3D Workshop',
      heading: 'Carve a hole, group it, print it.',
      body: 'Solid and hole shapes, keyboard nudges in millimetres, workplanes on any face and exports checked before they are saved.',
      linkLabel: 'Open 3D Workshop',
      href: '/editor/new?kind=3d',
      tone: 'qy-tone-3d',
      pauseLabel: 'Pause 3D Workshop preview',
      flip: false,
      draw: (stage, progress) => {
        const turn = progress * 360;
        stage.innerHTML = `${stillSvg(
          [
            shape('p3d-1', 'box', 0, 0, 10, 40, 40, 20, 'solid', '#f08a24'),
            shape('p3d-2', 'cylinder', 0, 0, 10, 16, 16, 22, 'hole', '#f08a24'),
          ],
          { width: 320, height: 200, azimuth: turn },
        )}<svg class="qy-preview-overlay" viewBox="0 0 320 200" aria-hidden="true"><rect x="70" y="40" width="180" height="120" fill="none" stroke="#1552f0" stroke-width="2" stroke-dasharray="6 6" /><rect x="64" y="34" width="12" height="12" fill="#1552f0" /><rect x="244" y="34" width="12" height="12" fill="#1552f0" /><rect x="64" y="154" width="12" height="12" fill="#1552f0" /><rect x="244" y="154" width="12" height="12" fill="#1552f0" /></svg>`;
      },
    }),
    featureRow({
      id: 'feature-circuit',
      eyebrow: 'Circuit Bench',
      heading: 'The LED lights, or it burns out.',
      body: 'Wire a battery, LED, resistor and switch, then watch the solved current change as you type a new resistance.',
      linkLabel: 'Open Circuit Bench',
      href: '/editor/new?kind=circuit',
      tone: 'qy-tone-circuit',
      pauseLabel: 'Pause Circuit Bench preview',
      flip: true,
      draw: (stage, progress) => {
        const brightness = 0.15 + 0.85 * Math.abs(Math.sin(progress * Math.PI));
        stage.innerHTML = `<svg viewBox="0 0 320 200" width="320" height="200" aria-hidden="true">
          <rect x="0" y="0" width="320" height="200" fill="#eef4ff" />
          <rect x="30" y="80" width="54" height="34" rx="6" fill="#ffffff" stroke="#2742a6" stroke-width="2" />
          <text x="57" y="102" font-size="12" text-anchor="middle" fill="#14181f">9V</text>
          <rect x="130" y="82" width="52" height="28" rx="4" fill="#ffffff" stroke="#2742a6" stroke-width="2" />
          <text x="156" y="101" font-size="11" text-anchor="middle" fill="#14181f">330 Ω</text>
          <circle cx="248" cy="96" r="20" fill="#f08a24" fill-opacity="${brightness.toFixed(2)}" stroke="#2742a6" stroke-width="2" />
          <path d="M84 97h46M182 96h46M248 116v34H57v-36" fill="none" stroke="#2742a6" stroke-width="2" />
        </svg>`;
      },
    }),
    featureRow({
      id: 'feature-blocks',
      eyebrow: 'Block Lab',
      heading: 'Three blocks, a tower of spheres.',
      body: 'Insert blocks by keyboard or pointer, press Play, and watch each step add a real object to the viewer.',
      linkLabel: 'Open Block Lab',
      href: '/editor/new?kind=blocks',
      tone: 'qy-tone-blocks',
      pauseLabel: 'Pause Block Lab preview',
      flip: false,
      draw: (stage, progress) => {
        const stacked = Math.floor(progress * 4) % 4;
        const chips = Array.from({ length: stacked + 1 }, (_unused, index) => {
          const y = 150 - index * 30;
          return `<rect x="40" y="${y}" width="120" height="24" rx="12" fill="#7b3ff2" fill-opacity="${1 - index * 0.15}" />`;
        }).join('');
        stage.innerHTML = `<svg viewBox="0 0 320 200" width="320" height="200" aria-hidden="true">
          <rect x="0" y="0" width="320" height="200" fill="#f4efff" />
          ${chips}
          ${Array.from({ length: stacked + 1 }, (_unused, index) => `<circle cx="240" cy="${160 - index * 26}" r="13" fill="#7b3ff2" />`).join('')}
        </svg>`;
      },
    }),
  ]);

  const closing = el('section', { class: 'qy-closing' }, [
    el('div', { class: 'qy-closing-inner' }, [
      el('h2', { class: 'qy-closing-heading', text: 'Your first class can run this week.' }),
      el('p', {
        class: 'qy-closing-copy',
        text: 'Make a classroom, read the join code to the room, and watch eighteen designs appear on one page.',
      }),
      el('a', { href: '/signup?type=educator', class: 'qy-pill qy-pill-light', text: 'Set up your first class' }),
    ]),
  ]);

  main.append(
    hero,
    el('div', { class: 'qy-poster-holder' }, [posterCard()]),
    intro,
    el('div', { class: 'qy-column' }, [editorIntroRow()]),
    statsBand(),
    featureRows,
    el('div', { class: 'qy-column' }, [starterGrid()]),
    closing,
    footer(),
  );

  if (reducedMotion()) main.dataset.reducedMotion = 'true';
};
