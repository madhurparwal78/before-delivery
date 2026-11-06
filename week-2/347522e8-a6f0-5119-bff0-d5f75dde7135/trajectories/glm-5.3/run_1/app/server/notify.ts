import type { Tx } from "./db.js";

export type NotificationKind =
  | "receipt"
  | "booking_confirmed"
  | "hold_expired"
  | "booking_displaced"
  | "document_expiring"
  | "document_expired";

export const queueNotification = async (
  tx: Tx,
  kind: NotificationKind,
  toAddress: string,
  subject: string,
  body: string,
): Promise<void> => {
  await tx.query(
    "insert into notifications (kind, to_address, subject, body, status) values ($1, $2, $3, $4, 'queued')",
    [kind, toAddress, subject, body],
  );
};

export const emailSubjects = {
  receipt: (packName: string) => `Receipt for your ${packName}`,
  bookingConfirmed: (stationName: string, date: string) => `Booking confirmed: ${stationName} on ${date}`,
  holdExpired: (stationName: string) => `Your hold on ${stationName} has expired`,
  bookingDisplaced: (stationName: string, date: string) => `Booking displaced: ${stationName} on ${date}`,
  documentExpiring: (label: string, date: string) => `Your ${label} expires on ${date}`,
  documentExpired: (label: string) => `Your ${label} has expired`,
};
