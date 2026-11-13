import { svg } from './dom.js';
import {
  COIN_RADIUS,
  CUSHION,
  POCKET_CENTRES,
  POCKET_RADIUS,
  STRIKER_RADIUS,
  BASELINE_Y,
  BASELINE_MAX_OFFSET,
} from '../shared/geometry.js';
import type { PieceId } from '../shared/types.js';

/**
 * The board is drawn by the app: lacquered ply, a darker wooden frame, four net pockets,
 * baselines, the centre circle and diagonal arrows. The rendered side is 740 mm, so screen
 * pixels convert straight to board millimetres.
 */
const FRAME_BAND = 16;
export const VIEW = CUSHION * 2;

interface BoardTheme {
  ply: string;
  grain: string;
  frame: string;
  line: string;
  pocket: string;
}

const BOARD_THEMES: Record<string, BoardTheme> = {
  'board-ply': { ply: '#e8c88c', grain: '#d7b474', frame: '#8a5a2b', line: '#2a1c0d', pocket: '#241a12' },
  'board-chalk': { ply: '#efe6d6', grain: '#e2d6c0', frame: '#4a4a4a', line: '#1d1d1d', pocket: '#161616' },
  'board-walnut': { ply: '#6b4a2c', grain: '#5b3d23', frame: '#2c1c10', line: '#e8d8bd', pocket: '#100a06' },
};

interface CoinTheme {
  white: string;
  black: string;
  queen: string;
  edge: string;
}

const COIN_THEMES: Record<string, CoinTheme> = {
  'coins-ivory': { white: '#fbf4e4', black: '#1a1a1a', queen: '#d8312a', edge: '#2a2016' },
  'coins-shell': { white: '#f2f5f7', black: '#3c4850', queen: '#c2372f', edge: '#1f2a30' },
};

interface StrikerTheme {
  body: string;
  ring: string;
  inlay: string;
}

const STRIKER_THEMES: Record<string, StrikerTheme> = {
  'striker-ply': { body: '#f6efe2', ring: '#8a5a2b', inlay: '#c9a977' },
  'striker-tomato': { body: '#f04a26', ring: '#7d1f0c', inlay: '#ffd9cd' },
  'striker-cobalt': { body: '#f3f5ff', ring: '#1b46d2', inlay: '#1b46d2' },
  'striker-brass': { body: '#f7edd4', ring: '#8a6a1f', inlay: '#d8b64a' },
};

export function boardTheme(id: string): BoardTheme {
  return BOARD_THEMES[id] ?? BOARD_THEMES['board-ply'];
}

export function coinTheme(id: string): CoinTheme {
  return COIN_THEMES[id] ?? COIN_THEMES['coins-ivory'];
}

export function strikerTheme(id: string): StrikerTheme {
  return STRIKER_THEMES[id] ?? STRIKER_THEMES['striker-ply'];
}

export interface BoardSkins {
  board: string;
  coins: string;
  striker: string;
}

export interface BoardHandles {
  root: SVGElement;
  pieces: Map<PieceId, SVGGElement>;
  striker: SVGGElement;
  strikerOutline: SVGCircleElement;
  aimGuide: SVGElement;
  ghostStriker: SVGElement;
  ghostAim: SVGElement;
}

function pocket(x: number, y: number): SVGElement[] {
  return [
    svg('circle', { cx: x, cy: y, r: POCKET_RADIUS, fill: 'var(--pocket)' }),
    svg('circle', { cx: x, cy: y, r: POCKET_RADIUS - 5, fill: 'none', stroke: 'var(--pocket)', 'stroke-width': 2 }),
  ];
}

function baseline(sign: 1 | -1, theme: BoardTheme): SVGElement[] {
  const y = BASELINE_Y * sign;
  const gap = 9.5;
  const nodes: SVGElement[] = [];
  for (const offset of [-gap, gap]) {
    nodes.push(
      svg('line', {
        x1: -BASELINE_MAX_OFFSET,
        x2: BASELINE_MAX_OFFSET,
        y1: y + offset,
        y2: y + offset,
        stroke: theme.line,
        'stroke-width': 2.5,
      }),
    );
  }
  for (const end of [-BASELINE_MAX_OFFSET, BASELINE_MAX_OFFSET]) {
    nodes.push(
      svg('circle', { cx: end, cy: y, r: gap, fill: 'none', stroke: theme.line, 'stroke-width': 2.5 }),
    );
  }
  return nodes;
}

function arrows(theme: BoardTheme): SVGElement[] {
  const nodes: SVGElement[] = [];
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    nodes.push(
      svg('path', {
        d: `M ${sx * 150} ${sy * 150} L ${sx * 262} ${sy * 262} M ${sx * 262} ${sy * 262} l ${-sx * 26} 0 M ${sx * 262} ${sy * 262} l 0 ${-sy * 26}`,
        stroke: theme.line,
        'stroke-width': 3,
        fill: 'none',
      }),
    );
  }
  return nodes;
}

