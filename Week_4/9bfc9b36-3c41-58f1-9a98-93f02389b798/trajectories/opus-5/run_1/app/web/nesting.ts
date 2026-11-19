import { call, ApiError } from './api';
import {
  announce, areaPair, chip, clear, countTo, currentLayout, durationOf, el, groupedInches, groupedMm,
  lengthPair, onLayoutChange, poster, refuse, showDialog, showFieldErrors, svgEl, dialogIsOpen,
} from './ui';
import { SUCCESS, layingPanelCopy, PENDING_COPY, ERROR_COPY, STATUS_CHIP_LABELS } from '../src/shared/copy';

/** The nesting screen: the cobalt drawing canvas, the black roll strip and the hold. */

export interface Panel {
  readonly number: number;
  readonly outline: readonly [number, number][];
  readonly length_mm: number;
  readonly width_mm: number;
  readonly area_mm2: number;
  readonly cut: boolean;
  readonly laid: { claim_id: string; stock_code: string; x_mm: number; y_mm: number; rotation: number } | null;
}

export interface Drawing {
  readonly code: string;
  readonly boat_code: string;
  readonly boat_name: string;
  readonly sail: string;
  readonly cloth_code: string;
  readonly lot: string | null;
  readonly status: string;
  readonly step: string;
  readonly panels: readonly Panel[];
  readonly claim_ids: readonly string[];
  readonly area: { area_mm2: number; area_m2: string; area_ft2: string; basis: string } | null;
}

export interface Claim {
  readonly id: string;
  readonly stock_code: string;
  readonly drawing_code: string;
  readonly holder: { email: string; display_name: string };
  readonly length_mm: number;
  readonly status: 'held' | 'cut' | 'lapsed' | 'released';
  readonly expires_at: string;
  readonly seconds_remaining: number;
  readonly used_mm: number;
  readonly lays: readonly { panel_number: number; x_mm: number; y_mm: number; rotation: number; outline: readonly [number, number][] }[];
  readonly next_positions: readonly { panel_number: number; x_mm: number | null; y_mm: number | null; rotation: number | null }[];
}

export interface Stock {
  readonly code: string;
  readonly kind: 'roll' | 'offcut';
  readonly lot: string;
  readonly usable_width_mm: number;
  readonly remaining_mm: number;
  readonly after_laid_mm: number;
  readonly on_hand_mm2: number;
  readonly free_mm: number;
}

interface StockList {
  readonly items: readonly Stock[];
}

const SMALL_STEP = 1;
const LARGE_STEP = 10;

export class NestingScreen {
  private readonly root: HTMLElement;
  private readonly drawingCode: string;
  private readonly withRail: boolean;

  private drawing: Drawing | null = null;
  private claims: Claim[] = [];
  private activeClaimId: string | null = null;
  private stock: Stock | null = null;
  private offcutCount = 0;

  private selected: number | null = null;
  private ghost: { x: number; y: number; rotation: 0 | 180 } = { x: 0, y: 0, rotation: 0 };
  private panelsOpen = true;
  private warned = new Set<string>();
  private countdownStarted = 0;
  private countdownFrom = 0;
  private timer: number | null = null;
  private poll: number | null = null;
  private stopLayout: (() => void) | null = null;
  private cutKeys = new Map<string, string>();
  private lastRemaining = 0;

  constructor(root: HTMLElement, drawingCode: string, withRail: boolean) {
    this.root = root;
    this.drawingCode = drawingCode;
    this.withRail = withRail;
  }

