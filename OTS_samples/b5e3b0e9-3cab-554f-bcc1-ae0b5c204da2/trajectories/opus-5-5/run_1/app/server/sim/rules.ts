import { durationText } from '../../shared/time.js';
import type { Command } from './grammar.js';
import { type Aircraft, type Alert, type Leg, OCCUPYING, type SimState, type Wake, WAKE_MINIMUM } from './model.js';

export interface RuleContext {
  state: SimState;
  wakeOf(callsign: string): Wake;
  arrivalProtectSeconds: number;
}

const byCallsign = (state: SimState) => Object.keys(state.aircraft).sort();

/** Seconds of wake minimum still to run for `callsign` behind the last takeoff, or null when none applies. */
export function wakeRemaining(ctx: RuleContext, callsign: string): { required: number; elapsed: number } | null {
  const leader = ctx.state.lastTakeoff;
  if (!leader || leader.callsign === callsign) return null;
  const required = WAKE_MINIMUM[leader.wake][ctx.wakeOf(callsign)];
  const elapsed = ctx.state.now - leader.start;
  return elapsed < required ? { required, elapsed } : null;
}

function runwayOccupant(state: SimState, callsign: string): Aircraft | null {
  const occupants = Object.values(state.aircraft)
    .filter((a) => a.callsign !== callsign && OCCUPYING.includes(a.status))
    .sort((a, b) => (a.runwayEntry ?? 0) - (b.runwayEntry ?? 0));
  return occupants[0] ?? null;
}

function nearestArrival(ctx: RuleContext): Aircraft | null {
  const arrivals = byCallsign(ctx.state)
    .map((cs) => ctx.state.aircraft[cs]!)
    .filter((a) => a.status === 'final' && a.due !== null && a.due <= ctx.arrivalProtectSeconds)
    .sort((a, b) => a.due! - b.due!);
  return arrivals[0] ?? null;
}

export interface TaxiConflicts {
  alerts: Alert[];
  marks: { segment: string; rule: 'R4' }[];
}

/** R4: shared segments in the opposite direction, or a shared final holding point. */
export function taxiConflicts(state: SimState, callsign: string, legs: Leg[], point: string): TaxiConflicts {
  const newSegments = legs.filter((leg) => leg.kind === 'seg');
  const conflicted = new Set<string>();
  let pointConflict = false;
  const alerts: Alert[] = [];
  for (const other of byCallsign(state)) {
    if (other === callsign) continue;
    const aircraft = state.aircraft[other]!;
    let where: string | null = null;
    if (aircraft.status === 'taxiing' || aircraft.status === 'stopped') {
      const theirs = aircraft.legs.filter((leg) => leg.kind === 'seg');
      for (const leg of newSegments) {
        if (theirs.some((their) => their.id === leg.id && their.from === leg.to)) {
          conflicted.add(leg.id);
          where ??= leg.id;
        }
      }
    }
    const last = aircraft.legs[aircraft.legs.length - 1];
    const headingThere = last !== undefined && last.to === point;
    const holdingThere = aircraft.status === 'holding' && aircraft.node === point && aircraft.legs.length === 0;
    if (headingThere || holdingThere) {
      pointConflict = true;
      where ??= point;
    }
    if (where) alerts.push({ rule: 'R4', text: `Taxi conflict on ${where}: ${other} and ${callsign}.`, callsign });
  }
  const marks = newSegments.filter((leg) => conflicted.has(leg.id)).map((leg) => ({ segment: leg.id, rule: 'R4' as const }));
  if (pointConflict) marks.push({ segment: point, rule: 'R4' });
  return { alerts, marks };
}

/** Alerts raised by an accepted clearance, in rule order. */
export function clearanceAlerts(ctx: RuleContext, callsign: string, command: Command, legs: Leg[] | null): Alert[] {
  const { state } = ctx;
  if (command.verb === 'TAXI') return taxiConflicts(state, callsign, legs ?? [], command.point).alerts;
  if (command.verb !== 'LINEUP' && command.verb !== 'TAKEOFF' && command.verb !== 'LAND' && command.verb !== 'CROSS') return [];
  const runway = command.runway;
  if (state.closed) return [{ rule: 'R8', text: `Runway ${runway} is closed.`, callsign }];
  const alerts: Alert[] = [];
  const occupant = runwayOccupant(state, callsign);
  if (occupant) alerts.push({ rule: 'R1', text: `Runway ${runway} occupied by ${occupant.callsign}.`, callsign });
  if (command.verb === 'TAKEOFF') {
    const wake = wakeRemaining(ctx, callsign);
    const leader = state.lastTakeoff;
    if (wake && leader) {
      alerts.push({
        rule: 'R2',
        text: `Wake: ${durationText(wake.required)} required behind ${leader.callsign} (${leader.wake}), ${durationText(wake.elapsed)} elapsed.`,
        callsign,
      });
    }
  }
  if (command.verb === 'LINEUP' || command.verb === 'TAKEOFF') {
    const arrival = nearestArrival(ctx);
    if (arrival) {
      alerts.push({
        rule: 'R3',
        text: `Arrival ${arrival.callsign} due in ${durationText(arrival.due!)}; departure not allowed.`,
        callsign,
      });
    }
  }
  return alerts;
}
