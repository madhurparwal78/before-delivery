import { h, prefersReducedMotion, svgEl } from './dom';
import { KIND_LABELS, PORTS, TRIGGER_LABELS, type Edge, type NodeKind } from '../shared/types';

export const CELL = 144;
export const NODE = 96;
export const GRID_COLUMNS = 24;
export const GRID_ROWS = 12;

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  name: string;
  col: number;
  row: number;
  status?: string;
  reused?: boolean;
}

export function kindLabel(kind: NodeKind): string {
  if (kind in KIND_LABELS) return KIND_LABELS[kind as keyof typeof KIND_LABELS];
  return TRIGGER_LABELS[kind as keyof typeof TRIGGER_LABELS];
}

export function nodeLeft(col: number): number {
  return (col - 1) * CELL + (CELL - NODE) / 2;
}

export function nodeTop(row: number): number {
  return (row - 1) * CELL + (CELL - NODE) / 2;
}

function portPoint(node: CanvasNode, port: string): { x: number; y: number } {
  const ports = PORTS[node.kind];
  const index = Math.max(0, ports.indexOf(port));
  const spread = ports.length === 1 ? 0.5 : (index + 1) / (ports.length + 1);
  return { x: nodeLeft(node.col) + NODE, y: nodeTop(node.row) + NODE * spread };
}

function inputPoint(node: CanvasNode): { x: number; y: number } {
  return { x: nodeLeft(node.col), y: nodeTop(node.row) + NODE / 2 };
}

function edgeCurve(from: CanvasNode, port: string, to: CanvasNode): string {
  const start = portPoint(from, port);
  const end = inputPoint(to);
  const midX = (start.x + end.x) / 2;
  return `M${start.x} ${start.y} C${midX} ${start.y} ${midX} ${end.y} ${end.x} ${end.y}`;
}

export interface NodeElementOptions {
  mode: 'editor' | 'run';
  onActivate?: (id: string) => void;
  draggable?: boolean;
}

export function nodeButton(node: CanvasNode, options: NodeElementOptions): HTMLButtonElement {
  const button = h('button', {
    type: 'button',
    class: `step-node${node.status === undefined ? '' : ` step-${node.status}`}`,
    'aria-label': node.name,
    'data-step-id': node.id,
    'data-kind': node.kind,
    'data-col': String(node.col),
    'data-row': String(node.row),
    'data-anim': node.status === 'running' && !prefersReducedMotion() ? 'running' : 'none',
  });
  if (node.status !== undefined) {
    button.setAttribute('data-status', node.status);
    button.setAttribute('data-reused', node.reused === true ? 'true' : 'false');
  }
  button.style.left = `${nodeLeft(node.col)}px`;
  button.style.top = `${nodeTop(node.row)}px`;
  button.append(h('span', { class: 'node-face', 'aria-hidden': 'true' }, h('span', { class: 'node-glyph' })));
  if (node.status !== undefined) {
    button.append(h('span', { class: `chip chip-${node.status} node-chip`, text: node.status }));
  }
  button.append(
    h(
      'span',
      { class: 'node-caption', 'aria-hidden': 'true' },
      h('span', { class: 'node-name', text: node.name }),
      h('span', { class: 'node-kind', text: kindLabel(node.kind) }),
    ),
  );
  if (options.onActivate !== undefined) {
    const activate = options.onActivate;
    button.addEventListener('click', () => activate(node.id));
  }
  return button;
}

export function portButton(node: CanvasNode, port: string | null, onClick?: () => void): HTMLButtonElement {
  const point = port === null ? inputPoint(node) : portPoint(node, port);
  const button = h('button', {
    type: 'button',
    class: port === null ? 'port port-input' : 'port port-output',
    'aria-label': port === null ? `Input port of ${node.name}` : `Output port ${port} of ${node.name}`,
    'data-step-id': node.id,
    'data-port': port ?? 'in',
    tabIndex: -1,
  });
  button.style.left = `${point.x}px`;
  button.style.top = `${point.y}px`;
  if (onClick !== undefined) button.addEventListener('click', onClick);
  return button;
}

export interface EdgeElementOptions {
  animate?: boolean;
  ghost?: { version: number };
  onActivate?: (edgeId: string) => void;
}

export function edgePath(
  edge: Edge,
  from: CanvasNode,
  to: CanvasNode,
  options: EdgeElementOptions = {},
): SVGElement {
  const reduced = prefersReducedMotion();
  const animating = options.animate === true && !reduced;
  const path = svgEl('path', {
    d: edgeCurve(from, edge.port, to),
    class: `edge-path${options.ghost === undefined ? '' : ' edge-ghost'}${animating ? ' edge-drawing' : ''}`,
    role: 'button',
    tabindex: '-1',
    'aria-label': `Edge from ${from.name} to ${to.name}`,
    'data-edge-id': edge.id,
    'data-from': edge.from,
    'data-port': edge.port,
    'data-to': edge.to,
    'data-order': String(edge.order),
    'data-anim': animating ? 'running' : 'none',
  });
  if (options.ghost !== undefined) {
    path.setAttribute('data-ghost', 'true');
    path.setAttribute('data-version', String(options.ghost.version));
  }
  if (animating) {
    path.addEventListener('animationend', () => {
      path.setAttribute('data-anim', 'none');
      path.classList.remove('edge-drawing');
    });
  }
  if (options.onActivate !== undefined) {
    const activate = options.onActivate;
    path.addEventListener('click', () => activate(edge.id));
  }
  return path;
}

export function canvasPanel(): {
  panel: HTMLElement;
  surface: HTMLElement;
  svg: SVGElement;
} {
  const svg = svgEl('svg', {
    class: 'canvas-svg',
    width: String(GRID_COLUMNS * CELL),
    height: String(GRID_ROWS * CELL),
    viewBox: `0 0 ${GRID_COLUMNS * CELL} ${GRID_ROWS * CELL}`,
    'aria-hidden': 'true',
  });
  const surface = h('div', { class: 'canvas-surface' }, svg);
  surface.style.width = `${GRID_COLUMNS * CELL}px`;
  surface.style.height = `${GRID_ROWS * CELL}px`;
  const panel = h(
    'div',
    { class: 'panel panel-dark canvas-panel', role: 'region', 'aria-label': 'Automation canvas' },
    surface,
  );
  return { panel, surface, svg };
}

export function runToken(runId: string, version: number | null, stepId: string, node: CanvasNode): HTMLElement {
  const token = h('span', {
    class: 'run-token',
    'data-run-token': runId,
    'data-version': version === null ? '' : String(version),
    'data-at-step': stepId,
    'aria-hidden': 'true',
  });
  token.style.left = `${nodeLeft(node.col) + NODE - 14}px`;
  token.style.top = `${nodeTop(node.row) - 10}px`;
  if (version !== null) token.append(h('span', { class: 'token-label mono', text: `v${version}` }));
  return token;
}
