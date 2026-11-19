// Labels the screens print for server codes.

export const VERSION_REASON_LABELS = { auto: "Autosave", close: "At close", before_restore: "Before restore" } as const;
export type VersionReason = keyof typeof VERSION_REASON_LABELS;

export const ACTIVITY_LABELS: Record<string, string> = {
  "workshop.created": "Workshop created",
  "workshop.transitioned": "Moved to",
  "join_link.rotated": "Join link replaced",
  "join_link.turned_off": "Join link turned off",
  "invites.sent": "Invites added",
  "frame.trashed": "Frame moved to trash",
  "frame.restored": "Frame restored",
  "frame.purged": "Frame purged",
  "version.restored": "Version restored",
  "note.facilitator_only_changed": "Facilitator-only flag changed",
  "plan.changed": "Plan changed",
  "plan.change_scheduled": "Plan change scheduled",
  "payment.retried": "Payment retried",
  "sponsor.invoiced": "Sponsor invoiced",
  "recap.completed": "Recap sent",
};

export const RECAP_REASON_COPY = {
  storage_unavailable: "Recap queued — file storage is unavailable. It will finish automatically.",
  billing_unavailable: "Recap queued — billing is unavailable. Files are saved; the invoice and email will go out automatically.",
  mail_unavailable: "Recap queued — email is unavailable. Files are saved; the email will go out automatically.",
} as const;
export type RecapReason = keyof typeof RECAP_REASON_COPY;

/** Formats exact cents as a UK euro amount with a thousands comma and two decimals. */
export function formatAmount(amount: string): string {
  const negative = amount.startsWith("-");
  const [whole = "0", fraction = "00"] = amount.replace(/^-/, "").split(".");
  return `${negative ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}
