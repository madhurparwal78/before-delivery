import type { App } from "./http.js";
import { query, withTransaction } from "./db.js";
import { returnVoucher } from "./services/vouchers.js";
import { voidAuthorisation, completePendingRefunds } from "./services/refunds.js";
import { collectDueInvoices } from "./services/invoices.js";
import { deadlineFormat } from "../shared/time.js";
import { recordHistory } from "./services/state.js";

// A freed seat goes to the earliest waiting visitor as a mailed offer.
async function offerFreedSeats(app: App): Promise<void> {
  const sessions = await query(
    `select distinct s.id from sessions s
     where exists (select 1 from waitlist_entries w where w.session_id = s.id and w.status = 'waiting')`,
  );
  for (const s of sessions.rows) {
    const sessionId = String(s.id);
    await withTransaction(async (client) => {
      await client.query("select * from sessions where id = $1 for update", [sessionId]);
      for (;;) {
        const waiting = await client.query(
          "select * from waitlist_entries where session_id = $1 and status = 'waiting' order by position, created_at limit 1",
          [sessionId],
        );
        if (waiting.rows.length === 0) return;
        const remainingRes = await client.query(
          `select
             (select capacity from sessions where id = $1)
             - coalesce((select sum(quantity) from holds where session_id = $1 and status = 'active' and expires_at > now()), 0)
             - coalesce((select count(*) from waitlist_entries where session_id = $1 and status = 'offered' and offer_expires_at > now()), 0)
             - coalesce((select count(*) from lines where session_id = $1 and state in ('proof_pending','captured','transferred')), 0)
           as remaining`,
          [sessionId],
        );
        const remaining = Number(remainingRes.rows[0].remaining);
        if (remaining <= 0) return;
        const entry = waiting.rows[0];
        const offerExpires = new Date(Date.now() + app.config.waitlistClaimSeconds * 1000);
        await client.query(
          "update waitlist_entries set status = 'offered', offer_expires_at = $2 where id = $1",
          [String(entry.id), offerExpires],
        );
        const user = await client.query("select * from users where id = $1", [Number(entry.user_id)]);
        const session = await client.query("select * from sessions where id = $1", [sessionId]);
        await app.queueMail(client, "waitlist_offer", String(user.rows[0].email),
          `A seat is free: ${String(session.rows[0].title)}`,
          `A seat is free for ${String(session.rows[0].title)}. Claim it by ${deadlineFormat(offerExpires)} on My tickets.`,
          [], null);
      }
    });
  }
}

export async function sweepHolds(app: App): Promise<void> {
  // Lapsed offers pass the seat to the next person in line.
  await query("update waitlist_entries set status = 'lapsed' where status = 'offered' and offer_expires_at <= now()");
  await query("update holds set status = 'expired' where status = 'active' and expires_at <= now()");
  await offerFreedSeats(app);
}

// A lapse voids the authorisation, marks the lines expired and returns voucher shares.
export async function sweepProofDeadlines(app: App): Promise<void> {
  const due = await query(
    `select distinct o.* from orders o
     join lines l on l.order_id = o.id
     where o.proof_deadline is not null and o.proof_deadline <= now() and l.state = 'proof_pending'`,
  );
  for (const order of due.rows) {
    await withTransaction(async (client) => {
      const lock = await client.query("select * from orders where id = $1 for update", [String(order.id)]);
      const locked = lock.rows[0];
      if (!locked.proof_deadline || new Date(String(locked.proof_deadline)).getTime() > Date.now()) return;
      const pending = await client.query(
        "select * from lines where order_id = $1 and state = 'proof_pending'",
        [String(order.id)],
      );
      if (pending.rows.length === 0) return;
      await voidAuthorisation(app, client, String(order.id));
      await client.query("update lines set state = 'expired' where order_id = $1 and state = 'proof_pending'", [String(order.id)]);
      await client.query("update passes set status = 'voided' where line_id = any($1::int[]) and status in ('valid','transferred')", [
        pending.rows.map((l) => Number(l.id)),
      ]);
      const voucherCents = pending.rows.reduce((s, l) => s + Number(l.voucher_cents), 0);
      if (voucherCents > 0 && locked.voucher_code) {
        await returnVoucher(client, String(locked.voucher_code), voucherCents, String(order.id));
      }
      await client.query("update proofs set status = 'expired' where order_id = $1 and status = 'pending'", [String(order.id)]);
      const statusRes = await client.query("select state from lines where order_id = $1", [String(order.id)]);
      const live = statusRes.rows.filter((l) => l.state !== "voided" && l.state !== "expired");
      const derived = live.every((l) => l.state === "refunded") && live.length > 0
        ? "refunded"
        : live.length === 0 ? "voided" : "refunded_partial";
      await client.query("update orders set status = $2 where id = $1", [String(order.id), derived]);
      await client.query(
        "insert into audit (actor, actor_role, action, target_type, target_id) values ('system','system','proof_lapsed','order',$1)",
        [String(order.id)],
      );
      const buyer = await client.query("select * from users where id = $1", [Number(locked.buyer_id)]);
      await app.queueMail(client, "proof_lapsed", String(buyer.rows[0].email),
        `Reduced-rate hold expired — order ${String(order.id)}`,
        `The proof deadline for order ${String(order.id)} passed. Your payment authorisation was released.`,
        [], String(order.id));
    });
  }
}

// A scheduled item records its move at exactly publish_at, by the system.
export async function sweepPublishing(): Promise<void> {
  const sessions = await query(
    "select * from sessions where status = 'scheduled' and publish_at <= now()",
  );
  for (const s of sessions.rows) {
    await withTransaction(async (client) => {
      const lock = await client.query("select * from sessions where id = $1 for update", [String(s.id)]);
      if (String(lock.rows[0].status) !== "scheduled") return;
      await client.query("update sessions set status = 'published' where id = $1", [String(s.id)]);
      await recordHistory(client, "session", String(s.id), "scheduled", "published", "system", null);
      await client.query(
        "insert into audit (actor, actor_role, action, target_type, target_id) values ('system','system','auto_published','session',$1)",
        [String(s.id)],
      );
    });
  }
  const entries = await query("select * from entries where status = 'scheduled' and publish_at <= now()");
  for (const e of entries.rows) {
    await withTransaction(async (client) => {
      const lock = await client.query("select * from entries where id = $1 for update", [String(e.id)]);
      if (String(lock.rows[0].status) !== "scheduled") return;
      await client.query("update entries set status = 'published' where id = $1", [String(e.id)]);
      await recordHistory(client, "entry", String(e.id), "scheduled", "published", "system", null);
      await client.query(
        "insert into audit (actor, actor_role, action, target_type, target_id) values ('system','system','auto_published','entry',$1)",
        [String(e.id)],
      );
    });
  }
}

export function startScheduler(app: App): NodeJS.Timeout {
  const tick = async (): Promise<void> => {
    try {
      await sweepHolds(app);
      await sweepProofDeadlines(app);
      await sweepPublishing();
      await collectDueInvoices(app);
      await completePendingRefunds(app);
      await app.deliverOutbox();
    } catch {
      // A failed pass retries on the next tick.
    }
  };
  void tick();
  return setInterval(() => {
    void tick();
  }, 2000);
}
