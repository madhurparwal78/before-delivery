// The embargo dial: a 24-hour ring with 96 quarter-hour ticks, a dark night arc,
// the vermilion hand and six concentric market pins. The slider steps by the
// published keys without wrapping, and the hand turns over 280 milliseconds.
import { el } from './ui.js';
import { pad2, spokenCopenhagen, partsIn, isNightLocal } from './format.js';
import { MARKETS } from './api.js';

export interface DialUpdate {
  date: string;       // YYYY-MM-DD Copenhagen
  hour: number;       // 0..23
  minute: number;     // 0, 15, 30, 45
  type: 'simultaneous' | 'rolling';
  utc: string | null; // instant of the Copenhagen market, null in the gap
}

export interface DialParts {
  group: HTMLElement;      // role=group aria-label="Embargo dial", carries data-utc
  slider: HTMLInputElement;
  root: SVGSVGElement;
  handGroup: SVGGElement;
  pins: Map<string, { group: SVGGElement; label: SVGTextElement; timeText: SVGTextElement }>;
  centreText: SVGTextElement;
}

const CX = 260;
const CY = 260;

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function buildDial(onChange: (hour: number, minute: number) => void): DialParts {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg') as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 520 520');
  svg.setAttribute('class', 'dial-svg');
  svg.setAttribute('aria-hidden', 'true');

  // Night arc from 22:00 round to 07:00.
  const nightStart = 22 * 15;      // quarter index
  const nightEnd = 7 * 15;
  const arc = describeArc(CX, CY, 190, nightStart * 1.5, nightEnd * 1.5 - 360);
  const nightArc = document.createElementNS(ns, 'path');
  nightArc.setAttribute('d', arc);
  nightArc.setAttribute('fill', 'var(--night)');
  nightArc.setAttribute('opacity', '0.92');
  svg.append(nightArc);

  // 96 fine ticks, longer each hour, numerals every 3 hours.
  for (let q = 0; q < 96; q++) {
    const isHour = q % 4 === 0;
    const outer = 230;
    const len = isHour ? 14 : 7;
    const p1 = polar(CX, CY, outer, q * 1.5);
    const p2 = polar(CX, CY, outer - len, q * 1.5);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(p1.x)); line.setAttribute('y1', String(p1.y));
    line.setAttribute('x2', String(p2.x)); line.setAttribute('y2', String(p2.y));
    line.setAttribute('stroke', isHour ? 'var(--ink)' : 'var(--rule)');
    line.setAttribute('stroke-width', isHour ? '2' : '1');
    svg.append(line);
    if (q % 12 === 0) {
      const pt = polar(CX, CY, outer - 30, q * 1.5);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(pt.x)); text.setAttribute('y', String(pt.y + 5));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'pin-label');
      text.setAttribute('fill', 'var(--ink-soft)');
      text.textContent = String(q / 4).padStart(2, '0');
      svg.append(text);
    }
  }

  // Six concentric rings, outermost Copenhagen … innermost Tokyo.
  const pins = new Map<string, { group: SVGGElement; label: SVGTextElement; timeText: SVGTextElement }>();
  MARKETS.forEach((m, i) => {
    const r = 168 - i * 18;
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', String(CX)); ring.setAttribute('cy', String(CY));
    ring.setAttribute('r', String(r));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'var(--rule)');
    ring.setAttribute('stroke-width', '1');
    ring.setAttribute('stroke-dasharray', '2 4');
    svg.append(ring);
    const g = document.createElementNS(ns, 'g') as unknown as SVGGElement;
    g.setAttribute('class', 'dial-pin');
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '4.6');
    dot.setAttribute('fill', 'var(--ink)');
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('class', 'pin-label');
    label.setAttribute('fill', 'var(--ink)');
    const timeText = document.createElementNS(ns, 'text');
    timeText.setAttribute('class', 'pin-label');
    timeText.setAttribute('fill', 'var(--ink)');
    g.append(dot, label, timeText);
    svg.append(g);
    pins.set(m.market, { group: g, label, timeText });
  });

  // The hand follows the slider's straight range from 00:00 to 23:45 and never
  // crosses the top.
  const handGroup = document.createElementNS(ns, 'g') as unknown as SVGGElement;
  handGroup.setAttribute('class', 'dial-hand');
  const handLine = document.createElementNS(ns, 'line');
  handLine.setAttribute('x1', String(CX)); handLine.setAttribute('y1', String(CY));
  const tip = polar(CX, CY, 236, 0);
  handLine.setAttribute('x2', String(tip.x)); handLine.setAttribute('y2', String(tip.y));
  handLine.setAttribute('stroke', 'var(--vermilion)');
  handLine.setAttribute('stroke-width', '4');
  handLine.setAttribute('stroke-linecap', 'round');
  const hub = document.createElementNS(ns, 'circle');
  hub.setAttribute('cx', String(CX)); hub.setAttribute('cy', String(CY));
  hub.setAttribute('r', '6'); hub.setAttribute('fill', 'var(--vermilion)');
  handGroup.append(handLine, hub);
  svg.append(handGroup);

  const centreText = document.createElementNS(ns, 'text');
  centreText.setAttribute('x', String(CX)); centreText.setAttribute('y', String(CY + 44));
  centreText.setAttribute('class', 'dial-centre');
  centreText.setAttribute('fill', 'var(--ink)');
  svg.append(centreText);

  // The ring is pressable: pointer events move the hand to the nearest quarter.
  svg.addEventListener('pointerdown', (e: PointerEvent) => {
    svg.setPointerCapture?.(e.pointerId);
    moveToPointer(e);
  });
  svg.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    if ((e.buttons ?? 0) !== 0 || (e.pressure ?? 0) > 0) moveToPointer(e);
  });
  function moveToPointer(e: PointerEvent): void {
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    let deg = Math.atan2(x, -y) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    const quarters = Math.round(deg / 1.5) % 96;
    const hour = Math.floor(quarters / 4);
    const minute = (quarters % 4) * 15;
    if (minute % 15 === 0) onChange(hour, minute);
  }

  const slider = el('input', { type: 'range', min: '0', max: '95', step: '1', value: '40', 'aria-label': 'Drop time', class: 'dial-slider' }) as HTMLInputElement;
  const describedBy = el('span', { id: 'dial-value', class: 'sr-only', role: 'presentation' });
  slider.addEventListener('input', () => {
    const q = Number(slider.value);
    onChange(Math.floor(q / 4), (q % 4) * 15);
  });
  const group = el('div', { class: 'dial-wrap', role: 'group', 'aria-label': 'Embargo dial' }) as HTMLElement;
  group.append(slider, svg, describedBy);
  (group as HTMLElement & { _slider: HTMLInputElement })._slider = slider;
  group.dataset.utc = '';
  return { group, slider, root: svg, handGroup, pins, centreText };
}

