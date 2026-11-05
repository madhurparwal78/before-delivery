export const COPY = {
  quotePending: "Quoting\u2026",
  quoteOutage: "Live pricing is offline. Try again in a moment.",
  acceptPending: "Accepting your quote\u2026",
  quoteStale: "Prices changed since your quote. Review the new total before accepting.",
  payPending: "Processing payment\u2026",
  cardDeclined: "Your card was declined. Nothing was charged.",
  billingOutage:
    "We can't reach billing right now. Nothing was charged, and your details are still here. Try Pay again in a few minutes.",
  storageOutageCheckout:
    "We couldn't open your project folder, so the payment was cancelled and nothing was charged. Try again in a few minutes.",
  previewPending: "Working out your proration\u2026",
  previewExpired: "This preview expired. Open the change again for fresh figures.",
  previewStale: "Billing moved on since your preview. Review the updated figures.",
  planChangeOutage: "Billing is unreachable, so we can't change your plan right now.",
  planActionPending: "Confirming with billing\u2026",
  planResumed: "Your plan is active again.",
  planPageOutage: "Billing is unreachable, so we can't show your plan status right now.",
  pastDue: "Your last care-plan payment failed. Update your card to keep your plan.",
  cardUpdatePaid: "Payment received. Your plan is active.",
  uploadNameRefused: "That file name can't be stored. Rename the file and try again.",
  storageOutageUpload: "File storage is unavailable. Your file was not uploaded. Try again in a minute.",
  linkExpired: "This download link expired. Press Download again.",
  invitePending: "Sending invite\u2026",
  inviteEmailTaken: "This person already has a Pampero Ledger sign-in.",
  refundPending: "Issuing refund\u2026",
  signInFailed: "Email or password is incorrect.",
  cmsOutage: "Case studies are unavailable right now.",
  notFoundHeading: "We couldn't find that page.",
  accessEndedHeading: "Your access to this project ended when it closed.",
  allowlist: "Accepted: PNG, JPEG, WebP, SVG, PDF, WOFF2, OTF and TTF, up to 10 MB each.",
} as const;

export function quoteReady(dueNow: string, dueAtLaunch: string, total: string): string {
  return `Due now ${dueNow}, due at launch ${dueAtLaunch}, total ${total}.`;
}

export function quoteAccepted(total: string): string {
  return `Quote accepted. Price locked at ${total}.`;
}

export function receiptEmailLine(ownerEmail: string): string {
  return `We'll email your receipt to ${ownerEmail}.`;
}

export function previewReady(credit: string, charge: string, total: string): string {
  return `Credit ${credit}, new plan charge ${charge}, total ${total}.`;
}

export function planChanged(name: string): string {
  return `Your plan is now ${name}.`;
}

export function planPauses(date: string): string {
  return `Your plan pauses on ${date}.`;
}

export function planEnds(date: string): string {
  return `Your plan ends on ${date}.`;
}

export function uploadProgress(fileName: string, percent: number): string {
  return `Uploading ${fileName}: ${percent}%`;
}

export function uploadDone(fileName: string): string {
  return `Uploaded ${fileName}.`;
}

export function uploadTypeRefused(fileName: string): string {
  return `${fileName} is not an accepted file type.`;
}

export function uploadSizeRefused(fileName: string): string {
  return `${fileName} is larger than 10 MB.`;
}

export function inviteSent(email: string): string {
  return `Invite sent to ${email}.`;
}

export function refundDone(amount: string, remaining: string): string {
  return `Refunded ${amount}. ${remaining} left on this payment.`;
}

export function refundOverCap(remaining: string): string {
  return `That is more than the ${remaining} left on this payment.`;
}

export function accountCurrencyRefusal(currency: string): string {
  return `Your account bills in ${currency}.`;
}

export function creditCurrencyRefusal(currency: string): string {
  return `Credits must be in ${currency}.`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `1 December 2026` from a `YYYY-MM-DD` date. */
export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  const monthName = MONTHS[Number(month) - 1] ?? month ?? "";
  return `${Number(day)} ${monthName} ${year}`;
}
