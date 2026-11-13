import { svg } from './dom.js';

const DEVICE_PATHS: Record<string, string[]> = {
  wick: ['M7 4h10v4H7z', 'M10 8h4v14h-4z', 'M9 22h6v2H9z'],
  chime: ['M4 3h16v2H4z', 'M6 5c0 5 -2 5 -2 8h6c0-3 -2-3 -2-8z', 'M16 5c0 5 -2 5 -2 8h6c0-3 -2-3 -2-8z'],
  siphon: ['M2 9h5v8H2z', 'M9.5 9h5v8h-5z', 'M17 9h5v8h-5z', 'M1 6h22v2H1z'],
  wall: ['M2 18l5-10l5 10l5-10l5 10', 'M2 20h20v2H2z'],
  prism: ['M12 2l9 18H3z', 'M12 2v18', 'M7 14h10'],
  gong: ['M12 3a7 7 0 1 0 0.01 0z', 'M12 10v12', 'M5 22l7-6l7 6'],
};

const CREATURE_PATHS: Record<string, string[]> = {
  mote: ['M12 2c4 6 7 9 7 13a7 7 0 0 1 -14 0c0-4 3-7 7-13z', 'M9 10l-2 3l3 1'],
  shell: ['M2 18a10 8 0 0 1 20 0z', 'M4 14h16', 'M6 10h12', 'M9 6h6'],
  skipper: ['M4 12a8 8 0 0 1 16 0a8 8 0 0 0 -16 0z', 'M12 4v16', 'M2 8l4 4l-4 4'],
  mass: ['M4 4h16v16H4z', 'M4 4l16 16', 'M20 4l-16 16'],
};

function shape(paths: string[], className: string, label: string): SVGElement {
  const root = svg('svg', {
    viewBox: '0 0 24 24',
    class: `silhouette ${className}`,
    role: 'img',
    'aria-label': label,
  });
  for (const path of paths) {
    root.append(svg('path', { d: path, 'stroke-width': '1.6', 'vector-effect': 'non-scaling-stroke' }));
  }
  return root;
}

const EMITTERS = new Set(['wick', 'chime', 'prism', 'gong']);

export function deviceSilhouette(id: string, label: string): SVGElement {
  return shape(DEVICE_PATHS[id], EMITTERS.has(id) ? 'emitter' : 'support', label);
}

export function creatureSilhouette(id: string, label: string): SVGElement {
  return shape(CREATURE_PATHS[id], 'storm', label);
}

/** Restrained procedural pier weathering drawn behind the harbour chart. */
export function pierTexture(lanes: number, cells: number): SVGElement {
  const root = svg('svg', {
    class: 'pier-texture',
    viewBox: `0 0 ${cells * 10} ${lanes * 10}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  let seed = 20240517;
  const draw = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let lane = 0; lane < lanes; lane += 1) {
    for (let cell = 0; cell < cells; cell += 1) {
      for (let dot = 0; dot < 5; dot += 1) {
        root.append(
          svg('circle', {
            cx: (cell + draw()) * 10,
            cy: (lane + draw()) * 10,
            r: 0.22,
            class: 'stipple',
          }),
        );
      }
    }
  }
  for (let cell = 0; cell <= cells; cell += 1) {
    root.append(
      svg('line', { x1: cell * 10, y1: 0, x2: cell * 10, y2: lanes * 10, class: 'rule' }),
    );
  }
  for (let lane = 0; lane <= lanes; lane += 1) {
    root.append(
      svg('line', { x1: 0, y1: lane * 10, x2: cells * 10, y2: lane * 10, class: 'rule' }),
    );
  }
  return root;
}

export type ContactKind = 'damage' | 'death' | 'breach';

/** Distinguishable contact marks: damage diamond, death cross, breach square. */
export function contactMark(kind: ContactKind, number: number, branch: 'proposed' | 'none'): SVGElement {
  const group = svg('svg', {
    viewBox: '0 0 20 20',
    class: `contact contact-${kind} branch-${branch}`,
    'aria-hidden': 'true',
  });
  if (kind === 'damage') group.append(svg('path', { d: 'M10 1l9 9l-9 9l-9-9z' }));
  if (kind === 'death') group.append(svg('path', { d: 'M3 3l14 14M17 3l-14 14' }));
  if (kind === 'breach') group.append(svg('path', { d: 'M3 3h14v14H3z' }));
  const label = svg('text', { x: 10, y: 13.5, 'text-anchor': 'middle', class: 'contact-number' });
  label.textContent = String(number);
  group.append(label);
  return group;
}
