import { deriveOptics, readoutLine, TRAINS } from '../../shared/optics.js';
import { packetPageContent, type RowPage } from '../../shared/packet-page.js';
import { skyToPixel } from '../../shared/projection.js';
import type { SkyPoint, TrainId } from '../../shared/types.js';
import { el, prefersReducedMotion } from '../dom.js';
import { footer } from '../chrome.js';
import { navigate, onLeaveScreen } from '../router.js';
import { appState } from '../state.js';

type HeroObject = 'M13' | 'Albireo' | 'M51';

const SEQUENCE: HeroObject[] = ['M13', 'Albireo', 'M51'];
const HOLD_MS = 6000;
const FADE_MS = 1000;

interface Dot {
  x: number;
  y: number;
  r: number;
  colour: string;
}

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

function dotsFor(object: HeroObject): Dot[] {
  const random = seeded(object.length * 7919 + object.charCodeAt(0));
  const dots: Dot[] = [];
  if (object === 'M13') {
    for (let index = 0; index < 220; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = random() ** 2.2;
      dots.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        r: 0.004 + random() * 0.006,
        colour: '#ffffff',
      });
    }
    return dots;
  }
  if (object === 'Albireo') {
    dots.push({ x: -0.16, y: -0.1, r: 0.05, colour: '#ffd79a' });
    dots.push({ x: 0.2, y: 0.13, r: 0.035, colour: '#a8c8ff' });
    for (let index = 0; index < 40; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 0.3 + random() * 0.65;
      dots.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        r: 0.003 + random() * 0.004,
        colour: '#ffffff',
      });
    }
    return dots;
  }
  for (let index = 0; index < 170; index += 1) {
    const turn = random();
    const angle = turn * Math.PI * 3.1;
    const radius = 0.08 + turn * 0.56;
    const spread = (random() - 0.5) * 0.1;
    dots.push({
      x: Math.cos(angle) * radius + spread,
      y: Math.sin(angle) * radius * 0.78 + spread,
      r: 0.004 + random() * 0.005,
      colour: '#ffffff',
    });
  }
  for (let index = 0; index < 30; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 0.62 + random() * 0.3;
    dots.push({
      x: Math.cos(angle) * radius * 0.6 + 0.3,
      y: Math.sin(angle) * radius * 0.6 - 0.34,
      r: 0.004 + random() * 0.004,
      colour: '#ffffff',
    });
  }
  return dots;
}

function drawHero(canvas: HTMLCanvasElement, from: HeroObject, to: HeroObject, mix: number): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  const size = Math.min(box.width, box.height) || 320;
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size, size);
  const radius = size / 2 - 6;
  const centre = size / 2;

  context.save();
  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.clip();

  const paint = (object: HeroObject, alpha: number): void => {
    if (alpha <= 0) return;
    context.globalAlpha = alpha;
    const glow = context.createRadialGradient(centre, centre, 0, centre, centre, radius);
    glow.addColorStop(0, 'rgba(255,255,255,0.14)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
    for (const dot of dotsFor(object)) {
      context.beginPath();
      context.fillStyle = dot.colour;
      context.arc(centre + dot.x * radius, centre + dot.y * radius, dot.r * radius, 0, Math.PI * 2);
      context.fill();
    }
  };
  paint(from, 1 - mix);
  paint(to, mix);
  context.globalAlpha = 1;
  context.restore();

  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.strokeStyle = 'rgba(255,255,255,0.3)';
  context.lineWidth = 1;
  context.stroke();
}

function compassDemonstration(trainId: TrainId, label: string): HTMLElement {
  const size = 110;
  const marks: HTMLElement[] = [];
  const places: Array<[SkyPoint, string]> = [
    [[0, 12], 'N'],
    [[12, 0], 'E'],
  ];
  for (const [point, text] of places) {
    const pixel = skyToPixel(point, trainId, 30, size / 2 - 14);
    marks.push(
      el('span', {
        class: 'demo-compass-mark',
        text,
        attrs: { style: `left:${size / 2 + pixel.x}px;top:${size / 2 + pixel.y}px` },
      }),
    );
  }
  return el('div', { class: 'demo-compass' }, [
    el('div', { class: 'demo-compass-circle' }, marks),
    el('p', { class: 'demo-caption', text: label }),
  ]);
}

