import { announce } from '../announce.js';
import { h } from '../dom.js';
import { money } from '../../shared/format.js';
import { segmentPriceCents } from '../../shared/pricing.js';
import {
  assignSeats,
  freeSeatsForSpan,
  seatBandName,
  type SeatMapEntry,
} from '../../shared/seats.js';
import { runMotion } from '../motion.js';
import type { Ride } from '../types.js';

export interface Span {
  boardingIdx: number;
  alightingIdx: number;
}

export interface LegSpanOptions {
  ride: Ride;
  initial: Span;
  /** The driver's own view of a ride has no sliders. */
  interactive: boolean;
  seats: () => number;
  onChange?: (state: LegSpanState) => void;
}

export interface LegSpanState extends Span {
  km: number;
  freeSeats: number;
  perSeatCents: number;
  totalCents: number;
}

export interface LegSpanHandle {
  element: HTMLElement;
  state(): LegSpanState;
  setSeatMap(seatMap: SeatMapEntry[]): void;
  setSeats(): void;
  announceSpan(): void;
  clearSelection(): void;
  confirmSeats(): void;
}

export function legSpan(options: LegSpanOptions): LegSpanHandle {
  const ride = options.ride;
  const cities = ride.stops.map((stop) => stop.city);
  const lastIndex = ride.stops.length - 1;
  let seatMap = ride.seat_map;
  let boardingIdx = options.initial.boardingIdx;
  let alightingIdx = options.initial.alightingIdx;
  let cleared = false;

  const strip = h('div', { class: 'span-strip' });
  const stopRow = h('div', { class: 'span-stops' });
  const bandsBox = h('div', { class: 'span-bands' });
  const priceFigure = h('p', { class: 'span-price' });
  const kmFigure = h('p', { class: 'span-km' });
  const tint = h('div', { class: 'span-tint' });

  const boarding = h('div', {
    role: 'slider',
    'aria-label': 'Boarding stop',
    tabindex: '0',
    class: 'span-handle',
  });
  const alighting = h('div', {
    role: 'slider',
    'aria-label': 'Alighting stop',
    tabindex: '0',
    class: 'span-handle',
  });

  const element = h(
    'div',
    { role: 'group', 'aria-label': 'Leg Span', class: 'leg-span' },
    h(
      'div',
      { class: 'span-track-box' },
      h('div', { class: 'span-line' }),
      tint,
      stopRow,
      options.interactive ? boarding : null,
      options.interactive ? alighting : null,
      strip,
    ),
    bandsBox,
    h('div', { class: 'span-figures' }, priceFigure, kmFigure),
  );

  const kmOf = (index: number): number => ride.stops[index]?.km ?? 0;
  const percentOf = (index: number): number =>
    ride.route_km === 0 ? 0 : (kmOf(index) / ride.route_km) * 100;

  const computed = (): LegSpanState => {
    const km = kmOf(alightingIdx) - kmOf(boardingIdx);
    const perSeat = segmentPriceCents(ride.price_cents, km, ride.route_km);
    const free = freeSeatsForSpan(seatMap, boardingIdx, alightingIdx).length;
    return {
      boardingIdx,
      alightingIdx,
      km,
      freeSeats: free,
      perSeatCents: perSeat,
      totalCents: perSeat * Math.max(1, options.seats()),
    };
  };

  const paintStops = () => {
    stopRow.textContent = '';
    ride.stops.forEach((stop, index) => {
      const item = h(
        'span',
        { class: 'span-stop', style: `left:${percentOf(index)}%` },
        h('span', { class: 'span-tick' }),
        h('span', { class: 'span-stop-name', text: stop.city }),
      );
      stopRow.appendChild(item);
    });
  };

  const paintBands = () => {
    const assigned = cleared
      ? []
      : (assignSeats(seatMap, boardingIdx, alightingIdx, Math.max(1, options.seats())) ?? []);
    const free = cleared ? [] : freeSeatsForSpan(seatMap, boardingIdx, alightingIdx);
    const existing = new Map<number, HTMLElement>();
    for (const band of bandsBox.querySelectorAll<HTMLElement>('[data-seat]')) {
      existing.set(Number(band.dataset.seat), band);
    }
    bandsBox.textContent = '';
    for (const entry of seatMap) {
      const name = seatBandName(entry, cities);
      const band = h('div', {
        role: 'img',
        'aria-label': name,
        class: 'seat-band',
        'data-seat': String(entry.seat),
      });
      for (let leg = 0; leg < entry.legs.length; leg += 1) {
        const width = ((kmOf(leg + 1) - kmOf(leg)) / ride.route_km) * 100;
        const inSpan = leg >= boardingIdx && leg < alightingIdx;
        band.appendChild(
          h('span', {
            class: [
              'seat-leg',
              entry.legs[leg] === 'taken' ? 'taken' : 'open',
              inSpan && !cleared ? 'in-span' : '',
              inSpan && free.includes(entry.seat) ? 'free-span' : '',
              inSpan && assigned.includes(entry.seat) ? 'assigned' : '',
            ]
              .filter(Boolean)
              .join(' '),
            style: `width:${width}%`,
          }),
        );
      }
      const previous = existing.get(entry.seat);
      const changed =
        previous !== undefined && previous.getAttribute('aria-label') !== name;
      bandsBox.appendChild(band);
      if (changed) runMotion(band, 'seat-fill');
    }
  };

  const paintFigures = (roll: boolean) => {
    const state = computed();
    priceFigure.textContent = money(state.totalCents);
    kmFigure.textContent = `${state.km} km`;
    if (roll) {
      runMotion(priceFigure, 'price-roll');
      runMotion(kmFigure, 'price-roll');
    }
  };

  const paintHandles = (snap: boolean) => {
    boarding.setAttribute('aria-valuemin', '0');
    boarding.setAttribute('aria-valuemax', String(lastIndex - 1));
    boarding.setAttribute('aria-valuenow', String(boardingIdx));
    boarding.setAttribute('aria-valuetext', cities[boardingIdx] as string);
    boarding.style.left = `${percentOf(boardingIdx)}%`;
    alighting.setAttribute('aria-valuemin', '1');
    alighting.setAttribute('aria-valuemax', String(lastIndex));
    alighting.setAttribute('aria-valuenow', String(alightingIdx));
    alighting.setAttribute('aria-valuetext', cities[alightingIdx] as string);
    alighting.style.left = `${percentOf(alightingIdx)}%`;
    tint.style.left = `${percentOf(boardingIdx)}%`;
    tint.style.width = `${percentOf(alightingIdx) - percentOf(boardingIdx)}%`;
    tint.hidden = cleared;
    if (snap) {
      runMotion(boarding, 'handle-snap');
      runMotion(alighting, 'handle-snap');
    }
  };

  const spanAnnouncement = (): string => {
    const state = computed();
    return (
      `${cities[boardingIdx]} to ${cities[alightingIdx]}, ${state.km} km, ` +
      `${state.freeSeats === 1 ? '1 seat' : `${state.freeSeats} seats`} free, ` +
      `${money(state.totalCents)}`
    );
  };

  const settle = (snap: boolean, speak: boolean) => {
    cleared = false;
    paintHandles(snap);
    paintBands();
    paintFigures(true);
    if (speak) announce(spanAnnouncement());
    options.onChange?.(computed());
  };

  const moveHandle = (which: 'boarding' | 'alighting', next: number) => {
    if (which === 'boarding') {
      if (next < 0 || next >= alightingIdx) return;
      boardingIdx = next;
    } else {
      if (next > lastIndex || next <= boardingIdx) return;
      alightingIdx = next;
    }
    settle(true, true);
  };

  const onKey = (which: 'boarding' | 'alighting') => (event: KeyboardEvent) => {
    const current = which === 'boarding' ? boardingIdx : alightingIdx;
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
    };
    if (event.key in steps) {
      event.preventDefault();
      moveHandle(which, current + (steps[event.key] as number));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      moveHandle(which, which === 'boarding' ? 0 : boardingIdx + 1);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      moveHandle(which, which === 'boarding' ? alightingIdx - 1 : lastIndex);
    }
  };

  const nearestStop = (clientX: number): number => {
    const box = element.querySelector('.span-track-box') as HTMLElement;
    const rect = box.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const km = fraction * ride.route_km;
    let best = 0;
    let bestGap = Number.POSITIVE_INFINITY;
    ride.stops.forEach((stop, index) => {
      const gap = Math.abs(stop.km - km);
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    });
    return best;
  };

  const startDrag = (which: 'boarding' | 'alighting') => (event: PointerEvent) => {
    event.preventDefault();
    const handle = which === 'boarding' ? boarding : alighting;
    handle.focus();
    const onMove = (moveEvent: PointerEvent) => {
      const box = element.querySelector('.span-track-box') as HTMLElement;
      const rect = box.getBoundingClientRect();
      const fraction = Math.min(
        1,
        Math.max(0, (moveEvent.clientX - rect.left) / rect.width),
      );
      handle.style.left = `${fraction * 100}%`;
    };
    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      moveHandle(which, nearestStop(upEvent.clientX));
      paintHandles(true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (options.interactive) {
    boarding.addEventListener('keydown', onKey('boarding'));
    alighting.addEventListener('keydown', onKey('alighting'));
    boarding.addEventListener('pointerdown', startDrag('boarding'));
    alighting.addEventListener('pointerdown', startDrag('alighting'));
  }

  paintStops();
  paintHandles(false);
  paintBands();
  paintFigures(false);

  return {
    element,
    state: computed,
    setSeatMap(next: SeatMapEntry[]) {
      seatMap = next;
      paintBands();
      paintFigures(false);
      options.onChange?.(computed());
    },
    setSeats() {
      paintBands();
      paintFigures(true);
      options.onChange?.(computed());
    },
    announceSpan() {
      announce(spanAnnouncement());
    },
    clearSelection() {
      cleared = true;
      paintHandles(false);
      paintBands();
    },
    confirmSeats() {
      const assigned = bandsBox.querySelector<HTMLElement>('.assigned');
      const band = assigned?.closest<HTMLElement>('[data-seat]') ?? null;
      if (band) runMotion(band, 'booking-confirm');
    },
  };
}
