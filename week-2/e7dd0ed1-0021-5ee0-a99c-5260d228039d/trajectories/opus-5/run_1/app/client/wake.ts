import { formatCount } from '../src/format';
import { project } from '../src/worldmap';
import { dotGridSvg } from './worldstrip';
import { prefersReducedMotion, replace, svgEl } from './dom';
import { readiness, replicaCopy } from './copy';

export interface Replica {
  region: string;
  role: 'origin' | 'replica';
  state: 'pending' | 'settled' | 'failed' | 'superseded';
  attempts: number;
  settled_at: string | null;
  settle_ms: number | null;
  error: string | null;
}

export interface ReplicaView {
  version_id: string;
  etag: string;
  acknowledged_at: string;
  ready: boolean;
  replicas: Replica[];
}

export interface RegionInfo {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

const WIDTH = 420;
const HEIGHT = 190;

interface Pins {
  pin: SVGElement;
  line: SVGElement | null;
  numeral: SVGElement;
  label: SVGElement;
  glyph: SVGElement;
}

/** The Replica Wake: pins, wake lines and counting numerals driven only by replica records. */
export class ReplicaWake {
  private readonly pins = new Map<string, Pins>();
  private readonly shown = new Map<string, Replica>();
  private queue: { region: string; settleMs: number; settledAt: number; order: number }[] = [];
  private playing = false;
  private versionId: string | null = null;

  constructor(
    private readonly figure: HTMLElement,
    private readonly list: HTMLElement,
    private readonly announcements: HTMLElement,
    private readonly readinessStatus: HTMLElement,
    private readonly regions: RegionInfo[],
    private readonly placement: string[],
    private readonly onRetry: (region: string) => void,
    private readonly canRetry: boolean,
  ) {}

  mount(): void {
    const svg = svgEl('svg', {
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      class: 'replica-map',
      'aria-hidden': 'true',
      preserveAspectRatio: 'xMidYMid meet',
    });
    svg.append(dotGridSvg(WIDTH, HEIGHT, 6));
    const origin = this.placement[0];
    const originPoint = this.pointOf(origin);
    for (const region of this.placement) {
      const point = this.pointOf(region);
      const group = svgEl('g', { class: 'pin-group' });
      let line: SVGElement | null = null;
      if (region !== origin) {
        line = svgEl('line', {
          x1: originPoint.x,
          y1: originPoint.y,
          x2: originPoint.x,
          y2: originPoint.y,
          class: 'wake-line',
        });
        line.setAttribute('data-wake', region);
        line.setAttribute('data-progress', '0.00');
        group.append(line);
      }
      const pin = svgEl('circle', { cx: point.x, cy: point.y, r: 5, class: 'pin' });
      pin.setAttribute('data-region', region);
      pin.setAttribute('data-state', region === origin ? 'origin' : 'pending');
      const glyph = svgEl('text', { x: point.x, y: point.y + 3, class: 'pin-glyph', 'text-anchor': 'middle' });
      const label = svgEl('text', { x: point.x + 9, y: point.y - 3, class: 'pin-label' });
      label.textContent = `${this.nameOf(region)}${region === origin ? ' origin' : ' pending'}`;
      const numeral = svgEl('text', { x: point.x + 9, y: point.y + 10, class: 'pin-numeral' });
      numeral.setAttribute('data-numeral', region);
      numeral.textContent = region === origin ? '0 ms' : '';
      group.append(pin, glyph, label, numeral);
      svg.append(group);
      this.pins.set(region, { pin, line, numeral, label, glyph });
    }
    replace(this.figure, [svg, document.createElement('figcaption')]);
    const caption = this.figure.querySelector('figcaption');
    if (caption) caption.textContent = 'Replica map';
  }

  private pointOf(region: string): { x: number; y: number } {
    const found = this.regions.find((candidate) => candidate.id === region);
    if (!found) return { x: WIDTH / 2, y: HEIGHT / 2 };
    return project(found.lon, found.lat, WIDTH, HEIGHT);
  }

  private nameOf(region: string): string {
    return this.regions.find((candidate) => candidate.id === region)?.name ?? region;
  }

