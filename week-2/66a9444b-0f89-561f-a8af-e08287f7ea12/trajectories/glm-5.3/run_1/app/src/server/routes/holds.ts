import { randomUUID } from "node:crypto";
import type { Route, Ctx } from "../http.js";
import { query, withTransaction } from "../db.js";
import { errors, validationError } from "../errors.js";
import { utcIso } from "../../shared/time.js";
import { effectiveStatus, seatsRemaining } from "../services/seats.js";

export function holdsRoutes(): Route[] {
  const createHold: Route = {
    method: "POST",
    pattern: "/api/holds",
    roles: "signed_in",
    bodyLimit: "json",
    async handler(ctx: Ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const sessionId = String(body.session_id ?? "");
      const quantity = Number(body.quantity ?? 0);
      const isGroup = ctx.user?.role === "group_booker";
      const max = isGroup ? 30 : 4;
      const out = await withTransaction(async (client) => {
        // Serialise competing holds per session: exactly one winner per seat.
        const sessionRes = await client.query("select * from sessions where id = $1 for update", [sessionId]);
        const session = sessionRes.rows[0];
        if (!session) throw errors.notFound();
        if (String(session.admission) !== "seat") {
          throw validationError({ session_id: "no_seats" });
        }
        const eff = effectiveStatus(String(session.status), session.publish_at ? new Date(String(session.publish_at)) : null, new Date());
        if (eff === "cancelled") throw errors.conflict("session_cancelled");
        if (eff !== "published") throw errors.conflict("not_on_sale");
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
          throw validationError({ quantity: "out_of_range" });
        }
        const remaining = await seatsRemaining(client, sessionId);
        if (remaining === null || remaining < quantity) {
          throw errors.conflict("sold_out", { seats_remaining: remaining ?? 0, waitlist: true });
        }
        const id = randomUUID();
        const expiresAt = new Date(Date.now() + ctx.app.config.holdSeconds * 1000);
        await client.query(
          `insert into holds (id, user_id, session_id, quantity, expires_at, status)
           values ($1,$2,$3,$4,$5,'active')`,
          [id, ctx.user!.id, sessionId, quantity, expiresAt],
        );
        const after = await seatsRemaining(client, sessionId);
        return { id, expiresAt, quantity, sessionId, after };
      });
      return {
        status: 201,
        body: {
          id: out.id,
          session_id: out.sessionId,
          quantity: out.quantity,
          expires_at: utcIso(out.expiresAt),
          status: "active",
          seats_remaining: out.after,
        },
      };
    },
  };

  const listHolds: Route = {
    method: "GET",
    pattern: "/api/holds",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const res = await query(
        "select * from holds where user_id = $1 and status = 'active' and expires_at > now() order by created_at",
        [ctx.user!.id],
      );
      return {
        status: 200,
        body: {
          holds: res.rows.map((h) => ({
            id: String(h.id),
            session_id: String(h.session_id),
            quantity: Number(h.quantity),
            expires_at: utcIso(new Date(String(h.expires_at))),
            status: "active",
          })),
        },
      };
    },
  };

  const releaseHold: Route = {
    method: "DELETE",
    pattern: "/api/holds/:id",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const id = ctx.params.id;
      await withTransaction(async (client) => {
        const res = await client.query("select * from holds where id = $1 for update", [id]);
        const hold = res.rows[0];
        if (!hold || Number(hold.user_id) !== ctx.user!.id) throw errors.notFound();
        if (String(hold.status) !== "active" || new Date(String(hold.expires_at)).getTime() <= Date.now()) {
          throw errors.conflict("hold_not_active");
        }
        await client.query("update holds set status = 'released' where id = $1", [id]);
      });
      return { status: 204 };
    },
  };

  const joinWaitlist: Route = {
    method: "POST",
    pattern: "/api/sessions/:id/waitlist",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const sessionId = ctx.params.id;
      const created = await withTransaction(async (client) => {
        const sessionRes = await client.query("select * from sessions where id = $1 for update", [sessionId]);
        const session = sessionRes.rows[0];
        if (!session) throw errors.notFound();
        const eff = effectiveStatus(String(session.status), session.publish_at ? new Date(String(session.publish_at)) : null, new Date());
        if (eff === "cancelled") throw errors.conflict("session_cancelled");
        if (eff !== "published") throw errors.conflict("not_on_sale");
        const existing = await client.query(
          "select * from waitlist_entries where session_id = $1 and user_id = $2 and status in ('waiting','offered')",
          [sessionId, ctx.user!.id],
        );
        if (existing.rows.length > 0) throw errors.conflict("already_waiting");
        const remaining = await seatsRemaining(client, sessionId);
        if (remaining !== null && remaining > 0) throw errors.conflict("seats_available");
        const maxRes = await client.query(
          "select coalesce(max(position),0) as m from waitlist_entries where session_id = $1",
          [sessionId],
        );
        const position = Number(maxRes.rows[0].m) + 1;
        const id = crypto.randomUUID();
        await client.query(
          `insert into waitlist_entries (id, user_id, session_id, position, status)
           values ($1,$2,$3,$4,'waiting')`,
          [id, ctx.user!.id, sessionId, position],
        );
        return { id, position };
      });
      return {
        status: 201,
        body: { id: created.id, session_id: sessionId, position: created.position, status: "waiting" },
      };
    },
  };

  const listWaitlist: Route = {
    method: "GET",
    pattern: "/api/waitlist",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const res = await query(
        `select w.*, s.title, s.starts_at
         from waitlist_entries w join sessions s on s.id = w.session_id
         where w.user_id = $1 and w.status in ('waiting','offered')
         order by w.created_at`,
        [ctx.user!.id],
      );
      return {
        status: 200,
        body: {
          entries: res.rows.map((w) => {
            const offered = String(w.status) === "offered";
            const expired = offered && new Date(String(w.offer_expires_at)).getTime() <= Date.now();
            return {
              id: String(w.id),
              session_id: String(w.session_id),
              title: String(w.title),
              position: Number(w.position),
              status: expired ? "lapsed" : String(w.status),
              offer_expires_at: offered && w.offer_expires_at ? utcIso(new Date(String(w.offer_expires_at))) : null,
            };
          }),
        },
      };
    },
  };

  const claimOffer: Route = {
    method: "POST",
    pattern: "/api/waitlist/:id/claim",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const entryId = ctx.params.id;
      const created = await withTransaction(async (client) => {
        const res = await client.query("select * from waitlist_entries where id = $1 for update", [entryId]);
        const entry = res.rows[0];
        if (!entry || Number(entry.user_id) !== ctx.user!.id) throw errors.notFound();
        if (String(entry.status) === "waiting") throw errors.conflict("no_offer");
        if (String(entry.status) !== "offered") throw errors.conflict("no_offer");
        if (new Date(String(entry.offer_expires_at)).getTime() <= Date.now()) {
          throw errors.conflict("offer_lapsed");
        }
        await client.query("update waitlist_entries set status = 'claimed' where id = $1", [entryId]);
        const holdId = randomUUID();
        const expiresAt = new Date(Date.now() + ctx.app.config.holdSeconds * 1000);
        await client.query(
          `insert into holds (id, user_id, session_id, quantity, expires_at, status)
           values ($1,$2,$3,1,$4,'active')`,
          [holdId, ctx.user!.id, String(entry.session_id), expiresAt],
        );
        return { holdId, expiresAt, sessionId: String(entry.session_id) };
      });
      return {
        status: 201,
        body: {
          id: created.holdId,
          session_id: created.sessionId,
          quantity: 1,
          expires_at: utcIso(created.expiresAt),
          status: "active",
        },
      };
    },
  };

  return [createHold, listHolds, releaseHold, joinWaitlist, listWaitlist, claimOffer];
}
