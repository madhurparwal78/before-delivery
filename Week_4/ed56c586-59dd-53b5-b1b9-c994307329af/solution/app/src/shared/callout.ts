import { type Callout } from "./catalog.js";

/** The Callout Thread: selecting a callout shows its first frame, then steps one frame every 150 ms to its last. */

export const CALLOUT_STEP_MS = 150;
const CALLOUT_COUNT = 3;
export const CALLOUT_PARAM = "callout";
export const NO_CALLOUT_READOUT = "No callout selected";

export function calloutFrameAt(callout: Callout, elapsedMs: number): number {
  return Math.min(callout.lastFrame, callout.firstFrame + Math.floor(elapsedMs / CALLOUT_STEP_MS));
}

export function calloutPosition(number: number): string {
  return `Callout ${number} of ${CALLOUT_COUNT}`;
}

export function calloutRange(callout: Callout): string {
  return `${callout.firstFrame}–${callout.lastFrame}`;
}

export function calloutReadout(number: number, callout: Callout): string {
  return `${calloutPosition(number)} · frames ${calloutRange(callout)}`;
}

export function calloutButtonLabel(number: number, callout: Callout): string {
  return `Callout ${number}: ${callout.label}`;
}

/** The callout number an address value selects, or undefined for anything but a published callout. */
export function parseCalloutParam(raw: string | null): number | undefined {
  const number = Number(raw);
  return raw !== null && /^\d$/.test(raw) && number >= 1 && number <= CALLOUT_COUNT ? number : undefined;
}