  /** Applies a server answer: resets on a new version, queues settles, applies the rest at once. */
  update(view: ReplicaView, reason: 'load' | 'poll' | 'new' | 'restored'): void {
    const fresh = this.versionId !== view.version_id;
    if (fresh) {
      const first = this.versionId === null;
      this.versionId = view.version_id;
      this.queue = [];
      this.shown.clear();
      for (const replica of view.replicas) {
        if (replica.role === 'origin') {
          this.shown.set(replica.region, replica);
          this.paint(replica, 0);
          continue;
        }
        this.shown.set(replica.region, { ...replica, state: 'pending', settle_ms: null, settled_at: null });
        this.paint({ ...replica, state: 'pending', settle_ms: null, settled_at: null }, null);
      }
      if (!first || reason === 'new' || reason === 'restored') {
        const pending = view.replicas.filter((replica) => replica.role !== 'origin').length;
        this.announce(
          reason === 'restored'
            ? replicaCopy.restored(view.version_id, pending)
            : replicaCopy.newVersion(view.version_id, pending),
        );
      }
      if (reason === 'load') {
        for (const replica of view.replicas) {
          if (replica.role === 'origin' || replica.state !== 'settled') continue;
          this.shown.set(replica.region, replica);
          this.paint(replica, replica.settle_ms ?? 0);
        }
      }
      this.renderList();
      this.renderReadiness(view);
      if (reason !== 'load') this.applyUpdates(view);
      return;
    }
    this.applyUpdates(view);
    this.renderReadiness(view);
  }

  private applyUpdates(view: ReplicaView): void {
    const settles: { region: string; settleMs: number; settledAt: number; order: number }[] = [];
    for (const replica of view.replicas) {
      if (replica.role === 'origin') continue;
      const shown = this.shown.get(replica.region);
      if (shown && shown.state === replica.state) continue;
      if (replica.state === 'settled') {
        if (this.queue.some((entry) => entry.region === replica.region)) continue;
        settles.push({
          region: replica.region,
          settleMs: replica.settle_ms ?? 0,
          settledAt: replica.settled_at === null ? 0 : new Date(replica.settled_at).getTime(),
          order: this.placement.indexOf(replica.region),
        });
        continue;
      }
      this.shown.set(replica.region, replica);
      this.paint(replica, null);
      if (replica.state === 'failed') this.announce(replicaCopy.failed(this.nameOf(replica.region)));
      if (replica.state === 'pending' && shown && shown.state === 'failed') {
        this.announce(replicaCopy.retrying(this.nameOf(replica.region)));
      }
      this.renderList();
    }
    if (settles.length === 0) return;
    settles.sort((left, right) => (left.settledAt === right.settledAt ? left.order - right.order : left.settledAt - right.settledAt));
    this.queue.push(...settles);
    void this.playQueue(view);
  }

