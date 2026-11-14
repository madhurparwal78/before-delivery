import { findRoute, type PathStep } from "./graph.ts";
import { CLEARED_BAY, FORWARD_VERB, dueTimer, offerTimer, slotTimer, wakeTimer } from "./rules.ts";
import type { StripTimer } from "../../shared/wire.ts";
import { wakeRemaining, type Sim } from "./engine.ts";
import type { Aircraft, StripCopy } from "./state.ts";
import type { AircraftPosition, AircraftRow, Bay, CopyState, ForwardMove, Position, RunRow, StripRow } from "../../shared/wire.ts";

const segmentIds = (path: PathStep[]): string[] => path.flatMap((step) => (step.kind === "segment" ? [step.segment] : []));

const positionOf = (aircraft: Aircraft): AircraftPosition => ({
  callsign: aircraft.callsign,
  status: aircraft.status,
  segment: aircraft.segment,
  from: aircraft.segment !== null && aircraft.path[0]?.kind === "segment" ? aircraft.path[0].from : null,
  node: aircraft.node,
  progress: aircraft.progress,
});

export const aircraftRows = (sim: Sim): AircraftRow[] =>
  sim.state.aircraft.filter((aircraft) => aircraft.appeared).map((aircraft) => ({ ...positionOf(aircraft), route: segmentIds(aircraft.path) }));

/** The accepted taxi runs that are still lit: from the clearance until the aircraft lines up. */
export function runRows(sim: Sim): RunRow[] {
  return sim.state.aircraft.flatMap((aircraft) => (aircraft.run ? [{ callsign: aircraft.callsign, position: aircraft.run.position, stop: aircraft.run.stop }] : []));
}

const taxiwayOfLastSegment = (sim: Sim, aircraft: Aircraft, point: string): string | null => {
  const route = findRoute(sim.graph, aircraft.node ?? aircraft.stand ?? "", point, []);
  const last = route ? [...route].reverse().find((step) => step.kind === "segment") : undefined;
  return last && last.kind === "segment" ? (sim.graph.segments.get(last.segment)?.taxiway ?? null) : null;
};

function forwardMove(sim: Sim, aircraft: Aircraft, copy: StripCopy, holdingPoint: string | null): ForwardMove | null {
  const cs = aircraft.callsign;
  const rwy = sim.state.runwayInUse;
  if (copy.state === "transferred") return null;
  if (copy.bay === "Incoming") return { to: "Holding", line: null };
  const verb = FORWARD_VERB[copy.bay];
  if (!verb) return null;
  const to = CLEARED_BAY[verb];
  switch (verb) {
    case "PUSH":
      return { to, line: `${cs} PUSH APPROVED` };
    case "TAXI": {
      const taxiway = holdingPoint ? taxiwayOfLastSegment(sim, aircraft, holdingPoint) : null;
      const via = taxiway ? ` VIA ${taxiway}` : "";
      return { to, line: `${cs} TAXI HP ${holdingPoint ?? ""}${via}` };
    }
    case "CONTACT":
      return { to, line: `${cs} CONTACT TOWER` };
    case "LINEUP":
      return { to, line: `${cs} LINEUP ${rwy}` };
    case "TAKEOFF":
      return { to, line: `${cs} CLEARED TAKEOFF ${rwy}` };
    case "LAND":
      return { to, line: `${cs} CLEARED LAND ${aircraft.runway ?? ""}` };
  }
}

function timersOf(sim: Sim, aircraft: Aircraft, copy: StripCopy): StripTimer[] {
  const timers: StripTimer[] = [];
  if (aircraft.offerLeft !== null && copy.state === "offered") timers.push(offerTimer(aircraft.offerLeft));
  if ((copy.bay === "Holding" || copy.bay === "Line up") && aircraft.kind === "dep") {
    const left = wakeRemaining(sim, aircraft);
    if (left > 0) timers.push(wakeTimer(left));
  }
  if (copy.bay === "Arrivals" && aircraft.status === "final" && aircraft.due !== null) timers.push(dueTimer(aircraft.due));
  if (aircraft.kind === "dep" && aircraft.slotSeconds !== null && aircraft.takeoffStart === null) {
    const end = sim.setup.scenarioStart + aircraft.slotSeconds + sim.timers.slotToleranceSeconds;
    timers.push(slotTimer(end - sim.state.simTime));
  }
  return timers;
}

export function stripRows(sim: Sim): StripRow[] {
  return [...sim.state.copies]
    .sort((a, b) => a.entered - b.entered)
    .flatMap((copy) => {
      const flight = sim.state.aircraft.find((x) => x.callsign === copy.callsign);
      const stripRecord = sim.state.strips[copy.callsign];
      if (!flight || !stripRecord) return [];
      return [
        {
          callsign: flight.callsign,
          board: copy.board,
          bay: copy.bay,
          frequency: copy.frequency,
          state: copy.state,
          version: stripRecord.version,
          cleared: stripRecord.cleared,
          timers: timersOf(sim, flight, copy),
          kind: flight.kind,
          type: flight.type,
          wake: flight.wake,
          rules: flight.rules,
          stand: flight.stand,
          runway: flight.runway,
          holdingPoint: stripRecord.holdingPoint,
          remarks: stripRecord.remarks,
          goAround: stripRecord.goAround,
          emergency: stripRecord.emergency,
          forward: forwardMove(sim, flight, copy, stripRecord.holdingPoint),
          back: copy.bay === "Hand-off" && copy.state === "offered" ? "Taxi" : null,
        },
      ];
    });
}

export interface Frame {
  aircraft: AircraftPosition[];
  strips: { callsign: string; board: Position; bay: Bay; state: CopyState }[];
}

/** What the replay shows for one persisted sim second. */
export function frameOf(sim: Sim): Frame {
  return {
    aircraft: sim.state.aircraft.filter((aircraft) => aircraft.appeared).map(positionOf),
    strips: [...sim.state.copies]
      .sort((a, b) => a.entered - b.entered)
      .map((c) => ({ callsign: c.callsign, board: c.board, bay: c.bay, state: c.state })),
  };
}
