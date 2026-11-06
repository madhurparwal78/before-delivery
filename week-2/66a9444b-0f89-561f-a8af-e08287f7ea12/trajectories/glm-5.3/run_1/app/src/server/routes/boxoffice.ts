import type { Route, Ctx } from "../http.js";
import { query, withTransaction, type Row } from "../db.js";
import { errors, validationError } from "../errors.js";
import { festivalDayStart, festivalDayEnd, utcIso, sessionClock, formatClock, dayLabel } from "../../shared/time.js";
import { proofJson, orderJson, refreshOrderStatusTx } from "../services/shapes.js";
import { returnVoucher } from "../services/vouchers.js";
import { storePass, passObjectKey, deletePassObject } from "../services/passes.js";
import { recordKbTransaction, PaymentUnavailable } from "../services/kb.js";
import { voidAuthorisation } from "../services/refunds.js";
import { StorageUnavailable } from "../s3.js";
import { ApiError } from "../errors.js";


async function orderPaymentId(client: { query: (sql: string, a: unknown[]) => Promise<{ rows: Row[] }> }, orderId: string): Promise<string | null> {
  const res = await client.query(
    "select payment_id, amount_cents from kb_transactions where order_ref = $1 and external_key = $2 limit 1",
    [orderId, `${orderId}-auth`],
  );
  const row = res.rows[0];
  if (!row || !row.payment_id) return null;
  return String(row.payment_id);
}

