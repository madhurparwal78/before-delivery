import { COLOURS, ZOOM_MIN, ZOOM_MAX } from './colours.js';
import type { EditorStore } from './store.js';
import type { Topic } from '../../shared/types.js';
import { el, animate, reducedMotion } from './dom.js';

/**
 * Canvas rendering: stage transform, topics, connectors, cross-links,
 * boundaries, the minimap, focus-keeping and fit rules.
 */

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export function roundZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10000) / 10000));
}

/** The published screen position rule: map point × zoom + pan. */
export function toScreen(p: { x: number; y: number }, v: ViewportState): { x: number; y: number } {
  return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
}

export function toMap(s: { x: number; y: number }, v: ViewportState): { x: number; y: number } {
  return { x: (s.x - v.panX) / v.zoom, y: (s.y - v.panY) / v.zoom };
}

/** Ctrl+wheel and pinch share the published zoom-about-a-point rule. */
export function zoomAbout(point: { x: number; y: number }, factor: number, v: ViewportState): ViewportState {
  const newZoom = roundZoom(v.zoom * factor);
  const panX = point.x - (point.x - v.panX) * newZoom / v.zoom;
  const panY = point.y - (point.y - v.panY) * newZoom / v.zoom;
  return { zoom: newZoom, panX: Math.round(panX * 100) / 100, panY: Math.round(panY * 100) / 100 };
}

