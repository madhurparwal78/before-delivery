// The canvas: SVG rendering of zones, shapes, connectors and markers, with
// pointer and touch interaction.

import { PageDocument, Shape } from '../shared/types.js';
import { derivePage, zoneContains } from '../shared/geometry.js';
import { tallyText } from '../shared/pageRules.js';
import { formatLabel, plainLabel } from '../shared/labels.js';
import { Editor } from './editor.js';
import { svgEl, clear } from './hyperscript.js';

interface MarkerState {
  zoneId: string;
  connectorId: string;
  x: number;
  y: number;
  direction: 'in' | 'out';
  opacity: number;
  visible: boolean;
}

export class CanvasView {
  private editor: Editor;
  private svg!: SVGSVGElement;
  private world!: SVGGElement;
  private itemsGroup!: SVGGElement;
  private markerGroup!: SVGGElement;
  private items = new Map<string, SVGGElement>();
  private markers = new Map<string, MarkerState>();
  private labelElements = new Map<string, Text[]>();
  private connectorPaths = new Map<string, string>();
  private pointerMode: null | { kind: 'pan'; lastX: number; lastY: number }
    | { kind: 'move'; ids: Set<string>; startX: number; startY: number; moved: boolean }
    | { kind: 'connect'; source: string; sourcePort: string } = null;
  private touchState: null | { kind: 'one'; id: number; lastX: number; lastY: number; mode: 'pan' | 'move'; movedIds: Set<string>; startX: number; startY: number }
    | { kind: 'pinch'; ids: number[]; startDist: number; startZoom: number; midX: number; midY: number; canvasX: number; canvasY: number } = null;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  mount(host: HTMLElement): void {
    host.classList.add('canvas-pane-host');
    this.svg = svgEl<SVGSVGElement>('svg', { class: 'canvas-svg' });
    this.svg.setAttribute('role', 'application');
    this.svg.setAttribute('aria-label', 'Diagram canvas');
    // The dot grid is drawn by a CSS background on the world group.
    this.world = svgEl<SVGGElement>('g', { class: 'canvas-world' });
    this.itemsGroup = svgEl<SVGGElement>('g', {});
    this.markerGroup = svgEl<SVGGElement>('g', {});
    this.world.append(this.itemsGroup, this.markerGroup);
    this.svg.appendChild(this.world);
    host.appendChild(this.svg);
    this.bindPointer();
    this.bindTouch();
    this.bindKeys();
    this.updateTransform();
  }

  destroy(): void {
    this.svg.remove();
  }

  openAtOrigin(): void {
    this.items.clear();
    this.markers.clear();
    this.labelElements.clear();
    this.connectorPaths.clear();
    clear(this.itemsGroup);
    clear(this.markerGroup);
    this.updateTransform();
  }

  updateTransform(): void {
    if (this.world === undefined) return;
    this.world.setAttribute('transform', `translate(${this.editor.panX},${this.editor.panY}) scale(${this.editor.zoom})`);
  }

