import { el } from './dom';
import { appState, link, panel, workspaceFooter, workspaceHeader } from './shell';
import { StageView } from './stage-view';
import { demoDocument, numeralDocument, tileDocument } from './demo-scene';
import { LightField, MotionClock, TiltField, prefersReducedMotion } from './follow-light';
import type { Pointer } from './follow-light';
import { num3, timeReadout } from '../shared/format';
import { config } from './client-config';

const EMBED_NAMES = [
  'Northwind Kiln hero',
  'Pell & Sorrel launch',
  'Quiet Orbit pricing',
  'Ferrous Lab intro',
  'Tallow Street drop',
  'Marrow FM teaser',
];

const LAYER_KIND_TILES: { title: string; blurb: string }[] = [
  { title: 'Primitives', blurb: 'Cube, sphere, cylinder, torus and plane with exact triangle counts.' },
  { title: 'Extruded type', blurb: 'The built-in Halation Block outline font, extruded and bevelled.' },
  { title: 'Models', blurb: 'Upload a small glTF or place a generated preset model.' },
  { title: 'Particles', blurb: 'Seeded emitters and formations that settle on a wordmark.' },
  { title: 'Cloth', blurb: 'Fixed-step cloth with pinned edges, wind and stiffness.' },
  { title: 'Effects', blurb: 'Blur, grain, bloom, glow, aberration, displacement and pixelate.' },
];

function miniStage(document_: ReturnType<typeof tileDocument>): HTMLElement {
  const view = new StageView();
  view.setArtboard(1440, 810);
  const light = new LightField();
  light.level = 1;
  view.draw(
    {
      document: document_,
      sceneId: document_.scenes[0].id,
      frame: 42,
      breakpoint: 'desktop',
      scroll: 0,
      reducedMotion: false,
      assets: {},
      particleMax: config().particleMax,
      imageUrl: () => '',
    },
    { level: 1, focus: light.focus },
  );
  view.element.style.position = 'relative';
  return view.element;
}

function followLightStage(): HTMLElement {
  const view = new StageView();
  const reduced = prefersReducedMotion();
  const region = el('section', {
    role: 'region',
    'aria-label': 'Follow Light stage',
    class: 'hero-stage',
    'data-light-level': '0',
    'data-light-focus': '0.800, 0.900',
    'data-renderer': view.renderer,
  });

  const firstLine = el('span', { class: 'headline-line', text: 'Scenes that hold' });
  const secondLine = el('span', { class: 'headline-line' }, [
    el('span', { text: 'their ' }),
    el('span', { class: 'serif-accent', text: 'shape' }),
  ]);
  const headline = el('h1', { class: 'headline' }, [firstLine, secondLine]);
  headline.setAttribute('aria-label', 'Scenes that hold their shape');

  const pill = link(
    'New Republish any version as the next one',
    '/#release-notes',
    'pill',
  );
  pill.textContent = '';
  pill.append(
    el('span', { class: 'pill-dot', 'aria-hidden': 'true' }),
    el('strong', { text: 'New' }),
    el('span', { class: 'caption', text: 'Republish any version as the next one' }),
  );
  pill.setAttribute('aria-label', 'New Republish any version as the next one');

  const openEditor = link('Open editor', appState.me ? '/projects' : '/signin', 'button open-editor');

  const content = el('div', { class: 'hero-content' }, [
    pill,
    headline,
    el('p', {
      class: 'hero-sub',
      text:
        'Build a layered hero from primitives, extruded type, models, particles and cloth, then publish it as a numbered version your site switches to in place.',
    }),
    openEditor,
  ]);

  if (!reduced) {
    pill.style.animationDelay = '0ms';
    firstLine.style.animationDelay = '60ms';
    secondLine.style.animationDelay = '120ms';
    (content.children[2] as HTMLElement).style.animationDelay = '180ms';
    openEditor.style.animationDelay = '420ms';
  }

  region.append(view.element, content);
  view.element.style.position = 'absolute';
  view.element.style.inset = '0';

  const document_ = demoDocument(window.innerWidth < 640);
  const scene = document_.scenes[0];
  const pointer: Pointer = { x: 0.8, y: 0.9, inside: false };
  const light = new LightField();
  const clock = new MotionClock();
  const tilts = new Map<string, TiltField>();
  for (const layer of scene.layers) tilts.set(layer.id, new TiltField());
  let keyboardPointer: { x: number; y: number } | null = null;

  const setPointerFromEvent = (clientX: number, clientY: number): void => {
    const rect = region.getBoundingClientRect();
    pointer.x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    pointer.y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    pointer.inside = true;
  };

  region.addEventListener('pointermove', (event) => setPointerFromEvent(event.clientX, event.clientY));
  region.addEventListener('pointerleave', () => {
    pointer.inside = false;
    keyboardPointer = null;
  });
  region.addEventListener('touchmove', (event) => {
    const touch = event.touches[0];
    if (touch) setPointerFromEvent(touch.clientX, touch.clientY);
  });

  const render = (now: number): void => {
    if (!region.isConnected) return;
    const frames = clock.step(now);
    light.advanceLevel(now, reduced);
    light.advanceFocus(now, frames, pointer, scene.light.momentum, reduced);
    const current = keyboardPointer ? { ...keyboardPointer, inside: true } : pointer;
    let tilt = { x: 0, y: 0 };
    for (const layer of scene.layers) {
      const field = tilts.get(layer.id);
      if (!field || !layer.events.tilt.enabled) continue;
      field.advance(now, frames, current, layer.events.tilt, reduced);
      tilt = field.current;
    }
    region.setAttribute('data-light-level', num3(light.level));
    region.setAttribute('data-light-focus', `${num3(light.focus.x)}, ${num3(light.focus.y)}`);
    const rect = region.getBoundingClientRect();
    const size = {
      width: Math.max(320, Math.round(rect.width)),
      height: Math.max(240, Math.round(rect.height)),
    };
    view.setArtboard(size.width, size.height);
    view.draw(
      {
        document: document_,
        sceneId: scene.id,
        frame: 0,
        breakpoint: 'desktop',
        scroll: 0,
        reducedMotion: reduced,
        assets: {},
        particleMax: config().particleMax,
        tilt,
        imageUrl: () => '',
        viewport: size,
      },
      { level: light.level, focus: light.focus },
    );
    window.requestAnimationFrame(render);
  };
  window.requestAnimationFrame(render);
  return region;
}

