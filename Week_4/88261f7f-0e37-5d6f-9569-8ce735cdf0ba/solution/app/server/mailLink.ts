import { randomBytes } from "node:crypto";
import { sendMail } from "./providers/smtp";

export const newLinkToken = (): string => randomBytes(24).toString("base64url");

/** Emails the check-in link; resolves only once the mail service accepted the message. */
export async function sendCheckinLink(hotelName: string, guestEmail: string, token: string, origin: string): Promise<void> {
  const base = origin.replace(/\/$/, "");
  await sendMail({
    to: guestEmail,
    subject: `Check in for your stay at ${hotelName}`,
    text: `Your stay at ${hotelName} is booked.\r\n\r\nCheck in here: ${base}/checkin/${token}\r\n`,
  });
}
