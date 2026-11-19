import { dollars, monthName } from "../shared/rules";

// Every published line of copy, character for character.

const t1 = (seconds: number): string => seconds.toFixed(1);
const mmss = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const copy = {
  promptExample: "Oil-slick ripples that thicken toward the bottom edge, slow tide, warm rim light",
  drafting: "Drafting your piece...",
  draftReady: "Draft ready. Tune it on the instrument panel.",
  promptLength: "Describe the piece in 3 to 500 characters.",
  assistantDown: "The shader assistant is offline. Your prompt is kept; try again in a minute.",
  assistantBad: "The shader assistant sent something we can't run. Try a different prompt.",
  creatorsOnly: "Only creator accounts can start pieces.",
  saved: (v: number) => `Saved version ${v}.`,
  saveConflict: (v: number) => `This piece changed in another tab. Reload to see version ${v}.`,
  keyAdded: (label: string, t: number) => `${label} keyframe added at ${t1(t)} s.`,
  keyMoved: (label: string, t: number) => `${label} keyframe moved to ${t1(t)} s.`,
  keyRemoved: (label: string) => `${label} keyframe removed.`,
  keyEased: (label: string, easing: string) => `${label} keyframe easing set to ${easing}.`,
  keyBlocked: (label: string, t: number) => `${label} already has a keyframe at ${t1(t)} s.`,
  uploaded: (name: string) => `${name} uploaded.`,
  tooLarge: "That file is over 20,000,000 bytes.",
  published: (m: number) => `Published as ${m} numbered editions.`,
  withdrawn: "Withdrawn. Owners keep their downloads.",
  remixCreated: (title: string) => `Remix draft created from ${title}.`,

  needsCredits: (cost: number, available: number) => `This render needs ${cost} credits; you have ${available}.`,
  queued: (cost: number) => `Render queued. ${cost} credits reserved.`,
  rendering: (aspect: string, resolution: string) => `Rendering ${aspect} ${resolution} export.`,
  ready: (cost: number) => `Export ready. ${cost} credits used.`,
  renderFailed: "Render failed. Your credits are being returned.",
  timedOut: "Render timed out after 3 attempts.",
  returned: (cost: number) => `${cost} credits returned to your balance.`,
  cancelled: "Render cancelled.",

  holdGranted: (n: number, m: number, seconds: number) => `Edition ${n} of ${m} is held for you. ${mmss(seconds)} left.`,
  minutesLeft: (minutes: number, n: number) => (minutes === 1 ? `1 minute left on edition ${n}.` : `${minutes} minutes left on edition ${n}.`),
  thirtySeconds: (n: number) => `30 seconds left on edition ${n}.`,
  heldFor: (seconds: number) => `Held for ${mmss(seconds)}`,
  holdExpired: (n: number) => `Your hold on edition ${n} expired.`,
  taken: (n: number, k: number) => `Edition ${n} was just taken. Showing edition ${k}.`,
  allTaken: "Every edition of this run is taken.",
  noCountry: "We can't invoice that country yet.",
  noEmail: "Enter an email address.",
  noName: "Enter the name for the invoice.",
  paying: "Payment sent. Waiting for Kill Bill to confirm.",
  confirmed: (n: number, m: number) => `Payment confirmed. Edition ${n} of ${m} is yours.`,
  invoicePending: (number: string) => `Paid, invoice pending. Invoice ${number} will be ready shortly.`,
  paymentFailed: (n: number) => `Payment failed. Edition ${n} is released.`,
  paymentsDown: "Payments are offline right now. Your hold is kept until its timer runs out.",

  storageDown: "Downloads are paused while file storage is offline.",

  refundIssued: (number: string) => `Refund issued as ${number}.`,
  refundClosed: "Refunds close 30 days after payment.",
  refundRange: (remaining: number) => `Refund between $0.01 and $${dollars(remaining)}.`,
  statementsSent: (period: string, count: number) => `Statements for ${monthName(period)} sent to ${count} creators.`,
  periodOpen: (period: string) => `${monthName(period)} is still open.`,

  planPending: "Waiting for Kill Bill to confirm your payment.",
  planActive: (plan: string) => `Your ${plan} plan is active.`,
  packAdded: "500 credits added.",
  planEnds: (date: string) => `Your plan ends on ${date}.`,
  planUnconfirmed: "Your plan can be cancelled once Kill Bill confirms it.",

  checkFields: (count: number) => `Check ${count} fields.`,
  stillFrame: "This piece plays live with WebGL. Showing a still frame.",

  banners: {
    killbill: "Kill Bill is unreachable. New purchases, refunds and plan changes are paused; held editions keep their timers.",
    render_provider: "The render provider is unreachable. New renders wait in the queue and return their credits if they run out of retries.",
    gotenberg: 'Invoice rendering is down. Paid orders keep their invoice numbers and show "Paid, invoice pending" until their PDFs render.',
    mail: "Mail is down. Receipts and notices wait in the outbox and send once mail is back.",
    storage: "File storage is unreachable. Renders cannot finish and downloads are paused.",
  },
} as const;

export const money = (cents: number): string => `$${dollars(cents)}`;