function marquee(): HTMLElement {
  const items = [...EMBED_NAMES, ...EMBED_NAMES].map((name) =>
    el('span', { class: 'marquee-item', text: name }),
  );
  return el('section', { role: 'region', 'aria-label': 'Published embeds', class: 'panel', id: 'published-embeds' }, [
    el('p', { class: 'caption', text: 'Published from Halation Studio' }),
    el('div', { class: 'marquee' }, [el('div', { class: 'marquee-track' }, items)]),
  ]);
}

function layerKindTiles(): HTMLElement {
  return el('section', { role: 'region', 'aria-label': 'Layer kinds', class: 'panel' }, [
    el('h3', { text: 'Layer kinds' }),
    el(
      'div',
      { class: 'tile-grid' },
      LAYER_KIND_TILES.map((tile) =>
        el('article', { class: 'tile' }, [
          miniStage(tileDocument(tile.title)),
          el('h4', { text: tile.title }),
          el('p', { class: 'caption', text: tile.blurb }),
        ]),
      ),
    ),
  ]);
}

function timelineDemo(): HTMLElement {
  const track = el('div', { class: 'timeline-track' });
  const playhead = el('div', { class: 'playhead-line' });
  track.append(playhead);
  const readout = el('span', { class: 'caption', text: timeReadout(0) });
  for (const [index, property] of ['Rotation Y', 'Opacity', 'Position X'].entries()) {
    const row = el('div', { class: 'keyframe-row' }, [
      el('span', { class: 'caption', text: property }),
    ]);
    for (const frame of [0, 30 + index * 10, 90]) {
      const marker = el('span', { class: 'keyframe-button', 'aria-hidden': 'true' });
      marker.style.left = `${(frame / 120) * 100}%`;
      row.append(marker);
    }
    track.append(row);
  }
  let start = 0;
  const sweep = (now: number): void => {
    if (!track.isConnected) return;
    if (start === 0) start = now;
    const progress = Math.min(1, (now - start) / 2000);
    playhead.style.left = `${progress * 100}%`;
    readout.textContent = timeReadout(Math.round(progress * 120));
    if (progress < 1) window.requestAnimationFrame(sweep);
  };
  window.requestAnimationFrame(sweep);
  return panel('Keyframes on a 60 fps timeline', [
    el('p', { class: 'caption', text: 'Easing presets, spring keyframes and frame-exact readouts.' }),
    track,
    readout,
  ]);
}