  private async playQueue(view: ReplicaView): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    const versionAtStart = this.versionId;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      if (this.versionId !== versionAtStart) break;
      await this.playWake(next.region, next.settleMs);
      this.renderList();
      this.renderReadiness(view);
    }
    this.playing = false;
  }

  private async playWake(region: string, settleMs: number): Promise<void> {
    const pins = this.pins.get(region);
    if (!pins) return;
    const target = this.pointOf(region);
    const origin = this.pointOf(this.placement[0]);
    const settle = (): void => {
      pins.pin.setAttribute('data-state', 'settled');
      pins.label.textContent = this.nameOf(region);
      const replica = this.shown.get(region);
      this.shown.set(region, {
        region,
        role: 'replica',
        state: 'settled',
        attempts: replica?.attempts ?? 1,
        settled_at: new Date().toISOString(),
        settle_ms: settleMs,
        error: null,
      });
      pins.glyph.textContent = '';
      this.renderList();
      this.announce(replicaCopy.settled(this.nameOf(region), settleMs));
    };
    if (prefersReducedMotion()) {
      if (pins.line) {
        pins.line.setAttribute('data-progress', '1.00');
        pins.line.setAttribute('x2', String(target.x));
        pins.line.setAttribute('y2', String(target.y));
      }
      settle();
      pins.numeral.textContent = `${formatCount(settleMs)} ms`;
      return;
    }
    await this.animate(333, (fraction) => {
      if (!pins.line) return;
      pins.line.setAttribute('data-progress', fraction.toFixed(2));
      pins.line.setAttribute('x2', String(origin.x + (target.x - origin.x) * fraction));
      pins.line.setAttribute('y2', String(origin.y + (target.y - origin.y) * fraction));
    });
    settle();
    await this.animate(200, (fraction) => {
      pins.pin.setAttribute('r', String(3 + 2 * fraction));
    });
    await this.animate(560, (fraction) => {
      pins.numeral.textContent = `${formatCount(Math.round(settleMs * fraction))} ms`;
    });
    pins.numeral.textContent = `${formatCount(settleMs)} ms`;
  }

  private animate(duration: number, step: (fraction: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number): void => {
        const fraction = Math.min(1, (now - start) / duration);
        step(1 - (1 - fraction) * (1 - fraction));
        if (fraction < 1) {
          requestAnimationFrame(frame);
          return;
        }
        step(1);
        resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  private paint(replica: Replica, settleMs: number | null): void {
    const pins = this.pins.get(replica.region);
    if (!pins) return;
    const isOrigin = replica.role === 'origin';
    const state = isOrigin ? 'origin' : replica.state === 'superseded' ? 'pending' : replica.state;
    pins.pin.setAttribute('data-state', state);
    pins.glyph.textContent = state === 'failed' ? '\u2715' : '';
    pins.label.textContent =
      state === 'origin'
        ? `${this.nameOf(replica.region)} origin`
        : state === 'pending'
          ? `${this.nameOf(replica.region)} pending`
          : state === 'failed'
            ? `${this.nameOf(replica.region)} failed`
            : this.nameOf(replica.region);
    if (pins.line) {
      const drawn = state === 'settled';
      const target = this.pointOf(replica.region);
      const origin = this.pointOf(this.placement[0]);
      pins.line.setAttribute('data-progress', drawn ? '1.00' : '0.00');
      pins.line.setAttribute('x2', String(drawn ? target.x : origin.x));
      pins.line.setAttribute('y2', String(drawn ? target.y : origin.y));
    }
    pins.numeral.textContent = settleMs === null ? '' : `${formatCount(settleMs)} ms`;
  }

  private renderList(): void {
    const items = this.placement.map((region) => {
      const replica = this.shown.get(region);
      const name = this.nameOf(region);
      if (!replica) return `${name}: pending`;
      if (replica.role === 'origin') return `${name}: origin, settled`;
      if (replica.state === 'settled') return `${name}: settled in ${formatCount(replica.settle_ms ?? 0)} ms`;
      if (replica.state === 'failed') return `${name}: failed`;
      return `${name}: pending`;
    });
    const nodes = items.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    });
    replace(this.list, nodes);
    this.renderRetryButtons();
  }

  private renderRetryButtons(): void {
    const holder = this.figure.parentElement?.querySelector('[data-retry-holder]');
    if (!holder) return;
    const failed = this.placement.filter((region) => this.shown.get(region)?.state === 'failed');
    replace(
      holder,
      this.canRetry
        ? failed.map((region) => {
            const node = document.createElement('button');
            node.type = 'button';
            node.textContent = 'Retry';
            node.setAttribute('aria-label', `Retry ${this.nameOf(region)}`);
            node.setAttribute('data-focus-key', `retry:${region}`);
            node.addEventListener('click', () => this.onRetry(region));
            return node;
          })
        : [],
    );
  }

  private renderReadiness(view: ReplicaView): void {
    const placed = this.placement.length;
    const states = this.placement.map((region) => this.shown.get(region)?.state ?? 'pending');
    const failed = states.filter((state) => state === 'failed').length;
    const settled = states.filter((state) => state === 'settled').length;
    const text =
      failed > 0
        ? readiness.failed(failed)
        : settled === placed
          ? readiness.ready(placed, view.version_id)
          : readiness.waiting(placed - settled, placed);
    if (this.readinessStatus.textContent !== text) this.readinessStatus.textContent = text;
  }

  private announce(text: string): void {
    this.announcements.textContent = text;
  }
}