function coinShape(id: PieceId, theme: CoinTheme): SVGGElement {
  const fill = id === 'queen' ? theme.queen : id.startsWith('w') ? theme.white : theme.black;
  const group = svg('g', {}, [
    svg('circle', { r: COIN_RADIUS, fill, stroke: theme.edge, 'stroke-width': 1.6 }),
    svg('circle', { r: COIN_RADIUS - 4.5, fill: 'none', stroke: theme.edge, 'stroke-width': 1, opacity: 0.55 }),
  ]) as SVGGElement;
  return group;
}

export function strikerShape(skin: string): { group: SVGGElement; outline: SVGCircleElement } {
  const theme = strikerTheme(skin);
  const outline = svg('circle', {
    r: STRIKER_RADIUS,
    fill: theme.body,
    stroke: '#ffffff',
    'stroke-width': 3,
    class: 'striker-outline',
  }) as SVGCircleElement;
  const group = svg('g', {}, [
    svg('circle', { r: STRIKER_RADIUS + 1.5, fill: 'none', stroke: theme.ring, 'stroke-width': 3 }),
    outline,
    svg('circle', { r: STRIKER_RADIUS - 7, fill: 'none', stroke: theme.inlay, 'stroke-width': 2.5 }),
  ]) as SVGGElement;
  return { group, outline };
}

export function drawBoard(skins: BoardSkins): BoardHandles {
  const theme = boardTheme(skins.board);
  const coins = coinTheme(skins.coins);
  const half = VIEW / 2;

  const defs = svg('defs', {}, [
    svg('pattern', { id: 'dc-grain', width: 18, height: 18, patternUnits: 'userSpaceOnUse' }, [
      svg('rect', { width: 18, height: 18, fill: theme.ply }),
      svg('path', { d: 'M0 4 H18 M0 11 H18', stroke: theme.grain, 'stroke-width': 1.4, opacity: 0.7 }),
    ]),
  ]);

  const inner = CUSHION - FRAME_BAND;
  const surface = svg('g', {}, [
    svg('rect', { x: -half, y: -half, width: VIEW, height: VIEW, fill: theme.frame }),
    svg('rect', {
      x: -inner,
      y: -inner,
      width: inner * 2,
      height: inner * 2,
      fill: 'url(#dc-grain)',
      stroke: theme.line,
      'stroke-width': 3,
    }),
    svg('circle', { r: 85, fill: 'none', stroke: theme.line, 'stroke-width': 3 }),
    svg('circle', { r: 22, fill: 'none', stroke: theme.line, 'stroke-width': 2 }),
    ...arrows(theme),
    ...baseline(1, theme),
    ...baseline(-1, theme),
    ...POCKET_CENTRES.flatMap((p) => pocket(p.x, p.y)),
  ]);

  const pieces = new Map<PieceId, SVGGElement>();
  const pieceLayer = svg('g', { id: 'dc-pieces' });
  for (const id of ['queen', ...Array.from({ length: 9 }, (_, i) => `w${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `b${i + 1}`)]) {
    const shape = coinShape(id, coins);
    shape.setAttribute('id', `piece-${id}`);
    shape.setAttribute('data-state', 'board');
    pieces.set(id, shape);
    pieceLayer.append(shape);
  }

  const { group: striker, outline: strikerOutline } = strikerShape(skins.striker);
  striker.setAttribute('id', 'piece-striker');
  striker.setAttribute('data-state', 'board');
  striker.setAttribute('data-skin', skins.striker);

  const aimGuide = svg('g', { id: 'aim-guide' }, [
    svg('line', { x1: 0, y1: 0, x2: 0, y2: 0, stroke: '#ffffff', 'stroke-width': 3, 'stroke-dasharray': '14 10' }),
    svg('line', { x1: 0, y1: 0, x2: 0, y2: 0, stroke: '#121212', 'stroke-width': 1.5, 'stroke-dasharray': '14 10' }),
  ]);

  const ghostStriker = svg('g', { id: 'ghost-striker', opacity: 0.4 }, [
    svg('circle', { r: STRIKER_RADIUS, fill: '#ffffff', stroke: '#121212', 'stroke-width': 2.5 }),
  ]);
  const ghostAim = svg('g', { id: 'ghost-aim', opacity: 0.4 }, [
    svg('line', { x1: 0, y1: 0, x2: 0, y2: 0, stroke: '#121212', 'stroke-width': 3, 'stroke-dasharray': '10 8' }),
  ]);

  const root = svg(
    'svg',
    {
      viewBox: `${-half} ${-half} ${VIEW} ${VIEW}`,
      style: `--pocket:${theme.pocket}`,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    [defs, surface, aimGuide, ghostAim, ghostStriker, pieceLayer, striker],
  );

  return { root, pieces, striker, strikerOutline, aimGuide, ghostStriker, ghostAim };
}

export function setDanger(outline: SVGCircleElement, danger: boolean): void {
  if (danger) {
    outline.setAttribute('stroke', '#121212');
    outline.setAttribute('stroke-width', '9');
    outline.setAttribute('class', 'striker-outline striker-outline--danger');
  } else {
    outline.setAttribute('stroke', '#ffffff');
    outline.setAttribute('stroke-width', '3');
    outline.setAttribute('class', 'striker-outline');
  }
}

/** The board side as rendered, in board millimetres. */
export const RENDERED_SIDE = CUSHION * 2;