// Pin angles take the shorter way round their own ring; exactly half turns go
// clockwise. The hand follows the slider's range without crossing the top.
export function updateDial(parts: DialParts, state: DialUpdate, pins: { market: string; city: string; localParts: { hh: number; mm: number } | null; night: boolean; utc: string | null }[], centre: string): void {
  const quarters = state.hour * 4 + Math.floor(state.minute / 15);
  const prevQ = Number(parts.handGroup.dataset.q ?? quarters);
  parts.handGroup.dataset.q = String(quarters);
  // The hand follows the slider's straight range: later turns clockwise, earlier
  // anticlockwise, never wrapping past the top.
  const turn = Number(parts.handGroup.dataset.turn ?? 0) + (quarters - prevQ) * 1.5;
  parts.handGroup.dataset.turn = String(turn);
  parts.handGroup.style.transformOrigin = `${CX}px ${CY}px`;
  parts.handGroup.style.transform = `rotate(${turn}deg)`;

  parts.slider.value = String(quarters);
  parts.slider.setAttribute('aria-valuetext', spokenCopenhagen(state.date, state.hour, state.minute));
  parts.centreText.textContent = centre;

  parts.group.dataset.utc = state.utc ?? '';

  MARKETS.forEach((m, i) => {
    const pin = parts.pins.get(m.market);
    if (!pin) return;
    const r = 168 - i * 18;
    const info = pins.find(p => p.market === m.market);
    if (!info || !info.localParts) {
      pin.group.setAttribute('data-local-time', '');
      pin.group.setAttribute('data-utc', '');
      pin.group.setAttribute('data-night', 'false');
      pin.label.textContent = `${m.city} —`;
      pin.timeText.textContent = '';
      pin.group.style.transform = '';
      return;
    }
    const localQuarters = info.localParts.hh * 4 + Math.floor(info.localParts.mm / 15);
    const pos = polar(CX, CY, r, localQuarters * 1.5);
    const prev = pin.group.dataset.q ? Number(pin.group.dataset.q) : localQuarters;
    pin.group.dataset.q = String(localQuarters);
    // Shorter way round, half turns clockwise.
    let diff = localQuarters - prev;
    if (diff > 48) diff -= 96;
    if (diff < -48) diff += 96;
    if (diff === -48) diff = 48;
    pin.group.dataset.turn = String(Number(pin.group.dataset.turn ?? 0) + diff);
    pin.group.style.transformOrigin = `${CX}px ${CY}px`;
    pin.group.style.transform = `rotate(${pin.group.dataset.turn}deg)`;
    const dot = pin.group.querySelector('circle');
    if (dot) {
      dot.setAttribute('cx', String(pos.x));
      dot.setAttribute('cy', String(pos.y));
    }
    pin.label.setAttribute('x', String(pos.x + 10));
    pin.label.setAttribute('y', String(pos.y - 2));
    pin.label.textContent = `${m.city} ${pad2(info.localParts.hh)}:${pad2(info.localParts.mm)}`;
    pin.timeText.setAttribute('x', String(pos.x + 10));
    pin.timeText.setAttribute('y', String(pos.y + 12));
    pin.timeText.textContent = info.night ? '☾ Night' : '';
    pin.group.setAttribute('data-market', m.market);
    pin.group.setAttribute('data-local-time', `${pad2(info.localParts.hh)}:${pad2(info.localParts.mm)}`);
    pin.group.setAttribute('data-utc', info.utc ?? '');
    pin.group.setAttribute('data-night', info.night ? 'true' : 'false');
  });
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const p0 = polar(cx, cy, r, startDeg);
  const p1 = polar(cx, cy, r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg > startDeg ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} ${sweep} ${p1.x} ${p1.y}`;
}

export function localPartsOf(instant: Date, market: string): { hh: number; mm: number } | null {
  const p = partsIn(instant, zoneOfMarket(market));
  return { hh: p.hh, mm: p.mm };
}

export function nightOf(instant: Date, market: string): boolean {
  return isNightLocal(instant, market);
}

function zoneOfMarket(market: string): string {
  const map: Record<string, string> = {
    copenhagen: 'Europe/Copenhagen', stockholm: 'Europe/Stockholm', paris: 'Europe/Paris',
    london: 'Europe/London', new_york: 'America/New_York', tokyo: 'Asia/Tokyo'
  };
  return map[market] ?? 'Europe/Copenhagen';
}
