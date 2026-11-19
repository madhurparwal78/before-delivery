import type { CloseReason, Plan, SessionState } from './types.js';

export const fieldCopy = {
  trialName: 'Enter your name.',
  trialEmail: 'Enter a work email address.',
  trialCompany: 'Enter your company.',
  trialTeam: 'Choose a team.',
  invitationName: 'Enter a name of up to 100 characters.',
  invitationEmail: 'Enter an email address of up to 200 characters.',
  role: 'Choose a role.',
  projectIds: 'Choose projects from the list.',
  password: 'Use at least 12 characters.',
  projectName: 'Enter a project name of up to 60 characters.',
  projectNameTaken: 'A project with this name already exists.',
  quota: 'Enter a whole number of minutes from 1 to 1000000.',
  keyName: 'Enter a key name of up to 60 characters.',
  uploadKey: 'Choose an active API key.',
  source: 'Choose a source.',
  audio: 'Upload a 16 kHz, 16-bit PCM WAV file with one or two channels.',
  audioTooLarge: 'Audio files can be up to 50,000,000 bytes.',
  sidecar: 'The sidecar must be WebVTT with one confidence per word.',
  label: 'Enter a label of up to 80 characters.',
  idempotencyKey: 'Use an idempotency key of 1 to 100 characters.',
  channels: 'Use 1 or 2 channels.',
  sampleRate: 'Use a sample rate of 16000.',
  searchQuery: 'Enter 1 to 100 characters.',
  correctionText: 'Enter the corrected words.',
  returnNote: 'Add a note of up to 500 characters.',
  synthesisText: 'Enter 1 to 1000 characters.',
  voice: 'Choose a voice.',
  plan: 'Choose Pilot or Scale.',
} as const;

export const reviewCopy = {
  draftSaved: 'Draft saved.',
  submitted: 'Correction submitted for approval.',
  approved: 'Correction approved. Reviewed transcript updated.',
  returned: (author: string) => `Correction returned to ${author}.`,
  reopened: 'Correction reopened as a draft.',
  correctionOpen: 'Another reviewer already has an open correction on this segment.',
  ownCorrection: "You can't approve your own correction.",
  alreadyDecided: 'This correction was already decided.',
  emptyPrompt: 'Select a flagged segment to review it.',
} as const;

export const keysCopy = {
  projectCreated: 'Project created. Issue its first API key.',
  keyIssued: "Key created. Copy it now; it won't be shown again.",
  keyRevoked: (closed: number) => `Key revoked. Live sessions closed: ${closed}.`,
} as const;

export const serviceCopy = {
  billingOutage: 'Billing is unreachable. Figures marked Pending will confirm automatically once it\u0027s back.',
  storageOutage:
    "Audio storage is unreachable. Playback and uploads will resume once it\u0027s back, and nothing you\u0027ve typed is lost.",
} as const;

const planLabels: Record<Plan, string> = { pilot: 'Pilot', scale: 'Scale' };

export const planLabel = (plan: Plan): string => planLabels[plan];

export const planCopy = {
  requested: (plan: Plan) => `Waiting for billing to confirm the ${planLabel(plan)} plan.`,
  confirmed: (plan: Plan) => `${planLabel(plan)} plan is active.`,
  failed: (current: Plan) => `Billing declined the change. You\u0027re still on the ${planLabel(current)} plan.`,
  unreachable: "Billing is unreachable, so your plan hasn\u0027t changed. Try again in a minute.",
} as const;

export const trialCopy = {
  success: 'Trial request received. We reply within two working days.',
} as const;

export const signInCopy = {
  failed: "That email and password don\u0027t match.",
} as const;

export const joinCopy = {
  used: 'This invitation has already been used.',
} as const;

export const membersCopy = {
  invitationCreated: (name: string) => `Invitation created. Share the link below with ${name}.`,
  updated: 'Member updated.',
  removed: 'Member removed.',
  selfChange: "You can\u0027t change or remove your own membership.",
} as const;

export const settingsCopy = { saved: 'Quota saved.' } as const;

export const uploadCopy = { pending: 'Uploading audio' } as const;

export const synthesisCopy = {
  pending: 'Rendering',
  success: (seconds: string) => `Rendered ${seconds} seconds of audio.`,
} as const;

export const searchCopy = {
  found: (n: number) => (n === 1 ? '1 session found.' : `${n} sessions found.`),
} as const;

export const calculatorCopy = {
  billed: (pilot: string, scale: string) => `Pilot: ${pilot} billed minutes. Scale: ${scale} billed minutes.`,
  invalid: 'Enter a length from 0 to 3600 seconds.',
} as const;

export const genericFailure = 'Something went wrong. Try again.';

export const sessionStatusCopy = (state: SessionState, reason: CloseReason | null): string => {
  switch (state) {
    case 'connecting':
      return 'Session connecting.';
    case 'live':
      return 'Session live.';
    case 'closed':
      return reason === 'cap' ? 'Session closed: time limit reached.' : 'Session closed.';
    case 'idle_closed':
      return 'Session closed: no audio received.';
    case 'quota_halted':
      return 'Session halted: project quota reached.';
    case 'revoked':
      return 'Session ended: API key revoked.';
  }
};

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const quotaHaltBanner = (limitMinutes: number, periodStart: string, resetsAt: string): string => {
  const start = new Date(periodStart);
  const reset = new Date(resetsAt);
  const month = `${monthNames[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  const resetDate = `${reset.getUTCDate()} ${monthNames[reset.getUTCMonth()]} ${reset.getUTCFullYear()}`;
  return `Quota reached. This project\u0027s ${limitMinutes} audio minutes for ${month} are used up. New sessions are refused until ${resetDate} UTC or until an admin raises the quota.`;
};