function variablesDemo(): HTMLElement {
  const spin = el('span', { class: 'caption', text: 'spin (0.000, 45.000, 0.000)' });
  const boost = el('span', { class: 'caption', text: 'boost 150.000' });
  const apply = (name: string, values: string[]): HTMLButtonElement => {
    const node = el('button', { type: 'button', class: 'button', text: `Apply ${name}` });
    node.addEventListener('click', () => {
      spin.textContent = values[0];
      boost.textContent = values[1];
    });
    return node;
  };
  return panel('Variables and presets', [
    el('p', { class: 'caption', text: 'Typed variables bind to compatible properties and clamp to their range.' }),
    el('div', { class: 'form-grid' }, [spin, boost]),
    el('div', { class: 'card-actions' }, [
      apply('Calm', ['spin (0.000, 0.000, 0.000)', 'boost 150.000']),
      apply('Lively', ['spin (0.000, 90.000, 15.000)', 'boost 2.000']),
    ]),
  ]);
}

function readoutDemo(): HTMLElement {
  const entries: [string, string, number][] = [
    ['screen-point', '806.85, 231.29 px', 806.85],
    ['triangles', 'Triangles 1536', 1536],
    ['ior', 'IOR 1.250', 1.25],
    ['live-particles', 'Live particles 17', 17],
  ];
  const nodes = entries.map(([key, text]) => el('span', { 'data-readout': key, text }));
  const region = el('section', { role: 'region', 'aria-label': 'Readouts', class: 'panel' }, [
    el('h3', { text: 'Readouts' }),
    el('div', { class: 'readouts' }, nodes),
  ]);
  let start = 0;
  const countUp = (now: number): void => {
    if (!region.isConnected) return;
    if (start === 0) start = now;
    const progress = Math.min(1, (now - start) / 600);
    entries.forEach(([key, text, value], index) => {
      if (key === 'screen-point') {
        nodes[index].textContent = `${(value * progress).toFixed(2)}, ${(231.29 * progress).toFixed(2)} px`;
      } else if (key === 'triangles') {
        nodes[index].textContent = `Triangles ${Math.round(value * progress)}`;
      } else if (key === 'ior') {
        nodes[index].textContent = `IOR ${(1 + 0.25 * progress).toFixed(3)}`;
      } else {
        nodes[index].textContent = `Live particles ${Math.round(value * progress)}`;
      }
      void text;
    });
    if (progress < 1) window.requestAnimationFrame(countUp);
  };
  window.requestAnimationFrame(countUp);
  return region;
}

function versionCard(): HTMLElement {
  const numeral = miniStage(numeralDocument('3'));
  const code = el('div', {
    class: 'code-box',
    text: `<iframe src="${window.location.origin}/embed/your-project-id" title="Halation Studio embed"></iframe>`,
  });
  return el(
    'section',
    {
      role: 'region',
      'aria-label': 'Every publish gets a number',
      class: 'panel',
      id: 'every-publish-gets-a-number',
    },
    [
      el('h3', { text: 'Every publish gets a number' }),
      numeral,
      el('p', { class: 'caption', text: 'Versions are numbered, immutable and gapless. Republish any of them as the next one.' }),
      code,
    ],
  );
}

function thumbnailMosaic(): HTMLElement {
  const tiles = ['Primitives', 'Particles', 'Cloth'];
  return panel('Recent heroes', [
    el(
      'div',
      { class: 'mosaic' },
      tiles.map((name, index) =>
        el('article', { class: `tile ${index === 2 ? 'mosaic-wide' : ''}` }, [
          miniStage(tileDocument(name)),
          el('h4', { text: name }),
        ]),
      ),
    ),
  ]);
}

function releaseNotes(): HTMLElement {
  return panel('Release notes', [
    el('p', {
      class: 'caption',
      text: 'Republish any version as the next one, so rolling back ships forward.',
    }),
  ], { id: 'release-notes' });
}

export function renderLanding(root: HTMLElement): void {
  root.append(
    el('div', { class: 'frame' }, [
      workspaceHeader(),
      followLightStage(),
      marquee(),
      layerKindTiles(),
      timelineDemo(),
      variablesDemo(),
      readoutDemo(),
      versionCard(),
      thumbnailMosaic(),
      releaseNotes(),
      workspaceFooter(),
    ]),
  );
}
