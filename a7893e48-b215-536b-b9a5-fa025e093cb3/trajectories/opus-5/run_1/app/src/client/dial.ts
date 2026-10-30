import type { DaySegment, DayStation, DayView, SegmentState } from '../shared/types.js';
import { STATE_WORD, copy, hours } from './copy.js';
import { clear, el, svg } from './dom.js';
import { DURATION, animate, reducedMotion } from './motion.js';

const QUARTER = 15;
const MAX_SELECTION_MINUTES = 12 * 60;
const CENTRE = 500;
const COUNTDOWN_OUTER = 492;
const COUNTDOWN_INNER = 480;
const TICK_OUTER = 474;
const TICK_INNER = 460;
const TICK_LABEL_RADIUS = 436;
const OUTER_RADIUS = 406;
const INNER_RADIUS = 196;
const RING_GAP = 6;
const MAX_OVERSHOOT_DEGREES = 6;

export interface Selection {
  stationId: string;
  startMinute: number;
  endMinute: number;
}

export interface DialHold {
  startMinute: number;
  createdAt: number;
  expiresAt: number;
}

export interface DialHandlers {
  onSelection: (selection: Selection | null) => void;
  onPlace: (selection: Selection) => void;
  onAnnounce: (message: string) => void;
  claimRefusal: () => string | null;
}

interface Interval {
  startMinute: number;
  endMinute: number;
  segment: DaySegment;
}

interface RingGeometry {
  station: DayStation;
  outer: number;
  inner: number;
}

function polar(radius: number, degrees: number): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: CENTRE + radius * Math.cos(radians), y: CENTRE + radius * Math.sin(radians) };
}

