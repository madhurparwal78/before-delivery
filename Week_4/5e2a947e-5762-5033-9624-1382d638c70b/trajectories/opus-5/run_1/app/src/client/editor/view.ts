import { copy } from '../../shared/copy.js';
import { boundingBox, BOUNDARY_PAD } from '../../shared/layout.js';
import { topicAria } from '../../shared/labels.js';
import { colourHex } from '../../shared/style.js';
import { lockInfo, nearestVisibleAncestor, permittedChildren } from '../../shared/tree.js';
import type { Box } from '../../shared/types.js';
import { animate, clear, el, on, reducedMotion, svg } from '../dom.js';
import type { Editor } from './state.js';

interface HeldFocus {
  node: HTMLElement;
  start: number | null;
  end: number | null;
}

function heldFocus(): HeldFocus | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (active instanceof HTMLInputElement) {
    return { node: active, start: active.selectionStart, end: active.selectionEnd };
  }
  return { node: active, start: null, end: null };
}

function restoreFocus(held: HeldFocus | null): void {
  if (held === null || document.activeElement === held.node) return;
  if (!held.node.isConnected) return;
  held.node.focus({ preventScroll: true });
  if (held.node instanceof HTMLInputElement && held.start !== null && held.end !== null) {
    held.node.setSelectionRange(held.start, held.end);
  }
}

export class CanvasView {
  readonly region: HTMLElement;
  readonly stage: HTMLElement;
  readonly tree: HTMLElement;
  readonly links: SVGElement;
  readonly boundaries: HTMLElement;
  readonly cursors: HTMLElement;
  readonly emptyPrompt: HTMLElement;
  readonly minimap: HTMLElement;
  private readonly minimapPicture: SVGElement;
  private readonly editor: Editor;
  private elements = new Map<string, HTMLElement>();
  private previousCentres = new Map<string, { x: number; y: number }>();
  private regrowPending = false;

