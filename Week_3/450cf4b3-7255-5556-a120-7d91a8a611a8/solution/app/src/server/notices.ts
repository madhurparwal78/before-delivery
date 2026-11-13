// Expiry notice points: "seven_days" on the kitchen date seven days before expiresOn and "today"
// on expiresOn, for each current document of an approved or suspended tenant. A point is claimed
// once in Postgres together with its queued email, so restarts and extra processes add nothing.

import { addDays, dateLabel } from "../shared/clock.js";
import { db } from "./db.js";
import { kitchenTime, zone } from "./kitchen.js";
import { queueEmail } from "./mail.js";
import { col } from "./postgres.js";

const KIND_LABEL: Readonly<Record<string, string>> = {
  insurance_certificate: "certificate of insurance",
  food_handler_card: "food-handler card",
};

export async function sweepNotices(): Promise<void> {
  const date = (await kitchenTime(db)).today;
  const due = await db.query(
    `SELECT c.id, c.kind, c.expires_on::text AS expires_on, t.contact_name, u.email
       FROM current_documents c
       JOIN tenants t ON t.id = c.tenant_id
       JOIN users u ON u.tenant_id = t.id
      WHERE t.onboarding = 'approved' AND (c.expires_on = $1::date OR c.expires_on = $2::date)`,
    [date, addDays(date, 7)],
  );
  for (const row of due) {
    const expiresOn = col.text(row, "expires_on");
    const point = expiresOn === date ? "today" : "seven_days";
    const label = KIND_LABEL[col.text(row, "kind")] ?? "document";
    await db.transaction(async (tx) => {
      const claimed = await tx.query(
        "INSERT INTO notice_claims (document_id, point) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING point",
        [col.text(row, "id"), point],
      );
      if (claimed.length === 0) return;
      const mailId = await queueEmail(tx, {
        action: "expiry_notice", recordId: col.text(row, "id"), toName: col.text(row, "contact_name"), to: col.text(row, "email"),
        subject: point === "today" ? `Your ${label} expires today` : `Your ${label} expires in 7 days`,
        lines: [`Expires: ${dateLabel(expiresOn)} at 23:59 ${zone}`,
          `Bookings after ${dateLabel(expiresOn)} will be refused until a renewed document is on file.`],
      });
      await tx.query("UPDATE notice_claims SET mail_id = $3 WHERE document_id = $1 AND point = $2", [col.text(row, "id"), point, mailId]);
    });
  }
}
