// Published copy, exactly as specified, and environment-timer defaults.

export const COPY = {
  signInIncorrect: 'Email or password is incorrect.',
  signInLocked: 'Too many sign-in attempts. Try again later.',
  sessionDialogText: 'Your session ended. Sign in again and we will save your change.',
  passwordChanged: 'Password changed. Your other sessions were signed out.',
  currentPasswordIncorrect: 'Current password is incorrect.',
  passwordLength: 'Use 12 to 128 characters.',
  passwordUnchanged: 'Choose a password different from your current one.',
  diagramNotFoundHeading: 'Diagram not found',
  diagramNotFoundText: "We couldn't find that diagram. It may have been deleted, or you may not have access to it.",
  pageNotFoundHeading: 'Page not found',
  pageNotFoundText: "We couldn't find that page.",
  overlapRefusal: "Zones can't overlap.",
  emptyLibrarySearch: 'No shapes match your search.',
  connectPrompt: 'Choose a shape to connect to. Press Escape to cancel.',
  conflictBanner: 'Someone else saved this page. Reload to see their changes.',
  downgradeBanner: 'Your role on this diagram is now viewer. Your last change was not saved.',
  genericFailureBanner: 'Something went wrong. Try again.',
  storageOutageBanner: 'File storage is unavailable. Diagram edits still save, but exports and imports are paused until it returns.',
  exportReady: 'Export ready.',
  exportPreparing: 'Preparing',
  exportFailed: 'Failed',
  exportFailedRow: 'Export failed. File storage did not confirm the files.',
  importTooLarge: 'This file is too large to import.',
  importWrongType: 'Only diagram XML and SVG files can be imported.',
  importUnsafe: 'This file contains scripts, external entities or unsafe links and was not imported.',
  importInvalid: 'This file does not describe a valid diagram.',
  inviteExpiredHeading: 'This invitation has expired',
  inviteExpiredText: 'Ask the diagram owner to send you a new one.',
  inviteWrongPerson: 'This invitation was sent to a different email address.',
  inviteTooManyHeading: 'Too many attempts',
  inviteTooManyText: 'Wait a few minutes and open the link again.',
  emailInvalid: 'Enter a valid email address.',
  alreadyMember: 'This person already has access.',
  invitePending: 'An invitation to this email is already pending.',
  inviteRateLimited: 'Too many invitations sent. Try again later.',
  inviteCreatedFor: (email: string) => `Invitation created for ${email}.`,
  deliverySentence: (email: string) => `Invitation delivered to ${email}.`,
  expirySentence: (email: string) => `Invitation expired for ${email}.`,
  roleChangedFor: (email: string) => `Access updated for ${email}.`,
  removedFor: (email: string) => `Removed ${email}.`,
  withdrawnFor: (email: string) => `Invitation withdrawn for ${email}.`,
  importProgress: (name: string) => `Importing ${name}...`,
  importSuccess: (name: string) => `Imported ${name} as a new page.`,
  connectedTo: (source: string, target: string) => `Connected ${source} to ${target}.`,
} as const;

export const TIMER_DEFAULTS = {
  SESSION_IDLE_SECONDS: 1800,
  SESSION_ABSOLUTE_SECONDS: 43200,
  SIGNIN_WINDOW_SECONDS: 900,
  SIGNIN_LOCK_SECONDS: 900,
  INVITE_TTL_SECONDS: 259200,
  INVITE_RATE_WINDOW_SECONDS: 3600,
  INVITE_LOOKUP_WINDOW_SECONDS: 600,
  IDEMPOTENCY_KEY_SECONDS: 86400,
  DOWNLOAD_LINK_SECONDS: 60,
} as const;

export type TimerName = keyof typeof TIMER_DEFAULTS;

export interface AppTimers {
  sessionIdleSeconds: number;
  sessionAbsoluteSeconds: number;
  signinWindowSeconds: number;
  signinLockSeconds: number;
  inviteTtlSeconds: number;
  inviteRateWindowSeconds: number;
  inviteLookupWindowSeconds: number;
  idempotencyKeySeconds: number;
  downloadLinkSeconds: number;
}

export function readTimers(env: Record<string, string | undefined>): AppTimers {
  const read = (name: TimerName): number => {
    const raw = env[name];
    const n = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : TIMER_DEFAULTS[name];
  };
  return {
    sessionIdleSeconds: read('SESSION_IDLE_SECONDS'),
    sessionAbsoluteSeconds: read('SESSION_ABSOLUTE_SECONDS'),
    signinWindowSeconds: read('SIGNIN_WINDOW_SECONDS'),
    signinLockSeconds: read('SIGNIN_LOCK_SECONDS'),
    inviteTtlSeconds: read('INVITE_TTL_SECONDS'),
    inviteRateWindowSeconds: read('INVITE_RATE_WINDOW_SECONDS'),
    inviteLookupWindowSeconds: read('INVITE_LOOKUP_WINDOW_SECONDS'),
    idempotencyKeySeconds: read('IDEMPOTENCY_KEY_SECONDS'),
    downloadLinkSeconds: read('DOWNLOAD_LINK_SECONDS'),
  };
}

// The published sign-in lock thresholds.
export const SIGNIN_PAIR_FAILURES = 5;
export const SIGNIN_IP_FAILURES = 20;

// The published invitation limits.
export const INVITE_RATE_LIMIT = 20;
export const INVITE_LOOKUP_LIMIT = 20;

export const JSON_BODY_LIMIT = 1000000;
export const IMPORT_FILE_LIMIT = 2000000;
export const IMPORT_REQUEST_LIMIT = 2100000;
