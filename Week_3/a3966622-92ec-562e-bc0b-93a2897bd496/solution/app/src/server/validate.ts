// Request validation: every failure becomes one message under its field in a single 422.
import { decimalsOf, DRAUGHT_MAX_MM, DRAUGHT_MIN_MM, draughtMmFromFeet, draughtMmFromMetres } from "../shared/draught.js";
import { readPortMinute, SKIPPED_TIME, STEP_MINUTES } from "../shared/portTime.js";
import { invalid } from "./errors.js";
import type { VesselRecord } from "./store.js";


export function objectBody(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid({ body: "Send a JSON object" });
  return body as Record<string, unknown>;
}

export interface Boarding {
  at: string;
  instant: number;
  date: string;
  minutes: number;
}

export class Fields {
  readonly errors: Record<string, string> = {};

  constructor(readonly body: Record<string, unknown>) {}

  has(name: string): boolean {
    return this.body[name] !== undefined;
  }

  fail(name: string, message: string): void {
    this.errors[name] ??= message;
  }

  number(name: string, min: number, max: number, places: number, message: string): number | undefined {
    const value = this.body[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || decimalsOf(value) > places) {
      this.fail(name, message);
      return undefined;
    }
    return value;
  }

  text(name: string, min: number, max: number, message: string): string | undefined {
    const value = this.body[name];
    if (typeof value !== "string" || value.trim().length < min || value.length > max) {
      this.fail(name, message);
      return undefined;
    }
    return value;
  }

  /** A port boarding time: it must exist on its date, fall on a 5-minute step and, if asked, lie ahead. */
  boarding(name: string, laterThan: number | null): Boarding | undefined {
    const value = this.body[name];
    const read = typeof value === "string" ? readPortMinute(value) : { kind: "malformed" as const };
    if (read.kind === "skipped") return void this.fail(name, SKIPPED_TIME);
    if (read.kind === "malformed") return void this.fail(name, "Give the boarding time as YYYY-MM-DDTHH:MM port time");
    if (read.minutes % STEP_MINUTES !== 0) return void this.fail(name, "Boarding times fall on 5-minute steps");
    if (laterThan !== null && read.instant <= laterThan) return void this.fail(name, "That boarding time has passed");
    return { at: value as string, instant: read.instant, date: read.date, minutes: read.minutes };
  }

  /** Exactly one draught input: `draught_m`, or `draught_ft` with `draught_in`. */
  draught(): number | undefined {
    const metres = this.has("draught_m");
    const feet = this.has("draught_ft") || this.has("draught_in");
    if (metres === feet) return void this.fail("draught_m", "Give the draught in metres, or in feet and inches");
    const ft = this.body.draught_ft;
    const inches = this.body.draught_in;
    const mm = metres
      ? typeof this.body.draught_m === "number" ? draughtMmFromMetres(this.body.draught_m) : null
      : typeof ft === "number" && typeof inches === "number" ? draughtMmFromFeet(ft, inches) : null;
    if (mm === null || mm < DRAUGHT_MIN_MM || mm > DRAUGHT_MAX_MM) {
      return void this.fail(metres ? "draught_m" : "draught_ft", "Draught must be from 2.000 to 16.000 m");
    }
    return mm;
  }

  failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }
}

interface OrderValues {
  speed_kn: number;
  draught_mm: number;
  block_coefficient: number;
  gross_tonnage: number;
  length_m: number;
}

/** The plan inputs of an order or plan request, vessel defaults filling the optional details. */
export function orderValues(fields: Fields, vessel: VesselRecord): OrderValues | undefined {
  const speed = fields.number("speed_kn", 3, 16, 2, "Speed must be from 3 to 16 knots");
  const draught = fields.draught();
  const cb = fields.has("block_coefficient")
    ? fields.number("block_coefficient", 0.4, 0.95, 3, "Block coefficient must be from 0.40 to 0.95")
    : vessel.block_coefficient;
  const gt = fields.has("gross_tonnage")
    ? fields.number("gross_tonnage", 1, 1_000_000, 0, "Gross tonnage must be a whole number from 1 to 1,000,000")
    : vessel.gross_tonnage;
  const length = fields.has("length_m")
    ? fields.number("length_m", 10, 500, 1, "Length must be from 10 to 500 m")
    : vessel.length_m;
  if (speed === undefined || draught === undefined || cb === undefined || gt === undefined || length === undefined) return undefined;
  return { speed_kn: speed, draught_mm: draught, block_coefficient: cb, gross_tonnage: gt, length_m: length };
}

export const DUTY_MESSAGE = "Duty must be a whole number of minutes from 30 to 1440";
