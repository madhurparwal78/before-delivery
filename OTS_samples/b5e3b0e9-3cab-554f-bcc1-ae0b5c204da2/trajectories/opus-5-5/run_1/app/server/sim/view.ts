import type { AircraftView, AlertView, ReplayView, StripMoveView, StripView, TimerView } from '../../shared/types.js';
import { clockText, durationText } from '../../shared/time.js';
import { boardOf, type Engine } from './engine.js';
import { RULES, type Strip } from './model.js';
import { findRoute, segmentIds } from './routes.js';
import { wakeRemaining } from './rules.js';

const NEAR = { wake: 15, offer: 15, due: 120, slot: 60 };

function timer(kind: TimerView['kind'], label: string, seconds: number): TimerView {
  return { kind, text: `${label} ${durationText(seconds)}`, near: seconds <= NEAR[kind] };
}

function taxiPrefill(engine: Engine, strip: Strip): string {
  const point = strip.holdingPoint;
  if (!point) return `${strip.callsign} TAXI HP`;
  const legs = findRoute(engine.airfield, engine.state.aircraft[strip.callsign]!, point, []);
  const last = legs?.filter((leg) => leg.kind === 'seg').pop();
  const taxiway = last ? engine.airfield.segments.get(last.id)!.taxiway.toUpperCase() : null;
  return `${strip.callsign} TAXI HP ${point}${taxiway ? ` VIA ${taxiway}` : ''}`;
}

/** The forward move a strip may make from its bay, with the clearance it needs. */
function forwardMove(engine: Engine, strip: Strip): StripMoveView | null {
  const cs = strip.callsign;
  const runway = engine.state.runwayInUse;
  switch (strip.bay) {
    case 'Pending':
      return { to: 'Pushback', command: `${cs} PUSH APPROVED` };
    case 'Pushback':
      return { to: 'Taxi', command: taxiPrefill(engine, strip) };
    case 'Taxi':
      return { to: 'Hand-off', command: `${cs} CONTACT TOWER` };
    case 'Holding':
      return { to: 'Line up', command: `${cs} LINEUP ${runway}` };
    case 'Line up':
      return { to: 'Departed', command: `${cs} CLEARED TAKEOFF ${runway}` };
    case 'Arrivals':
      return { to: 'Landed', command: `${cs} CLEARED LAND ${strip.runway}` };
    default:
      return null;
  }
}

function timersFor(engine: Engine, strip: Strip, copy: 'main' | 'offer'): TimerView[] {
  const s = engine.state;
  const item = engine.item(strip.callsign);
  const aircraft = s.aircraft[strip.callsign]!;
  const timers: TimerView[] = [];
  if (copy === 'main' && (strip.bay === 'Holding' || strip.bay === 'Line up')) {
    const wake = wakeRemaining(engine, strip.callsign);
    if (wake) timers.push(timer('wake', 'Wake', wake.required - wake.elapsed));
  }
  if (strip.offer) timers.push(timer('offer', 'Offer', Math.max(0, strip.offer.expiresAt - s.now)));
  if (aircraft.status === 'final' && aircraft.due !== null) timers.push(timer('due', 'Due', Math.max(0, aircraft.due)));
  if (item.kind === 'dep' && item.slotSeconds !== null && aircraft.takeoffStart === null) {
    const left = engine.startTime + item.slotSeconds + engine.timers.slotToleranceSeconds - s.now;
    timers.push(left >= 0 ? timer('slot', 'Slot', left) : { kind: 'slot', text: `Slot late ${durationText(-left)}`, near: true });
  }
  return timers;
}

export function stripViews(engine: Engine): StripView[] {
  const copies: { seq: number; view: StripView }[] = [];
  for (const strip of Object.values(engine.state.strips)) {
    const item = engine.item(strip.callsign);
    const base = {
      callsign: strip.callsign,
      version: strip.version,
      cleared: strip.cleared,
      kind: item.kind === 'dep' ? ('DEP' as const) : ('ARR' as const),
      type: item.type,
      wake: item.wake,
      rules: item.rules,
      stand: item.kind === 'dep' ? item.stand : null,
      runway: strip.runway,
      holdingPoint: strip.holdingPoint,
      remarks: strip.remarks,
      emergency: strip.emergency,
      goAround: strip.goAround,
    };
    if (strip.offer) {
      const timers = timersFor(engine, strip, 'offer');
      copies.push({
        seq: strip.seq,
        view: { ...base, board: 'GND', bay: 'Hand-off', frequency: strip.frequency, state: 'offered', timers, forward: null, back: { to: 'Taxi', command: null } },
      });
      copies.push({
        seq: strip.offer.seq,
        view: { ...base, board: 'TWR', bay: 'Incoming', frequency: strip.frequency, state: 'offered', timers, forward: { to: 'Holding', command: null }, back: null },
      });
      continue;
    }
    copies.push({
      seq: strip.seq,
      view: {
        ...base,
        board: boardOf(strip.bay),
        bay: strip.bay,
        frequency: strip.frequency,
        state: 'active',
        timers: timersFor(engine, strip, 'main'),
        forward: forwardMove(engine, strip),
        back: null,
      },
    });
    if (strip.transferredSeq !== null) {
      copies.push({
        seq: strip.transferredSeq,
        view: { ...base, board: 'GND', bay: 'Hand-off', frequency: strip.frequency, state: 'transferred', timers: [], forward: null, back: null },
      });
    }
  }
  return copies.sort((a, b) => a.seq - b.seq).map((copy) => copy.view);
}

export function aircraftViews(engine: Engine): AircraftView[] {
  return Object.keys(engine.state.aircraft)
    .sort()
    .map((callsign) => {
      const a = engine.state.aircraft[callsign]!;
      return {
        callsign,
        status: a.status,
        segment: a.segment,
        node: a.segment === null ? a.node : null,
        progress: a.progress,
        from: a.segment !== null ? (a.legs[0]?.from ?? null) : null,
        route: segmentIds(a.legs),
        stop: a.stop,
        routeBy: a.routeBy,
        emergency: a.emergency,
      };
    });
}

export function alertViews(engine: Engine): AlertView[] {
  return engine.state.log
    .filter((row) => row.kind === 'alert' && row.rule)
    .map((row) => ({ simTime: clockText(row.simTime), rule: row.rule!, text: row.text, severity: RULES[row.rule!].severity }));
}

export function snapshot(engine: Engine): ReplayView {
  return {
    simTime: engine.simClock,
    aircraft: aircraftViews(engine).map(({ callsign, status, segment, node, progress, from }) => ({
      callsign,
      status,
      segment,
      node,
      progress,
      from,
    })),
    strips: stripViews(engine).map(({ callsign, bay }) => ({ callsign, bay })),
  };
}
