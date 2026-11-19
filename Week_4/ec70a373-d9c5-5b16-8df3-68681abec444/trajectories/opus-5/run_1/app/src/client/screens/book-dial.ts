import { button, el, prefersReducedMotion, setText, svg } from '../dom';
import {
  DIAL_SIZE,
  arcPath,
  claimLabel,
  degreesFor,
  dialPatterns,
  minutesFromPoint,
  ringFurniture,
  sectorClass,
  sectorLabel,
  snapToStep,
} from '../dial';
import { countdown, countdownMinutes, hours } from '../copy';
import { icon } from '../icons';
import { minutesToWall } from '../../shared/tz';
import {
  SANITATION_BUFFER_MINUTES,
  type AvailabilitySector,
  type AvailabilityStation,
} from '../../shared/types';

const OCCUPIED: AvailabilitySector['kind'][] = [
  'booked',
  'buffer',
  'own_held',
  'own_confirmed',
  'nonexistent',
];
const BLOCKS_BUFFER: AvailabilitySector['kind'][] = [
  'booked',
  'buffer',
  'own_held',
  'own_confirmed',
];

export interface DialCallbacks {
  /** Elapsed quarter hours of a window, worked out in the site's time zone. */
  quartersFor(startMinutes: number, endMinutes: number): number;
  availableQuarters(): number;
  isBusy(): boolean;
  onClaim(dial: Dial): void;
  onConfirm(dial: Dial): void;
  onRelease(dial: Dial): void;
  onRepeatWeekly(dial: Dial): void;
  serverNow(): number;
}

interface Span {
  start: number;
  end: number;
}

