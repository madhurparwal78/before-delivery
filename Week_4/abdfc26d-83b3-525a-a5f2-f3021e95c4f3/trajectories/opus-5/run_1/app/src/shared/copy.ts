import { formatClock, formatPeriod, formatUsd } from './money.js';

/** Studio status region: the editor and the describe-a-piece prompt bar. */
export const studioStatus = {
  describePending: 'Drafting your piece...',
  describeSuccess: 'Draft ready. Tune it on the instrument panel.',
  promptLength: 'Describe the piece in 3 to 500 characters.',
  providerOffline: 'The shader assistant is offline. Your prompt is kept; try again in a minute.',
  providerMalformed: "The shader assistant sent something we can't run. Try a different prompt.",
  notACreator: 'Only creator accounts can start pieces.',
  saved: (version: number): string => `Saved version ${version}.`,
  saveConflict: (currentVersion: number): string =>
    `This piece changed in another tab. Reload to see version ${currentVersion}.`,
  keyframeAdded: (label: string, time: string): string => `${label} keyframe added at ${time} s.`,
  keyframeMoved: (label: string, time: string): string => `${label} keyframe moved to ${time} s.`,
  keyframeRemoved: (label: string): string => `${label} keyframe removed.`,
  keyframeEasing: (label: string, easingName: string): string =>
    `${label} keyframe easing set to ${easingName}.`,
  keyframeBlocked: (label: string, time: string): string =>
    `${label} already has a keyframe at ${time} s.`,
  assetUploaded: (filename: string): string => `${filename} uploaded.`,
  assetTooLarge: 'That file is over 20,000,000 bytes.',
  published: (editionCount: number): string => `Published as ${editionCount} numbered editions.`,
  withdrawn: 'Withdrawn. Owners keep their downloads.',
  remixCreated: (sourceTitle: string): string => `Remix draft created from ${sourceTitle}.`,
} as const;

export const renderStatus = {
  insufficientCredits: (cost: number, available: number): string =>
    `This render needs ${cost} credits; you have ${available}.`,
  queued: (cost: number): string => `Render queued. ${cost} credits reserved.`,
  rendering: (aspect: string, resolution: string): string =>
    `Rendering ${aspect} ${resolution} export.`,
  ready: (cost: number): string => `Export ready. ${cost} credits used.`,
  failed: 'Render failed. Your credits are being returned.',
  timedOut: 'Render timed out after 3 attempts.',
  creditsReturned: (cost: number): string => `${cost} credits returned to your balance.`,
  cancelled: 'Render cancelled.',
} as const;

export const checkoutStatus = {
  holdGranted: (edition: number, editionCount: number, secondsLeft: number): string =>
    `Edition ${edition} of ${editionCount} is held for you. ${formatClock(secondsLeft)} left.`,
  minutesLeft: (minutes: number, edition: number): string =>
    `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left on edition ${edition}.`,
  thirtySecondsLeft: (edition: number): string => `30 seconds left on edition ${edition}.`,
  heldFor: (secondsLeft: number): string => `Held for ${formatClock(secondsLeft)}`,
  holdExpired: (edition: number): string => `Your hold on edition ${edition} expired.`,
  editionTaken: (edition: number, nextFree: number): string =>
    `Edition ${edition} was just taken. Showing edition ${nextFree}.`,
  runSoldOut: 'Every edition of this run is taken.',
  countryUnsupported: "We can't invoice that country yet.",
  emailInvalid: 'Enter an email address.',
  billingNameEmpty: 'Enter the name for the invoice.',
  paying: 'Payment sent. Waiting for Kill Bill to confirm.',
  confirmed: (edition: number, editionCount: number): string =>
    `Payment confirmed. Edition ${edition} of ${editionCount} is yours.`,
  invoicePending: (invoiceNumber: string): string =>
    `Paid, invoice pending. Invoice ${invoiceNumber} will be ready shortly.`,
  paymentFailed: (edition: number): string => `Payment failed. Edition ${edition} is released.`,
  paymentsOffline: 'Payments are offline right now. Your hold is kept until its timer runs out.',
} as const;

export const libraryStatus = {
  storageOffline: 'Downloads are paused while file storage is offline.',
  invoicePending: (invoiceNumber: string): string =>
    `Paid, invoice pending. Invoice ${invoiceNumber} will be ready shortly.`,
} as const;

export const consoleStatus = {
  refundIssued: (creditNoteNumber: string): string => `Refund issued as ${creditNoteNumber}.`,
  refundWindowClosed: 'Refunds close 30 days after payment.',
  refundAmountOutOfRange: (remainingCents: number): string =>
    `Refund between $0.01 and $${formatUsd(remainingCents)}.`,
  statementsClosed: (period: string, creators: number): string =>
    `Statements for ${formatPeriod(period)} sent to ${creators} creators.`,
  periodOpen: (period: string): string => `${formatPeriod(period)} is still open.`,
} as const;

export const planStatus = {
  pending: 'Waiting for Kill Bill to confirm your payment.',
  active: (planName: 'Studio' | 'Pro'): string => `Your ${planName} plan is active.`,
  packConfirmed: '500 credits added.',
  cancelled: (endsOn: string): string => `Your plan ends on ${endsOn}.`,
  cancelBeforeConfirmation: 'Your plan can be cancelled once Kill Bill confirms it.',
} as const;

export const emptyStates = {
  freshRuns: 'Nothing numbered yet.',
  remixes: 'No remixes yet.',
  studio: 'No pieces yet.',
  library: 'No editions collected yet.',
} as const;

export type ServiceName = 'killbill' | 'render_provider' | 'gotenberg' | 'mail' | 'storage';

export const outageBanners: Readonly<Record<ServiceName, string>> = {
  killbill:
    'Kill Bill is unreachable. New purchases, refunds and plan changes are paused; held editions keep their timers.',
  render_provider:
    'The render provider is unreachable. New renders wait in the queue and return their credits if they run out of retries.',
  gotenberg:
    'Invoice rendering is down. Paid orders keep their invoice numbers and show "Paid, invoice pending" until their PDFs render.',
  mail: 'Mail is down. Receipts and notices wait in the outbox and send once mail is back.',
  storage: 'File storage is unreachable. Renders cannot finish and downloads are paused.',
};

export function errorSummary(count: number): string {
  return `Check ${count} fields.`;
}

export const noWebglNotice =
  'This piece plays live with WebGL. Showing a still frame.';

export const promptPlaceholder =
  'Oil-slick ripples that thicken toward the bottom edge, slow tide, warm rim light';

export const WORKFLOW_VERBS = ['Describe.', 'Tune.', 'Keyframe.', 'Number.', 'Settle.'] as const;

export const EASING_LABELS = {
  linear: 'Linear',
  'ease-in': 'Ease in',
  'ease-out': 'Ease out',
  'ease-in-out': 'Ease in-out',
} as const;

export type EasingValue = keyof typeof EASING_LABELS;

export const BILLING_COUNTRY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'IE', label: 'Ireland' },
  { value: 'SE', label: 'Sweden' },
  { value: 'OTHER', label: 'Other country' },
];

/** The sheet prices `Other country` at 0% VAT; the server refuses it. */
export const CHECKOUT_VAT_RATES: Readonly<Record<string, number>> = {
  US: 0,
  GB: 20,
  DE: 19,
  FR: 20,
  NL: 21,
  IE: 23,
  SE: 25,
  OTHER: 0,
};