function annulusPath(from: number, to: number, inner: number, outer: number): string {
  const sweep = to - from;
  if (sweep <= 0) return '';
  if (sweep >= 359.999) {
    const half = from + 180;
    return [
      annulusPath(from, half, inner, outer),
      annulusPath(half, from + 360, inner, outer),
    ].join(' ');
  }
  const large = sweep > 180 ? 1 : 0;
  const outerStart = polar(outer, from);
  const outerEnd = polar(outer, to);
  const innerEnd = polar(inner, to);
  const innerStart = polar(inner, from);
  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export class StationDial {
  readonly element: HTMLElement;

  private frame = svg('svg', {
    viewBox: '0 0 1000 1000',
    class: 'dial-svg',
    'aria-hidden': 'true',
  });

  private handleLayer = el('div', { class: 'ring-handles' });

  private calloutList = el('ul', { class: 'dial-callouts', 'aria-label': 'Dial segment labels' });

  private day: DayView | null = null;

  private stations: DayStation[] = [];

  private selection: Selection | null = null;

  private hold: DialHold | null = null;

  private focusedIndex = 0;

  private dragging: { stationId: string; anchor: number; moved: boolean } | null = null;

  private overshootDegrees = 0;

  private fillOnNextRender = false;

  private blockerNote: { minute: number; state: SegmentState; stationId: string } | null = null;

  private sliders = new Map<string, HTMLElement>();

  private countdownTimer: number | null = null;

  constructor(private readonly handlers: DialHandlers) {
    this.element = el('div', { class: 'dial', role: 'group', 'aria-label': 'Station dial' }, [
      this.frame,
      this.handleLayer,
      this.calloutList,
    ]);
    this.frame.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', () => this.onPointerUp());
  }

  setDay(day: DayView): void {
    this.day = day;
    this.stations = day.stations;
    if (this.selection !== null && !this.stations.some((station) => station.id === this.selection?.stationId)) {
      this.selection = null;
    }
    this.render();
  }

  setHold(hold: DialHold | null): void {
    this.fillOnNextRender = hold !== null;
    this.hold = hold;
    if (hold === null && this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.render();
    if (hold !== null) this.startCountdown();
  }

  setSelection(selection: Selection | null): void {
    this.selection = selection;
    this.render();
  }

  focusStation(stationId: string): void {
    const index = this.stations.findIndex((station) => station.id === stationId);
    if (index === -1) return;
    this.focusedIndex = index;
    this.sliders.get(stationId)?.focus();
  }

  /** Retracts a refused claim along the path it was drawn, then clears it. */
  retractSelection(onDone?: () => void): void {
    const selection = this.selection;
    if (selection === null) {
      onDone?.();
      return;
    }
    const length = selection.endMinute - selection.startMinute;
    animate(
      DURATION.large,
      (progress) => {
        this.selection = {
          ...selection,
          endMinute: selection.startMinute + Math.round(length * (1 - progress)),
        };
        this.render();
      },
      () => {
        this.selection = null;
        this.render();
        onDone?.();
      },
    );
  }

  private dayMinutes(): number {
    return this.day === null ? 1440 : this.day.hours * 60;
  }

  private dayStartMs(): number {
    const first = this.day?.ticks[0];
    return first === undefined ? 0 : Date.parse(first.at);
  }

  private degreesPerMinute(): number {
    return 360 / this.dayMinutes();
  }

  localLabel(minute: number): string {
    if (this.day === null) return '00:00';
    const instant = this.dayStartMs() + minute * 60_000;
    const ticks = this.day.ticks;
    let index = 0;
    for (let probe = 0; probe < ticks.length; probe += 1) {
      if (Date.parse((ticks[probe] as { at: string }).at) <= instant) index = probe;
    }
    const tick = ticks[index] as { at: string; label: string };
    const into = Math.round((instant - Date.parse(tick.at)) / 60_000);
    const [hour] = tick.label.split(':') as [string, string];
    const carriedHour = (Number(hour) + Math.floor(into / 60)) % 24;
    return `${String(carriedHour).padStart(2, '0')}:${String(into % 60).padStart(2, '0')}`;
  }

  instantAt(minute: number): string {
    return new Date(this.dayStartMs() + minute * 60_000).toISOString();
  }

  private intervalsOf(station: DayStation): Interval[] {
    const dayStart = this.dayStartMs();
    const total = this.dayMinutes();
    return station.segments.map((segment) => ({
      segment,
      startMinute: Math.max(0, Math.round((Date.parse(segment.start_at) - dayStart) / 60_000)),
      endMinute: Math.min(total, Math.round((Date.parse(segment.end_at) - dayStart) / 60_000)),
    }));
  }

  private geometry(): RingGeometry[] {
    const count = Math.max(1, this.stations.length);
    const thickness = (OUTER_RADIUS - INNER_RADIUS) / count;
    return this.stations.map((station, index) => ({
      station,
      outer: OUTER_RADIUS - index * thickness,
      inner: OUTER_RADIUS - (index + 1) * thickness + RING_GAP,
    }));
  }

  private snap(minute: number): number {
    const total = this.dayMinutes();
    return Math.min(total, Math.max(0, Math.round(minute / QUARTER) * QUARTER));
  }

  private minuteFromEvent(event: PointerEvent): number {
    const matrix = this.frame.getScreenCTM();
    if (matrix === null) return 0;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const degrees = (Math.atan2(point.y - CENTRE, point.x - CENTRE) * 180) / Math.PI + 90;
    const normalised = (degrees + 360) % 360;
    return normalised / this.degreesPerMinute();
  }

  private occupiedAt(station: DayStation, minute: number): Interval | null {
    return (
      this.intervalsOf(station).find(
        (interval) => minute >= interval.startMinute && minute < interval.endMinute,
      ) ?? null
    );
  }

  private onPointerDown(event: PointerEvent): void {
    const target = event.target as Element | null;
    const stationId = target?.getAttribute('data-station');
    if (stationId === null || stationId === undefined) return;
    const station = this.stations.find((entry) => entry.id === stationId);
    if (station === undefined) return;
    event.preventDefault();
    this.focusStation(stationId);
    const refusal = this.handlers.claimRefusal();
    if (refusal !== null) {
      this.handlers.onAnnounce(refusal);
      return;
    }
    const raw = this.minuteFromEvent(event);
    const occupied = this.occupiedAt(station, raw);
    if (occupied !== null) {
      this.handlers.onAnnounce(occupied.segment.label);
      return;
    }
    const anchor = this.snap(raw);
    this.dragging = { stationId, anchor, moved: false };
    this.blockerNote = null;
    this.selection = { stationId, startMinute: anchor, endMinute: anchor + QUARTER };
    this.handlers.onSelection(this.selection);
    this.render();
  }

  private onPointerMove(event: PointerEvent): void {
    const dragging = this.dragging;
    if (dragging === null) return;
    const station = this.stations.find((entry) => entry.id === dragging.stationId);
    if (station === undefined) return;
    const current = this.snap(this.minuteFromEvent(event));
    const anchor = dragging.anchor;
    let next: Selection;
    if (current >= anchor + QUARTER) {
      next = { stationId: station.id, startMinute: anchor, endMinute: current };
    } else if (current <= anchor - QUARTER) {
      next = { stationId: station.id, startMinute: current, endMinute: anchor + QUARTER };
    } else {
      next = { stationId: station.id, startMinute: anchor, endMinute: anchor + QUARTER };
    }
    if (next.startMinute !== anchor || next.endMinute !== anchor + QUARTER) dragging.moved = true;
    this.applyLimits(station, next, current > anchor ? 'forward' : 'back');
  }

  private applyLimits(station: DayStation, wanted: Selection, direction: 'forward' | 'back'): void {
    const intervals = this.intervalsOf(station);
    let { startMinute, endMinute } = wanted;
    let blocker: Interval | null = null;
    for (const interval of intervals) {
      if (interval.startMinute >= endMinute || interval.endMinute <= startMinute) continue;
      blocker = interval;
      if (direction === 'forward') {
        endMinute = Math.max(startMinute + QUARTER, interval.startMinute);
      } else {
        startMinute = Math.min(endMinute - QUARTER, interval.endMinute);
      }
    }
    if (endMinute - startMinute > MAX_SELECTION_MINUTES) {
      if (direction === 'forward') endMinute = startMinute + MAX_SELECTION_MINUTES;
      else startMinute = endMinute - MAX_SELECTION_MINUTES;
    }
    this.selection = { stationId: station.id, startMinute, endMinute };
    this.handlers.onSelection(this.selection);
    if (blocker !== null) {
      const boundary = direction === 'forward' ? blocker.startMinute : blocker.endMinute;
      this.blockerNote = { minute: boundary, state: blocker.segment.state, stationId: station.id };
      this.handlers.onAnnounce(copy.dragBlocked(blocker.segment.label));
      this.springBack();
      return;
    }
    this.blockerNote = null;
    this.render();
  }

  private springBack(): void {
    if (reducedMotion()) {
      this.overshootDegrees = 0;
      this.render();
      return;
    }
    animate(
      DURATION.large,
      (progress) => {
        this.overshootDegrees = MAX_OVERSHOOT_DEGREES * (1 - progress);
        this.render();
      },
      () => {
        this.overshootDegrees = 0;
        this.render();
      },
    );
  }

  private onPointerUp(): void {
    const dragging = this.dragging;
    if (dragging === null) return;
    this.dragging = null;
    const selection = this.selection;
    if (selection === null) return;
    if (!dragging.moved) {
      this.selection = null;
      this.handlers.onSelection(null);
      this.render();
      return;
    }
    this.handlers.onPlace(selection);
  }

  private onSliderKey(event: KeyboardEvent, station: DayStation): void {
    const keys = ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Enter', 'Escape'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      this.selection = null;
      this.handlers.onSelection(null);
      this.handlers.onAnnounce(copy.noSelection);
      this.render();
      return;
    }
    if (event.key === 'Enter') {
      if (this.selection !== null && this.selection.stationId === station.id) {
        this.handlers.onPlace(this.selection);
      }
      return;
    }
    const refusal = this.handlers.claimRefusal();
    if (refusal !== null) {
      this.handlers.onAnnounce(refusal);
      return;
    }
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const current =
      this.selection !== null && this.selection.stationId === station.id
        ? this.selection
        : { stationId: station.id, startMinute: this.firstFreeMinute(station), endMinute: 0 };
    const start = current.endMinute === 0 ? current.startMinute : current.startMinute;
    const length =
      current.endMinute === 0 ? QUARTER : Math.max(QUARTER, current.endMinute - current.startMinute);
    let wanted: Selection;
    if (event.shiftKey) {
      const nextLength = Math.max(QUARTER, length + (forward ? QUARTER : -QUARTER));
      wanted = { stationId: station.id, startMinute: start, endMinute: start + nextLength };
    } else {
      const shift = current.endMinute === 0 ? 0 : forward ? QUARTER : -QUARTER;
      const nextStart = Math.max(0, Math.min(this.dayMinutes() - length, start + shift));
      wanted = { stationId: station.id, startMinute: nextStart, endMinute: nextStart + length };
    }
    this.applyLimits(station, wanted, forward ? 'forward' : 'back');
    this.handlers.onAnnounce(this.valueText(station));
  }

  private firstFreeMinute(station: DayStation): number {
    const intervals = this.intervalsOf(station);
    for (let minute = 0; minute + QUARTER <= this.dayMinutes(); minute += QUARTER) {
      const clash = intervals.some(
        (interval) => minute < interval.endMinute && minute + QUARTER > interval.startMinute,
      );
      if (!clash) return minute;
    }
    return 0;
  }

  valueText(station: DayStation): string {
    const selection = this.selection;
    if (selection === null || selection.stationId !== station.id) return copy.noSelection;
    return `Selection ${this.localLabel(selection.startMinute)}–${this.localLabel(selection.endMinute)}, ${hours(selection.endMinute - selection.startMinute)} h`;
  }

  private startCountdown(): void {
    if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
    this.countdownTimer = window.setInterval(() => {
      if (this.hold === null) return;
      this.renderCountdown();
    }, 1000);
  }

  private renderCountdown(): void {
    const ring = this.frame.querySelector('.countdown-ring');
    const hold = this.hold;
    if (ring === null || hold === null) return;
    if (reducedMotion()) {
      ring.setAttribute('d', '');
      return;
    }
    const life = hold.expiresAt - hold.createdAt;
    const left = Math.max(0, hold.expiresAt - Date.now());
    const from = hold.startMinute * this.degreesPerMinute();
    const sweep = 360 * (left / life);
    ring.setAttribute('d', annulusPath(from, from + sweep, COUNTDOWN_INNER, COUNTDOWN_OUTER));
  }

  /** The ring's keyboard handle: the accessible slider for that station. */
  private ringHandle(ring: RingGeometry): HTMLElement {
    const selection = this.selection;
    const atMinute =
      selection !== null && selection.stationId === ring.station.id ? selection.startMinute : 0;
    const point = polar((ring.inner + ring.outer) / 2, atMinute * this.degreesPerMinute());
    const handle = el('div', {
      role: 'slider',
      tabindex: 0,
      class: 'ring-handle',
      'aria-label': ring.station.name,
      'aria-valuemin': 0,
      'aria-valuemax': this.dayMinutes(),
      'aria-valuenow': atMinute,
      'aria-valuetext': this.valueText(ring.station),
      style: `left:${(point.x / 10).toFixed(2)}%;top:${(point.y / 10).toFixed(2)}%`,
    });
    handle.addEventListener('keydown', (event) => this.onSliderKey(event, ring.station));
    handle.addEventListener('focus', () => {
      this.focusedIndex = this.stations.findIndex((station) => station.id === ring.station.id);
    });
    this.sliders.set(ring.station.id, handle);
    return handle;
  }

  render(): void {
    if (this.day === null) return;
    const active = document.activeElement;
    const activeStation =
      active instanceof HTMLElement ? active.getAttribute('aria-label') : null;
    clear(this.frame);
    clear(this.handleLayer);
    clear(this.calloutList);
    const defs = svg('defs', {}, [
      svg(
        'pattern',
        {
          id: 'booked-hatch',
          width: 12,
          height: 12,
          patternUnits: 'userSpaceOnUse',
          patternTransform: 'rotate(45)',
        },
        [
          svg('rect', { width: 12, height: 12, class: 'hatch-ground' }),
          svg('line', { x1: 0, y1: 0, x2: 0, y2: 12, class: 'hatch-line' }),
        ],
      ),
    ]);
    this.frame.append(defs);
    this.frame.append(
      svg('path', { class: 'countdown-ring', d: '', 'aria-hidden': 'true' }),
    );
    this.drawTicks();
    const geometry = this.geometry();
    for (const ring of geometry) this.drawRing(ring);
    this.fillOnNextRender = false;
    this.renderCountdown();
    if (activeStation !== null && active?.classList.contains('ring-handle') === true) {
      const station = this.stations.find((entry) => entry.name === activeStation);
      if (station !== undefined) this.sliders.get(station.id)?.focus();
    }
  }

  private drawTicks(): void {
    const degrees = this.degreesPerMinute();
    const day = this.day;
    if (day === null) return;
    const group = svg('g', { class: 'dial-ticks' });
    day.ticks.forEach((tick, index) => {
      const minute = index * 60;
      const angle = minute * degrees;
      const outer = polar(TICK_OUTER, angle);
      const inner = polar(TICK_INNER, angle);
      group.append(
        svg('line', {
          x1: inner.x.toFixed(2),
          y1: inner.y.toFixed(2),
          x2: outer.x.toFixed(2),
          y2: outer.y.toFixed(2),
          class: 'dial-tick',
        }),
      );
      const repeatedHour = day.ticks.filter((entry) => entry.label === tick.label).length > 1;
      if (index % 3 === 0 || repeatedHour) {
        const label = polar(TICK_LABEL_RADIUS, angle);
        group.append(
          svg(
            'text',
            {
              x: label.x.toFixed(2),
              y: label.y.toFixed(2),
              class: 'dial-tick-label mono',
              'text-anchor': 'middle',
              'dominant-baseline': 'middle',
            },
            [repeatedHour || index === 0 ? `${tick.label} ${tick.zone}` : tick.label],
          ),
        );
      }
    });
    this.frame.append(group);
  }

  private drawRing(ring: RingGeometry): void {
    const degrees = this.degreesPerMinute();
    const group = svg('g', { class: 'dial-ring', 'data-station-ring': ring.station.id });
    group.append(
      svg('path', {
        class: this.stations.indexOf(ring.station) % 2 === 0 ? 'ring-free' : 'ring-free sunk',
        d: annulusPath(0, 360, ring.inner, ring.outer),
        'data-station': ring.station.id,
      }),
    );
    for (let hour = 0; hour < (this.day?.ticks.length ?? 24); hour += 1) {
      const angle = hour * 60 * degrees;
      const from = polar(ring.inner + 2, angle);
      const to = polar(ring.inner + (hour % 3 === 0 ? 16 : 9), angle);
      group.append(
        svg('line', {
          x1: from.x.toFixed(2),
          y1: from.y.toFixed(2),
          x2: to.x.toFixed(2),
          y2: to.y.toFixed(2),
          class: 'ring-hour-mark',
        }),
      );
    }
    for (const interval of this.intervalsOf(ring.station)) {
      const from = interval.startMinute * degrees;
      const to = interval.endMinute * degrees;
      group.append(
        svg('path', {
          class: `ring-segment state-${interval.segment.state}`,
          d: annulusPath(from, to, ring.inner, ring.outer),
          'data-station': ring.station.id,
        }),
      );
      const midRadius = (ring.inner + ring.outer) / 2;
      const arcLength = ((to - from) / 360) * 2 * Math.PI * midRadius;
      if (arcLength > interval.segment.label.length * 10) {
        const pathId = `arc-${ring.station.id}-${interval.startMinute}`;
        const start = polar(midRadius, from);
        const finish = polar(midRadius, to);
        this.frame.append(
          svg('path', {
            id: pathId,
            class: 'label-track',
            d: `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${midRadius} ${midRadius} 0 ${to - from > 180 ? 1 : 0} 1 ${finish.x.toFixed(2)} ${finish.y.toFixed(2)}`,
          }),
        );
        const text = svg('text', { class: 'ring-label mono' });
        const along = svg(
          'textPath',
          { href: `#${pathId}`, startOffset: '50%', 'text-anchor': 'middle' },
          [interval.segment.label],
        );
        text.append(along);
        group.append(text);
      }
      this.calloutList.append(
        el('li', { class: `callout state-${interval.segment.state}` }, [
          el('span', { class: 'callout-station' }, [ring.station.name]),
          el('span', { class: 'callout-label mono' }, [interval.segment.label]),
          ...(interval.segment.renter_business === null
            ? []
            : [el('span', { class: 'callout-business' }, [interval.segment.renter_business])]),
        ]),
      );
    }
    const selection = this.selection;
    if (selection !== null && selection.stationId === ring.station.id) {
      const from = selection.startMinute * degrees;
      const to = selection.endMinute * degrees + this.overshootDegrees;
      const arc = svg('path', {
        class: this.hold === null ? 'ring-selection' : 'ring-selection placed',
        d: annulusPath(from, to, ring.inner, ring.outer),
        'data-station': ring.station.id,
      });
      group.append(arc);
      if (this.fillOnNextRender && this.hold !== null && !reducedMotion()) {
        arc.animate([{ fillOpacity: 0 }, { fillOpacity: 1 }], {
          duration: DURATION.large,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    }
    const note = this.blockerNote;
    if (note !== null && note.stationId === ring.station.id) {
      const point = polar((ring.inner + ring.outer) / 2, note.minute * degrees);
      group.append(
        svg(
          'text',
          {
            x: point.x.toFixed(2),
            y: point.y.toFixed(2),
            class: 'blocker-note mono',
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
          },
          [`${STATE_WORD[note.state]} ${this.localLabel(note.minute)}`],
        ),
      );
    }
    this.frame.append(group);
    this.handleLayer.append(this.ringHandle(ring));
  }

  focusedStationId(): string | null {
    return this.stations[this.focusedIndex]?.id ?? null;
  }
}