export function boxOfficeRoutes(): Route[] {
  const proofQueue: Route = {
    method: "GET",
    pattern: "/api/box-office/proofs",
    roles: "box_office",
    bodyLimit: "none",
    async handler(ctx) {
      const status = ctx.query.get("status") ?? "pending";
      const res = await query(
        `select p.*, u.name as buyer_name from proofs p join orders o on o.id = p.order_id join users u on u.id = o.buyer_id
         where p.status = $1 order by p.uploaded_at`,
        [status],
      );
      const proofs = [];
      for (const row of res.rows) {
        proofs.push({ ...proofJson(row), buyer_name: String(row.buyer_name) });
      }
      return { status: 200, body: { proofs } };
    },
  };

  const readProof: Route = {
    method: "POST",
    pattern: "/api/box-office/proofs/:id/read",
    roles: "box_office",
    bodyLimit: "none",
    async handler(ctx) {
      const res = await query("select * from proofs where id = $1", [ctx.params.id]);
      const proof = res.rows[0];
      if (!proof) throw errors.notFound();
      const expiresAt = new Date(Date.now() + ctx.app.config.signedReadSeconds * 1000);
      const token = ctx.app.signFileToken(`proofs/${String(proof.order_id)}/${String(proof.id)}`, expiresAt);
      return { status: 200, body: { url: `/api/files/${token}`, expires_at: utcIso(expiresAt) } };
    },
  };

  // Approval captures the sum of the still-pending lines' charged cents and
  // stores their passes first; rejection voids the authorisation.
  const proofDecision: Route = {
    method: "POST",
    pattern: "/api/box-office/proofs/:id/decision",
    roles: "box_office",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const decision = String(body.decision ?? "");
      if (decision !== "approve" && decision !== "reject") {
        throw validationError({ decision: "invalid" });
      }
      const reason = body.reason === null || body.reason === undefined ? null : String(body.reason);
      if (decision === "reject" && (reason === null || reason.trim().length === 0)) {
        throw validationError({ reason: "required" });
      }
      const proofRes = await query("select * from proofs where id = $1", [ctx.params.id]);
      const proof = proofRes.rows[0];
      if (!proof) throw errors.notFound();
      const orderRes = await query("select * from orders where id = $1", [String(proof.order_id)]);
      const order = orderRes.rows[0];
      if (!order) throw errors.notFound();

      const storedObjects: string[] = [];
      try {
        await withTransaction(async (client) => {
          const lock = await client.query("select * from proofs where id = $1 for update", [ctx.params.id]);
          const locked = lock.rows[0];
          if (!locked) throw errors.notFound();
          if (String(locked.status) !== "pending") throw errors.conflict("already_decided");
          // A decision at or after the deadline is refused.
          if (new Date(String(locked.deadline)).getTime() <= Date.now()) {
            throw errors.conflict("proof_hold_expired");
          }
          const orderRes2 = await client.query("select * from orders where id = $1 for update", [String(locked.order_id)]);
          const lockedOrder = orderRes2.rows[0];
          const pendingLines = await client.query(
            "select * from lines where order_id = $1 and state = 'proof_pending' order by position",
            [String(locked.order_id)],
          );
          if (pendingLines.rows.length === 0) throw errors.conflict("already_decided");

          if (decision === "approve") {
            // Passes are stored first; the capture happens only once every
            // pass is stored.
            const passInfos: Array<{ code: string; objectKey: string }> = [];
            for (const line of pendingLines.rows) {
              const when = await passWhenForLine(client, line);
              const venue = await passVenueForLine(client, line);
              const info = await storePass(ctx.app.s3, client, {
                orderRef: String(locked.order_id),
                holderName: String(line.holder_name),
                itemTitle: String(line.title),
                when,
                venue,
              }, Number(line.id));
              storedObjects.push(info.objectKey);
              passInfos.push(info);
            }
            const captureCents = pendingLines.rows.reduce((s, l) => s + Number(l.charged_cents), 0);
            if (captureCents > 0) {
              const paymentId = await orderPaymentId(client, String(locked.order_id));
              if (paymentId) {
                const tx = await ctx.app.killbill.completeTransaction(paymentId, "CAPTURE", `${String(locked.order_id)}-capture`, captureCents);
                await recordKbTransaction(client, tx, "CAPTURE", captureCents, `${String(locked.order_id)}-capture`, String(locked.order_id), paymentId);
              }
            }
            await client.query("update lines set state = 'captured' where id = any($1::int[])", [
              pendingLines.rows.map((l) => Number(l.id)),
            ]);
            await client.query("update proofs set status = 'approved' where id = $1", [ctx.params.id]);
            await client.query(
              "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'proof_approved','proof',$3)",
              [ctx.user!.email, ctx.user!.role, ctx.params.id],
            );
            const buyer = await client.query("select * from users where id = $1", [Number(lockedOrder.buyer_id)]);
            await ctx.app.queueMail(client, "proof_approved", String(buyer.rows[0].email),
              `Reduced rate approved — order ${String(locked.order_id)}`,
              `Your reduced rate is approved for order ${String(locked.order_id)}. Your passes are attached.`,
              passInfos.map((p, i) => ({
                filename: `${String(pendingLines.rows[i].title)}.pdf`,
                contentType: "application/pdf",
                objectKey: p.objectKey,
              })),
              String(locked.order_id));
          } else {
            await voidAuthorisation(ctx.app, client, String(locked.order_id));
            await client.query("update lines set state = 'voided' where id = any($1::int[])", [
              pendingLines.rows.map((l) => Number(l.id)),
            ]);
            await client.query("update passes set status = 'voided' where line_id = any($1::int[]) and status in ('valid','transferred')", [
              pendingLines.rows.map((l) => Number(l.id)),
            ]);
            const voucherCents = pendingLines.rows.reduce((s, l) => s + Number(l.voucher_cents), 0);
            if (voucherCents > 0 && lockedOrder.voucher_code) {
              await returnVoucher(client, String(lockedOrder.voucher_code), voucherCents, String(locked.order_id));
            }
            await client.query("update proofs set status = 'rejected' where id = $1", [ctx.params.id]);
            await client.query(
              "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'proof_rejected','proof',$3)",
              [ctx.user!.email, ctx.user!.role, ctx.params.id],
            );
            const buyer = await client.query("select * from users where id = $1", [Number(lockedOrder.buyer_id)]);
            await ctx.app.queueMail(client, "proof_rejected", String(buyer.rows[0].email),
              `Reduced rate not approved — order ${String(locked.order_id)}`,
              `Your reduced rate was not approved for order ${String(locked.order_id)}. ${reason ?? ""}\nYour payment authorisation was released.`,
              [], String(locked.order_id));
          }
          await refreshOrderStatusTx(client, String(locked.order_id));
        });
      } catch (e) {
        for (const objectKey of storedObjects) {
          await deletePassObject(ctx.app.s3, objectKey);
        }
        if (e instanceof PaymentUnavailable) throw errors.paymentUnavailable();
        if (e instanceof StorageUnavailable) throw errors.storageUnavailable();
        throw e;
      }
      const proofAfter = (await query("select * from proofs where id = $1", [ctx.params.id])).rows[0];
      const orderAfter = (await query("select * from orders where id = $1", [String(proofAfter.order_id)])).rows[0];
      return {
        status: 200,
        body: { proof: proofJson(proofAfter), order: await orderJson(orderAfter) },
      };
    },
  };

  // Door scans: refusal reasons for the pass status come before entitlement.
  const scan: Route = {
    method: "POST",
    pattern: "/api/box-office/scans",
    roles: "box_office",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const passCode = String(body.pass_code ?? "").trim();
      const sessionId = String(body.session_id ?? "");
      if (passCode.length === 0) throw validationError({ pass_code: "required" });
      const sessionRes = await query("select * from sessions where id = $1", [sessionId]);
      const session = sessionRes.rows[0];
      if (!session) throw errors.notFound();
      const sessionFestivalDay = String(session.festival_day);
      const now = new Date();

      const result = await withTransaction(async (client) => {
        const passRes = await client.query(
          `select p.*, l.kind as line_kind, l.session_id as line_session_id, l.festival_day as line_festival_day,
                  l.state as line_state, l.holder_name, l.title, o.id as order_ref, s.status as session_status
           from passes p
           join lines l on l.id = p.line_id
           join orders o on o.id = l.order_id
           left join sessions s on s.id = $2
           where p.code = $1`,
          [passCode, sessionId],
        );
        const pass = passRes.rows[0];
        if (!pass) return { result: "unknown" as never };

        // A scan counts against the festival day of the session at the door.
        const logScan = async (result2: string, firstAdmittedAt: Date | null): Promise<void> => {
          await client.query(
            "insert into scans (pass_code, session_id, result, staff_id, festival_day, first_admitted_at) values ($1,$2,$3,$4,$5,$6)",
            [passCode, sessionId, result2, ctx.user!.id, sessionFestivalDay, firstAdmittedAt],
          );
        };

        const sessionStatus = pass.session_status === null || pass.session_status === undefined ? null : String(pass.session_status);
        const passStatus = String(pass.status);
        if (passStatus === "transferred") {
          await logScan("pass_transferred", null);
          return { result: "refused", reason: "pass_transferred", firstAdmittedAt: null };
        }
        if (passStatus === "refunded") {
          await logScan("pass_refunded", null);
          return { result: "refused", reason: "pass_refunded", firstAdmittedAt: null };
        }
        if (passStatus === "voided") {
          await logScan("pass_voided", null);
          return { result: "refused", reason: "pass_voided", firstAdmittedAt: null };
        }
        if (sessionStatus === "cancelled") {
          await logScan("session_cancelled", null);
          return { result: "refused", reason: "session_cancelled", firstAdmittedAt: null };
        }
        const lineState = String(pass.line_state);
        if (lineState !== "captured" && lineState !== "transferred") {
          await logScan("pass_voided", null);
          return { result: "refused", reason: "pass_voided", firstAdmittedAt: null };
        }

        const kind = String(pass.line_kind);
        if (kind === "seat") {
          if (String(pass.line_session_id) !== sessionId) {
            await logScan("not_entitled", null);
            return { result: "refused", reason: "not_entitled", firstAdmittedAt: null };
          }
          const already = await client.query(
            "select * from scans where pass_code = $1 and session_id = $2 and result = 'admitted' order by scanned_at limit 1",
            [passCode, sessionId],
          );
          if (already.rows.length > 0) {
            const firstAt = new Date(String(already.rows[0].scanned_at));
            await logScan("already_admitted", firstAt);
            return { result: "refused", reason: "already_admitted", firstAdmittedAt: firstAt };
          }
          await logScan("admitted", now);
          return { result: "admitted" as never, holder: String(pass.holder_name), title: String(pass.title) };
        }
        if (kind === "full_festival") {
          const already = await client.query(
            "select * from scans where pass_code = $1 and session_id = $2 and result = 'admitted' order by scanned_at limit 1",
            [passCode, sessionId],
          );
          if (already.rows.length > 0) {
            const firstAt = new Date(String(already.rows[0].scanned_at));
            await logScan("already_admitted", firstAt);
            return { result: "refused", reason: "already_admitted", firstAdmittedAt: firstAt };
          }
          await logScan("admitted", now);
          return { result: "admitted" as never, holder: String(pass.holder_name), title: String(pass.title) };
        }
        if (kind === "day") {
          const domeRes = await client.query("select venue_id from sessions where id = $1", [sessionId]);
          const dome = domeRes.rows[0] && String(domeRes.rows[0].venue_id) === "planetarium-dome";
          if (dome || sessionFestivalDay !== String(pass.line_festival_day)) {
            await logScan("not_entitled", null);
            return { result: "refused", reason: "not_entitled", firstAdmittedAt: null };
          }
          const already = await client.query(
            `select * from scans where pass_code = $1 and result = 'admitted' and festival_day = $2
             and session_id in (select id from sessions where festival_day = $2)
             order by scanned_at limit 1`,
            [passCode, sessionFestivalDay],
          );
          if (already.rows.length > 0) {
            const firstAt = new Date(String(already.rows[0].scanned_at));
            await logScan("already_admitted", firstAt);
            return { result: "refused", reason: "already_admitted", firstAdmittedAt: firstAt };
          }
          await logScan("admitted", now);
          return { result: "admitted" as never, holder: String(pass.holder_name), title: String(pass.title) };
        }
        await logScan("not_entitled", null);
        return { result: "refused", reason: "not_entitled", firstAdmittedAt: null };
      });

      if (result.result === "unknown") {
        const err = new ApiError(404, { error: "unknown_pass" });
        throw err;
      }
      if (result.result === "admitted") {
        return {
          status: 200,
          body: {
            result: "admitted",
            pass_code: passCode,
            holder_name: result.holder,
            item_title: result.title,
            session_id: sessionId,
            festival_day: sessionFestivalDay,
            scanned_at: utcIso(now),
          },
        };
      }
      return {
        status: 409,
        body: {
          error: "admission_refused",
          reason: result.reason,
          first_admitted_at: result.firstAdmittedAt ? utcIso(result.firstAdmittedAt) : null,
        },
      };
    },
  };

  const admissions: Route = {
    method: "GET",
    pattern: "/api/box-office/admissions",
    roles: "box_office",
    bodyLimit: "none",
    async handler(ctx) {
      const day = ctx.query.get("festival_day") ?? "";
      const edition = (await query("select * from edition where id = 1")).rows[0];
      if (day < String(edition.first_day) || day > String(edition.last_day)) {
        throw validationError({ festival_day: "unknown_festival_day" });
      }
      const start = festivalDayStart(day);
      const end = festivalDayEnd(day);
      const lengthHours = (end.getTime() - start.getTime()) / 3600000;
      const venuesRes = await query("select * from venues order by id");
      const counts = await query(
        `select s.venue_id, count(*) as n from scans sc
         join sessions s on s.id = sc.session_id
         where sc.result = 'admitted' and s.festival_day = $1
         group by s.venue_id`,
        [day],
      );
      const byVenue = new Map(counts.rows.map((r) => [String(r.venue_id), Number(r.n)]));
      const total = [...byVenue.values()].reduce((s, n) => s + n, 0);
      return {
        status: 200,
        body: {
          festival_day: day,
          starts_at: utcIso(start),
          ends_at: utcIso(end),
          length_hours: lengthHours,
          venues: venuesRes.rows.map((v) => ({
            venue_id: String(v.id),
            name: String(v.name),
            admissions: byVenue.get(String(v.id)) ?? 0,
          })),
          total,
        },
      };
    },
  };

  return [proofQueue, readProof, proofDecision, scan, admissions];
}

async function passWhenForLine(client: { query: (sql: string, a: unknown[]) => Promise<{ rows: Row[] }> }, line: Row): Promise<string> {
  if (line.session_id !== null && line.session_id !== undefined) {
    const res = await client.query("select * from sessions where id = $1", [String(line.session_id)]);
    const s = res.rows[0];
    return `${sessionClock(new Date(String(s.starts_at)))}–${formatClock(new Date(String(s.ends_at)))}`;
  }
  if (line.festival_day !== null && line.festival_day !== undefined) {
    return dayLabel(String(line.festival_day));
  }
  const edition = await client.query("select * from edition where id = 1", []);
  const e = edition.rows[0];
  return `${dayLabel(String(e.first_day))} – ${dayLabel(String(e.last_day))}`;
}

async function passVenueForLine(client: { query: (sql: string, a: unknown[]) => Promise<{ rows: Row[] }> }, line: Row): Promise<string> {
  if (line.session_id !== null && line.session_id !== undefined) {
    const res = await client.query(
      "select v.name from sessions s join venues v on v.id = s.venue_id where s.id = $1",
      [String(line.session_id)],
    );
    return String(res.rows[0]?.name ?? "All venues");
  }
  return "All venues";
}