  // Canvas point for a screen position.
  toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.editor.panX) / this.editor.zoom,
      y: (clientY - rect.top - this.editor.panY) / this.editor.zoom,
    };
  }

  render(): void {
    const page = this.editor.page;
    if (page === null) return;
    this.updateTransform();
    this.renderZones(page);
    this.renderShapes(page);
    this.renderConnectors(page);
    this.pruneItems(new Set([
      ...page.zones.map((z) => z.id),
      ...page.shapes.map((s) => s.id),
      ...page.connectors.map((c) => c.id),
    ]));
    this.syncMarkers(page);
    this.renderGrid();
  }

  private renderGrid(): void {
    const size = 24;
    this.svg.style.setProperty('--grid-size', `${size * this.editor.zoom}px`);
  }

  private ensureItem(id: string, ariaLabel: string, classes: string): SVGGElement {
    let item = this.items.get(id);
    if (item === undefined) {
      const fresh = svgEl<SVGGElement>('g', {
        class: classes,
        role: 'button',
        tabindex: 0,
        'aria-label': ariaLabel,
      });
      fresh.addEventListener('focus', () => this.onItemFocus(id));
      fresh.addEventListener('pointerdown', (e) => this.onItemPointerDown(e, id));
      fresh.addEventListener('click', (e) => this.onItemClick(e, id));
      this.itemsGroup.appendChild(fresh);
      this.items.set(id, fresh);
      item = fresh;
    }
    item.setAttribute('aria-label', ariaLabel);
    item.setAttribute('class', classes);
    if (classes.includes('selected')) {
      item.setAttribute('aria-pressed', 'true');
    } else {
      item.removeAttribute('aria-pressed');
    }
    return item;
  }

  private onItemFocus(id: string): void {
    this.editor.focusItemId = id;
  }

  private onItemClick(e: MouseEvent, id: string): void {
    if (this.editor.connectMode !== null) {
      const source = this.editor.connectMode.source;
      if (id !== source) {
        this.editor.attachConnectorPublic(source, id);
      }
      return;
    }
    if (e.shiftKey) {
      const selection = this.editor.selection;
      const index = selection.indexOf(id);
      if (index === -1) selection.push(id);
      else selection.splice(index, 1);
    } else {
      this.editor.selection = [id];
    }
    this.editor.focusItemId = id;
    this.editor.render();
  }

  private onItemPointerDown(e: PointerEvent, id: string): void {
    if (this.editor.readOnly) return;
    const page = this.editor.page;
    if (page === null) return;
    const zone = page.zones.find((z) => z.id === id);
    if (zone !== undefined) {
      const onHeader = (e.target as Element).classList.contains('zone-header-hit');
      if (onHeader) {
        const carried = page.shapes.filter((s) => zoneContains(zone, s)).map((s) => s.id);
        const grouped = new Set<string>(carried);
        for (const shape of page.shapes) {
          if (shape.groupId !== null && carried.some((cid) => page.shapes.find((s) => s.id === cid)?.groupId === shape.groupId)) {
            grouped.add(shape.id);
          }
        }
        this.pointerMode = { kind: 'move', ids: new Set([id, ...grouped]), startX: e.clientX, startY: e.clientY, moved: false };
        e.preventDefault();
      }
      return;
    }
    const shape = page.shapes.find((s) => s.id === id);
    if (shape !== undefined) {
      const selection = this.editor.selection;
      if (!selection.includes(id)) {
        if (e.shiftKey) selection.push(id);
        else this.editor.selection = [id];
        this.editor.render();
      }
      const ids = new Set<string>([id]);
      // Grouped shapes move together.
      if (shape.groupId !== null) {
        for (const other of page.shapes) {
          if (other.groupId === shape.groupId) ids.add(other.id);
        }
      } else {
        for (const selectedId of selection) {
          ids.add(selectedId);
        }
      }
      this.pointerMode = { kind: 'move', ids, startX: e.clientX, startY: e.clientY, moved: false };
      e.preventDefault();
    }
  }

  private bindPointer(): void {
    this.svg.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if ((e.target as Element).closest('[role="button"]') !== null) return;
      if (this.editor.readOnly) {
        this.pointerMode = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
        return;
      }
      this.pointerMode = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
    });
    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const mode = this.pointerMode;
      if (mode === null) return;
      if (mode.kind === 'pan') {
        this.editor.panBy(e.clientX - mode.lastX, e.clientY - mode.lastY);
        mode.lastX = e.clientX;
        mode.lastY = e.clientY;
      } else if (mode.kind === 'move') {
        const dx = (e.clientX - mode.startX) / this.editor.zoom;
        const dy = (e.clientY - mode.startY) / this.editor.zoom;
        const stepX = Math.round(dx / 8) * 8;
        const stepY = Math.round(dy / 8) * 8;
        if (stepX !== 0 || stepY !== 0 || mode.moved) {
          if (stepX !== 0 || stepY !== 0) {
            mode.moved = true;
          }
        }
      }
    });
    window.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const mode = this.pointerMode;
      this.pointerMode = null;
      if (mode === null) return;
      if (mode.kind === 'move' && mode.moved) {
        const dx = (e.clientX - mode.startX) / this.editor.zoom;
        const dy = (e.clientY - mode.startY) / this.editor.zoom;
        const stepX = Math.round(dx / 8) * 8;
        const stepY = Math.round(dy / 8) * 8;
        if (stepX !== 0 || stepY !== 0) {
          this.editor.dragMove(mode.ids, stepX, stepY);
        }
      }
    });
    this.svg.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.editor.setZoomAt(this.editor.zoom * factor, e.clientX, e.clientY);
      } else {
        this.editor.panBy(-e.deltaX, -e.deltaY);
      }
    }, { passive: false });
  }

  private bindTouch(): void {
    this.svg.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const item = target?.closest('[role="button"]');
        let mode: 'pan' | 'move' = 'pan';
        let movedIds = new Set<string>();
        if (!this.editor.readOnly && item !== null && item !== undefined) {
          const id = (item as SVGElement).getAttribute('data-id') ?? '';
          const page = this.editor.page;
          if (page !== null) {
            const zone = page.zones.find((z) => z.id === id);
            if (zone !== undefined) {
              const onHeader = (target as Element | null)?.classList.contains('zone-header-hit') === true;
              if (onHeader) {
                mode = 'move';
                movedIds = new Set([id, ...page.shapes.filter((s) => zoneContains(zone, s)).map((s) => s.id)]);
              }
            } else if (page.shapes.some((s) => s.id === id)) {
              mode = 'move';
              movedIds = new Set([id]);
            }
          }
        }
        this.touchState = { kind: 'one', id: touch.identifier, lastX: touch.clientX, lastY: touch.clientY, mode, movedIds, startX: touch.clientX, startY: touch.clientY };
      } else if (e.touches.length === 2) {
        // A second finger cancels a one-finger move with no edit.
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const midX = (a.clientX + b.clientX) / 2;
        const midY = (a.clientY + b.clientY) / 2;
        const canvas = this.toCanvas(midX, midY);
        this.touchState = { kind: 'pinch', ids: [a.identifier, b.identifier], startDist: dist, startZoom: this.editor.zoom, midX, midY, canvasX: canvas.x, canvasY: canvas.y };
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });

    this.svg.addEventListener('touchmove', (e: TouchEvent) => {
      const state = this.touchState;
      if (state === null) return;
      if (state.kind === 'one') {
        const touch = e.touches[0];
        if (touch.identifier !== state.id) return;
        if (e.touches.length >= 2) {
          // The gesture becomes a pinch; the move is cancelled with no edit.
          const [a, b] = [e.touches[0], e.touches[1]];
          const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          const midX = (a.clientX + b.clientX) / 2;
          const midY = (a.clientY + b.clientY) / 2;
          const canvas = this.toCanvas(midX, midY);
          this.touchState = { kind: 'pinch', ids: [a.identifier, b.identifier], startDist: dist, startZoom: this.editor.zoom, midX, midY, canvasX: canvas.x, canvasY: canvas.y };
          return;
        }
        const dx = touch.clientX - state.lastX;
        const dy = touch.clientY - state.lastY;
        state.lastX = touch.clientX;
        state.lastY = touch.clientY;
        if (state.mode === 'pan') {
          this.editor.panBy(dx, dy);
        }
        if (e.cancelable) e.preventDefault();
      } else if (state.kind === 'pinch') {
        if (e.touches.length < 2) return;
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (state.startDist === 0) return;
        const zoom = Math.min(4, Math.max(0.25, state.startZoom * (dist / state.startDist)));
        const midX = (a.clientX + b.clientX) / 2;
        const midY = (a.clientY + b.clientY) / 2;
        // The canvas point under the starting midpoint stays under the
        // ending midpoint.
        const rect = this.svg.getBoundingClientRect();
        this.editor.zoom = zoom;
        this.editor.panX = (midX - rect.left) - state.canvasX * zoom;
        this.editor.panY = (midY - rect.top) - state.canvasY * zoom;
        this.editor.updateZoomStatus();
        this.updateTransform();
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });

    this.svg.addEventListener('touchend', (e: TouchEvent) => {
      const state = this.touchState;
      if (state === null) return;
      if (state.kind === 'one') {
        const touch = e.changedTouches[0];
        if (touch.identifier !== state.id) return;
        if (state.mode === 'move' && !this.editor.readOnly) {
          const dx = (touch.clientX - state.startX) / this.editor.zoom;
          const dy = (touch.clientY - state.startY) / this.editor.zoom;
          const stepX = Math.round(dx / 8) * 8;
          const stepY = Math.round(dy / 8) * 8;
          if (stepX !== 0 || stepY !== 0) {
            this.editor.dragMove(state.movedIds, stepX, stepY);
          }
        } else if (state.mode === 'pan') {
          // A tap selects.
          const target = document.elementFromPoint(touch.clientX, touch.clientY);
          const item = target?.closest('[role="button"]');
          if (item !== null && item !== undefined) {
            const id = (item as SVGElement).getAttribute('data-id') ?? '';
            if (id !== '') {
              this.editor.selection = [id];
              this.editor.focusItemId = id;
              this.editor.render();
            }
          }
        }
        this.touchState = null;
      } else if (state.kind === 'pinch') {
        if (e.touches.length === 0) {
          this.touchState = null;
          this.editor.render();
        } else if (e.touches.length === 1) {
          const touch = e.touches[0];
          this.touchState = { kind: 'one', id: touch.identifier, lastX: touch.clientX, lastY: touch.clientY, mode: 'pan', movedIds: new Set(), startX: touch.clientX, startY: touch.clientY };
        }
      }
    });
  }

  private bindKeys(): void {
    // Canvas shortcuts are handled at the editor root, so they work whatever
    // control in the canvas region or the top bar has focus.
  }

  focusItem(id: string): void {
    const item = this.items.get(id);
    if (item !== undefined) {
      (item as unknown as HTMLElement).focus();
    }
  }

  private renderZones(page: PageDocument): void {
    for (const zone of page.zones) {
      const classes = `canvas-zone kind-${zone.kind}` + (this.editor.selection.includes(zone.id) ? ' selected' : '');
      const item = this.ensureItem(zone.id, `Zone ${zone.name}`, classes);
      item.setAttribute('data-id', zone.id);
      clear(item);
      const rect = svgEl('rect', { x: zone.x, y: zone.y, width: zone.width, height: zone.height, class: 'zone-rect' });
      const header = svgEl('g', { class: 'zone-header' });
      const name = svgEl<SVGTextElement>('text', { x: zone.x + 8, y: zone.y + 20, class: 'zone-name' });
      name.textContent = zone.name;
      const tally = svgEl<SVGTextElement>('text', { x: zone.x + zone.width - 8, y: zone.y + 20, class: 'zone-tally mono', 'text-anchor': 'end' });
      const derived = this.editor.derived;
      const zoneDerived = derived?.zones.find((z) => z.id === zone.id);
      tally.textContent = tallyText(zoneDerived?.systems ?? 0, zoneDerived?.crossings ?? 0);
      const tallyGroup = svgEl<SVGGElement>('g', { role: 'group', 'aria-label': `${zone.name} tally` });
      tallyGroup.appendChild(tally);
      header.append(name, tallyGroup);
      rect.style.pointerEvents = 'none';
      // Anywhere else inside a zone counts as empty canvas, so only the
      // header strip is interactive.
      const headerHit = svgEl('rect', { x: zone.x, y: zone.y, width: zone.width, height: 32, class: 'zone-header-hit', fill: 'transparent' });
      headerHit.style.cursor = 'move';
      item.append(rect, header, headerHit);
      if (zone.note.trim() !== '') {
        const noteText = svgEl<SVGTextElement>('text', { x: zone.x + 8, y: zone.y + 36, class: 'zone-note' });
        this.renderFormatted(noteText, zone.note);
        const noteGroup = svgEl<SVGGElement>('g', { role: 'note', 'aria-label': `${zone.name} note` });
        noteGroup.appendChild(noteText);
        item.append(noteGroup);
      }
    }
  }

  private renderShapes(page: PageDocument): void {
    const shapes = [...page.shapes].sort((a, b) => a.z - b.z);
    for (const shape of shapes) {
      const classes = `canvas-shape kind-${shape.kind}` + (this.editor.selection.includes(shape.id) ? ' selected' : '');
      const item = this.ensureItem(shape.id, `${plainLabel(shape.label)}, ${kindName(shape)}`, classes);
      item.setAttribute('data-id', shape.id);
      clear(item);
      const rect = svgEl('rect', { x: shape.x, y: shape.y, width: shape.width, height: shape.height, class: 'shape-rect' });
      const label = svgEl<SVGTextElement>('text', { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 + 4, class: 'shape-label', 'text-anchor': 'middle' });
      this.renderFormatted(label, shape.label);
      item.append(rect, label);
      // Ports show on hover or focus through CSS.
      if (this.editor.connectMode !== null && this.editor.connectMode.source !== shape.id) {
        item.classList.add('connect-target');
      }
      // The connect-mode source shows its ports.
      if (this.editor.connectMode?.source === shape.id) {
        item.classList.add('connect-source');
      }
    }
  }

  private renderConnectors(page: PageDocument): void {
    for (const connector of page.connectors) {
      const from = page.shapes.find((s) => s.id === connector.from.shapeId);
      const to = page.shapes.find((s) => s.id === connector.to.shapeId);
      if (from === undefined || to === undefined) continue;
      const classes = 'canvas-connector' + (this.editor.selection.includes(connector.id) ? ' selected' : '');
      const item = this.ensureItem(connector.id, `Connector from ${plainLabel(from.label)} to ${plainLabel(to.label)}`, classes);
      item.setAttribute('data-id', connector.id);
      clear(item);
      const path = connector.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
      const line = svgEl('path', { d: path, class: 'connector-line' });
      // The label sits at the path's midpoint.
      const mid = connector.points[Math.floor(connector.points.length / 2)];
      const label = svgEl<SVGTextElement>('text', { x: mid[0], y: mid[1] - 6, class: 'connector-label', 'text-anchor': 'middle' });
      this.renderFormatted(label, connector.label);
      item.append(line, label);
    }
    this.applyReadingOrder(page);
  }

  // Tab and Shift+Tab move through the items in reading order: by top-left
  // corner, top to bottom, then left to right; a connector by its first point.
  // The DOM order is only rewritten when the reading order changes, so a
  // focused item never loses focus to a re-render.
  private applyReadingOrder(page: PageDocument): void {
    const order: { id: string; x: number; y: number }[] = [];
    for (const zone of page.zones) order.push({ id: zone.id, x: zone.x, y: zone.y });
    for (const shape of page.shapes) order.push({ id: shape.id, x: shape.x, y: shape.y });
    for (const connector of page.connectors) {
      order.push({ id: connector.id, x: connector.points[0][0], y: connector.points[0][1] });
    }
    order.sort((a, b) => a.y - b.y || a.x - b.x);
    const current = Array.from(this.itemsGroup.children).map((el) => el.getAttribute('data-id'));
    const wanted = order.map((entry) => entry.id);
    const same = current.length === wanted.length && current.every((id, i) => id === wanted[i]);
    if (same) return;
    const active = document.activeElement;
    const activeInside = active !== null && this.itemsGroup.contains(active);
    for (const entry of order) {
      const item = this.items.get(entry.id);
      if (item !== undefined) this.itemsGroup.appendChild(item);
    }
    if (activeInside && active !== null && active !== document.activeElement) {
      (active as unknown as HTMLElement).focus();
    }
  }

  private renderFormatted(text: SVGTextElement, label: string): void {
    for (const seg of formatLabel(label)) {
      if (seg.br) {
        text.appendChild(svgEl<SVGTSpanElement>('tspan', { class: 'br' }));
        continue;
      }
      const tspan = svgEl<SVGTSpanElement>('tspan', {});
      if (seg.bold) tspan.classList.add('bold');
      if (seg.italic) tspan.classList.add('italic');
      tspan.textContent = seg.text;
      text.appendChild(tspan);
    }
  }

  private pruneItems(valid: Set<string>): void {
    for (const [id, item] of Array.from(this.items.entries())) {
      if (!valid.has(id)) {
        item.remove();
        this.items.delete(id);
      }
    }
  }

  // Markers derived from the current page.
  private syncMarkers(page: PageDocument): void {
    const derived = this.editor.derived ?? derivePage(page);
    const seen = new Set<string>();
    for (const crossing of derived.crossings) {
      const key = `${crossing.zoneId}:${crossing.connectorId}:${crossing.x}:${crossing.y}`;
      seen.add(key);
      const existing = this.markers.get(key);
      if (existing === undefined) {
        this.markers.set(key, {
          zoneId: crossing.zoneId,
          connectorId: crossing.connectorId,
          x: crossing.x,
          y: crossing.y,
          direction: crossing.direction,
          opacity: 1,
          visible: true,
        });
      } else {
        existing.x = crossing.x;
        existing.y = crossing.y;
        existing.direction = crossing.direction;
        existing.visible = true;
        existing.opacity = 1;
      }
    }
    for (const [key, marker] of this.markers) {
      if (!seen.has(key)) {
        marker.visible = false;
        marker.opacity = 0;
      }
    }
    this.renderMarkers(page);
  }

  private renderMarkers(page: PageDocument): void {
    clear(this.markerGroup);
    const order = [...this.markers.values()]
      .filter((m) => m.visible)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    for (const marker of order) {
      const zone = page.zones.find((z) => z.id === marker.zoneId);
      if (zone === undefined) continue;
      const isCde = zone.kind === 'cde';
      const g = svgEl('g', {
        class: `crossing-marker ${isCde ? 'cde-marker' : 'ink-marker'} ${marker.direction}`,
        role: 'img',
        'aria-label': `Crossing on ${zone.name}, ${marker.direction === 'in' ? 'entering' : 'leaving'}`,
        opacity: String(marker.opacity),
      });
      g.setAttribute('transform', `translate(${marker.x},${marker.y})`);
      const diamond = svgEl('path', { d: diamondPath(6), class: 'marker-diamond' });
      const chevron = svgEl('path', { d: chevronPath(marker.direction), class: 'marker-chevron' });
      g.append(diamond, chevron);
      this.markerGroup.appendChild(g);
    }
  }

  // Animation support: morph a connector's path.
  morphConnector(connectorId: string, points: [number, number][], durationMs: number): void {
    const item = this.items.get(connectorId);
    const line = item?.querySelector('.connector-line');
    if (line === null || line === undefined || item === undefined) return;
    const from = this.connectorPaths.get(connectorId);
    const to = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
    this.connectorPaths.set(connectorId, to);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || durationMs <= 0) {
      (line as SVGPathElement).setAttribute('d', to);
      return;
    }
    if (from === undefined) {
      (line as SVGPathElement).setAttribute('d', to);
      return;
    }
    const startPoints = this.parsePath(from);
    const endPoints = points;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      const morphed = startPoints.map((p, i) => {
        const target = endPoints[Math.min(i, endPoints.length - 1)];
        return [p[0] + (target[0] - p[0]) * eased, p[1] + (target[1] - p[1]) * eased] as [number, number];
      });
      (line as SVGPathElement).setAttribute('d', morphed.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' '));
      if (t < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  private parsePath(path: string): [number, number][] {
    const out: [number, number][] = [];
    const re = /[ML](\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(path)) !== null) {
      out.push([Number(m[1]), Number(m[2])]);
    }
    return out;
  }

  rememberConnectorPath(connectorId: string, points: [number, number][]): void {
    this.connectorPaths.set(connectorId, points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' '));
  }

  fadeMarker(key: string, durationMs: number): void {
    const marker = this.markers.get(key);
    if (marker === undefined) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || durationMs <= 0) {
      marker.visible = false;
      marker.opacity = 0;
      if (this.editor.page !== null) this.renderMarkers(this.editor.page);
      return;
    }
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      marker.opacity = 1 - t;
      if (this.editor.page !== null) this.renderMarkers(this.editor.page);
      if (t < 1) requestAnimationFrame(step);
      else {
        marker.visible = false;
        if (this.editor.page !== null) this.renderMarkers(this.editor.page);
      }
    };
    requestAnimationFrame(step);
  }
}

function diamondPath(radius: number): string {
  return `M0,${-radius} L${radius},0 L0,${radius} L${-radius},0 Z`;
}

function chevronPath(direction: 'in' | 'out'): string {
  // The chevron points into the zone for entering, out of it for leaving.
  return direction === 'in' ? 'M-3,-4 L3,0 L-3,4' : 'M3,-4 L-3,0 L3,4';
}

function kindName(shape: Shape): string {
  const names: Record<string, string> = {
    server: 'Server', database: 'Database', firewall: 'Firewall', router: 'Router',
    load_balancer: 'Load balancer', web_app: 'Web application', api_service: 'API service',
    payment_terminal: 'Payment terminal', workstation: 'Workstation', cloud_service: 'Cloud service',
    third_party: 'Third party', backup_storage: 'Backup storage',
  };
  return names[shape.kind] ?? shape.kind;
}