function demonstrationPacketPage(): HTMLElement {
  const page: RowPage = {
    kind: 'row',
    designation: 'M13',
    object_name: 'Great Globular Cluster in Hercules',
    ut_date: '2026-07-18',
    ut_time: '03:20',
    local_time: '21:20',
    local_offset: '-06:00',
    time_zone: 'America/Denver',
    site_name: 'A dark site',
    seeing: 8,
    transparency_nelm: 6.5,
    telescope_name: '10-inch Dobsonian',
    aperture_mm: 254,
    eyepiece_name: '10 mm wide',
    barlow_name: null,
    magnification: 120,
    true_field_arcmin: 34,
    exit_pupil_mm: 2.1,
    orientation_sentence: 'North down, east right.',
    train: 'straight',
    edition: 1,
    is_globular: true,
    concentration_class: 'V',
    is_double_star: false,
    pair: null,
    description:
      'Steadier night than last year. Core fully resolved at 120x with chains of stars spilling to the northwest.',
    sketch: {
      format: 'lowlamp-strokes/1',
      strokes: [{ width: 'medium', points: [[-6, 4], [-2, 1], [3, -3], [7, -2]] }],
      stars: [
        { at: [0, 10], brightness: 5 },
        { at: [-6, -4], brightness: 3 },
        { at: [7, 2], brightness: 2 },
      ],
    },
  };
  const paper = el('div', { class: 'lowlamp-page', html: packetPageContent(page) });
  return el('div', { class: 'demo-paper' }, [el('div', { class: 'demo-paper-scale' }, [paper])]);
}

function demonstrations(): HTMLElement {
  const telescope = { id: 't', name: '10-inch Dobsonian', aperture_mm: 254, focal_length_mm: 1200 };
  const eyepiece = { id: 'e', name: '10 mm wide', focal_length_mm: 10, apparent_field_deg: 67 };
  const derived = deriveOptics({ telescope, eyepiece, barlow: null, train: 'straight' });
  return el('section', { class: 'demonstrations' }, [
    el('div', { class: 'column' }, [
      el('div', { class: 'demo-block' }, [
        el('p', { class: 'demo-title', text: '10-inch Dobsonian with a 10 mm wide eyepiece' }),
        el('p', { class: 'demo-readout', text: readoutLine(derived) }),
      ]),
      el('div', { class: 'demo-block' }, [
        el('p', { class: 'demo-title', text: 'North and east, before and after a mirror diagonal' }),
        el('div', { class: 'demo-compasses' }, [
          compassDemonstration('straight', TRAINS[0]?.sentence ?? ''),
          compassDemonstration('mirror_diagonal', TRAINS[1]?.sentence ?? ''),
        ]),
      ]),
      el('div', { class: 'demo-block' }, [
        el('p', { class: 'demo-title', text: 'One packet page, in graphite on white' }),
        demonstrationPacketPage(),
      ]),
    ]),
  ]);
}

export async function renderLanding(): Promise<HTMLElement> {
  const canvas = el('canvas', {
    class: 'hero-canvas',
    attrs: { role: 'img', 'aria-label': 'Eyepiece view of M13' },
  });
  const plinth = el('div', { class: 'plinth' }, [canvas]);
  const startHref = appState().account ? '/tonight' : '/signup';
  const start = el('a', {
    class: 'button accent start-log',
    text: 'Start a log',
    attrs: { href: startHref },
    on: {
      click: (event) => {
        event.preventDefault();
        navigate(startHref);
      },
    },
  });

  const hero = el('section', { class: 'hero' }, [
    el('p', { class: 'wordmark', text: 'Lowlamp' }),
    el('p', { class: 'tagline', text: 'A field log for people who still draw what they see.' }),
    el('div', { class: 'column' }, [plinth, start]),
  ]);

  const root = el('div', { class: 'page landing' }, [hero, demonstrations(), footer()]);

  let index = 0;
  let timer: number | null = null;
  let frame: number | null = null;
  const reduced = prefersReducedMotion();

  const paintStill = (): void => {
    const object = SEQUENCE[index] as HeroObject;
    canvas.setAttribute('aria-label', `Eyepiece view of ${object}`);
    drawHero(canvas, object, object, 0);
  };

  const crossfade = (): void => {
    const from = SEQUENCE[index] as HeroObject;
    const next = (index + 1) % SEQUENCE.length;
    const to = SEQUENCE[next] as HeroObject;
    const startedAt = performance.now();
    const step = (): void => {
      const mix = Math.min(1, (performance.now() - startedAt) / FADE_MS);
      drawHero(canvas, from, to, mix);
      if (mix >= 1) {
        index = next;
        canvas.setAttribute('aria-label', `Eyepiece view of ${to}`);
        frame = null;
        timer = window.setTimeout(crossfade, HOLD_MS - FADE_MS);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  queueMicrotask(() => {
    paintStill();
    if (!reduced) timer = window.setTimeout(crossfade, HOLD_MS - FADE_MS);
  });
  window.addEventListener('resize', paintStill);

  onLeaveScreen(() => {
    if (timer !== null) window.clearTimeout(timer);
    if (frame !== null) cancelAnimationFrame(frame);
    window.removeEventListener('resize', paintStill);
  });

  return root;
}
