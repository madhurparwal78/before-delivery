import { COMPOSED_STATUS, REFUSALS, OUTAGES, type ComposedCode, type RefusalCode } from "../shared/copy.js";
import type { ApiErrorBody } from "../shared/types.js";

type ErrorCode = RefusalCode | ComposedCode;

/** A refusal in the one published shape: status, `{error, message}` and, for 422, `fields`. */
export class Refusal extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, message?: string, extra: Partial<ApiErrorBody> = {}, headers: Record<string, string> = {}) {
    const known = code in REFUSALS ? REFUSALS[code as RefusalCode] : undefined;
    const status = known ? known.status : COMPOSED_STATUS[code as ComposedCode];
    const copy = message ?? known?.message ?? "";
    super(copy);
    this.status = status;
    this.body = { error: code, message: copy, ...extra };
    this.headers = headers;
  }
}

export const refuse = (code: RefusalCode): Refusal => new Refusal(code);

export const notFound = (): Refusal => refuse("not_found");

export function invalid(fields: Record<string, string>): Refusal {
  return new Refusal("invalid", undefined, { fields });
}

export const storeUnavailable = (copy: keyof Pick<typeof OUTAGES, "sheet" | "photo">): Refusal =>
  new Refusal("store_unavailable", OUTAGES[copy]);
export const identityUnavailable = (): Refusal => new Refusal("identity_unavailable", OUTAGES.identity);
export const databaseUnavailable = (): Refusal => new Refusal("database_unavailable", OUTAGES.database);

/** Collects field problems; throws the 422 once, at the end of validation. */
export class FieldErrors {
  private readonly problems: Record<string, string> = {};

  add(field: string, copy: string): void {
    if (!(field in this.problems)) this.problems[field] = copy;
  }

  get empty(): boolean {
    return Object.keys(this.problems).length === 0;
  }

  /** The 422 these problems add up to, or null when there are none. */
  refusal(): Refusal | null {
    return this.empty ? null : invalid(this.problems);
  }

  throwIfAny(): void {
    const refusal = this.refusal();
    if (refusal) throw refusal;
  }
}
