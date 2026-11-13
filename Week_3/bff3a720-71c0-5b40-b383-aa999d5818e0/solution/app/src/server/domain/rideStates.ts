import type { RideState } from "../../shared/api";

/** A ride in these states is public and bookable until its booking cutoff; every edit starts from them. */
export const OPEN_RIDE_STATES: readonly RideState[] = ["published", "changed"];

export function isOpenRide(state: RideState): boolean {
  return OPEN_RIDE_STATES.includes(state);
}

/** Open rides that have not yet arrived: the ones the departure and arrival sweep still has to move. */
export const UNARRIVED_RIDE_STATES: readonly RideState[] = [...OPEN_RIDE_STATES, "departed"];