function toMinutes(wall: string): number {
  const [hour, minute] = wall.split(':');
  return Number.parseInt(hour as string, 10) * 60 + Number.parseInt(minute as string, 10);
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export class Dial {
  station: AvailabilityStation;
  startMinutes = 0;
  endMinutes = 0;
  holdBookingId: string | null = null;
  holdExpiresAt: number | null = null;
  confirmedBalanceQuarters: number | null = null;
  attemptKey: string | null = null;
  attemptPending = false;
  dragging = false;
  private sectorSignature = '';

  readonly group: HTMLElement;
  private readonly ring: SVGSVGElement;
  private readonly sectorLayer: SVGElement;
  private readonly claimPath: SVGElement;
  private readonly centreTop: HTMLElement;
  private readonly centreBottom: HTMLElement;
  private readonly centreNumeral: HTMLElement;
  readonly startSpin: HTMLElement;
  readonly endSpin: HTMLElement;
  readonly holdButton: HTMLButtonElement;
  readonly repeatButton: HTMLButtonElement;
  readonly confirmButton: HTMLButtonElement;
  readonly releaseButton: HTMLButtonElement;
  private readonly callbacks: DialCallbacks;

  constructor(station: AvailabilityStation, callbacks: DialCallbacks) {
    this.station = station;
    this.callbacks = callbacks;
    this.group = el('div', {
      role: 'group',
      'aria-label': `${station.name} dial`,
      'aria-busy': 'false',
      class: 'dial-row',
    });
    this.ring = svg('svg', {
      viewBox: `0 0 ${DIAL_SIZE} ${DIAL_SIZE}`,
      class: 'dial',
      'aria-hidden': 'false',
    }) as SVGSVGElement;
    this.ring.append(dialPatterns());
    for (const node of ringFurniture()) this.ring.append(node);
    this.sectorLayer = svg('g', { class: 'sector-layer' });
    this.claimPath = svg('path', {
      class: 'claim-arc',
      role: 'img',
      'aria-label': claimLabel(0, 0),
      'data-start-deg': '0',
      'data-end-deg': '0',
      d: arcPath(0, 0),
      fill: 'none',
    });
    this.ring.append(this.sectorLayer, this.claimPath);
    this.centreTop = el('p', { class: 'dial-centre-top' });
    this.centreNumeral = el('span', { class: 'dial-numeral', 'data-pack-hours': '0' });
    this.centreBottom = el('p', { class: 'dial-centre-bottom' });
    const centre = el('div', { class: 'dial-centre' }, [this.centreTop, this.centreBottom]);
    const dialBox = el('div', { class: 'dial-box' }, [this.ring, centre]);

    this.startSpin = this.spinbutton('Start time');
    this.endSpin = this.spinbutton('End time');
    this.holdButton = button('Hold window', { class: 'primary', 'aria-disabled': 'true' });
    this.repeatButton = button('Repeat weekly', { 'aria-disabled': 'true' });
    this.confirmButton = button('Confirm booking', { class: 'primary' });
    this.releaseButton = button('Release hold');
    const actions = el('div', { class: 'dial-actions' }, [
      this.startSpin,
      this.endSpin,
      this.holdButton,
      this.repeatButton,
    ]);
    const side = el('div', { class: 'dial-side' }, [
      el('h3', { class: 'station-name', text: station.name }),
      el('p', { class: 'station-kind', text: stationKindLabel(station.kind) }),
      legend(),
      actions,
    ]);
    this.group.append(dialBox, side);

    this.holdButton.addEventListener('click', () => {
      if (this.holdButton.getAttribute('aria-disabled') === 'true') return;
      if (this.callbacks.isBusy()) return;
      this.callbacks.onClaim(this);
    });
    this.repeatButton.addEventListener('click', () => {
      if (this.repeatButton.getAttribute('aria-disabled') === 'true') return;
      if (this.callbacks.isBusy()) return;
      this.callbacks.onRepeatWeekly(this);
    });
    this.confirmButton.addEventListener('click', () => {
      if (this.confirmButton.getAttribute('aria-disabled') === 'true') return;
      this.callbacks.onConfirm(this);
    });
    this.releaseButton.addEventListener('click', () => {
      if (this.releaseButton.getAttribute('aria-disabled') === 'true') return;
      this.callbacks.onRelease(this);
    });
    this.bindPointer();
    this.bindKeys();
  }

  private spinbutton(name: string): HTMLElement {
    const node = el('div', {
      role: 'spinbutton',
      'aria-label': name,
      tabindex: '0',
      class: 'spinbutton',
      'aria-valuenow': '0',
      'aria-valuetext': '00:00',
      'aria-valuemin': '0',
      'aria-valuemax': '1440',
    });
    node.append(
      el('span', { class: 'spin-label', 'aria-hidden': 'true', text: name }),
      el('span', { class: 'spin-value', text: '00:00' }),
    );
    return node;
  }

  get bufferMinutes(): number {
    return SANITATION_BUFFER_MINUTES[this.station.kind];
  }

  private occupiedSpans(kinds: AvailabilitySector['kind'][]): Span[] {
    return this.station.sectors
      .filter((sector) => kinds.includes(sector.kind))
      .map((sector) => ({ start: toMinutes(sector.start), end: toMinutes(sector.end) }));
  }

  /** The window plus the station's own sanitation buffer straight after it. */
  footprintBlocked(startMinutes: number, endMinutes: number): boolean {
    const windowEnd = endMinutes > startMinutes ? endMinutes : Math.min(1440, startMinutes + 15);
    const windowPart: Span = { start: startMinutes, end: windowEnd };
    if (this.occupiedSpans(OCCUPIED).some((span) => overlaps(windowPart, span))) return true;
    const bufferPart: Span = { start: windowEnd, end: windowEnd + this.bufferMinutes };
    return this.occupiedSpans(BLOCKS_BUFFER).some((span) => overlaps(bufferPart, span));
  }

  earliestOpenStep(): number {
    for (let minutes = 0; minutes < 1440; minutes += 15) {
      if (!this.footprintBlocked(minutes, minutes)) return minutes;
    }
    return 0;
  }

  /** The latest End a window from this Start may take. */
  maxEndFor(startMinutes: number): number {
    let end = startMinutes;
    for (let candidate = startMinutes + 15; candidate <= 1440; candidate += 15) {
      if (this.footprintBlocked(startMinutes, candidate)) break;
      if (this.callbacks.quartersFor(startMinutes, candidate) > this.callbacks.availableQuarters()) {
        break;
      }
      end = candidate;
    }
    return end;
  }

  setWindow(startMinutes: number, endMinutes: number): void {
    this.startMinutes = startMinutes;
    this.endMinutes = endMinutes;
    this.confirmedBalanceQuarters = null;
    this.paint();
  }

  resetToEarliestOpen(): void {
    const step = this.earliestOpenStep();
    this.startMinutes = step;
    this.endMinutes = step;
    this.paint();
  }

  setBusy(busy: boolean): void {
    this.group.setAttribute('aria-busy', busy ? 'true' : 'false');
    this.group.classList.toggle('busy', busy);
  }

  updateSectors(station: AvailabilityStation): void {
    this.station = station;
    const signature = station.sectors
      .map((sector) => `${sector.kind}|${sector.start}|${sector.end}|${sector.booking_id ?? ''}`)
      .join(',');
    /* Unchanged sectors keep their elements, so a reload never restarts the hold pulse. */
    if (signature === this.sectorSignature) return;
    this.sectorSignature = signature;
    while (this.sectorLayer.firstChild !== null) {
      this.sectorLayer.removeChild(this.sectorLayer.firstChild);
    }
    for (const sector of station.sectors) {
      const startDegrees = degreesFor(toMinutes(sector.start));
      const endDegrees = degreesFor(toMinutes(sector.end));
      this.sectorLayer.append(
        svg('path', {
          class: sectorClass(sector.kind),
          role: 'img',
          'aria-label': sectorLabel(sector),
          'data-start-deg': startDegrees.toFixed(2),
          'data-end-deg': endDegrees.toFixed(2),
          d: arcPath(startDegrees, endDegrees),
          fill: 'none',
        }),
      );
    }
  }

  paint(): void {
    const startDegrees = degreesFor(this.startMinutes);
    const endDegrees = degreesFor(this.endMinutes);
    this.claimPath.setAttribute('d', arcPath(startDegrees, endDegrees));
    this.claimPath.setAttribute('data-start-deg', startDegrees.toFixed(2));
    this.claimPath.setAttribute('data-end-deg', endDegrees.toFixed(2));
    this.claimPath.setAttribute('aria-label', claimLabel(this.startMinutes, this.endMinutes));
    this.setSpin(this.startSpin, this.startMinutes);
    this.setSpin(this.endSpin, this.endMinutes);
    const hasLength = this.endMinutes > this.startMinutes;
    this.holdButton.setAttribute('aria-disabled', hasLength ? 'false' : 'true');
    this.repeatButton.setAttribute('aria-disabled', hasLength ? 'false' : 'true');
    this.paintCentre();
  }

  private setSpin(node: HTMLElement, minutes: number): void {
    node.setAttribute('aria-valuenow', String(minutes));
    node.setAttribute('aria-valuetext', minutesToWall(minutes));
    const value = node.querySelector('.spin-value');
    if (value !== null) setText(value, minutesToWall(minutes));
  }

  paintCentre(): void {
    const available = this.callbacks.availableQuarters();
    if (this.holdBookingId !== null && this.holdExpiresAt !== null) {
      const remaining = this.holdExpiresAt - this.callbacks.serverNow();
      const text = prefersReducedMotion()
        ? `Held · ${countdownMinutes(remaining)} min left`
        : `Held · ${countdown(remaining)} left`;
      setText(this.centreTop, text);
      this.renderNumeral(`Pack hours ${hours(available / 4)}`, available);
      this.group.classList.add('holding');
      return;
    }
    this.group.classList.remove('holding');
    if (this.confirmedBalanceQuarters !== null) {
      this.centreTop.textContent = '';
      this.centreTop.append(icon('check'), document.createTextNode('Confirmed'));
      this.renderNumeral(
        `Pack hours ${hours(this.confirmedBalanceQuarters / 4)}`,
        this.confirmedBalanceQuarters,
      );
      this.group.classList.add('confirmed');
      return;
    }
    this.group.classList.remove('confirmed');
    if (this.endMinutes > this.startMinutes) {
      setText(
        this.centreTop,
        `${minutesToWall(this.startMinutes)}–${minutesToWall(this.endMinutes)}`,
      );
      const after = available - this.callbacks.quartersFor(this.startMinutes, this.endMinutes);
      this.renderNumeral(`Pack hours after this claim ${hours(after / 4)}`, after);
      return;
    }
    setText(this.centreTop, 'Drag to claim');
    this.renderNumeral(`Pack hours ${hours(available / 4)}`, available);
  }

  private renderNumeral(text: string, quarters: number): void {
    this.centreNumeral.setAttribute('data-pack-hours', hours(quarters / 4));
    this.centreNumeral.textContent = text;
    if (this.centreBottom.firstChild !== this.centreNumeral) {
      this.centreBottom.textContent = '';
      this.centreBottom.append(this.centreNumeral);
    }
  }

  showHeldActions(): void {
    const actions = this.group.querySelector('.dial-actions') as HTMLElement;
    if (!actions.contains(this.confirmButton)) actions.append(this.confirmButton, this.releaseButton);
  }

  hideHeldActions(): void {
    this.confirmButton.remove();
    this.releaseButton.remove();
  }

  private bindPointer(): void {
    this.ring.addEventListener('pointerdown', (event) => {
      if (this.callbacks.isBusy()) return;
      const minutes = snapToStep(minutesFromPoint(this.ring, event.clientX, event.clientY));
      if (minutes >= 1440) return;
      if (this.footprintBlocked(minutes, minutes)) return;
      event.preventDefault();
      this.ring.setPointerCapture(event.pointerId);
      this.dragging = true;
      this.setWindow(minutes, minutes);
    });
    this.ring.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      event.preventDefault();
      const minutes = snapToStep(minutesFromPoint(this.ring, event.clientX, event.clientY));
      const limit = this.maxEndFor(this.startMinutes);
      const end = Math.max(this.startMinutes, Math.min(minutes, limit));
      if (end !== this.endMinutes) this.setWindow(this.startMinutes, end);
    });
    const release = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.endMinutes > this.startMinutes) this.callbacks.onClaim(this);
      else this.resetToEarliestOpen();
    };
    this.ring.addEventListener('pointerup', release);
    this.ring.addEventListener('pointercancel', () => {
      this.dragging = false;
    });
  }

  private bindKeys(): void {
    this.startSpin.addEventListener('keydown', (event) => this.onStartKey(event));
    this.endSpin.addEventListener('keydown', (event) => this.onEndKey(event));
  }

  private stepFor(event: KeyboardEvent): number | null {
    const size = event.shiftKey ? 60 : 15;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') return size;
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') return -size;
    return null;
  }

  private onStartKey(event: KeyboardEvent): void {
    const step = this.stepFor(event);
    if (step === null) return;
    event.preventDefault();
    if (this.callbacks.isBusy()) return;
    const length = this.endMinutes - this.startMinutes;
    const movedStart = this.startMinutes + step;
    const movedEnd = movedStart + length;
    if (movedStart < 0 || movedEnd > 1440) return;
    if (length === 0 && movedStart >= 1440) return;
    if (!this.footprintBlocked(movedStart, movedEnd)) {
      if (this.callbacks.quartersFor(movedStart, movedEnd) > this.callbacks.availableQuarters()) {
        return;
      }
      this.setWindow(movedStart, movedEnd);
      return;
    }
    const landing = this.landingStart(movedStart, movedEnd, step > 0);
    if (landing === null) return;
    this.setWindow(landing, landing);
  }

  /** Lands Start on the far side of the run of occupied sectors in the way. */
  private landingStart(
    movedStart: number,
    movedEnd: number,
    later: boolean,
  ): number | null {
    let run = this.blockingRun(movedStart, movedEnd, later);
    if (run === null) return null;
    for (let guard = 0; guard < 96; guard += 1) {
      const landing = later ? run.end : run.start - this.bufferMinutes - 15;
      if (landing >= 1440 || landing < 0) return null;
      if (!this.footprintBlocked(landing, landing)) return landing;
      const grown = this.blockingRun(landing, landing, later);
      if (grown === null) return null;
      run = {
        start: Math.min(run.start, grown.start),
        end: Math.max(run.end, grown.end),
      };
    }
    return null;
  }

  private blockingRun(
    startMinutes: number,
    endMinutes: number,
    later: boolean,
  ): Span | null {
    const windowEnd = endMinutes > startMinutes ? endMinutes : Math.min(1440, startMinutes + 15);
    const windowPart: Span = { start: startMinutes, end: windowEnd };
    const bufferPart: Span = { start: windowEnd, end: windowEnd + this.bufferMinutes };
    const blocking = [
      ...this.occupiedSpans(OCCUPIED).filter((span) => overlaps(windowPart, span)),
      ...this.occupiedSpans(BLOCKS_BUFFER).filter((span) => overlaps(bufferPart, span)),
    ];
    if (blocking.length === 0) return null;
    let chosen = blocking[0] as Span;
    for (const span of blocking) {
      if (later ? span.start < chosen.start : span.end > chosen.end) chosen = span;
    }
    let run: Span = { ...chosen };
    const all = this.occupiedSpans(OCCUPIED);
    for (let guard = 0; guard < 96; guard += 1) {
      let grew = false;
      for (const span of all) {
        if (span.start <= run.end && span.end >= run.start) {
          const start = Math.min(run.start, span.start);
          const end = Math.max(run.end, span.end);
          if (start !== run.start || end !== run.end) {
            run = { start, end };
            grew = true;
          }
        }
      }
      if (!grew) break;
    }
    return run;
  }

  private onEndKey(event: KeyboardEvent): void {
    const step = this.stepFor(event);
    if (step === null) return;
    event.preventDefault();
    if (this.callbacks.isBusy()) return;
    const moved = this.endMinutes + step;
    if (moved < this.startMinutes || moved > 1440) return;
    if (moved > this.startMinutes) {
      if (this.footprintBlocked(this.startMinutes, moved)) return;
      if (this.callbacks.quartersFor(this.startMinutes, moved) > this.callbacks.availableQuarters()) {
        return;
      }
    }
    this.setWindow(this.startMinutes, moved);
  }
}

function stationKindLabel(kind: AvailabilityStation['kind']): string {
  if (kind === 'oven') return 'Oven';
  if (kind === 'mixer') return 'Mixer';
  if (kind === 'blast_chiller') return 'Blast chiller';
  return 'Prep table';
}

function legend(): HTMLElement {
  return el('ul', { class: 'dial-legend' }, [
    el('li', { class: 'legend-booked', text: 'Booked' }),
    el('li', { class: 'legend-buffer', text: 'Sanitation buffer' }),
    el('li', { class: 'legend-own', text: 'Your booking' }),
    el('li', { class: 'legend-claim', text: 'Your claim' }),
  ]);
}