  constructor(editor: Editor) {
    this.editor = editor;
    this.links = svg('svg', { class: 'link-layer', 'aria-hidden': 'true', focusable: 'false' });
    this.boundaries = el('div', { class: 'boundary-layer', 'aria-hidden': 'true' });
    this.cursors = el('div', { class: 'cursor-layer', 'aria-hidden': 'true' });
    this.tree = el('div', { class: 'topic-layer', role: 'tree', 'aria-label': 'Map' });
    this.stage = el('div', { class: 'stage' }, [
      this.boundaries,
      this.links,
      this.tree,
      this.cursors,
    ]);
    this.emptyPrompt = el('div', { class: 'empty-map' }, [
      svg('svg', { class: 'empty-ribbon', viewBox: '0 0 220 80', 'aria-hidden': 'true', focusable: 'false' }, [
        svg('path', {
          d: 'M 10 70 C 70 70, 90 20, 210 14',
          fill: 'none',
          stroke: '#d8d6e6',
          'stroke-width': 10,
          'stroke-linecap': 'round',
          'stroke-dasharray': '2 14',
        }),
      ]),
      el('p', { text: copy.emptyMapPrompt }),
    ]);
    this.minimapPicture = svg('svg', { 'aria-hidden': 'true', focusable: 'false' });
    const visibleArea = el('button', {
      type: 'button',
      class: 'minimap-area',
      'aria-label': 'Visible area',
    });
    this.minimap = el('div', { class: 'minimap', role: 'region', 'aria-label': 'Minimap' }, [
      this.minimapPicture,
      visibleArea,
    ]);
    on(visibleArea, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      const step = 40;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      const move = moves[key];
      if (!move) return;
      event.preventDefault();
      this.editor.panX += move[0];
      this.editor.panY += move[1];
      this.editor.changed();
    });
    on(this.minimapPicture, 'click', (event) => {
      const rect = this.minimapPicture.getBoundingClientRect();
      const bounds = this.mapBounds();
      const fx = (event as MouseEvent).clientX - rect.left;
      const fy = (event as MouseEvent).clientY - rect.top;
      const mapX = bounds.x + (fx / rect.width) * bounds.w;
      const mapY = bounds.y + (fy / rect.height) * bounds.h;
      this.centreOn(mapX, mapY);
    });
    this.region = el('div', { class: 'canvas', role: 'region', 'aria-label': 'Canvas' }, [
      this.stage,
      this.emptyPrompt,
      this.minimap,
    ]);
    // The canvas pans inside itself: it never scrolls, so that a screen point
    // stays map point x zoom + pan.
    on(this.region, 'scroll', () => {
      this.region.scrollLeft = 0;
      this.region.scrollTop = 0;
    });
  }

  measure(): void {
    const rect = this.region.getBoundingClientRect();
    if (rect.width > 0) {
      this.editor.canvasWidth = rect.width;
      this.editor.canvasHeight = rect.height;
    }
  }

  mapBounds(): Box {
    return (
      boundingBox(this.editor.layout()) ?? { x: -200, y: -100, w: 400, h: 200 }
    );
  }

  screenCentreOf(id: string): { x: number; y: number } | null {
    const laid = this.editor.layout().get(id);
    if (!laid) return null;
    return {
      x: laid.x * this.editor.zoom + this.editor.panX,
      y: laid.y * this.editor.zoom + this.editor.panY,
    };
  }

  prepareRegrow(): void {
    this.previousCentres.clear();
    for (const id of this.editor.visible()) {
      const centre = this.screenCentreOf(id);
      if (centre) this.previousCentres.set(id, centre);
    }
    this.regrowPending = true;
  }

  /** Opens a map at zoom 1 with the root centred. */
  openCentred(): void {
    this.measure();
    const root = this.editor.layout().get(this.editor.doc.root);
    this.editor.zoom = 1;
    this.editor.panX = this.editor.canvasWidth / 2 - (root?.x ?? 0);
    this.editor.panY = this.editor.canvasHeight / 2 - (root?.y ?? 0);
  }

  centreOn(mapX: number, mapY: number): void {
    this.editor.panX = this.editor.canvasWidth / 2 - mapX * this.editor.zoom;
    this.editor.panY = this.editor.canvasHeight / 2 - mapY * this.editor.zoom;
    this.editor.changed();
  }

  clampZoom(value: number): number {
    return Math.round(Math.min(4, Math.max(0.25, value)) * 10000) / 10000;
  }

  zoomAbout(pointX: number, pointY: number, next: number): void {
    const zoom = this.clampZoom(next);
    this.editor.panX = pointX - (pointX - this.editor.panX) * (zoom / this.editor.zoom);
    this.editor.panY = pointY - (pointY - this.editor.panY) * (zoom / this.editor.zoom);
    this.editor.zoom = zoom;
    this.editor.changed();
  }

  /** Zoom and pan that fit every visible box, or one branch. */
  fitFrame(ids?: string[]): { zoom: number; panX: number; panY: number } {
    this.measure();
    const layout = this.editor.layout();
    const chosen = ids ?? this.editor.visible();
    const boxes = new Map(
      chosen
        .map((id) => [id, layout.get(id)] as const)
        .filter((pair): pair is [string, NonNullable<ReturnType<typeof layout.get>>] => pair[1] !== undefined),
    );
    const bounds = boundingBox(boxes) ?? { x: 0, y: 0, w: 1, h: 1 };
    const zoom = this.clampZoom(
      Math.min(
        1,
        (this.editor.canvasWidth - 96) / Math.max(bounds.w, 1),
        (this.editor.canvasHeight - 96) / Math.max(bounds.h, 1),
      ),
    );
    const centreX = bounds.x + bounds.w / 2;
    const centreY = bounds.y + bounds.h / 2;
    return {
      zoom,
      panX: this.editor.canvasWidth / 2 - centreX * zoom,
      panY: this.editor.canvasHeight / 2 - centreY * zoom,
    };
  }

  fitToScreen(ids?: string[], withCamera = false): void {
    const frame = this.fitFrame(ids);
    if (withCamera) this.animateCamera(frame);
    this.editor.zoom = frame.zoom;
    this.editor.panX = frame.panX;
    this.editor.panY = frame.panY;
    this.editor.changed();
  }

  animateCamera(frame: { zoom: number; panX: number; panY: number }): void {
    animate(
      this.stage,
      'camera',
      [
        {
          transform: `translate(${this.editor.panX.toFixed(2)}px, ${this.editor.panY.toFixed(2)}px) scale(${this.editor.zoom})`,
        },
        {
          transform: `translate(${frame.panX.toFixed(2)}px, ${frame.panY.toFixed(2)}px) scale(${frame.zoom})`,
        },
      ],
      400,
    );
  }

  /** Pans by the least amount that brings a topic 48 px inside the canvas. */
  keepInView(id: string): void {
    const laid = this.editor.layout().get(id);
    if (!laid) return;
    this.measure();
    const margin = 48;
    const left = (laid.x - laid.w / 2) * this.editor.zoom + this.editor.panX;
    const right = (laid.x + laid.w / 2) * this.editor.zoom + this.editor.panX;
    const top = (laid.y - laid.h / 2) * this.editor.zoom + this.editor.panY;
    const bottom = (laid.y + laid.h / 2) * this.editor.zoom + this.editor.panY;
    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > this.editor.canvasWidth - margin) dx = this.editor.canvasWidth - margin - right;
    if (top < margin) dy = margin - top;
    else if (bottom > this.editor.canvasHeight - margin) dy = this.editor.canvasHeight - margin - bottom;
    if (dx !== 0 || dy !== 0) {
      this.editor.panX += dx;
      this.editor.panY += dy;
      this.editor.changed();
    }
  }

  /** The topics the page holds, by the published large-map rules. */
  private chooseTopics(): string[] {
    const visible = this.editor.visible();
    const settings = this.editor.payload.settings;
    if (visible.length < settings.virtual_from) return visible;
    const layout = this.editor.layout();
    const margin = settings.dom_margin_px;
    const inView = (id: string): boolean => {
      const laid = layout.get(id);
      if (!laid) return false;
      const left = (laid.x - laid.w / 2) * this.editor.zoom + this.editor.panX;
      const right = (laid.x + laid.w / 2) * this.editor.zoom + this.editor.panX;
      const top = (laid.y - laid.h / 2) * this.editor.zoom + this.editor.panY;
      const bottom = (laid.y + laid.h / 2) * this.editor.zoom + this.editor.panY;
      return (
        right >= -margin &&
        left <= this.editor.canvasWidth + margin &&
        bottom >= -margin &&
        top <= this.editor.canvasHeight + margin
      );
    };
    const chosen: string[] = [];
    const taken = new Set<string>();
    const add = (id: string): void => {
      if (taken.has(id) || chosen.length >= settings.dom_ceiling) return;
      taken.add(id);
      chosen.push(id);
    };
    add(this.editor.focusId);
    for (const id of this.editor.ancestorsOf(this.editor.focusId)) add(id);
    const centreX = (this.editor.canvasWidth / 2 - this.editor.panX) / this.editor.zoom;
    const centreY = (this.editor.canvasHeight / 2 - this.editor.panY) / this.editor.zoom;
    const near = visible
      .filter((id) => !taken.has(id) && inView(id))
      .map((id) => {
        const laid = layout.get(id);
        const dx = (laid?.x ?? 0) - centreX;
        const dy = (laid?.y ?? 0) - centreY;
        return { id, distance: dx * dx + dy * dy };
      })
      .sort((a, b) => a.distance - b.distance);
    for (const candidate of near) add(candidate.id);
    return chosen;
  }

  update(): void {
    const editor = this.editor;
    const layout = editor.layout();
    const derived = editor.derived();
    const view = editor.view();
    const chosen = this.chooseTopics();
    const wanted = new Set(chosen);
    const held = heldFocus();

    this.stage.style.transform = `translate(${editor.panX.toFixed(2)}px, ${editor.panY.toFixed(2)}px) scale(${editor.zoom})`;
    this.stage.dataset.zoom = editor.zoom.toFixed(4);
    this.stage.dataset.panX = editor.panX.toFixed(2);
    this.stage.dataset.panY = editor.panY.toFixed(2);
    this.stage.dataset.layout = editor.doc.layout;
    this.stage.dataset.revision = String(editor.revision);
    this.region.dataset.theme = editor.doc.theme;

    for (const [id, node] of [...this.elements]) {
      if (!wanted.has(id)) {
        node.remove();
        this.elements.delete(id);
      }
    }

    const order = editor.visible().filter((id) => wanted.has(id));
    for (const id of order) {
      const laid = layout.get(id);
      const topic = editor.doc.topics[id];
      const info = derived.get(id);
      if (!laid || !topic || !info) continue;
      let node = this.elements.get(id);
      const created = node === undefined;
      if (!node) {
        node = el('div', { class: 'topic', role: 'treeitem' });
        this.elements.set(id, node);
        this.tree.append(node);
      }
      node.style.left = `${laid.x - laid.w / 2}px`;
      node.style.top = `${laid.y - laid.h / 2}px`;
      node.style.width = `${laid.w}px`;
      node.style.minHeight = `${laid.h}px`;
      node.style.setProperty('--branch', colourHex(info.colour));
      node.dataset.topicId = id;
      node.dataset.x = String(laid.x);
      node.dataset.y = String(laid.y);
      node.dataset.w = String(laid.w);
      node.dataset.h = String(laid.h);
      node.dataset.side = laid.side;
      node.dataset.colour = info.colour;
      node.dataset.shape = info.shape;
      node.dataset.text = info.text;
      if (topic.icon) node.dataset.icon = topic.icon;
      else delete node.dataset.icon;
      node.dataset.percent = info.percent === null ? '' : info.percent === 'dash' ? '' : String(info.percent);
      if (editor.dimmed.has(id)) node.dataset.dim = 'true';
      else delete node.dataset.dim;
      const diff = editor.diff.get(id);
      if (diff) node.dataset.diff = diff;
      else delete node.dataset.diff;
      if (editor.dropTarget === id) node.dataset.dropTarget = 'true';
      else delete node.dataset.dropTarget;

      const aria = topicAria(view, id, info, editor.countsFor(id));
      node.setAttribute('aria-level', String(aria.level));
      node.setAttribute('aria-posinset', String(aria.posinset));
      node.setAttribute('aria-setsize', String(aria.setsize));
      node.setAttribute('aria-label', aria.label);
      if (aria.expanded === null) node.removeAttribute('aria-expanded');
      else node.setAttribute('aria-expanded', aria.expanded ? 'true' : 'false');
      node.setAttribute('aria-selected', editor.selection.has(id) ? 'true' : 'false');
      node.tabIndex = editor.focusId === id ? 0 : -1;
      node.classList.toggle('root', id === editor.doc.root);
      node.classList.toggle('selected', editor.selection.has(id));
      node.classList.toggle('focused', editor.focusId === id);

      if (editor.editingTopic !== id) this.paintTopic(node, id, info);
      if (created && !this.regrowPending) {
        animate(node, 'topic-enter', [{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }], 160);
      }
    }
    // Keep document order without moving nodes that are already in place, so
    // that an open title input never loses focus to a re-render.
    let cursor = this.tree.firstElementChild;
    for (const id of order) {
      const node = this.elements.get(id);
      if (!node) continue;
      if (node === cursor) {
        cursor = node.nextElementSibling;
        continue;
      }
      this.tree.insertBefore(node, cursor);
    }

    this.paintConnectors(order, wanted);
    this.paintCrossLinks();
    this.paintBoundaries(wanted);
    this.paintCursors();
    this.paintMinimap();
    this.emptyPrompt.hidden = permittedChildren(view, editor.doc.root).length > 0;
    if (this.regrowPending) this.runRegrow();
    restoreFocus(held);
  }

  private paintTopic(node: HTMLElement, id: string, info: ReturnType<Editor['derived']> extends Map<string, infer T> ? T : never): void {
    const editor = this.editor;
    const topic = editor.doc.topics[id];
    const counts = editor.countsFor(id);
    clear(node);
    if (topic.icon) {
      node.append(el('span', { class: `icon icon-${topic.icon}`, 'aria-hidden': 'true' }));
    }
    node.append(el('span', { class: 'topic-title', text: topic.title }));
    if (editor.collapsed.has(id) && info.subtopics > 0) {
      node.append(el('span', { class: 'badge', text: String(info.subtopics), 'aria-hidden': 'true' }));
    }
    if (counts.votes > 0) {
      node.append(
        el('span', { class: 'votes', 'aria-hidden': 'true' }, [
          el('span', { class: 'star', text: '\u2605' }),
          el('span', { text: String(counts.votes) }),
        ]),
      );
    }
    if (info.percent !== null) {
      node.append(
        el('span', {
          class: 'progress',
          'aria-hidden': 'true',
          text: info.percent === 'dash' ? copy.rollupDash : `${info.percent}%`,
        }),
      );
    }
    if (info.blocked_by.length > 0) {
      const first = editor.doc.topics[info.blocked_by[0]];
      node.append(
        el('span', { class: 'blocked', text: copy.blockedTopic(first?.title ?? '') }),
      );
    }
    if (info.blocked_count > 0) {
      node.append(el('span', { class: 'blocked-count', text: copy.parentBlockedCount(info.blocked_count) }));
    }
    if (info.overdue) node.append(el('span', { class: 'overdue', text: copy.overdue }));
    const lock = lockInfo(editor.doc, id);
    if (lock.by !== null) {
      node.append(
        el('span', { class: 'lock', title: `Locked by ${lock.by}` }, [
          el('span', { class: 'lock-mark', 'aria-hidden': 'true', text: '\u{1F512}' }),
          el('span', { class: 'sr-only', text: `Locked by ${lock.by}` }),
        ]),
      );
    }
    if (topic.attachments.length > 0) {
      for (const attachment of topic.attachments) {
        node.append(
          el('img', {
            class: 'attachment',
            src: `/api/attachments/${attachment.id}`,
            alt: `Attachment on ${topic.title}`,
          }),
        );
      }
    }
  }

  private paintConnectors(order: string[], wanted: Set<string>): void {
    const layout = this.editor.layout();
    const existing = new Map<string, SVGElement>();
    for (const node of [...this.links.querySelectorAll('[data-connector]')]) {
      existing.set(node.getAttribute('data-connector') ?? '', node as SVGElement);
    }
    const keep = new Set<string>();
    for (const id of order) {
      const topic = this.editor.doc.topics[id];
      if (!topic || topic.parent_id === null || !wanted.has(topic.parent_id)) continue;
      const from = layout.get(topic.parent_id);
      const to = layout.get(id);
      if (!from || !to) continue;
      keep.add(id);
      const d = `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`;
      let path = existing.get(id);
      if (!path) {
        path = svg('path', { 'data-connector': id, class: 'connector' });
        this.links.append(path);
      }
      path.setAttribute('d', d);
      path.setAttribute('stroke', colourHex(this.editor.derived().get(id)?.colour ?? 'accent'));
    }
    for (const [id, node] of existing) {
      if (!keep.has(id)) node.remove();
    }
  }

  private paintCrossLinks(): void {
    for (const node of [...this.links.querySelectorAll('[data-from]')]) node.remove();
    const layout = this.editor.layout();
    const view = this.editor.view();
    for (const link of this.editor.doc.links) {
      const from = nearestVisibleAncestor(view, link.from);
      const to = nearestVisibleAncestor(view, link.to);
      if (from === null || to === null || from === to) continue;
      const a = layout.get(from);
      const b = layout.get(to);
      if (!a || !b) continue;
      const group = svg('g', {
        'data-from': link.from,
        'data-to': link.to,
        'data-drawn-from': from,
        'data-drawn-to': to,
        class: `cross-link ${link.type}`,
      });
      group.append(
        svg('path', {
          d: `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 60}, ${b.x} ${b.y}`,
          fill: 'none',
          stroke: '#6b6485',
          'stroke-width': 2,
          'stroke-dasharray': link.type === 'depends' ? '2 6' : '6 6',
        }),
      );
      if (link.label !== '') {
        const label = svg('text', {
          x: (a.x + b.x) / 2,
          y: Math.min(a.y, b.y) - 24,
          'text-anchor': 'middle',
          class: 'link-label',
        });
        label.textContent = link.label;
        group.append(label);
      }
      this.links.append(group);
    }
  }

  private paintBoundaries(wanted: Set<string>): void {
    clear(this.boundaries);
    const layout = this.editor.layout();
    const view = this.editor.view();
    for (const boundary of this.editor.doc.boundaries) {
      const ids = [boundary.topic_id];
      const walk = (id: string): void => {
        for (const child of permittedChildren(view, id)) {
          ids.push(child);
          walk(child);
        }
      };
      walk(boundary.topic_id);
      const boxes = new Map(
        ids
          .filter((id) => wanted.has(id))
          .map((id) => [id, layout.get(id)] as const)
          .filter((pair): pair is [string, NonNullable<ReturnType<typeof layout.get>>] => pair[1] !== undefined),
      );
      const bounds = boundingBox(boxes);
      if (!bounds) continue;
      const node = el('div', { class: 'boundary' });
      node.dataset.boundary = boundary.id;
      node.dataset.x = String(Math.round(bounds.x - BOUNDARY_PAD));
      node.dataset.y = String(Math.round(bounds.y - BOUNDARY_PAD));
      node.dataset.w = String(Math.round(bounds.w + BOUNDARY_PAD * 2));
      node.dataset.h = String(Math.round(bounds.h + BOUNDARY_PAD * 2));
      node.style.left = `${bounds.x - BOUNDARY_PAD}px`;
      node.style.top = `${bounds.y - BOUNDARY_PAD}px`;
      node.style.width = `${bounds.w + BOUNDARY_PAD * 2}px`;
      node.style.height = `${bounds.h + BOUNDARY_PAD * 2}px`;
      if (boundary.label !== '') {
        node.append(el('span', { class: 'boundary-label', text: boundary.label }));
      }
      this.boundaries.append(node);
    }
  }

  private paintCursors(): void {
    clear(this.cursors);
    for (const person of this.editor.people) {
      if (person.name === this.editor.me) continue;
      if (person.cursor) {
        const marker = el('div', { class: 'remote-cursor' }, [
          el('span', { class: 'remote-name', text: person.name }),
        ]);
        marker.dataset.user = person.name;
        marker.dataset.colour = person.colour;
        marker.style.left = `${person.cursor.x}px`;
        marker.style.top = `${person.cursor.y}px`;
        marker.style.setProperty('--branch', colourHex(person.colour));
        this.cursors.append(marker);
      }
      const selected = person.cursor?.topic_id;
      if (selected) {
        const laid = this.editor.layout().get(selected);
        if (!laid) continue;
        const ring = el('div', { class: 'selection-ring' });
        ring.dataset.selectedBy = person.name;
        ring.dataset.colour = person.colour;
        ring.style.left = `${laid.x - laid.w / 2 - 4}px`;
        ring.style.top = `${laid.y - laid.h / 2 - 4}px`;
        ring.style.width = `${laid.w + 8}px`;
        ring.style.height = `${laid.h + 8}px`;
        ring.style.setProperty('--branch', colourHex(person.colour));
        this.cursors.append(ring);
      }
    }
  }

  private paintMinimap(): void {
    const bounds = this.mapBounds();
    const layout = this.editor.layout();
    clear(this.minimapPicture);
    this.minimapPicture.setAttribute(
      'viewBox',
      `${bounds.x - 20} ${bounds.y - 20} ${bounds.w + 40} ${bounds.h + 40}`,
    );
    for (const id of this.editor.visible()) {
      const laid = layout.get(id);
      if (!laid) continue;
      this.minimapPicture.append(
        svg('rect', {
          x: laid.x - laid.w / 2,
          y: laid.y - laid.h / 2,
          width: laid.w,
          height: laid.h,
          fill: colourHex(this.editor.derived().get(id)?.colour ?? 'accent'),
          opacity: 0.6,
        }),
      );
    }
    const viewLeft = -this.editor.panX / this.editor.zoom;
    const viewTop = -this.editor.panY / this.editor.zoom;
    this.minimapPicture.append(
      svg('rect', {
        x: viewLeft,
        y: viewTop,
        width: this.editor.canvasWidth / this.editor.zoom,
        height: this.editor.canvasHeight / this.editor.zoom,
        fill: 'none',
        stroke: '#1f49e0',
        'stroke-width': Math.max(2, bounds.w / 200),
      }),
    );
  }

  private runRegrow(): void {
    this.regrowPending = false;
    if (reducedMotion()) {
      this.previousCentres.clear();
      return;
    }
    for (const [id, node] of this.elements) {
      const before = this.previousCentres.get(id);
      const now = this.screenCentreOf(id);
      if (!before || !now) continue;
      const dx = before.x - now.x;
      const dy = before.y - now.y;
      animate(
        node,
        'regrow-topic',
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
        320,
      );
    }
    for (const connector of this.links.querySelectorAll('[data-connector]')) {
      animate(connector, 'regrow-connector', [{ opacity: 0 }, { opacity: 1 }], 200, 320);
    }
    this.previousCentres.clear();
  }

  elementFor(id: string): HTMLElement | undefined {
    return this.elements.get(id);
  }

  /** Brings a topic into the page and the view, then focuses it. */
  focusTopic(id: string): void {
    this.editor.focusId = id;
    this.editor.changed();
    this.keepInView(id);
    const node = this.elements.get(id);
    node?.focus({ preventScroll: true });
  }
}
