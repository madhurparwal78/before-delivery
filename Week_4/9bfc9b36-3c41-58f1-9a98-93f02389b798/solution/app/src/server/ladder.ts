/**
 * The one refusal ladder (brief: Refusal ladder), highest rank first. A request that breaks several rules
 * answers only the refusal on the highest rung; every endpoint ranks its refusals through this table.
 */
import { FieldErrors, type Refusal } from "./errors.js";

const RUNGS: readonly { status: number; code?: string }[] = [
  { status: 413 },
  { status: 415 },
  { status: 401 },
  { status: 404 },
  { status: 403 },
  { status: 428 },
  { status: 412 },
  { status: 409, code: "sealed" },
  { status: 409 },
  { status: 429 },
  { status: 422 },
];

const rungOf = (refusal: Refusal): number =>
  RUNGS.findIndex((rung) => rung.status === refusal.status && (rung.code === undefined || rung.code === refusal.body.error));

/** Collects the refusals a request earns and throws the highest-ranked one. */
export class Ladder {
  private top: Refusal | null = null;

  consider(refusal: Refusal | null): void {
    if (refusal && (this.top === null || rungOf(refusal) < rungOf(this.top))) this.top = refusal;
  }

  /** Whether a refusal has already been earned, so later checks that depend on the request being sound are skipped. */
  get refused(): boolean {
    return this.top !== null;
  }

  /** Throws the highest-ranked refusal, the field problems taking the 422 rung. */
  settle(fields: FieldErrors = new FieldErrors()): void {
    this.consider(fields.refusal());
    if (this.top) throw this.top;
  }
}
