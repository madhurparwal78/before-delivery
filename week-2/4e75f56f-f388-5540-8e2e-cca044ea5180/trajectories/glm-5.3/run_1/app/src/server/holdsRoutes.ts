import { Router } from "express";
import type { Request } from "express";
import { query, withTransaction, withLedgerLock } from "./db.js";
import { accountFromRequest, requireAccount, type Account } from "./auth.js";
import { conflict, notFound, validation, err } from "./errors.js";
import { ATELIER_CAP, PRICES, type Config } from "./config.js";
import { newId } from "./ids.js";
import {
  insertHold, fetchReservation, reservationWithDocs, countAtelierActiveClient,
  fetchReservationClient, offerBenchToWaitlist,
} from "./reservations.js";
import { tierOfRow, type Tier } from "./domain.js";
import { ledgerPayload, benchViewsFor } from "./ledger.js";
import { venueDate, nowIso } from "./time.js";

export function makeHoldsRouter(cfg: Config): Router {
  const router = Router();

  // GET /api/benches — anonymous allowed; per-viewer states computed per request.
  router.get("/benches", async (req, res, next) => {
    try {
      const viewer = await accountFromRequest(req);
      const { counts, benches } = await benchViewsFor(viewer?.id ?? null, viewer?.email ?? null);
      const filtered = viewer
        ? benches
        : benches.map((b) => ({
            ...b,
            state: b.state === "open" || b.state === "held" || b.state === "sold" ? b.state : "held",
          }));
      res.json(ledgerPayload(cfg, counts, filtered));
    } catch (e) {
      next(e);
    }
  });

  // POST /api/holds — practitioner or clinic.
  router.post("/holds", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner" && account.role !== "clinic") {
        res.status(403).json({ error: "forbidden", message: "Staff accounts cannot hold benches." });
        return;
      }
      const benches = req.body?.benches;
      const max = account.role === "practitioner" ? 1 : 6;
      const errors: Record<string, string> = {};
      if (!Array.isArray(benches) || benches.length === 0) errors.benches = "Choose at least one bench.";
      else if (new Set(benches).size !== benches.length) errors.benches = "Each bench may appear once.";
      else if (benches.length > max) errors.benches = `At most ${max} bench${max === 1 ? "" : "es"}.`;
      else if (benches.some((b: unknown) => typeof b !== "string" || !/^[A-D][1-6]$/.test(b))) errors.benches = "Choose benches from A1 to D6.";
      if (Object.keys(errors).length > 0) {
        res.status(422).json({ error: "validation", message: "Some fields need attention.", errors });
        return;
      }

      const requested = benches as string[];
      const result = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          if (account.role === "practitioner") {
            const { rows: mine } = await client.query(
              `SELECT id FROM reservations WHERE buyer_id = $1
                 AND state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')`,
              [account.id]
            );
            const { rows: attending } = await client.query(
              `SELECT id FROM reservations WHERE attendee_email = $1 AND attendee_accepted = true
                 AND state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')`,
              [account.email]
            );
            const { rows: wl } = await client.query(
              `SELECT id FROM waitlist WHERE account_id = $1 AND state IN ('waitlisted','offered','held')`,
              [account.id]
            );
            if (mine.length > 0 || attending.length > 0 || wl.length > 0) {
              return { code: "already_reserved" as const };
            }
          } else {
            const { rows: liveHold } = await client.query(
              `SELECT id FROM reservations WHERE buyer_id = $1 AND state = 'held'
                 AND (hold_expires_at > now() OR payment_in_flight OR payment_pending IS NOT NULL)`,
              [account.id]
            );
            if (liveHold.length > 0) {
              return { code: "hold_limit" as const };
            }
          }

          // Which requested benches are open?
          const { rows: occupiedRows } = await client.query<{ bench: string }>(
            `SELECT r.bench FROM reservations r
             WHERE r.bench = ANY($1)
               AND r.state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')
               AND (r.state <> 'held' OR r.hold_expires_at > now() OR r.payment_in_flight OR r.payment_pending IS NOT NULL)`,
            [requested]
          );
          const { rows: offeredRows } = await client.query<{ bench: string }>(
            `SELECT bench FROM waitlist WHERE state = 'offered' AND offer_expires_at > now() AND bench = ANY($1)`,
            [requested]
          );
          const { rows: upgradeTargets } = await client.query<{ upgrade_bench: string }>(
            `SELECT upgrade_bench FROM reservations WHERE upgrade_bench = ANY($1) AND payment_pending = 'upgrade'`,
            [requested]
          );
          const taken = new Set<string>([
            ...occupiedRows.map((r) => r.bench),
            ...offeredRows.map((r) => r.bench),
            ...upgradeTargets.map((r) => r.upgrade_bench),
          ]);
          const notOpen = requested.filter((b) => taken.has(b));
          if (notOpen.length > 0) {
            const waitlist = await waitlistOpenPayload(client, requested);
            return { code: "bench_taken" as const, bench: notOpen[0], waitlist };
          }

          // Atelier cap.
          if (requested.some((b) => b[0] === "A" || b[0] === "B")) {
            const active = await countAtelierActiveClient(client);
            const wanted = requested.filter((b) => b[0] === "A" || b[0] === "B").length;
            if (active + wanted > ATELIER_CAP) {
              const waitlist = await waitlistOpenPayload(client, requested);
              return { code: "atelier_sold_out" as const, waitlist };
            }
          }

          // A clinic's hold is always a group, even for one bench: it pays
          // one group invoice and releases together.
          const groupId = account.role === "clinic" ? newId("grp") : null;
          if (groupId) {
            await client.query("INSERT INTO groups (id, buyer_id, state) VALUES ($1, $2, 'held')", [groupId, account.id]);
          }
          const created: string[] = [];
          for (const bench of requested) {
            const row = await insertHold(client, cfg, account, bench, groupId);
            created.push(row.id);
          }
          return { created, groupId };
        });
      });

      if ("code" in result) {
        if (result.code === "bench_taken") {
          res.status(409).json({
            error: "bench_taken",
            message: `Bench ${result.bench} was just taken.`,
            waitlist: result.waitlist,
          });
        } else if (result.code === "atelier_sold_out") {
          res.status(409).json({
            error: "atelier_sold_out",
            message: "Atelier is sold out.",
            waitlist: result.waitlist,
          });
        } else {
          res.status(409).json({ error: result.code, message: result.code === "hold_limit" ? "You already have a live group hold." : "You already have a seat, hold or waitlist entry." });
        }
        return;
      }

      const reservations = [];
      for (const id of result.created) {
        const row = await fetchReservation(id);
        if (row) reservations.push(await reservationWithDocs(row));
      }
      const { counts } = await benchViewsFor(null, null);
      res.status(201).json({
        reservations,
        group_id: result.groupId,
        seats_remaining: counts.seats_remaining,
        server_time: nowIso(),
      });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/reservations/{id}/release — buyer.
  router.post("/reservations/:id/release", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner" && account.role !== "clinic") {
        res.status(403).json({ error: "forbidden", message: "You may not do that." });
        return;
      }
      const { id } = req.params;
      const outcome = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const r = await fetchReservationClient(client, id!);
          if (!r || r.buyer_id !== account.id) return { code: "not_found" as const };
          if (r.state !== "held") return { code: "invalid_transition" as const };
          await client.query("UPDATE reservations SET state = 'released', payment_in_flight = FALSE, payment_pending = NULL WHERE id = $1", [id]);
          const offered = await offerBenchToWaitlist(client, r.bench, cfg);
          return { offered, bench: r.bench };
        });
      });
      if (outcome.code === "not_found") {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      if (outcome.code === "invalid_transition") {
        res.status(409).json({ error: "invalid_transition", message: "That seat cannot be released." });
        return;
      }
      if (outcome.offered) await offerEmail(outcome.offered);
      const row = await fetchReservation(id!);
      const { counts } = await benchViewsFor(null, null);
      res.json({ reservation: row ? await reservationWithDocs(row) : null, seats_remaining: counts.seats_remaining });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/groups/{id}/release — buyer.
  router.post("/groups/:id/release", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner" && account.role !== "clinic") {
        res.status(403).json({ error: "forbidden", message: "You may not do that." });
        return;
      }
      const { id } = req.params;
      const offeredEmails: Awaited<ReturnType<typeof offerBenchToWaitlist>>[] = [];
      const outcome = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const { rows: g } = await client.query("SELECT id, buyer_id, state FROM groups WHERE id = $1", [id]);
          if (!g[0] || g[0].buyer_id !== account.id) return { code: "not_found" as const };
          const { rows } = await client.query(
            `SELECT * FROM reservations WHERE group_id = $1 AND state = 'held'`,
            [id]
          );
          if (rows.length === 0) return { code: "invalid_transition" as const };
          for (const r of rows) {
            await client.query("UPDATE reservations SET state = 'released', payment_in_flight = FALSE, payment_pending = NULL WHERE id = $1", [r.id]);
            const offered = await offerBenchToWaitlist(client, r.bench, cfg);
            if (offered) offeredEmails.push(offered);
          }
          await client.query("UPDATE groups SET state = 'released' WHERE id = $1", [id]);
          return { code: "ok" as const };
        });
      });
      if (outcome.code === "not_found") {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      if (outcome.code === "invalid_transition") {
        res.status(409).json({ error: "invalid_transition", message: "That group cannot be released." });
        return;
      }
      for (const o of offeredEmails) if (o) await offerEmail(o);
      const { counts } = await benchViewsFor(null, null);
      const { rows: groupRows } = await query<{ state: string }>("SELECT state FROM groups WHERE id = $1", [id]);
      res.json({
        group: { id: id!, state: groupRows[0]?.state ?? "released" },
        seats_remaining: counts.seats_remaining,
      });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/waitlist — practitioner only.
  router.post("/waitlist", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner" && account.role !== "clinic") {
        res.status(403).json({ error: "forbidden", message: "You may not do that." });
        return;
      }
      if (account.role === "clinic") {
        res.status(403).json({ error: "forbidden", message: "Clinic accounts join the waitlist per practitioner." });
        return;
      }
      const tier = req.body?.tier;
      if (tier !== "bench" && tier !== "atelier") {
        res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: { tier: "Choose Bench or Atelier." } });
        return;
      }
      const result = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const { rows: mine } = await client.query(
            `SELECT id FROM reservations WHERE buyer_id = $1
               AND state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')`,
            [account.id]
          );
          const { rows: attending } = await client.query(
            `SELECT id FROM reservations WHERE attendee_email = $1 AND attendee_accepted = true
               AND state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')`,
            [account.email]
          );
          const { rows: wl } = await client.query(
            `SELECT id FROM waitlist WHERE account_id = $1 AND state IN ('waitlisted','offered','held')`,
            [account.id]
          );
          if (mine.length > 0 || attending.length > 0 || wl.length > 0) {
            return { code: "already_reserved" as const };
          }
          const holdable = await holdableCount(client, tier);
          if (holdable > 0) return { code: "benches_available" as const };
          const { rows: pos } = await client.query(
            "SELECT count(*)::int AS count FROM waitlist WHERE tier = $1 AND state = 'waitlisted'",
            [tier]
          );
          const id = newId("off");
          await client.query("INSERT INTO waitlist (id, account_id, tier, state) VALUES ($1, $2, $3, 'waitlisted')", [id, account.id, tier]);
          return { position: (pos[0]?.count ?? 0) + 1 };
        });
      });
      if ("code" in result) {
        res.status(409).json({ error: result.code, message: result.code === "benches_available" ? "There is a bench you could hold." : "You already have a seat, hold or waitlist entry." });
        return;
      }
      res.status(201).json({ tier, position: result.position });
    } catch (e) {
      next(e);
    }
  });

  // DELETE /api/waitlist
  router.delete("/waitlist", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      await query("DELETE FROM waitlist WHERE account_id = $1 AND state = 'waitlisted'", [account.id]);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // POST /api/offers/{id}/accept — offeree.
  router.post("/offers/:id/accept", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      const { id } = req.params;
      const result = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const { rows } = await client.query(
            "SELECT id, account_id, tier, state, bench, offer_expires_at FROM waitlist WHERE id = $1",
            [id]
          );
          const offer = rows[0];
          if (!offer || offer.account_id !== account.id) return { code: "not_found" as const };
          if (offer.state !== "offered" || !offer.offer_expires_at || new Date(offer.offer_expires_at).getTime() <= Date.now()) {
            return { code: "offer_lapsed" as const };
          }
          const { rows: occupiedHold } = await client.query(
            `SELECT id FROM reservations r WHERE r.bench = $1
               AND r.state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')
               AND (r.state <> 'held' OR r.hold_expires_at > now() OR r.payment_in_flight OR r.payment_pending IS NOT NULL)`,
            [offer.bench]
          );
          if (occupiedHold.length > 0) return { code: "offer_lapsed" as const };
          const { rows: offeredNow } = await client.query(
            `SELECT id FROM waitlist WHERE bench = $1 AND state = 'offered' AND offer_expires_at > now() AND id <> $2`,
            [offer.bench, id]
          );
          if (offeredNow.length > 0) return { code: "offer_lapsed" as const };
          if (offer.tier === "atelier") {
            // The offer itself holds the bench, so it already counts toward the
            // cap; accepting swaps the offer for a hold without growing it.
            const active = await countAtelierActiveClient(client);
            if (active > ATELIER_CAP) return { code: "offer_lapsed" as const };
          }
          await client.query("UPDATE waitlist SET state = 'held' WHERE id = $1", [id]);
          const hold = await insertHold(client, cfg, account, offer.bench, null);
          return { holdId: hold.id, bench: offer.bench };
        });
      });
      if ("code" in result) {
        if (result.code === "not_found") {
          res.status(404).json({ error: "not_found", message: "Nothing here." });
        } else {
          res.status(409).json({ error: "offer_lapsed", message: "This offer has passed to the next person on the waitlist." });
        }
        return;
      }
      const row = await fetchReservation(result.holdId);
      const { counts } = await benchViewsFor(null, null);
      res.status(201).json({
        reservations: [row ? await reservationWithDocs(row) : null],
        seats_remaining: counts.seats_remaining,
        server_time: nowIso(),
      });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/offers/{id}/decline — offeree.
  router.post("/offers/:id/decline", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      const { id } = req.params;
    const outcome = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const { rows } = await client.query(
            "SELECT id, account_id, state, bench, tier FROM waitlist WHERE id = $1",
            [id]
          );
          const offer = rows[0];
          if (!offer || offer.account_id !== account.id) return { code: "not_found" as const };
          if (offer.state !== "offered") return { code: "offer_lapsed" as const };
          await client.query("UPDATE waitlist SET state = 'offer_lapsed' WHERE id = $1", [id]);
          const offered = offer.bench ? await offerBenchToWaitlist(client, offer.bench, cfg) : null;
          return { offered, tier: offer.tier as Tier, bench: offer.bench };
        });
      });
      if (outcome.code === "not_found") {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      if (outcome.code === "offer_lapsed") {
        res.status(409).json({ error: "offer_lapsed", message: "This offer has passed to the next person on the waitlist." });
        return;
      }
      if (outcome.offered) await offerEmail(outcome.offered);
      res.json({ offer: { id: id!, state: "offer_lapsed" } });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

async function holdableCount(client: import("pg").PoolClient, tier: Tier): Promise<number> {
  const rowsOfTier = tier === "atelier" ? "('A','B')" : "('C','D')";
  const { rows } = await client.query<{ label: string }>(
    `SELECT b.label FROM benches b
     WHERE b.row IN ${rowsOfTier}
       AND NOT EXISTS (
         SELECT 1 FROM reservations r WHERE r.bench = b.label
           AND r.state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')
           AND (r.state <> 'held' OR r.hold_expires_at > now() OR r.payment_in_flight OR r.payment_pending IS NOT NULL))
       AND NOT EXISTS (
         SELECT 1 FROM waitlist w WHERE w.bench = b.label AND w.state = 'offered' AND w.offer_expires_at > now())
       AND NOT EXISTS (
         SELECT 1 FROM reservations u WHERE u.upgrade_bench = b.label AND u.payment_pending = 'upgrade')`
  );
  const labels = rows.map((r) => r.label);
  if (tier === "atelier") {
    const { rows: active } = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM (
         SELECT r.bench FROM reservations r JOIN benches b ON b.label = r.bench
         WHERE b.row IN ('A','B') AND r.state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')
           AND (r.state <> 'held' OR r.hold_expires_at > now() OR r.payment_in_flight OR r.payment_pending IS NOT NULL)
         UNION ALL
         SELECT w.bench FROM waitlist w JOIN benches b ON b.label = w.bench
         WHERE w.state = 'offered' AND w.offer_expires_at > now() AND b.row IN ('A','B')
       ) t`
    );
    const room = Math.max(0, ATELIER_CAP - (active[0]?.count ?? 0));
    return Math.min(labels.length, room);
  }
  return labels.length;
}

/** waitlist.open is true when the tier now has no bench to hold. */
async function waitlistOpenPayload(client: import("pg").PoolClient, requested: string[]): Promise<{ tier: Tier; open: boolean }> {
  const tier: Tier = requested.some((b) => b[0] === "A" || b[0] === "B") ? "atelier" : "bench";
  const holdable = await holdableCount(client, tier);
  return { tier, open: holdable === 0 };
}

export async function offerEmail(offer: { offerId: string; accountEmail: string; tier: Tier }): Promise<void> {
  const { queueMail } = await import("./mail.js");
  await queueMail(offer.accountEmail, "A bench is open for you: sign in to accept", "A bench in your tier has opened at Opaline Bench Days. Sign in to your account to accept it within the offer window: /account");
}

export type _T = Tier;
