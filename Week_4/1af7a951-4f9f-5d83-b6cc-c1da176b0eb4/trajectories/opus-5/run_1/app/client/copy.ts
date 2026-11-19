import type { CohortPhase, SignCategory } from './api.js';

export const COPY = {
  openCohorts: 'Open cohorts',
  enroll: 'Enroll',
  signIn: 'Sign in',
  signOut: 'Sign out',
  cohortNotFound: "We couldn't find that cohort.",
  pageNotFound: "We couldn't find that page.",
  paymentPending: 'Payment pending',
  enrolled: 'Enrolled',
  continueToPayment: 'Continue to payment',
  openLogbook: 'Open my logbook',
  seatNotReserved: 'Your seat is not reserved until payment is confirmed.',
  confirmingPayment: 'Confirming payment with the billing provider.',
  billingOutage:
    'Payments are unreachable right now. Your seat is not reserved and you have not been charged.',
  paymentDeclined: 'Your payment was declined. Your seat is not reserved.',
  cohortFull: 'This cohort just filled up. You have not been charged.',
  enrollmentClosed: 'Enrollment for this cohort is closed.',
  alreadyEnrolled: 'You already have a seat request for this cohort.',
  invalidCode: "That access code didn't work.",
  pendingCode: 'This enrollment is waiting for payment.',
  refundedCode: 'This seat was refunded, so this code no longer opens a logbook.',
  offlineSignIn: "You're offline. Connect to the internet to sign in.",
  offlineBanner: "You're offline. New entries are kept on this device until you reconnect.",
  emptyNight:
    'No dreams logged for this night yet. Write down whatever you remember, even a single image.',
  captureOpen: 'Morning capture window open until 14:00.',
  captureClosed: 'Capture window closed. New entries are marked late recall.',
  techniqueLocked: 'Technique practice unlocks on night 8.',
  keptOnDevice: 'Kept on this device',
  saved: 'Saved',
  lateRecall: 'Late recall',
  untitled: 'Untitled dream',
  entryConflict: 'This entry conflicts with one already saved.',
  cohortNotOpen: 'This cohort is not open for entries.',
  uploadingMemo: 'Uploading voice memo.',
  memoSaved: 'Voice memo saved.',
  memoStorageOutage: 'Voice memo kept on this device. It will upload when storage is back.',
  memoExists: 'This entry already has a different voice memo.',
  memoPlaybackFailed: 'Voice memo unavailable right now.',
  noSelection: 'Select a phrase in this entry first.',
  signOverlap: 'That phrase overlaps a sign you already tagged.',
  signRefused: "That sign wasn't saved. Try again.",
  noDrillTarget: 'Tag a dream sign first to set your drill target.',
  settingsSaved: 'Night settings saved. They apply to new entries.',
  sharedWithCoach: 'Shared with your coach.',
  noLongerShared: 'No longer shared.',
  cohortUnavailable: "That cohort isn't available.",
  cohortCreated: 'Cohort created as a draft.',
  cohortNameTaken: 'You already have a cohort with that name.',
  cohortPublished: 'Cohort published.',
  cohortClosed: 'Cohort closed.',
  illegalTransition: "That change isn't allowed in this phase.",
  sendingDigest: 'Sending digest.',
  mailOutage: 'Mail is unreachable. The digest was not sent.',
  refundWindowClosed: 'Refunds close when the technique weeks start.',
  refundComped: 'This seat was not paid through checkout.',
  refundBillingOutage: 'Billing is unreachable. No refund was made.',
  refundAlready: 'That seat was already refunded.',
  entryWithdrawn: 'That entry is no longer shared.',
  priceFieldError: 'Use a price from $1.00 to $1,000.00.',
  drillStep2: 'Ask yourself, out loud or silently: am I dreaming?',
  drillStep3: 'Pinch your nose and try to breathe through it.',
} as const;

export const CATEGORY_LABELS: Record<SignCategory, string> = {
  inner_awareness: 'Inner awareness',
  action: 'Action',
  form: 'Form',
  context: 'Context',
};

export const DRILL_PROMPTS: Record<SignCategory, string> = {
  inner_awareness: 'Notice what you are feeling right now. Is it the kind of feeling your dreams bring?',
  action: 'Notice what you and others are doing. Could it happen awake?',
  form: 'Look at your hands. Count your fingers twice.',
  context: 'Look around. Does this place make sense for where you are?',
};

export function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function seatsCopy(seatsLeft: number): string {
  if (seatsLeft <= 0) return 'Full';
  if (seatsLeft === 1) return '1 seat left';
  return `${seatsLeft} seats left`;
}

export function phaseLabel(phase: CohortPhase, week: number | null): string {
  switch (phase) {
    case 'draft':
      return 'Draft';
    case 'enrolling':
      return 'Enrolling';
    case 'baseline':
      return `Baseline \u2013 week ${week ?? 1} of 4`;
    case 'technique':
      return `Technique \u2013 week ${week ?? 1} of 4`;
    case 'closed':
      return 'Closed';
  }
}

export function nightsLine(startsOn: string): string {
  const last = new Date(Date.parse(`${startsOn}T00:00:00Z`) + 27 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `Nights ${startsOn} \u2013 ${last}`;
}

export function nightLine(nightNumber: number, nightKey: string): string {
  return `Night ${nightNumber} of 28 \u2013 ${nightKey}`;
}

export function rosterNight(nightNumber: number): string {
  if (nightNumber === 0) return 'Not started';
  return `${Math.min(nightNumber, 28)} of 28`;
}

export function statusLabel(status: 'active' | 'refunded'): string {
  return status === 'active' ? 'Active' : 'Refunded';
}

export function syncCopy(savedCount: number, keptCount: number): string {
  return `Synced: ${savedCount}. Kept on this device: ${keptCount}.`;
}

export function heldNightCopy(nightNumber: number): string {
  return `Night settings saved. You're still on night ${nightNumber} until your next bedtime.`;
}

export function signCopy(category: SignCategory, count: number): string {
  return `${CATEGORY_LABELS[category]} signs: ${count}.`;
}

export function drillLoggedCopy(count: number): string {
  return `Reality check logged. Checks this night: ${count}.`;
}

export function skyDescription(counts: Record<SignCategory, number>): string {
  return `Stars: inner awareness ${counts.inner_awareness}, action ${counts.action}, form ${counts.form}, context ${counts.context}.`;
}

export function loggedTime(createdAtUtc: string, homeTz: string): string {
  const instant = new Date(createdAtUtc);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: homeTz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}