/** Fit to screen over every visible box. */
export function fitBoxes(boxes: { x: number; y: number; w: number; h: number }[], canvasW: number, canvasH: number): ViewportState | null {
  if (boxes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x - b.w / 2);
    minY = Math.min(minY, b.y - b.h / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    maxY = Math.max(maxY, b.y + b.h / 2);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const zoom = roundZoom(Math.min(1, (canvasW - 96) / w, (canvasH - 96) / h));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { zoom, panX: Math.round((canvasW / 2 - cx * zoom) * 100) / 100, panY: Math.round((canvasH / 2 - cy * zoom) * 100) / 100 };
}

export interface CanvasParts {
  canvas: HTMLElement;
  stage: HTMLElement;
  treeEl: HTMLElement;
  connectorsEl: HTMLElement;
  topicsEl: HTMLElement;
  linksEl: HTMLElement;
  boundariesEl: HTMLElement;
  minimap: HTMLElement;
  minimapInner: HTMLElement;
  viewport: ViewportState;
  publish(): void;
}

export function buildCanvas(store: EditorStore, region: HTMLElement, initialViewport?: ViewportState): CanvasParts {
  const canvas = el('div', { class: 'canvas', role: 'region', 'aria-label': 'Canvas', tabindex: '0' });
  const stage = el('div', { class: 'stage', 'data-layout': store.state.map.layout, 'data-zoom': '1', 'data-pan-x': '0', 'data-pan-y': '0', 'data-revision': String(store.state.revision) });
  const connectorsEl = el('div', { class: 'connectors' });
  const boundariesEl = el('div', { class: 'boundaries' });
  const linksEl = el('div', { class: 'crosslinks' });
  const topicsEl = el('div', { class: 'topics' });
  stage.append(connectorsEl, boundariesEl, linksEl, topicsEl);
  canvas.appendChild(stage);
  const treeEl = el('div', { role: 'tree', 'aria-label': 'Map', class: 'a11y-tree' });
  canvas.appendChild(treeEl);

  const minimap = el('div', { class: 'minimap', role: 'region', 'aria-label': 'Minimap' });
  const minimapInner = el('div', { class: 'minimap-inner' });
  const visibleAreaBtn = el('button', { class: 'minimap-visible', 'aria-label': 'Visible area' });
  minimap.append(minimapInner, visibleAreaBtn);
  canvas.appendChild(minimap);
  region.appendChild(canvas);

  const parts: CanvasParts = {
    canvas, stage, treeEl, connectorsEl, topicsEl, linksEl, boundariesEl, minimap, minimapInner,
    viewport: initialViewport ?? { zoom: 1, panX: 0, panY: 0 },
    publish() {
      stage.setAttribute('data-zoom', String(roundZoom(this.viewport.zoom).toFixed(4)));
      stage.setAttribute('data-pan-x', this.viewport.panX.toFixed(2));
      stage.setAttribute('data-pan-y', this.viewport.panY.toFixed(2));
      stage.setAttribute('data-layout', store.state.map.layout);
      stage.setAttribute('data-revision', String(store.state.revision));
      // Transform via the stage's style from the viewport.
      (stage as HTMLElement).style.transform = `translate(${this.viewport.panX}px, ${this.viewport.panY}px) scale(${this.viewport.zoom})`;
    },
  };
  return parts;
}

/** Draw one frame of the visible map. */
export function renderCanvas(store: EditorStore, parts: CanvasParts, opts: { regrow?: boolean; previousBoxes?: Map<string, { x: number; y: number }> } = {}): void {
  const layout = store.layout();
  const prev = opts.previousBoxes ?? null;
  // topics
  parts.topicsEl.replaceChildren();
  parts.connectorsEl.replaceChildren();
  parts.linksEl.replaceChildren();
  parts.boundariesEl.replaceChildren();
  const visibleTopics: Topic[] = [];
  for (const t of store.state.topics.values()) {
    const b = layout.boxes.get(t.id);
    if (!b) continue;
    if (t.parent_id !== null && store.state.collapsed.has(t.parent_id)) continue;
    if (t.restricted && !(store.state.myRole === 'owner' || store.state.myRole === 'editor')) continue;
    visibleTopics.push(t);
  }
  for (const t of visibleTopics) {
    const b = layout.boxes.get(t.id)!;
    const side = layout.sides.get(t.id) ?? 'none';
    const node = el('div', {
      class: `topic shape-${t.derived.shape}`,
      'data-topic-id': t.id,
      'data-x': String(b.x), 'data-y': String(b.y), 'data-w': String(b.w), 'data-h': String(b.h),
      'data-side': side, 'data-colour': t.derived.colour, 'data-shape': t.derived.shape,
      'data-text': t.derived.text, 'data-icon': t.icon ?? '', 'data-percent': t.derived.percent === 'dash' ? '' : (t.derived.percent === null || t.derived.percent === undefined ? '' : String(t.derived.percent)),
    }, t.title);
    node.style.left = `${b.x - b.w / 2}px`;
    node.style.top = `${b.y - b.h / 2}px`;
    node.style.width = `${b.w}px`;
    node.style.height = `${b.h}px`;
    node.style.setProperty('--branch', (COLOURS.branch as Record<string, string>)[t.derived.colour] ?? COLOURS.accent);
    if (t.derived.shape === 'filled' || t.derived.shape === 'rounded') {
      node.style.background = (COLOURS.branch as Record<string, string>)[t.derived.colour] ?? COLOURS.accent;
      node.style.color = t.derived.text === 'white' ? '#ffffff' : COLOURS.ink;
    } else if (t.derived.shape === 'pill') {
      node.style.background = '#ffffff';
      node.style.borderColor = (COLOURS.branch as Record<string, string>)[t.derived.colour] ?? COLOURS.accent;
      node.style.color = COLOURS.ink;
    }
    // vote stars
    if (t.vote_count > 0) {
      const star = el('span', { class: 'stars' }, `★ ${t.vote_count}`);
      node.appendChild(star);
    }
    // collapsed badge
    if (store.state.collapsed.has(t.id)) {
      const n = countDescendants(store, t.id);
      node.appendChild(el('span', { class: 'collapsed-badge' }, String(n)));
    }
    if (t.locked_by || hasInheritedLock(store, t.id)) {
      node.appendChild(el('span', { class: 'lock-mark', title: `Locked by ${t.locked_by ?? ''}` }, '🔒'));
    }
    if (t.derived.overdue) node.appendChild(el('span', { class: 'overdue-badge' }, 'Overdue'));
    if (t.derived.blocked_by.length > 0) {
      const blocker = store.state.topics.get(t.derived.blocked_by[0]);
      node.appendChild(el('span', { class: 'blocked-badge' }, `Blocked by ${blocker?.title ?? ''}`));
    }
    if (t.derived.blocked_count > 0) {
      node.appendChild(el('span', { class: 'blocked-count' }, `${t.derived.blocked_count} blocked`));
    }
    if (typeof t.derived.percent === 'number') {
      node.appendChild(el('span', { class: 'percent-badge' }, `${t.derived.percent}%`));
    } else if (t.derived.percent === 'dash') {
      node.appendChild(el('span', { class: 'percent-badge' }, '—'));
    }
    parts.topicsEl.appendChild(node);
    if (opts.regrow && prev) {
      const before = prev.get(t.id);
      if (before && (before.x !== b.x || before.y !== b.y)) {
        const dx = (before.x - b.x) * parts.viewport.zoom;
        const dy = (before.y - b.y) * parts.viewport.zoom;
        animate(node, 'regrow-topic', [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0px, 0px)' },
        ], 320);
      }
    } else if (opts.regrow && !prev) {
      animate(node, 'topic-enter', [{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }], 160);
    }
  }
  // connectors
  for (const t of visibleTopics) {
    if (!t.parent_id) continue;
    const cb = layout.boxes.get(t.id);
    const pb = layout.boxes.get(t.parent_id);
    if (!cb || !pb) continue;
    const connector = el('div', { class: 'connector', 'data-connector': t.id });
    const x1 = pb.x, y1 = pb.y, x2 = cb.x - cb.w / 2, y2 = cb.y;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    connector.style.left = `${x1}px`;
    connector.style.top = `${y1}px`;
    connector.style.width = `${len}px`;
    connector.style.transform = `rotate(${angle}rad)`;
    connector.style.setProperty('--branch', (COLOURS.branch as Record<string, string>)[t.derived.colour] ?? COLOURS.accent);
    parts.connectorsEl.appendChild(connector);
  }
  if (opts.regrow && !reducedMotion()) {
    for (const c of parts.connectorsEl.children) {
      animate(c, 'regrow-connector', [{ opacity: 0 }, { opacity: 1 }], 200, 320);
    }
  }
  // cross links
  const visible = (id: string) => {
    const t = store.state.topics.get(id);
    if (!t) return false;
    if (store.state.collapsed.has(id)) return false;
    if (t.restricted && !(store.state.myRole === 'owner' || store.state.myRole === 'editor')) return false;
    return true;
  };
  for (const link of store.state.links) {
    let from = link.from;
    let to = link.to;
    while (!visible(from)) { const p = store.state.topics.get(from)?.parent_id; if (!p) break; from = p; }
    while (!visible(to)) { const p = store.state.topics.get(to)?.parent_id; if (!p) break; to = p; }
    if (from === to) continue;
    const fb = layout.boxes.get(from);
    const tb = layout.boxes.get(to);
    if (!fb || !tb) continue;
    const node = el('div', {
      class: 'crosslink', 'data-from': link.from, 'data-to': link.to,
      'data-drawn-from': from, 'data-drawn-to': to,
    }, link.label);
    const x1 = fb.x, y1 = fb.y, x2 = tb.x, y2 = tb.y;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    node.style.left = `${x1}px`;
    node.style.top = `${y1}px`;
    node.style.width = `${len}px`;
    node.style.transform = `rotate(${angle}rad)`;
    if (link.type === 'depends') node.classList.add('depends');
    parts.linksEl.appendChild(node);
  }
  // boundaries
  for (const b of store.state.boundaries) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (id: string) => {
      const box = layout.boxes.get(id);
      if (box) {
        minX = Math.min(minX, box.x - box.w / 2);
        minY = Math.min(minY, box.y - box.h / 2);
        maxX = Math.max(maxX, box.x + box.w / 2);
        maxY = Math.max(maxY, box.y + box.h / 2);
      }
      for (const t of store.state.topics.values()) if (t.parent_id === id) walk(t.id);
    };
    walk(b.topic_id);
    if (minX === Infinity) continue;
    const node = el('div', {
      class: 'boundary', 'data-boundary': b.id,
      'data-x': String((minX + maxX) / 2), 'data-y': String((minY + maxY) / 2),
      'data-w': String(maxX - minX + 24), 'data-h': String(maxY - minY + 24),
    }, b.label);
    node.style.left = `${minX - 12}px`;
    node.style.top = `${minY - 12}px`;
    node.style.width = `${maxX - minX + 24}px`;
    node.style.height = `${maxY - minY + 24}px`;
    parts.boundariesEl.appendChild(node);
  }
  // minimap
  parts.minimapInner.replaceChildren();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of visibleTopics) {
    const b = layout.boxes.get(t.id)!;
    minX = Math.min(minX, b.x - b.w / 2);
    minY = Math.min(minY, b.y - b.h / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    maxY = Math.max(maxY, b.y + b.h / 2);
  }
  if (minX !== Infinity) {
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const scale = Math.min(160 / w, 110 / h);
    for (const t of visibleTopics) {
      const b = layout.boxes.get(t.id)!;
      const dot = el('div', { class: 'minimap-topic' });
      dot.style.left = `${(b.x - b.w / 2 - minX) * scale}px`;
      dot.style.top = `${(b.y - b.h / 2 - minY) * scale}px`;
      dot.style.width = `${Math.max(2, b.w * scale)}px`;
      dot.style.height = `${Math.max(2, b.h * scale)}px`;
      dot.style.background = (COLOURS.branch as Record<string, string>)[t.derived.colour] ?? COLOURS.accent;
      parts.minimapInner.appendChild(dot);
    }
    // view rectangle
    const rect = el('div', { class: 'minimap-view' });
    const vw = parts.canvas.clientWidth / parts.viewport.zoom;
    const vh = parts.canvas.clientHeight / parts.viewport.zoom;
    rect.style.left = `${(-parts.viewport.panX / parts.viewport.zoom - minX) * scale}px`;
    rect.style.top = `${(-parts.viewport.panY / parts.viewport.zoom - minY) * scale}px`;
    rect.style.width = `${vw * scale}px`;
    rect.style.height = `${vh * scale}px`;
    parts.minimapInner.appendChild(rect);
  }
  parts.publish();
}

function countDescendants(store: EditorStore, id: string): number {
  let n = 0;
  const walk = (tid: string) => {
    for (const t of store.state.topics.values()) if (t.parent_id === tid) { n += 1; walk(t.id); }
  };
  walk(id);
  return n;
}

function hasInheritedLock(store: EditorStore, id: string): boolean {
  let cur: string | null = id;
  for (;;) {
    const t = store.state.topics.get(cur);
    if (!t) return false;
    if (t.locked_by) return true;
    cur = t.parent_id;
    if (cur === null) return false;
  }
}
