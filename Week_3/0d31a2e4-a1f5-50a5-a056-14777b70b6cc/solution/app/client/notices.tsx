// The Notices live region, and the one way the interface reports outcomes and failures.
import { ApiFailure } from "./api.js";
import { COPY } from "./copy.js";
import { Store, useStore } from "./store.js";

interface Notice {
  text: string;
  serial: number;
}

const notice = new Store<Notice>({ text: "", serial: 0 });

export function announce(text: string): void {
  notice.update((current) => ({ text, serial: current.serial + 1 }));
}

// A new action starts with an empty Notices region, so the next announcement is that action's own outcome.
export function clearNotice(): void {
  if (notice.get().text !== "") announce("");
}

// Turns a failure into its copy: `known` maps error codes to the action's own wording.
function failureCopy(error: unknown, known: Record<string, string> = {}): string {
  if (!(error instanceof ApiFailure)) return COPY.unexpected;
  const specific = known[error.code];
  if (specific !== undefined) return specific;
  if (error.code === "email_unverified") return COPY.verifyFirst;
  if (error.status >= 500 || error.status === 0) return COPY.unexpected;
  return COPY.cannotNow;
}

export function announceFailure(error: unknown, known: Record<string, string> = {}): void {
  announce(failureCopy(error, known));
}

export function Notices() {
  const current = useStore(notice);
  return (
    <div class="notices" role="status" aria-label="Notices" aria-live="polite">
      {current.text === "" ? null : <p key={current.serial}>{current.text}</p>}
    </div>
  );
}
