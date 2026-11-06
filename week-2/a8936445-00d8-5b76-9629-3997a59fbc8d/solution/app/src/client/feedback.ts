// Pending, success, error and outage copy for every request (brief: Feedback states).
import { ApiFailure } from "./api";
import { Store } from "./store";

export type Service = "billing" | "storage" | "mail";

interface Problem {
  text: string;
  service: Service | null;
  source: string | null;
}

interface FeedbackState {
  activity: string;
  problem: Problem | null;
  pending: number;
}

export const feedback = new Store<FeedbackState>({ activity: "", problem: null, pending: 0 });

export interface ActionSpec<T> {
  /** Pending copy; an action without it is a background request that only reports errors. */
  pending?: string;
  success?: (value: T) => string | null;
  /** The row's own error copy; `null` uses the fallback table, `false` reports nothing. */
  error?: (failure: ApiFailure) => string | null | false;
  /** Services the action needs; its success clears their outage copy. */
  services?: Service[];
  /** Groups an error with the later success that clears it (the day load). */
  source?: string;
  /** The action reads 401 itself (sign-in, the first session read) instead of ending the session. */
  own401?: boolean;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

const OUTAGE: Record<string, Service> = {
  billing_unavailable: "billing",
  storage_unavailable: "storage",
  mail_unavailable: "mail",
};

export const BILLING_NOTHING_CHARGED = "Billing is unreachable. Nothing was charged; try again in a moment.";
export const STORAGE_TRY_AGAIN = "Document storage is unreachable. Try again in a moment.";

function fallbackCopy(failure: ApiFailure): string {
  const { status, code } = failure;
  if (status === 403) return "You can't do that with this account.";
  if (status === 404) return "That record isn't available.";
  if (status === 409 && code === "idempotency_conflict") {
    return "This request was already sent with different details. Reload and try again.";
  }
  if (status === 409 || status === 410 || status === 412) {
    return "That can't be done in this record's current state. Reload to see the latest.";
  }
  if (status === 413) return "That request is too large.";
  if (status === 415) return "That kind of content isn't accepted.";
  if (status === 422 && code === "validation_failed") return "Check the highlighted fields.";
  if (status === 503 && code === "billing_unavailable") {
    return "Billing is unreachable. Nothing was changed; try again in a moment.";
  }
  if (status === 503 && code === "storage_unavailable") {
    return "Document storage is unreachable. Nothing was changed; try again in a moment.";
  }
  if (status === 503 && code === "mail_unavailable") {
    return "Email is unreachable. Nothing was changed; try again in a moment.";
  }
  return "Something went wrong. Try again in a moment.";
}

let onSessionEnded: () => void = () => undefined;

export function whenSessionEnds(handler: () => void): void {
  onSessionEnded = handler;
}

export function showProblem(text: string): void {
  feedback.update((s) => ({ ...s, problem: { text, service: null, source: null } }));
}

export function showActivity(text: string): void {
  feedback.update((s) => ({ ...s, activity: text }));
}

export async function act<T>(spec: ActionSpec<T>, task: () => Promise<T>): Promise<Outcome<T>> {
  const foreground = spec.pending !== undefined;
  feedback.update((s) => ({
    activity: foreground ? (spec.pending as string) : s.activity,
    problem: foreground && s.problem && !s.problem.service ? null : s.problem,
    pending: s.pending + 1,
  }));
  try {
    const value = await task();
    const message = foreground ? (spec.success?.(value) ?? null) : null;
    feedback.update((s) => {
      const cleared =
        s.problem &&
        ((s.problem.source !== null && s.problem.source === spec.source) ||
          (s.problem.service !== null && (spec.services ?? []).includes(s.problem.service)));
      return {
        activity: message ?? (foreground && s.activity === spec.pending ? "" : s.activity),
        problem: cleared ? null : s.problem,
        pending: s.pending - 1,
      };
    });
    return { ok: true, value };
  } catch (caught) {
    const failure = caught instanceof ApiFailure ? caught : new ApiFailure(0, "client", String(caught), {});
    feedback.update((s) => ({
      ...s,
      activity: foreground && s.activity === spec.pending ? "" : s.activity,
      pending: s.pending - 1,
    }));
    if (failure.status === 401 && !spec.own401) {
      onSessionEnded();
      showProblem("Your session ended. Sign in again.");
      return { ok: false, failure };
    }
    const own = spec.error?.(failure) ?? null;
    if (own !== false) {
      feedback.update((s) => ({
        ...s,
        problem: { text: own ?? fallbackCopy(failure), service: OUTAGE[failure.code] ?? null, source: spec.source ?? null },
      }));
    }
    return { ok: false, failure };
  }
}

/** The `details` sentence for one field of a 422 answer. */
export function fieldError(failure: ApiFailure | null, field: string): string | null {
  if (!failure || failure.code !== "validation_failed") return null;
  const value = failure.details[field];
  return typeof value === "string" ? value : null;
}
