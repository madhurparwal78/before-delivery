import { h, clear } from './els.js';
import { announce, motionAttrs, reducedMotion } from './announce.js';
import { money } from './fmt.js';
import type { Ride, SeatRow } from './types.js';
import { seatBandName } from './seatnames.js';

/**
 * The Leg Span: stops placed by km, one band per seat filled where taken,
 * boarding and alighting handles that move by pointer, touch or arrow keys,
 * snap to stops, tint the span and announce its km, free seats and price.
 */
export interface LegSpanOpts {
  ride: Ride;
  seatMap: SeatRow[];
  boarding: string;
  alighting: string;
  seats: number;
  interactive: boolean;
  onSpanChange: (boarding: string, alighting: string) => void;
}

export interface LegSpanHandle {
  root: HTMLElement;
  refresh: (opts: { seatMap: SeatRow[]; boarding: string; alighting: string; seats: number }) => void;
}

export function legSpan(opts: LegSpanOpts): LegSpanHandle {
  const stops = opts.ride.stops;
  const legCount = stops.length - 1;
  const state = {
    boarding: opts.boarding,
    alighting: opts.alighting,
    seats: opts.seats,
    seatMap: opts.seatMap,
  };

  const strip = h('div', { class: 'legspan-strip' });
  const line = h('div', { class: 'span-line' });
  const bands = h('div', { class: 'seat-bands' });
  const priceFigure = h('div', { class: 'price-figure' });
  const priceKm = h('div', { class: 'price-km' });
  const root = h('div', { role: 'group', 'aria-label': 'Leg Span', class: 'legspan' }, strip, bands);

  let boardingHandle: HTMLButtonElement | null = null;
  let alightingHandle: HTMLButtonElement | null = null;

  const indexOf = (city: string): number => stops.findIndex(s => s.city === city);

  const segmentKm = (): number => {
    const i = indexOf(state.boarding);
    const j = indexOf(state.alighting);
    if (i < 0 || j < 0 || j <= i) return 0;
    return stops[j].km - stops[i].km;
  };

  const segPrice = (): number => {
    const km = segmentKm();
    if (opts.ride.route_km === 0) return 0;
    return Math.floor((opts.ride.price_cents * km) / opts.ride.route_km);
  };

  const seatsFree = (): number => {
    const i = indexOf(state.boarding);
    const j = indexOf(state.alighting);
    if (i < 0 || j < 0) return 0;
    let n = 0;
    for (const row of state.seatMap) {
      let free = true;
      for (let leg = i; leg < j; leg++) if (row.legs[leg] === 'taken') free = false;
      if (free) n++;
    }
    return n;
  };

  const chosenSeats = (): number[] => {
    const i = indexOf(state.boarding);
    const j = indexOf(state.alighting);
    const out: number[] = [];
    for (const row of state.seatMap) {
      if (out.length >= state.seats) break;
      let free = true;
      for (let leg = i; leg < j; leg++) if (row.legs[leg] === 'taken') free = false;
      if (free) out.push(row.seat);
    }
    return out;
  };

  const pctOf = (km: number): number => {
    const total = stops[stops.length - 1].km;
    return total === 0 ? 0 : (km / total) * 100;
  };

  const renderStrip = (): void => {
    clear(strip);
    line.innerHTML = '';
    const i = indexOf(state.boarding);
    const j = indexOf(state.alighting);
    const tint = h('div', { class: 'span-tint', style: { left: `${pctOf(stops[i]?.km ?? 0)}%`, width: `${pctOf((stops[j]?.km ?? 0) - (stops[i]?.km ?? 0))}%` } });
    line.append(tint);
    stops.forEach((s, idx) => {
      const left = `${pctOf(s.km)}%`;
      line.append(h('div', { class: 'stop-tick', style: { left } }));
      const last = idx === stops.length - 1;
      const first = idx === 0;
      const cls = 'stop-name' + (last ? ' last' : '') + (first ? ' first' : '');
      const style: Record<string, string> = { left };
      if (last) { style.transform = 'translateX(-100%)'; style.left = '100%'; }
      line.append(h('div', { class: cls, style }, s.city));
    });
    strip.append(line);
    if (opts.interactive) {
      boardingHandle = h('button', {
        type: 'button', class: 'handle', role: 'slider', 'aria-label': 'Boarding stop',
        'aria-valuemin': '0', 'aria-valuemax': String(stops.length - 1),
        'aria-valuenow': String(i), 'aria-valuetext': state.boarding,
        ...motionAttrs('handle-snap', 160),
      }) as HTMLButtonElement;
      boardingHandle.style.left = `${pctOf(stops[i]?.km ?? 0)}%`;
      attachHandleKeys(boardingHandle, 'boarding');
      attachDrag(boardingHandle, 'boarding');
      alightingHandle = h('button', {
        type: 'button', class: 'handle', role: 'slider', 'aria-label': 'Alighting stop',
        'aria-valuemin': '0', 'aria-valuemax': String(stops.length - 1),
        'aria-valuenow': String(j), 'aria-valuetext': state.alighting,
        ...motionAttrs('handle-snap', 160),
      }) as HTMLButtonElement;
      alightingHandle.style.left = `${pctOf(stops[j]?.km ?? 0)}%`;
      attachHandleKeys(alightingHandle, 'alighting');
      attachDrag(alightingHandle, 'alighting');
      strip.append(boardingHandle, alightingHandle);
    }
  };

  const renderBands = (): void => {
    clear(bands);
    const i = indexOf(state.boarding);
    const j = indexOf(state.alighting);
    const chosen = new Set(chosenSeats());
    for (const row of state.seatMap) {
      const runs: Array<{ from: number; to: number; taken: boolean }> = [];
      for (let leg = 0; leg < legCount; leg++) {
        const taken = row.legs[leg] === 'taken';
        const last = runs[runs.length - 1];
        if (last && last.taken === taken) last.to = leg + 1;
        else runs.push({ from: leg, to: leg + 1, taken });
      }
      const band = h('div', { class: 'seat-band', role: 'img', 'aria-label': seatBandName(opts.ride, row) });
      for (const run of runs) {
        const left = pctOf(stops[run.from].km);
        const width = pctOf(stops[run.to].km - stops[run.from].km);
        const inside = i < run.to && j > run.from;
        const cls = run.taken ? 'seat-run' : inside ? (chosen.has(row.seat) ? 'seat-run chosen' : 'seat-run outlined') : 'seat-run';
        band.append(h('div', {
          class: cls, style: { left: `${left}%`, width: `${width}%` },
          'data-motion': 'seat-fill', 'data-motion-ms': reducedMotion() ? '0' : '280', 'data-state': 'done',
        }));
      }
      bands.append(band);
    }
  };

  const renderPrice = (): void => {
    priceFigure.textContent = money(segPrice() * state.seats);
    priceKm.textContent = `${segmentKm()} km`;
  };

  const announceSpan = (): void => {
    announce(`${state.boarding} to ${state.alighting}, ${segmentKm()} km, ${seatsFree()} ${seatsFree() === 1 ? 'seat' : 'seats'} free, ${money(segPrice() * state.seats)}`);
  };

  const apply = (): void => {
    renderStrip();
    renderBands();
    renderPrice();
  };

  const move = (which: 'boarding' | 'alighting', delta: number, extreme: 'home' | 'end' | null): void => {
    const bi = indexOf(state.boarding);
    const ai = indexOf(state.alighting);
    let next: number;
    if (which === 'boarding') {
      if (extreme === 'home') next = 0;
      else if (extreme === 'end') next = ai - 1;
      else next = bi + delta;
      next = Math.min(Math.max(next, 0), ai - 1);
      if (next === bi) return;
      state.boarding = stops[next].city;
    } else {
      if (extreme === 'home') next = bi + 1;
      else if (extreme === 'end') next = stops.length - 1;
      else next = ai + delta;
      next = Math.min(Math.max(next, bi + 1), stops.length - 1);
      if (next === ai) return;
      state.alighting = stops[next].city;
    }
    apply();
    announceSpan();
    opts.onSpanChange(state.boarding, state.alighting);
  };

  const attachHandleKeys = (handle: HTMLButtonElement, which: 'boarding' | 'alighting'): void => {
    handle.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'ArrowLeft' || ke.key === 'ArrowDown') { ke.preventDefault(); move(which, -1, null); }
      else if (ke.key === 'ArrowRight' || ke.key === 'ArrowUp') { ke.preventDefault(); move(which, 1, null); }
      else if (ke.key === 'Home') { ke.preventDefault(); move(which, 0, 'home'); }
      else if (ke.key === 'End') { ke.preventDefault(); move(which, 0, 'end'); }
    });
  };

  const attachDrag = (handle: HTMLButtonElement, which: 'boarding' | 'alighting'): void => {
    let dragging = false;
    const nearest = (clientX: number): number => {
      const rect = line.getBoundingClientRect();
      const ratio = (clientX - rect.left) / Math.max(1, rect.width);
      const km = ratio * stops[stops.length - 1].km;
      let best = 0;
      let bestDiff = Infinity;
      for (let k = 0; k < stops.length; k++) {
        const diff = Math.abs(stops[k].km - km);
        if (diff < bestDiff) { bestDiff = diff; best = k; }
      }
      return best;
    };
    const startDrag = (clientX: number): void => {
      dragging = true;
      const idx = nearest(clientX);
      const bi = indexOf(state.boarding);
      const ai = indexOf(state.alighting);
      if (which === 'boarding') {
        const next = Math.min(Math.max(idx, 0), ai - 1);
        if (next !== bi) { state.boarding = stops[next].city; apply(); }
      } else {
        const next = Math.min(Math.max(idx, bi + 1), stops.length - 1);
        if (next !== ai) { state.alighting = stops[next].city; apply(); }
      }
    };
    handle.addEventListener('mousedown', (e: MouseEvent) => { dragging = true; startDrag(e.clientX); });
    handle.addEventListener('touchstart', (e: TouchEvent) => { startDrag(e.touches[0].clientX); }, { passive: true });
    const onMove = (clientX: number): void => { if (dragging) startDrag(clientX); };
    window.addEventListener('mousemove', (e: MouseEvent) => onMove(e.clientX));
    window.addEventListener('touchmove', (e: TouchEvent) => onMove(e.touches[0].clientX), { passive: true });
    const end = (): void => {
      if (!dragging) return;
      dragging = false;
      apply();
      announceSpan();
      opts.onSpanChange(state.boarding, state.alighting);
    };
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
  };

  apply();

  return {
    root,
    refresh(update: { seatMap: SeatRow[]; boarding: string; alighting: string; seats: number }): void {
      state.seatMap = update.seatMap;
      if (update.boarding !== state.boarding || update.alighting !== state.alighting) {
        state.boarding = update.boarding;
        state.alighting = update.alighting;
      }
      state.seats = update.seats;
      apply();
    },
  };
}
