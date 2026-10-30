import { formatHours, formatMoney, type Line, type Quote } from "./domain";

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

function lineRow(line: Line): string {
  return `${line.station} — tier ${line.tier} — ${line.hours} h — ${line.paid_by === "pack" ? "pack hours" : formatMoney(line.amount_cents)}`;
}

export function confirmationEmail(
  to: string,
  kitchenName: string,
  booking: { ref: string; date: string; hours: string; total: string; packQuarters: number; lines: Line[]; blocks: Array<{ station: string; start: string; end: string; hours: string }>; cancellationWindowHours: number }
): EmailMessage {
  const lines = [
    `Booking ${booking.ref} confirmed at ${kitchenName}.`,
    `Date: ${booking.date}`,
    "",
    "Stations:",
    ...booking.blocks.map((block) => `  ${block.station}: ${block.start}–${block.end} (${block.hours} h)`),
    "",
    "Lines:",
    ...booking.lines.map((line) => `  ${lineRow(line)}`),
    "",
    `Hours: ${booking.hours}`,
    `Total: ${booking.total}`,
    `Pack hours used: ${formatHours(booking.packQuarters)}`,
    `Cancellation window: ${booking.cancellationWindowHours} hours`,
  ];
  return { to, subject: `Booking ${booking.ref} confirmed — ${kitchenName}`, body: lines.join("\n") };
}

export interface SeriesOccurrence {
  ref: string;
  date: string;
  hours: string;
  total: string;
  blocks: Array<{ station: string; start: string; end: string; hours: string }>;
  lines: Line[];
}

export function seriesEmail(
  to: string,
  kitchenName: string,
  occurrences: SeriesOccurrence[],
  total: string
): EmailMessage {
  const lines = [`Weekly series ${occurrences[0]!.ref} to ${occurrences[occurrences.length - 1]!.ref} confirmed at ${kitchenName}.`];
  for (const occurrence of occurrences) {
    lines.push(
      "",
      `${occurrence.ref} — ${occurrence.date}`,
      ...occurrence.blocks.map((block) => `  ${block.station}: ${block.start}–${block.end} (${block.hours} h)`),
      ...occurrence.lines.map((line) => `  ${lineRow(line)}`),
      `Hours: ${occurrence.hours}`,
      `Total: ${occurrence.total}`
    );
  }
  lines.push("", `Series total: ${total}`);
  return {
    to,
    subject: `Weekly series ${occurrences[0]!.ref} to ${occurrences[occurrences.length - 1]!.ref} confirmed — ${kitchenName}`,
    body: lines.join("\n"),
  };
}

export function cancellationEmail(
  to: string,
  booking: { ref: string; packQuarters: number; totalCents: number },
  inWindow: boolean
): EmailMessage {
  const hours = formatHours(booking.packQuarters);
  const body = inWindow
    ? [
        `Booking ${booking.ref} cancelled in window.`,
        `Refunded: ${hours} pack hours and ${formatMoney(booking.totalCents)}.`,
      ].join("\n")
    : [
        `Booking ${booking.ref} cancelled inside the cancellation window, so it is still charged.`,
        "Refunded: nothing.",
      ].join("\n");
  return { to, subject: `Booking ${booking.ref} cancelled — ${hours} pack hours refunded`, body };
}

export function reminderEmail(to: string, label: string, business: string, expiresOn: string): EmailMessage {
  return { to, subject: `${label} for ${business} expires ${expiresOn}`, body: `Your ${label.toLowerCase()} for ${business} expires ${expiresOn}. Upload a current one to keep booking.` };
}

export function quoteAnnouncement(quote: Quote): string {
  return `Total ${quote.total} for ${quote.hours} hours.`;
}
