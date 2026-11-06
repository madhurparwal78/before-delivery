import { config } from "./config.js";
import { rows, withTx } from "./db.js";
import { sendMail } from "./mailer.js";
import { queueNotification, emailSubjects } from "./notify.js";
import { recordMovement } from "./ledger.js";
import { loadDocuments, latestApprovedByKind, isCurrent, documentLabels, type DocumentKind } from "./compliance.js";
import { kitchenToday } from "./kitchenTime.js";

// The outbox: notifications are delivered exactly once, retried while mail is
// unreachable, and every action that causes one writes it in the same
// transaction (DP-30).
const deliverOutbox = async (): Promise<void> => {
  const queued = await withTx(async (tx) =>
    rows<{ id: string; to_address: string; subject: string; body: string; attempts: number }>(
      tx,
      "select id, to_address, subject, body, attempts from notifications where status = 'queued' order by created_at asc limit 20",
      [],
    ),
  ).catch(() => []);
  for (const notification of queued) {
    const sent = await sendMail(notification.to_address, notification.subject, notification.body);
    await withTx(async (tx) => {
      if (sent) {
        await tx.query("update notifications set status = 'sent', sent_at = now() where id = $1", [notification.id]);
      } else {
        await tx.query("update notifications set attempts = attempts + 1 where id = $1", [notification.id]);
      }
    });
  }
};

const notifiedKinds = new Set<string>();

const scanCompliance = async (): Promise<void> => {
  const today = kitchenToday(new Date());
  const renters = await withTx(async (tx) =>
    rows<{ id: string; email: string; status: string }>(tx, "select id, email, status from renters", []),
  );
  for (const renter of renters) {
    const documents = await withTx(async (tx) => loadDocuments(tx, renter.id));
    const approved = latestApprovedByKind(documents);
    for (const kind of ["coi", "food_handler_card"] as DocumentKind[]) {
      const doc = approved.get(kind);
      if (!doc) continue;
      const label = documentLabels[kind];
      const current = isCurrent(doc, today);
      const soon = new Date(`${today}T00:00:00Z`);
      soon.setUTCDate(soon.getUTCDate() + 14);
      const soonStr = soon.toISOString().slice(0, 10);
      const expiring = current && doc.expires_on !== null && doc.expires_on <= soonStr;
      if (expiring || !current) {
        const dedupKey = `${renter.id}:${kind}:${doc.expires_on}:${expiring ? "expiring" : "expired"}`;
        if (notifiedKinds.has(dedupKey)) continue;
        notifiedKinds.add(dedupKey);
        await withTx(async (tx) => {
          await queueNotification(
            tx,
            expiring ? "document_expiring" : "document_expired",
            renter.email,
            expiring ? emailSubjects.documentExpiring(label, doc.expires_on!) : emailSubjects.documentExpired(label),
            expiring ? `Your ${label} expires on ${doc.expires_on}.` : `Your ${label} has expired.`,
          );
        });
      }
    }
    const coi = approved.get("coi");
    const card = approved.get("food_handler_card");
    const complianceOk = Boolean(coi && card && isCurrent(coi, today) && isCurrent(card, today));
    if (!complianceOk && renter.status === "active") {
      await withTx(async (tx) => {
        await tx.query("update renters set status = 'suspended' where id = $1 and status = 'active'", [renter.id]);
      });
    }
  }
};

const expireHolds = async (): Promise<void> => {
  const now = new Date();
  const expired = await withTx(async (tx) =>
    rows<{ id: string; renter_id: string; minutes_debited: number; email: string; station_name: string }>(
      tx,
      `select b.id, b.renter_id, b.minutes_debited, r.email, s.name as station_name
       from bookings b join renters r on r.id = b.renter_id join stations s on s.id = b.station_id
       where b.status = 'hold' and b.hold_expires_at <= $1`,
      [now.toISOString()],
    ),
  );
  for (const booking of expired) {
    await withTx(async (tx) => {
      const updated = await rows<{ id: string }>(
        tx,
        "update bookings set status = 'expired' where id = $1 and status = 'hold' returning id",
        [booking.id],
      );
      if (updated.length === 0) return;
      await tx.query("delete from station_occupancy where booking_id = $1", [booking.id]);
      await recordMovement(tx, booking.renter_id, "hold_release", booking.minutes_debited, { bookingId: booking.id });
      await queueNotification(
        tx,
        "hold_expired",
        booking.email,
        emailSubjects.holdExpired(booking.station_name),
        `Your hold on ${booking.station_name} has expired.`,
      );
    });
  }
};

export const startOutbox = (): void => {
  const tick = () => {
    void deliverOutbox().catch(() => undefined);
  };
  tick();
  setInterval(tick, config.outboxRetrySeconds * 1000);
};

export const startComplianceScan = (): void => {
  void scanCompliance().catch(() => undefined);
  setInterval(() => {
    void scanCompliance().catch(() => undefined);
  }, config.complianceScanSeconds * 1000);
};

export const startHoldExpiry = (): void => {
  const tick = () => {
    void expireHolds().catch(() => undefined);
  };
  tick();
  setInterval(tick, 5000);
};
