import type { Category, CohortPhase } from "../shared/api";

// The brief's published copy, character for character.

export const CATEGORY_LABEL: Record<Category, string> = {
  inner_awareness: "Inner awareness",
  action: "Action",
  form: "Form",
  context: "Context",
};

/** The phase label: `Baseline – week 2 of 4` and `Technique – week 3 of 4` carry the cohort week. */
export function phaseLabel(cohort: { phase: CohortPhase; week: number | null }): string {
  if (cohort.phase === "baseline") return `Baseline – week ${cohort.week} of 4`;
  if (cohort.phase === "technique") return `Technique – week ${cohort.week} of 4`;
  return { draft: "Draft", enrolling: "Enrolling", closed: "Closed" }[cohort.phase];
}

export const DRILL_PROMPT: Record<Category, string> = {
  inner_awareness: "Notice what you are feeling right now. Is it the kind of feeling your dreams bring?",
  action: "Notice what you and others are doing. Could it happen awake?",
  form: "Look at your hands. Count your fingers twice.",
  context: "Look around. Does this place make sense for where you are?",
};

export const COPY = {
  saved: "Saved",
  kept: "Kept on this device",
  lateRecall: "Late recall",
  untitled: "Untitled dream",
  offline: "You're offline. New entries are kept on this device until you reconnect.",
  notOpen: "This cohort is not open for entries.",
  conflict: "This entry conflicts with one already saved.",
  emptyNight: "No dreams logged for this night yet. Write down whatever you remember, even a single image.",
  windowOpen: "Morning capture window open until 14:00.",
  windowClosed: "Capture window closed. New entries are marked late recall.",
  techniqueLocked: "Technique practice unlocks on night 8.",
  uploadingMemo: "Uploading voice memo.",
  memoSaved: "Voice memo saved.",
  memoKept: "Voice memo kept on this device. It will upload when storage is back.",
  memoUnavailable: "Voice memo unavailable right now.",
  noSelection: "Select a phrase in this entry first.",
  signRejected: "That sign wasn't saved. Try again.",
  noTarget: "Tag a dream sign first to set your drill target.",
  settingsSaved: "Night settings saved. They apply to new entries.",
  overlap: "That phrase overlaps a sign you already tagged.",
  memoExists: "This entry already has a different voice memo.",
  needsConnection: "This needs a connection. Try again when you are back online.",
  shared: "Shared with your coach.",
  unshared: "No longer shared.",
  drillQuestion: "Ask yourself, out loud or silently: am I dreaming?",
  drillCheck: "Pinch your nose and try to breathe through it.",
  badCode: "That access code didn't work.",
  waitingCode: "This enrollment is waiting for payment.",
  refundedCode: "This seat was refunded, so this code no longer opens a logbook.",
  offlineSignIn: "You're offline. Connect to the internet to sign in.",
  enrollmentClosed: "Enrollment for this cohort is closed.",
  alreadyEnrolled: "You already have a seat request for this cohort.",
  confirming: "Confirming payment with the billing provider.",
  paymentOutage: "Payments are unreachable right now. Your seat is not reserved and you have not been charged.",
  declined: "Your payment was declined. Your seat is not reserved.",
  full: "This cohort just filled up. You have not been charged.",
  pendingNotice: "Your seat is not reserved until payment is confirmed.",
  cohortCreated: "Cohort created as a draft.",
  published: "Cohort published.",
  closed: "Cohort closed.",
  illegal: "That change isn't allowed in this phase.",
  sendingDigest: "Sending digest.",
  mailOutage: "Mail is unreachable. The digest was not sent.",
  refundWindow: "Refunds close when the technique weeks start.",
  comped: "This seat was not paid through checkout.",
  billingOutage: "Billing is unreachable. No refund was made.",
  alreadyRefunded: "That seat was already refunded.",
  nameTaken: "You already have a cohort with that name.",
  unavailableCohort: "That cohort isn't available.",
  withdrawn: "That entry is no longer shared.",
} as const;

export const synced = (saved: number, kept: number): string => `Synced: ${saved}. Kept on this device: ${kept}.`;
export const notSaved = (reason: string): string => `Not saved: ${reason}`;
export const heldNight = (night: number): string => `Night settings saved. You're still on night ${night} until your next bedtime.`;
export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** `<n> of 28`, `28 of 28` past the last night, or `Not started` before night 1. */
export function rosterNight(night: number): string {
  return night <= 0 ? "Not started" : `${Math.min(night, 28)} of 28`;
}

/** An instant shown as 24-hour wall-clock time in the given home time zone. */
export function wallClock(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}
