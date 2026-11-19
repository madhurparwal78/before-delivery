import { LANES, type Input } from "../../shared/model";

// The published driving keys, shared by the solo race and the lobby race.
export const DRIVING_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "W", "a", "A", "s", "S", "d", "D", " "]);
const THROTTLE = ["ArrowUp", "w", "W"];
const BRAKE = ["ArrowDown", "s", "S"];
const LEFT = ["ArrowLeft", "a", "A"];
const RIGHT = ["ArrowRight", "d", "D"];

// The lane one to the left or right of the requested lane; the outer lanes stay put.
export function laneAfter(requested: number, key: string): number {
  if (LEFT.includes(key)) return Math.max(0, requested - 1);
  if (RIGHT.includes(key)) return Math.min(LANES.length - 1, requested + 1);
  return requested;
}

export function inputFrom(held: ReadonlySet<string>, requestedLane: number): Input {
  return {
    throttle: THROTTLE.some((key) => held.has(key)) ? 1 : 0,
    brake: BRAKE.some((key) => held.has(key)) ? 1 : 0,
    drift: held.has(" ") ? 1 : 0,
    lane: LANES[requestedLane],
  };
}
