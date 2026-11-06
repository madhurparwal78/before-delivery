import { STATUS_COPY } from '../domain/copy.ts';
import {
  rollingOpenings,
  simultaneousOpenings,
  resolveCopenhagenGoLive,
  type DropType,
  type MarketOpening,
} from '../domain/golive.ts';
import { MARKETS, marketCity, type Market } from '../domain/markets.ts';
import { isNight } from '../domain/night.ts';
import {
  formatCopenhagenDate,
  formatCopenhagenInstant,
  formatInstant,
  formatMarketTime,
  parseDate,
  parseLocalDateTime,
} from '../domain/time.ts';
import { setDeadline } from './countdown.ts';
import { turnTo } from './motion.ts';

const QUARTERS = 96;

export interface DialState {
  date: string;
  time: string;
  type: DropType;
  step: number;
}

export interface DialHost {
  root: HTMLElement;
  slider: HTMLElement;
  onChange(state: DialState, openings: MarketOpening[] | null): void;
}

function stepToTime(step: number): string {
  const hour = Math.floor(step / 4);
  const minute = (step % 4) * 15;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeToStep(time: string): number {
  return Number(time.slice(0, 2)) * 4 + Number(time.slice(3, 5)) / 15;
}

export interface DialResult {
  openings: MarketOpening[] | null;
  gapDate: string | null;
}

/** The six market openings for a date, time and type, or a gap when Copenhagen skips that hour. */
export function openingsForState(state: DialState): DialResult {
  const wall = parseLocalDateTime(`${state.date}T${state.time}`);
  if (wall === null || parseDate(state.date) === null) return { openings: null, gapDate: null };
  if (state.type === 'rolling') return { openings: rollingOpenings(wall), gapDate: null };
  const resolved = resolveCopenhagenGoLive(wall);
  if (resolved.kind === 'gap') return { openings: null, gapDate: resolved.gapDate };
  return { openings: simultaneousOpenings(resolved.instantMs), gapDate: null };
}

export class Dial {
  private readonly host: DialHost;
  private state: DialState;
  private handAngle = 0;
  private readonly pinAngles = new Map<Market, number>();

  constructor(host: DialHost, initial: DialState) {
    this.host = host;
    this.state = { ...initial };
    this.handAngle = (this.state.step / QUARTERS) * 360;
    for (const market of MARKETS) this.pinAngles.set(market, this.handAngle);
    this.wire();
    this.render(true);
  }

  get current(): DialState {
    return { ...this.state };
  }

  setDate(date: string): void {
    this.state = { ...this.state, date };
    this.render(false);
  }

  setType(type: DropType): void {
    this.state = { ...this.state, type };
    this.render(false);
  }

  setStep(step: number): void {
    const clamped = Math.max(0, Math.min(QUARTERS - 1, step));
    this.state = { ...this.state, step: clamped, time: stepToTime(clamped) };
    this.render(false);
  }

  private wire(): void {
    const slider = this.host.slider;
    slider.addEventListener('keydown', (event) => {
      const moves: Record<string, number> = {
        ArrowUp: 1,
        ArrowRight: 1,
        ArrowDown: -1,
        ArrowLeft: -1,
        PageUp: 4,
        PageDown: -4,
      };
      if (event.key === 'Home') {
        event.preventDefault();
        this.setStep(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        this.setStep(QUARTERS - 1);
        return;
      }
      const delta = moves[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      this.setStep(this.state.step + delta);
    });

    const ring = this.host.root;
    const moveFromPointer = (event: PointerEvent): void => {
      const box = ring.getBoundingClientRect();
      const x = event.clientX - (box.left + box.width / 2);
      const y = event.clientY - (box.top + box.height / 2);
      const degrees = (Math.atan2(x, -y) * 180) / Math.PI;
      const normalised = (degrees + 360) % 360;
      this.setStep(Math.round((normalised / 360) * QUARTERS) % QUARTERS);
    };
    ring.addEventListener('pointerdown', (event) => {
      if (
        (event.target as HTMLElement).closest('[data-dial-slider]') !== null ||
        (event.target as HTMLElement).closest('[data-countdown]') !== null
      ) {
        return;
      }
      ring.setPointerCapture(event.pointerId);
      moveFromPointer(event);
    });
    ring.addEventListener('pointermove', (event) => {
      if (!ring.hasPointerCapture(event.pointerId)) return;
      moveFromPointer(event);
    });
    ring.addEventListener('pointerup', (event) => {
      if (ring.hasPointerCapture(event.pointerId)) ring.releasePointerCapture(event.pointerId);
    });
  }

  /**
   * In one frame the slider's value, data-utc, every pin's data attributes, printed times and the
   * ledger take their new values; the hand and pins then turn to their new angles.
   */
  private render(initial: boolean): void {
    const { openings, gapDate } = openingsForState(this.state);
    const copenhagen = openings?.find((opening) => opening.market === 'copenhagen') ?? null;

    this.host.slider.setAttribute('aria-valuenow', String(this.state.step));
    this.host.slider.setAttribute(
      'aria-valuetext',
      copenhagen === null
        ? `${formatCopenhagenDate(this.state.date)}, ${this.state.time} Copenhagen time`
        : formatCopenhagenInstant(copenhagen.instantMs),
    );
    this.host.root.dataset['utc'] = copenhagen === null ? '' : formatInstant(copenhagen.instantMs);

    for (const market of MARKETS) {
      const opening = openings?.find((entry) => entry.market === market) ?? null;
      const pin = this.host.root.querySelector<HTMLElement>(`[data-market="${market}"]`);
      if (pin === null) continue;
      const night = opening !== null && isNight(opening.localTime);
      pin.dataset['localTime'] = opening?.localTime ?? '';
      pin.dataset['night'] = night ? 'true' : 'false';
      pin.dataset['utc'] = opening === null ? '' : formatInstant(opening.instantMs);
      const time = pin.querySelector<HTMLElement>('[data-pin-time]');
      if (time !== null) time.textContent = opening?.localTime ?? '—';
      const nightMark = pin.querySelector<HTMLElement>('[data-pin-night]');
      if (nightMark !== null) {
        const appearing = night && nightMark.hidden;
        nightMark.hidden = !night;
        if (appearing) {
          nightMark.classList.remove('is-appearing');
          void nightMark.offsetWidth;
          nightMark.classList.add('is-appearing');
        }
      }
      this.turnPin(market, opening);
      this.updateLedger(market, opening, night);
      this.updateSheet(market, opening, night);
    }

    const target = (this.state.step / QUARTERS) * 360;
    this.handAngle = initial ? target : target;
    turnTo(
      this.host.root.querySelector<HTMLElement>('[data-dial-hand]') ?? this.host.root,
      this.handAngle,
    );

    const notes = document.querySelector<HTMLElement>('[data-dial-notes]');
    if (notes !== null) {
      notes.textContent =
        gapDate !== null
          ? `Copenhagen skips from 02:00 to 03:00 on ${formatCopenhagenDate(gapDate)}. Choose another time.`
          : (openings ?? [])
              .filter((opening) => opening.shiftedTo !== null)
              .map((opening) => STATUS_COPY.rollingShift(marketCity(opening.market), opening.localTime))
              .join(' ');
    }

    const countdown = this.host.root.querySelector<HTMLElement>('[data-countdown="golive"]');
    if (countdown !== null) {
      setDeadline(countdown, copenhagen === null ? '' : formatInstant(copenhagen.instantMs));
    }

    const save = document.querySelector<HTMLButtonElement>('[data-action="save-time"]');
    for (const node of document.querySelectorAll<HTMLButtonElement>('[data-action="save-time"]')) {
      node.disabled = openings === null;
    }
    void save;

    this.host.onChange(this.current, openings);
  }

  /** Each pin takes the shorter way round its own ring; exactly half a turn goes clockwise. */
  private turnPin(market: Market, opening: MarketOpening | null): void {
    const ring = this.host.root.querySelector<HTMLElement>(`[data-pin-ring="${market}"]`);
    if (ring === null || opening === null) return;
    const local = opening.localTime;
    const target =
      ((Number(local.slice(0, 2)) * 60 + Number(local.slice(3, 5))) / 1440) * 360;
    const previous = this.pinAngles.get(market) ?? 0;
    let delta = (target - (previous % 360) + 360) % 360;
    if (delta > 180) delta -= 360;
    const next = previous + delta;
    this.pinAngles.set(market, next);
    turnTo(ring, next);
    const label = ring.querySelector<HTMLElement>('[data-market]');
    if (label !== null) label.style.setProperty('--counter-turn', `${-next}deg`);
  }

  private updateLedger(market: Market, opening: MarketOpening | null, night: boolean): void {
    const row = document.querySelector<HTMLElement>(`[data-ledger-row="${market}"]`);
    if (row === null) return;
    const set = (selector: string, value: string): void => {
      const cell = row.querySelector<HTMLElement>(selector);
      if (cell !== null) cell.textContent = value;
    };
    set('[data-ledger-local]', opening?.localTime ?? '—');
    set('[data-ledger-opens]', opening === null ? '—' : formatMarketTime(opening.instantMs, market));
    set('[data-ledger-utc]', opening === null ? '—' : formatInstant(opening.instantMs));
    const nightCell = row.querySelector<HTMLElement>('[data-ledger-night]');
    if (nightCell !== null) nightCell.innerHTML = night ? nightMarkHtml() : '';
  }

  private updateSheet(market: Market, opening: MarketOpening | null, night: boolean): void {
    const row = document.querySelector<HTMLElement>(`[data-sheet-market="${market}"]`);
    if (row === null) return;
    const local = row.querySelector<HTMLElement>('[data-sheet-local]');
    if (local !== null) local.textContent = opening?.localTime ?? '—';
    const nightCell = row.querySelector<HTMLElement>('[data-sheet-night]');
    if (nightCell !== null) nightCell.innerHTML = night ? nightMarkHtml() : '';
  }
}

function nightMarkHtml(): string {
  return '<span class="night-mark"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#icon-moon"></use></svg><span class="night-mark__word">Night</span></span>';
}

export { stepToTime, timeToStep };