  async start(): Promise<void> {
    this.panelsOpen = currentLayout() !== 'phone';
    this.stopLayout = onLayoutChange((layout) => {
      // Entering the phone layout always collapses the list; leaving opens it.
      this.panelsOpen = layout !== 'phone';
      this.render();
    });
    document.addEventListener('keydown', this.onKey);
    await this.load();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    document.removeEventListener('keydown', this.onKey);
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.poll !== null) window.clearTimeout(this.poll);
    this.stopLayout?.();
  }

  private async load(): Promise<void> {
    this.drawing = await call<Drawing>(`/api/drawings/${this.drawingCode}`);
    this.claims = [];
    for (const id of this.drawing.claim_ids) {
      const claim = await call<Claim>(`/api/claims/${id}`);
      this.claims.push(claim);
    }
    const held = this.heldClaims();
    if (this.activeClaimId === null || !held.some((claim) => claim.id === this.activeClaimId)) {
      this.activeClaimId = held[0]?.id ?? null;
    }
    await this.loadStock();
    this.startCountdown();
    this.render();
  }

  private async loadStock(): Promise<void> {
    const active = this.active();
    if (active === null) {
      this.stock = null;
      return;
    }
    this.stock = await call<Stock>(`/api/stock/${active.stock_code}`);
    this.lastRemaining = this.stock.after_laid_mm;
    const summary = await call<{ offcuts: number }>('/api/stock/summary');
    this.offcutCount = summary.offcuts;
  }

  /** `Active hold` lists each Held claim, newest first. */
  private heldClaims(): Claim[] {
    return this.claims.filter((claim) => claim.status === 'held').slice().reverse();
  }

  private active(): Claim | null {
    return this.claims.find((claim) => claim.id === this.activeClaimId) ?? null;
  }

  private startCountdown(): void {
    const active = this.active();
    this.countdownFrom = active?.seconds_remaining ?? 0;
    this.countdownStarted = performance.now();
  }

  /** Counts down by elapsed time, never from the device clock. */
  private secondsLeft(): number {
    const elapsed = Math.floor((performance.now() - this.countdownStarted) / 1000);
    return Math.max(0, this.countdownFrom - elapsed);
  }

  private tick(): void {
    const active = this.active();
    if (active === null || active.status !== 'held') return;
    const left = this.secondsLeft();
    const node = this.root.querySelector('[data-timer]');
    if (node) node.textContent = `Hold ends in ${minutesSeconds(left)}`;
    if (left <= 60 && !this.warned.has(active.id)) {
      this.warned.add(active.id);
      announce(SUCCESS.oneMinute(active.stock_code));
    }
    if (left === 0 && this.poll === null) {
      this.poll = window.setTimeout(() => {
        this.poll = null;
        void this.askServerAgain();
      }, 0);
    }
  }

  /** At zero the page asks the server again and shows whatever it answers. */
  private async askServerAgain(): Promise<void> {
    const active = this.active();
    if (active === null) return;
    const claim = await call<Claim>(`/api/claims/${active.id}`);
    this.claims = this.claims.map((item) => (item.id === claim.id ? claim : item));
    if (claim.status === 'held') {
      this.startCountdown();
      return;
    }
    this.selected = null;
    this.ghost = { x: 0, y: 0, rotation: 0 };
    await this.load();
    refuse(ERROR_COPY.claim_lapsed);
    this.root.querySelector<HTMLElement>('[data-claim-open]')?.focus();
  }

  /* -------------------------------------------------------------- keyboard */

  private onKey = (event: KeyboardEvent): void => {
    if (dialogIsOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    const region = this.root.querySelector('[data-nesting]');
    if (region === null || target === null || !region.contains(target)) return;

    const step = event.shiftKey ? LARGE_STEP : SMALL_STEP;
    switch (event.key) {
      case 'ArrowRight':
        this.nudge(step, 0);
        break;
      case 'ArrowLeft':
        this.nudge(-step, 0);
        break;
      case 'ArrowDown':
        this.nudge(0, step);
        break;
      case 'ArrowUp':
        this.nudge(0, -step);
        break;
      case 'r':
      case 'R':
        this.turn();
        break;
      case 'l':
      case 'L':
        void this.lay();
        break;
      case 'u':
      case 'U':
        void this.undo();
        break;
      case 'Escape':
        this.selected = null;
        this.render();
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  /** Every move is clamped so the turned outline stays on the cloth. */
  private clamp(x: number, y: number, rotation: 0 | 180): { x: number; y: number } {
    const panel = this.panel(this.selected);
    const active = this.active();
    if (panel === null || active === null || this.stock === null) return { x: 0, y: 0 };
    const width = rotation === 0 ? panel.length_mm : panel.length_mm;
    const height = panel.width_mm;
    return {
      x: Math.max(0, Math.min(x, active.length_mm - width)),
      y: Math.max(0, Math.min(y, this.stock.usable_width_mm - height)),
    };
  }

  private nudge(dx: number, dy: number): void {
    if (this.selected === null) return;
    const next = this.clamp(this.ghost.x + dx, this.ghost.y + dy, this.ghost.rotation);
    this.ghost = { ...this.ghost, ...next };
    this.paintGhost();
  }

  private turn(): void {
    if (this.selected === null) return;
    const rotation: 0 | 180 = this.ghost.rotation === 0 ? 180 : 0;
    const next = this.clamp(this.ghost.x, this.ghost.y, rotation);
    this.ghost = { x: next.x, y: next.y, rotation };
    this.paintGhost();
    announce(SUCCESS.turn(this.selected, rotation));
  }

  private panel(number: number | null): Panel | null {
    if (number === null || this.drawing === null) return null;
    return this.drawing.panels.find((item) => item.number === number) ?? null;
  }

  private select(number: number): void {
    this.selected = number;
    const active = this.active();
    const entry = active?.next_positions.find((item) => item.panel_number === number);
    this.ghost =
      entry && entry.x_mm !== null && entry.y_mm !== null && entry.rotation !== null
        ? { x: entry.x_mm, y: entry.y_mm, rotation: entry.rotation as 0 | 180 }
        : { x: 0, y: 0, rotation: 0 };
    if (currentLayout() === 'phone') this.panelsOpen = false;
    this.render();
    if (currentLayout() === 'phone') this.root.querySelector<HTMLElement>('[data-lay]')?.focus();
  }

  /* -------------------------------------------------------------- actions */

  private async lay(): Promise<void> {
    const active = this.active();
    const panel = this.panel(this.selected);
    if (active === null || panel === null) return;
    announce(layingPanelCopy(panel.number));
    const from = this.layStartRect(panel.number);
    try {
      const answer = await call<{ claim: Claim; stock: Stock; drawing_status: string }>(
        `/api/claims/${active.id}/lays`,
        { method: 'POST', body: { panel_number: panel.number, x_mm: this.ghost.x, y_mm: this.ghost.y, rotation: this.ghost.rotation } },
      );
      const laid = answer.claim.lays.find((entry) => entry.panel_number === panel.number);
      this.claims = this.claims.map((item) => (item.id === answer.claim.id ? answer.claim : item));
      this.stock = answer.stock;
      this.selected = null;
      if (laid) await this.threadLay(panel, laid.x_mm, laid.y_mm, from, answer.stock.after_laid_mm);
      else this.render();
      announce(
        SUCCESS.lay(panel.number, answer.stock.kind, answer.stock.code, groupedMm(answer.stock.after_laid_mm), groupedInches(answer.stock.after_laid_mm)),
      );
      await this.refreshDrawing();
    } catch (cause) {
      if (cause instanceof ApiError) {
        showFieldErrors(this.root, cause);
        if (Object.keys(cause.fields).length === 0) refuse(cause.message);
        // A refused lay sends the panel back; no stock figure changes.
        this.render();
      }
    }
  }

  private async undo(): Promise<void> {
    const active = this.active();
    if (active === null) return;
    const last = active.lays[active.lays.length - 1];
    if (last === undefined) return;
    try {
      const answer = await call<{ claim: Claim; stock: Stock; drawing_status: string }>(
        `/api/claims/${active.id}/lays/${last.panel_number}`,
        { method: 'DELETE' },
      );
      this.claims = this.claims.map((item) => (item.id === answer.claim.id ? answer.claim : item));
      this.stock = answer.stock;
      announce(SUCCESS.undo(last.panel_number, answer.stock.kind, answer.stock.code));
      await this.refreshDrawing();
    } catch (cause) {
      if (cause instanceof ApiError) refuse(cause.message);
    }
  }

  private async refreshDrawing(): Promise<void> {
    this.drawing = await call<Drawing>(`/api/drawings/${this.drawingCode}`);
    this.render();
  }

  private async claimLength(): Promise<void> {
    const drawing = this.drawing;
    if (drawing === null) return;
    const stock = await call<StockList>('/api/stock');
    const options = stock.items
      .filter((item) => item.remaining_mm > 0)
      .map((item) => ({ value: item.code, label: `${item.code} · lot ${item.lot}` }));
    showDialog(
      {
        title: 'Claim length',
        submit: 'Claim',
        fields: [
          { name: 'stock_code', label: 'Roll or offcut', options },
          { name: 'length_mm', label: 'Length (mm)', type: 'text' },
        ],
        onSubmit: async (values) => {
          announce(PENDING_COPY.claim);
          const claim = await call<Claim>('/api/claims', {
            method: 'POST',
            body: {
              stock_code: values['stock_code'],
              drawing_code: drawing.code,
              length_mm: Number(values['length_mm']),
            },
          });
          this.activeClaimId = claim.id;
          await this.load();
          announce(
            SUCCESS.claim(groupedMm(claim.length_mm), claim.stock_code, claim.expires_at.slice(11, 16)),
          );
        },
      },
      this.root.querySelector<HTMLElement>('[data-claim-open]'),
    );
  }

  private async release(): Promise<void> {
    const active = this.active();
    if (active === null) return;
    try {
      await call<Claim>(`/api/claims/${active.id}/release`, { method: 'POST' });
      announce(SUCCESS.release(active.stock_code));
      this.activeClaimId = null;
      await this.load();
    } catch (cause) {
      if (cause instanceof ApiError) refuse(cause.message);
    }
  }

  async confirmCut(claimId?: string): Promise<void> {
    const active = claimId === undefined ? this.active() : this.claims.find((item) => item.id === claimId) ?? null;
    if (active === null) return;
    // The confirmation key for a hold is kept in this tab and reused on a retry.
    let key = this.cutKeys.get(active.id);
    if (key === undefined) {
      key = `cut-${active.id}-${Math.random().toString(36).slice(2, 10)}`;
      this.cutKeys.set(active.id, key);
    }
    announce(PENDING_COPY.cut);
    try {
      const answer = await call<{ stock: Stock; offcut: Stock | null; drawing_status: string }>(
        `/api/claims/${active.id}/cut`,
        { method: 'POST', idempotencyKey: key, body: {} },
      );
      let copy = SUCCESS.cut(
        answer.stock.kind,
        answer.stock.code,
        groupedMm(answer.stock.remaining_mm),
        groupedInches(answer.stock.remaining_mm),
      );
      if (answer.offcut !== null) copy += SUCCESS.cutOffcut(answer.offcut.code);
      announce(copy);
      this.activeClaimId = null;
      await this.load();
      if (answer.drawing_status === 'cut') window.dispatchEvent(new CustomEvent('boltrope:cut-finished'));
    } catch (cause) {
      if (cause instanceof ApiError) refuse(cause.message);
    }
  }

  /* -------------------------------------------------------------- Thread Lay */

  private layStartRect(panelNumber: number): DOMRect | null {
    const node = this.root.querySelector<HTMLElement>(`[data-outline="${panelNumber}"]`);
    return node === null ? null : node.getBoundingClientRect();
  }

  /**
   * The panel lifts, travels as one shape to the server's nest position, lands
   * with its number, and the remaining figures count to the new value.
   */
  private async threadLay(
    panel: Panel,
    xMm: number,
    yMm: number,
    from: DOMRect | null,
    afterLaidMm: number,
  ): Promise<void> {
    const before = this.lastRemaining;
    this.render();
    const target = this.root.querySelector<HTMLElement>(`[data-laid="${panel.number}"]`);
    const travel = durationOf(420);
    if (from !== null && target !== null && travel > 0) {
      const to = target.getBoundingClientRect();
      const flyer = el('div', { class: 'flyer', text: String(panel.number) });
      flyer.style.left = `${from.left}px`;
      flyer.style.top = `${from.top}px`;
      flyer.style.width = `${from.width}px`;
      flyer.style.height = `${from.height}px`;
      document.body.append(flyer);
      target.style.visibility = 'hidden';
      const lift = durationOf(120);
      flyer.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }], {
        duration: lift,
        easing: 'cubic-bezier(0.17,0.84,0.44,1)',
      });
      const animation = flyer.animate(
        [
          { transform: 'translate(0px, 0px) scale(1)' },
          {
            transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / Math.max(1, from.width)}, ${to.height / Math.max(1, from.height)})`,
          },
        ],
        { duration: travel, easing: 'cubic-bezier(0.17,0.84,0.44,1)', fill: 'forwards' },
      );
      await animation.finished.catch(() => undefined);
      flyer.remove();
      target.style.visibility = '';
    }
    this.countRemaining(before, afterLaidMm);
    this.lastRemaining = afterLaidMm;
    void xMm;
    void yMm;
  }

  private countRemaining(from: number, to: number): void {
    const figure = this.root.querySelector<HTMLElement>('[data-remaining-figure]');
    if (figure !== null) countTo(figure, from, to, (value) => lengthPair(value), 320);
    const meter = this.root.querySelector<HTMLElement>('[data-meter]');
    const active = this.active();
    if (meter !== null && active !== null) {
      meter.style.width = `${Math.max(0, Math.min(100, (to / Math.max(1, active.length_mm)) * 100))}%`;
    }
  }

  /* -------------------------------------------------------------- render */

  private stripScale(active: Claim, stock: Stock, innerWidth: number): number {
    return innerWidth / Math.max(1, active.length_mm);
  }

  private paintGhost(): void {
    const node = this.root.querySelector<HTMLElement>('[data-ghost]');
    const active = this.active();
    const panel = this.panel(this.selected);
    const readout = this.root.querySelector<HTMLElement>('[data-readout]');
    if (readout !== null && panel !== null) {
      readout.textContent = `x ${groupedMm(this.ghost.x)} mm (${groupedInches(this.ghost.x)} in) · y ${groupedMm(this.ghost.y)} mm (${groupedInches(this.ghost.y)} in) · ${this.ghost.rotation}°`;
    }
    if (node === null || active === null || panel === null || this.stock === null) return;
    const strip = this.root.querySelector<HTMLElement>('[data-strip-inner]');
    if (strip === null) return;
    const scale = this.stripScale(active, this.stock, strip.clientWidth);
    node.style.left = `${this.ghost.x * scale}px`;
    node.style.top = `${this.ghost.y * scale}px`;
    node.style.width = `${panel.length_mm * scale}px`;
    node.style.height = `${panel.width_mm * scale}px`;
    node.setAttribute('aria-label', `Placement of panel ${panel.number}`);
  }

  private drawingCanvas(): HTMLElement {
    const drawing = this.drawing as Drawing;
    const maxX = Math.max(1, ...drawing.panels.map((panel) => panel.length_mm));
    const maxY = Math.max(1, ...drawing.panels.map((panel) => panel.width_mm));
    const columns = Math.ceil(Math.sqrt(drawing.panels.length)) || 1;
    const cellW = maxX + 200;
    const cellH = maxY + 200;
    const rows = Math.ceil(drawing.panels.length / columns);
    const svg = svgEl('svg', {
      viewBox: `0 0 ${columns * cellW} ${rows * cellH}`,
      role: 'group',
      'aria-label': 'Sail drawing',
    });
    drawing.panels.forEach((panel, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const points = panel.outline.map(([x, y]) => `${x},${y}`).join(' ');
      const group = svgEl('g', { transform: `translate(${column * cellW + 100},${row * cellH + 100})` });
      const polygon = svgEl('polygon', {
        points,
        fill: 'none',
        stroke: '#ffffff',
        'stroke-width': 30,
        role: 'img',
        'aria-label': `Drawing panel ${panel.number}`,
        'data-outline': panel.number,
      });
      group.append(polygon);
      group.append(
        svgEl('text', { x: 60, y: maxY / 2, fill: '#ffffff', 'font-size': 420, 'text-anchor': 'start' }, [
          document.createTextNode(String(panel.number)),
        ]),
      );
      svg.append(group);
    });
    const node = el('div', { class: 'canvas' });
    node.append(svg);
    return node;
  }

  private rollStrip(): HTMLElement {
    const active = this.active();
    const wrap = el('div', { class: 'strip-wrap' });
    const region = el('div', { class: 'strip', role: 'region', 'aria-label': 'Roll strip' });
    const inner = el('div', { class: 'strip-inner', 'data-strip-inner': '' });
    region.append(inner);
    wrap.append(region);
    if (active === null || this.stock === null) {
      region.style.height = '120px';
      inner.append(el('div', { class: 'cloth' }));
      return wrap;
    }
    // The strip draws the hold's full claimed length across its full inner width,
    // at the same mm-to-pixel scale in both directions.
    const width = Math.max(240, this.root.clientWidth - 48);
    const scale = width / active.length_mm;
    const height = Math.max(60, Math.round(this.stock.usable_width_mm * scale));
    region.style.height = `${height + 10}px`;
    inner.style.width = `${width}px`;
    inner.style.height = `${height}px`;
    inner.append(el('div', { class: 'cloth' }));

    for (const lay of active.lays) {
      const panel = this.panel(lay.panel_number);
      if (panel === null) continue;
      const node = el('div', {
        class: 'laid',
        role: 'img',
        'aria-label': `Laid panel ${lay.panel_number}`,
        'data-laid': lay.panel_number,
        text: String(lay.panel_number),
      });
      node.style.left = `${lay.x_mm * scale}px`;
      node.style.top = `${lay.y_mm * scale}px`;
      node.style.width = `${panel.length_mm * scale}px`;
      node.style.height = `${panel.width_mm * scale}px`;
      inner.append(node);
    }

    if (this.stock.kind === 'offcut') {
      const outline = el('div', { class: 'offcut-outline' });
      outline.style.inset = '0';
      inner.append(outline);
    }

    if (this.selected !== null) {
      const ghost = el('div', { class: 'ghost', role: 'img', 'data-ghost': '' });
      inner.append(ghost);
    }

    const meter = el('div', { class: 'meter', 'data-meter': '' });
    meter.style.width = `${Math.max(0, Math.min(100, (this.stock.after_laid_mm / active.length_mm) * 100))}%`;
    inner.append(meter);

    this.attachTouch(region, inner, scale);
    return wrap;
  }

  /** Dragging a panel onto the strip lands it at the position under the finger. */
  private attachTouch(region: HTMLElement, inner: HTMLElement, scale: number): void {
    const place = (clientX: number, clientY: number): void => {
      const box = inner.getBoundingClientRect();
      const panel = this.panel(this.selected);
      if (panel === null) return;
      const x = Math.round((clientX - box.left) / scale - panel.length_mm / 2);
      const y = Math.round((clientY - box.top) / scale - panel.width_mm / 2);
      const next = this.clamp(x, y, this.ghost.rotation);
      this.ghost = { ...this.ghost, ...next };
      this.paintGhost();
    };
    region.addEventListener('dragover', (event) => {
      event.preventDefault();
      place(event.clientX, event.clientY);
    });
    region.addEventListener('drop', (event) => {
      event.preventDefault();
      const carried = event.dataTransfer?.getData('text/panel');
      if (carried !== undefined && carried !== '') this.selected = Number(carried);
      place(event.clientX, event.clientY);
      void this.lay();
    });
    region.addEventListener('pointerdown', (event) => {
      const onGhost = (event.target as HTMLElement).hasAttribute('data-ghost');
      if (!onGhost) return;
      region.setPointerCapture(event.pointerId);
      const move = (moved: PointerEvent): void => place(moved.clientX, moved.clientY);
      const up = (): void => {
        region.removeEventListener('pointermove', move);
        region.removeEventListener('pointerup', up);
      };
      region.addEventListener('pointermove', move);
      region.addEventListener('pointerup', up);
    });
  }

  private panelButtons(): HTMLElement {
    const drawing = this.drawing as Drawing;
    const unlaid = drawing.panels.filter((panel) => !panel.cut && panel.laid === null);
    const list = el('ul', { class: 'panellist', role: 'list', 'aria-label': 'Panels' });
    for (const panel of drawing.panels) {
      const button = el('button', {
        type: 'button',
        text: `Panel ${panel.number}`,
        'aria-pressed': this.selected === panel.number ? 'true' : 'false',
        draggable: 'true',
      });
      button.addEventListener('click', () => this.select(panel.number));
      button.addEventListener('dragstart', (event) => {
        this.selected = panel.number;
        event.dataTransfer?.setData('text/panel', String(panel.number));
      });
      list.append(el('li', {}, [button]));
    }
    if (currentLayout() !== 'phone') return list;

    const wrap = el('div');
    const toggle = el('button', {
      type: 'button',
      text: `Panels (${unlaid.length} unlaid)`,
      'aria-expanded': this.panelsOpen ? 'true' : 'false',
    });
    toggle.addEventListener('click', () => {
      this.panelsOpen = !this.panelsOpen;
      this.render();
      this.root.querySelector<HTMLElement>('[data-panels-toggle]')?.focus();
    });
    toggle.setAttribute('data-panels-toggle', '');
    wrap.append(toggle);
    // While collapsed the list is absent from the accessibility tree.
    if (this.panelsOpen) wrap.append(list);
    return wrap;
  }

  private remainingRegion(): HTMLElement {
    const region = el('div', { class: 'poster-field', role: 'region', 'aria-label': 'Roll remaining' });
    if (this.stock === null) {
      region.append(el('p', { class: 'quiet', text: 'No hold on this drawing.' }));
      return region;
    }
    const figure = poster(lengthPair(this.stock.after_laid_mm));
    figure.setAttribute('data-remaining-figure', '');
    region.append(figure);
    region.append(el('p', { text: areaPair(this.stock.on_hand_mm2) }));
    region.append(el('p', { text: `${this.offcutCount} offcuts` }));
    return region;
  }

  render(): void {
    if (this.drawing === null) return;
    const drawing = this.drawing;
    clear(this.root);

    const heading = el('h1', { text: `Nest ${drawing.code}`, tabindex: '-1' });
    this.root.append(heading);

    const region = el('div', { class: 'nesting', role: 'region', 'aria-label': 'Nesting', 'data-nesting': '' });
    region.append(this.drawingCanvas());

    const side = el('div', { class: 'nest-side' });
    side.append(this.panelButtons());

    const held = this.heldClaims();
    const holdSelect = el('select', { 'aria-label': 'Active hold' });
    for (const claim of held) {
      holdSelect.append(
        el('option', {
          value: claim.id,
          text: `${claim.stock_code} · lot ${this.stock?.lot ?? ''}`,
          selected: claim.id === this.activeClaimId,
        }),
      );
    }
    holdSelect.addEventListener('change', () => {
      this.activeClaimId = holdSelect.value;
      this.selected = null;
      void this.loadStock().then(() => {
        this.startCountdown();
        this.render();
      });
    });
    side.append(el('p', { class: 'field' }, [el('label', { for: 'active-hold', text: 'Active hold' }), holdSelect]));
    holdSelect.id = 'active-hold';

    const readout = el('div', { class: 'readout', role: 'group', 'aria-label': 'Placement' }, [
      el('span', { 'data-readout': '', text: 'x 0 mm (0.00 in) · y 0 mm (0.00 in) · 0°' }),
    ]);
    side.append(readout);

    const turn = el('button', { type: 'button', text: 'Turn 180°' });
    turn.addEventListener('click', () => this.turn());
    const lay = el('button', { class: 'action', type: 'button', text: 'Lay', 'data-lay': '' });
    lay.addEventListener('click', () => void this.lay());
    const undo = el('button', { type: 'button', text: 'Undo' });
    undo.addEventListener('click', () => void this.undo());
    const claimOpen = el('button', { type: 'button', text: 'Claim length', 'data-claim-open': '' });
    claimOpen.addEventListener('click', () => void this.claimLength());
    const cut = el('button', { type: 'button', text: 'Confirm cut' });
    cut.addEventListener('click', () => void this.confirmCut());
    const releaseButton = el('button', { type: 'button', text: 'Release hold' });
    releaseButton.addEventListener('click', () => void this.release());
    side.append(el('div', { class: 'controls' }, [turn, lay, undo, claimOpen, cut, releaseButton]));

    const active = this.active();
    const timerNode = el('p', { role: 'timer', 'aria-label': 'Hold' });
    if (active !== null && active.status === 'held') {
      timerNode.setAttribute('data-timer', '');
      timerNode.textContent = `Hold ends in ${minutesSeconds(this.secondsLeft())}`;
    } else if (active !== null) {
      timerNode.append(chip(STATUS_CHIP_LABELS.lapsed, true));
    }
    side.append(timerNode);
    region.append(side);
    region.append(this.rollStrip());
    this.root.append(region);
    this.root.append(this.remainingRegion());
    this.paintGhost();
    void this.withRail;
  }
}

function minutesSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
