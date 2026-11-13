import { h } from './dom.js';
import { RequestFailed } from './api.js';

export const PENDING_COPY = {
  createAccount: 'Creating your harbour account…',
  signIn: 'Signing in…',
  signOut: 'Signing out…',
  inspection: 'Loading harbour records…',
  startDefence: 'Preparing the encounter…',
  saveLevel: 'Saving private level…',
  checkCommand: 'Checking this command…',
  submit: 'Checking command evidence…',
  publish: 'Preparing publication…',
  withdraw: 'Withdrawing challenge…',
  search: 'Searching harbour challenges…',
  sharePlayback: 'Sharing playback…',
  followPlayback: 'Following playback…',
} as const;

export const SUCCESS_COPY = {
  createAccount: "Account ready – your harbour's open.",
  signIn: 'Welcome back.',
  signOut: 'Signed out.',
  inspection: 'Harbour records loaded.',
  startDefence: 'Encounter ready.',
  saveLevel: 'Private level saved.',
  checkCommand: 'Command placed.',
  withdraw: 'Challenge withdrawn.',
  search: 'Search complete.',
  sharePlayback: "Playback shared – follow the keeper's cursor.",
  followPlayback: 'Following shared playback.',
  stopFollowing: 'Local playback restored.',
  practice: 'Practice complete. No ranked result is submitted.',
  acceptedVictory: "Verified victory – your strategy's recorded.",
  acceptedDefeat: 'Verified defence ended.',
  pendingEvidence: 'Evidence storage unavailable. Verification is pending; retry this result.',
  pendingPublication: 'Publication pending. Your challenge is still private; retry publication.',
  committedPublication: 'Challenge published.',
  previewReady: 'Preview ready.',
  previewCancelled: 'Preview cancelled.',
} as const;

export const INDEXING_COPY = {
  pending: 'Discovery is indexing – published results may still be arriving.',
  current: 'Discovery is current.',
} as const;

export function rejectionCopy(tick: number, reason: string, seq: number | null): string {
  const base = `Run rejected at tick ${tick}: ${reason}. Your account remains available.`;
  return seq === null ? base : `${base} Failing sequence ${seq}.`;
}

class Feedback {
  readonly status: HTMLElement;
  readonly error: HTMLElement;
  private fieldErrors: Record<string, string> = {};
  private announcedDependency: string | null = null;

  constructor() {
    this.status = h('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Harbour status', class: 'live status-line' });
    this.error = h('p', { role: 'alert', 'aria-label': 'Harbour error', class: 'live error-line' });
  }

  pending(copy: string): void {
    this.status.textContent = copy;
    this.error.textContent = '';
    this.fieldErrors = {};
  }

  succeed(copy: string): void {
    this.status.textContent = copy;
    this.error.textContent = '';
  }

  fail(error: unknown): Record<string, string> {
    this.status.textContent = '';
    if (error instanceof RequestFailed) {
      const fields = error.failure.fields;
      const paths = Object.keys(fields);
      this.fieldErrors = fields;
      this.error.textContent =
        paths.length === 0
          ? error.failure.message
          : paths.map((path) => `${path}: ${fields[path]}`).join(' ');
      return fields;
    }
    this.fieldErrors = {};
    this.error.textContent = (error as Error).message;
    return {};
  }

  localFailure(message: string): void {
    this.status.textContent = '';
    this.error.textContent = message;
  }

  fieldMessage(path: string): string | null {
    return this.fieldErrors[path] ?? null;
  }

  /** Announces a background dependency failure once until recovery. */
  dependencyFailed(message: string): void {
    if (this.announcedDependency === message) return;
    this.announcedDependency = message;
    this.error.textContent = message;
  }

  dependencyRecovered(): void {
    this.announcedDependency = null;
  }
}

export const feedback = new Feedback();
