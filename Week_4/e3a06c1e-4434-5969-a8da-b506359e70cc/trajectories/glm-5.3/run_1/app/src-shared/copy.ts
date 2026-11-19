// The published copy. Every backtick string renders character for character.

export const SESSION_STATUS_COPY: Record<string, string> = {
  connecting: 'Session connecting.',
  live: 'Session live.',
  closed: 'Session closed.',
  closed_cap: 'Session closed: time limit reached.',
  idle_closed: 'Session closed: no audio received.',
  quota_halted: 'Session halted: project quota reached.',
  revoked: 'Session ended: API key revoked.',
};

export function sessionStatusCopy(state: string, closeReason: string | null): string {
  if (state === 'closed' && closeReason === 'cap') return SESSION_STATUS_COPY.closed_cap;
  const key = state === 'closed' ? 'closed' : state;
  return SESSION_STATUS_COPY[key] ?? 'Session closed.';
}

export function quotaHaltCopy(quota: { limit_minutes: number; period_start: string; resets_at: string }): string {
  const month = monthName(quota.period_start);
  const reset = resetDate(quota.resets_at);
  return `Quota reached. This project's ${quota.limit_minutes} audio minutes for ${month} are used up. New sessions are refused until ${reset} UTC or until an admin raises the quota.`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function resetDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const SERVICE_STATUS = {
  billing: 'Billing is unreachable. Figures marked Pending will confirm automatically once it\u2019s back.',
  storage: 'Audio storage is unreachable. Playback and uploads will resume once it\u2019s back, and nothing you\u2019ve typed is lost.',
} as const;

export function planStatusRequested(plan: string): string {
  return `Waiting for billing to confirm the ${plan} plan.`;
}
export function planStatusConfirmed(plan: string): string {
  return `${plan} plan is active.`;
}
export function planStatusFailed(plan: string): string {
  return `Billing declined the change. You\u2019re still on the ${plan} plan.`;
}
export function planStatusUnreachable(): string {
  return 'Billing is unreachable, so your plan hasn\u2019t changed. Try again in a minute.';
}

export const REVIEW_STATUS = {
  draftSaved: 'Draft saved.',
  submitted: 'Correction submitted for approval.',
  approved: 'Correction approved. Reviewed transcript updated.',
  returned: (author: string) => `Correction returned to ${author}.`,
  reopened: 'Correction reopened as a draft.',
  openConflict: 'Another reviewer already has an open correction on this segment.',
  ownCorrection: 'You can\u2019t approve your own correction.',
  alreadyDecided: 'This correction was already decided.',
  correctedTextError: 'Enter the corrected words.',
  returnNoteError: 'Add a note of up to 500 characters.',
  inspectorEmpty: 'Select a flagged segment to review it.',
  generic: 'Something went wrong. Try again.',
} as const;

export const UPLOAD_STATUS = {
  pending: 'Uploading audio',
  audioError: 'Upload a 16 kHz, 16-bit PCM WAV file with one or two channels.',
  tooLarge: 'Audio files can be up to 50,000,000 bytes.',
  sidecarError: 'The sidecar must be WebVTT with one confidence per word.',
  keyError: 'Choose an active API key.',
} as const;

export const KEYS_STATUS = {
  projectCreated: 'Project created. Issue its first API key.',
  keyIssued: 'Key created. Copy it now; it won\u2019t be shown again.',
  keyRevoked: (n: number) => `Key revoked. Live sessions closed: ${n}.`,
  keyNameError: 'Enter a key name of up to 60 characters.',
} as const;

export const PROJECT_ERRORS = {
  name: 'Enter a project name of up to 60 characters.',
  nameTaken: 'A project with this name already exists.',
  quota: 'Enter a whole number of minutes from 1 to 1000000.',
} as const;

export const TRIAL_STATUS = {
  success: 'Trial request received. We reply within two working days.',
  name: 'Enter your name.',
  email: 'Enter a work email address.',
  company: 'Enter your company.',
  team: 'Choose a team.',
} as const;

export const SIGN_IN_STATUS = {
  invalid: 'That email and password don\u2019t match.',
} as const;

export const JOIN_STATUS = {
  used: 'This invitation has already been used.',
  password: 'Use at least 12 characters.',
} as const;

export const MEMBERS_STATUS = {
  invitationCreated: (name: string) => `Invitation created. Share the link below with ${name}.`,
  updated: 'Member updated.',
  removed: 'Member removed.',
  selfChange: 'You can\u2019t change or remove your own membership.',
  nameError: 'Enter a name of up to 100 characters.',
  emailError: 'Enter an email address of up to 200 characters.',
  roleError: 'Choose a role.',
  projectsError: 'Choose projects from the list.',
} as const;

export const SEARCH_RESULTS = (n: number) => (n === 1 ? '1 session found.' : `${n} sessions found.`);

export const SYNTHESIS_STATUS = {
  pending: 'Rendering',
  success: (seconds: string) => `Rendered ${seconds} seconds of audio.`,
  textError: 'Enter 1 to 1000 characters.',
  voiceError: 'Choose a voice.',
  keyError: 'Choose an active API key.',
} as const;

export const FIELD_MESSAGES = {
  search: 'Enter 1 to 100 characters.',
  label: 'Enter a label of up to 80 characters.',
  idempotencyKey: 'Use an idempotency key of 1 to 100 characters.',
  channels: 'Use 1 or 2 channels.',
  sampleRate: 'Use a sample rate of 16000.',
  source: 'Choose a source.',
  password: 'Use at least 12 characters.',
  plan: 'Choose Pilot or Scale.',
  correctionText: 'Enter the corrected words.',
  returnNote: 'Add a note of up to 500 characters.',
} as const;

export const SETTINGS_STATUS = {
  saved: 'Quota saved.',
} as const;

export const CALCULATOR = {
  error: 'Enter a length from 0 to 3600 seconds.',
} as const;
