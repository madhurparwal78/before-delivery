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

type ContactKind = 'damage' | 'death' | 'breach';

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
  label.textContent = `${branch === 'proposed' ? 'P' : 'N'}${number}`;
  group.append(label);
  return group;
}

/** Original harbour engraving: the same five piers, lanterns and storm creatures as play. */
export function harbourEngraving(): SVGElement {
  const art = svg('svg', { viewBox: '0 0 720 430', class: 'harbour-engraving', role: 'img', 'aria-label': 'Orrel Sound — five weathered piers, lantern towers and storm creatures' });
  const defs = svg('defs');
  const water = svg('pattern', { id: 'water-rules', width: 72, height: 36, patternUnits: 'userSpaceOnUse' });
  water.append(svg('path', { d: 'M4 17q10-5 20 0t20 0 M46 31q8-4 16 0', fill: 'none', stroke: 'currentColor', 'stroke-width': 1 }));
  defs.append(water); art.append(defs);
  art.append(svg('rect', { x: 0, y: 0, width: 720, height: 430, fill: 'url(#water-rules)', opacity: '.35' }));
  art.append(svg('path', { d: 'M24 52H70V378H24Z', class: 'engraving-timber' }));
  for (let lane = 0; lane < 5; lane += 1) {
    const y = 60 + lane * 62;
    art.append(svg('path', { d: `M56 ${y}H647L663 ${y+9}V${y+30}L647 ${y+40}H56Z`, class: 'engraving-timber' }));
    art.append(svg('path', { d: `M76 ${y+9}H640M76 ${y+29}H640`, class: 'engraving-rule' }));
    for (let cell = 0; cell < 9; cell += 1) {
      const x = 74 + cell * 62;
      art.append(svg('path', { d: `M${x} ${y+3}v34m5-26h6m26 18h9`, class: 'engraving-rule' }));
    }
    const numeral = svg('text', { x: 37, y: y+25, class: 'engraving-number', 'text-anchor': 'middle' });
    numeral.textContent=String(lane+1); art.append(numeral);
  }
  for (const [id,x,y] of [['wick',430,168],['chime',244,106],['siphon',121,292],['prism',366,230]] as [string,number,number][]) {
    const device=deviceSilhouette(id,id);device.setAttribute('x',String(x));device.setAttribute('y',String(y));device.setAttribute('width','40');device.setAttribute('height','40');device.classList.add('engraving-device');art.append(device);
  }
  art.append(svg('path', { d:'M450 184L609 174V195Z', class:'engraving-beam' }));
  for (const [id,x,y] of [['mote',583,162],['shell',531,225],['skipper',591,287]] as [string,number,number][]) {
    const creature=creatureSilhouette(id,id);creature.setAttribute('x',String(x));creature.setAttribute('y',String(y));creature.setAttribute('width','34');creature.setAttribute('height','34');creature.classList.add('engraving-creature');art.append(creature);
  }
  art.append(svg('path', { d:'M682 48v34m-9-9 9 9 9-9M682 355v-34m-9 9 9-9 9 9', class:'engraving-compass' }));
  return art;
}
