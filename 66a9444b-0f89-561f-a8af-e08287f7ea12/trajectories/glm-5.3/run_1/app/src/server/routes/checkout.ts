import { randomUUID } from "node:crypto";
import type { Route, Ctx } from "../http.js";
import { query, withTransaction, type Row } from "../db.js";
import { errors, validationError, ApiError } from "../errors.js";
import { allocateLines, groupDiscountCents, newOrderRef, euroCents } from "../../shared/money.js";
import { utcIso, deadlineFormat, formatDate, sessionClock, dayLabel, formatClock } from "../../shared/time.js";
import { effectiveStatus } from "../services/seats.js";
import { orderJson, refreshOrderStatusTx, proofJson, lineJson } from "../services/shapes.js";
import { redeemVoucher } from "../services/vouchers.js";
import { storePass, deletePassObject, passObjectKey } from "../services/passes.js";
import { ensureKbAccount, recordKbTransaction, PaymentUnavailable } from "../services/kb.js";
import { beginIdempotent, finishIdempotent } from "../services/idempotency.js";
import { StorageUnavailable } from "../s3.js";


interface PassRequest {
  product: string;
  festival_day?: string;
}

interface LineSpec {
  kind: "seat" | "full_festival" | "day";
  sessionId: string | null;
  festivalDay: string | null;
  title: string;
  listCents: number;
  holderName: string;
  when: string;
  venue: string;
}

const MAX_PASSES = 10;

function sniffType(bytes: Buffer): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function validFileName(name: string): boolean {
  if (name.length === 0 || name.length > 200) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return false;
  }
  return true;
}

export function canSeeOrder(user: { id: number; role: string; organisation_id: string | null }, order: Row): boolean {
  if (Number(order.buyer_id) === user.id) return true;
  if (user.role === "finance") return true;
  if (user.role === "group_booker" && order.organisation_id !== null) {
    return String(order.organisation_id) === user.organisation_id;
  }
  return false;
}

async function venueName(venueId: string): Promise<string> {
  const res = await query("select name from venues where id = $1", [venueId]);
  return String(res.rows[0]?.name ?? venueId);
}

async function editionRange(): Promise<string> {
  const res = await query("select * from edition where id = 1");
  const e = res.rows[0];
  return `${dayLabel(String(e.first_day))} – ${dayLabel(String(e.last_day))}`;
}

// The words printed on a pass: the session time, or the festival day(s) it covers.
async function passWhen(line: Row): Promise<string> {
  if (line.session_id !== null && line.session_id !== undefined) {
    const res = await query("select * from sessions where id = $1", [String(line.session_id)]);
    const s = res.rows[0];
    return `${sessionClock(new Date(String(s.starts_at)))}–${formatClock(new Date(String(s.ends_at)))}`;
  }
  if (line.festival_day !== null && line.festival_day !== undefined) {
    return dayLabel(String(line.festival_day));
  }
  return editionRange();
}

async function passVenue(line: Row): Promise<string> {
  if (line.session_id !== null && line.session_id !== undefined) {
    const res = await query("select venue_id from sessions where id = $1", [String(line.session_id)]);
    return venueName(String(res.rows[0].venue_id));
  }
  return "All venues";
}

export function checkoutRoutes(): Route[] {
  const checkout: Route = {
    method: "POST",
    pattern: "/api/checkout",
    roles: "signed_in",
    bodyLimit: "json",
    async handler(ctx: Ctx) {
      const user = ctx.user!;
      const key = ctx.req.headers["idempotency-key"] as string | undefined;
      const outcome = await beginIdempotent(user.id, key, ctx.body);
      if (outcome.replay) {
        return { status: outcome.storedStatus ?? 201, body: outcome.storedBody, headers: outcome.headers };
      }
      let result: { status: number; body?: unknown };
      try {
        result = await runCheckout(ctx);
      } catch (e) {
        if (e instanceof ApiError) {
          await finishIdempotent(user.id, key!, e.status, e.body);
        } else {
          await finishIdempotent(user.id, key!, 503, { error: "internal" });
        }
        throw e;
      }
      await finishIdempotent(user.id, key!, result.status, result.body ?? null);
      return result;
    },
  };

  async function runCheckout(ctx: Ctx): Promise<{ status: number; body?: unknown }> {
    const user = ctx.user!;
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const isGroup = user.role === "group_booker";
    const holdIds = Array.isArray(body.hold_ids) ? (body.hold_ids as unknown[]).map(String) : [];
    const passesRaw = Array.isArray(body.passes) ? (body.passes as PassRequest[]) : [];
    const rate = String(body.rate ?? "full");
    const voucherCode = body.voucher_code === null || body.voucher_code === undefined ? null : String(body.voucher_code).trim();
    const attendeeNamesRaw = Array.isArray(body.attendee_names) ? (body.attendee_names as unknown[]).map(String) : null;

    const orderRef = newOrderRef();
    const storedObjects: string[] = [];
    let kbAuthPaymentId: string | null = null;
    let kbAuthAmount = 0;

    try {
      const orderId = await withTransaction(async (client) => {
        // Holds: each must belong to the caller; expired ones abort the checkout.
        const holdRows: Row[] = [];
        const expiredHolds: string[] = [];
        for (const hid of holdIds) {
          const res = await client.query("select * from holds where id = $1", [hid]);
          const h = res.rows[0];
          if (!h || Number(h.user_id) !== user.id) throw errors.notFound();
          if (String(h.status) !== "active" || new Date(String(h.expires_at)).getTime() <= Date.now()) {
            expiredHolds.push(hid);
            continue;
          }
          holdRows.push(h);
        }
        if (expiredHolds.length > 0) {
          throw errors.conflict("hold_expired", { hold_ids: expiredHolds });
        }

        const editionRes = await client.query("select * from edition where id = 1");
        const edition = editionRes.rows[0];
        const policyRes = await client.query("select * from price_policy where id = 1");
        const policy = policyRes.rows[0];

        // Sessions for the holds must still be published.
        const sessionsById = new Map<string, Row>();
        for (const h of holdRows) {
          const res = await client.query("select * from sessions where id = $1", [String(h.session_id)]);
          const s = res.rows[0];
          if (!s) throw errors.notFound();
          const eff = effectiveStatus(String(s.status), s.publish_at ? new Date(String(s.publish_at)) : null, new Date());
          if (eff === "cancelled") throw errors.conflict("session_cancelled");
          sessionsById.set(String(s.id), s);
        }

        // Pass validation.
        const fieldErrors: Record<string, string> = {};
        for (const p of passesRaw) {
          if (p.product === "day") {
            const day = String(p.festival_day ?? "");
            if (day < String(edition.first_day) || day > String(edition.last_day)) fieldErrors.passes = "unknown_festival_day";
          } else if (p.product !== "full_festival") {
            fieldErrors.passes = "unknown";
          }
        }
        if (passesRaw.length > MAX_PASSES) fieldErrors.passes = "too_many";
        if (Object.keys(fieldErrors).length > 0) throw validationError(fieldErrors);

        // Lines: seats first in hold order, then passes.
        const specs: LineSpec[] = [];
        for (const h of holdRows) {
          const s = sessionsById.get(String(h.session_id))!;
          const price = rate === "reduced" ? Number(s.price_reduced_cents) : Number(s.price_full_cents);
          const vName = await venueNameIn(client, String(s.venue_id));
          for (let i = 0; i < Number(h.quantity); i += 1) {
            specs.push({
              kind: "seat",
              sessionId: String(s.id),
              festivalDay: null,
              title: String(s.title),
              listCents: price,
              holderName: user.name,
              when: `${sessionClock(new Date(String(s.starts_at)))}–${formatClock(new Date(String(s.ends_at)))}`,
              venue: vName,
            });
          }
        }
        for (const p of passesRaw) {
          if (p.product === "full_festival") {
            specs.push({
              kind: "full_festival",
              sessionId: null,
              festivalDay: null,
              title: "Full-festival pass",
              listCents: rate === "reduced" ? Number(policy.full_festival_reduced_cents) : Number(policy.full_festival_full_cents),
              holderName: user.name,
              when: `${dayLabel(String(edition.first_day))} – ${dayLabel(String(edition.last_day))}`,
              venue: "All venues",
            });
          } else {
            specs.push({
              kind: "day",
              sessionId: null,
              festivalDay: String(p.festival_day),
              title: `Day pass · ${dayLabel(String(p.festival_day))}`,
              listCents: rate === "reduced" ? Number(policy.day_reduced_cents) : Number(policy.day_full_cents),
              holderName: user.name,
              when: dayLabel(String(p.festival_day)),
              venue: "All venues",
            });
          }
        }

        const totalLines = specs.length;
        if (totalLines === 0) throw validationError({ items: "empty" });
        if (isGroup && totalLines < 5) throw validationError({ items: "group_minimum" });
        if (rate !== "full" && rate !== "reduced") throw validationError({ rate: "invalid" });
        if (isGroup && rate !== "full") throw validationError({ rate: "not_for_groups" });
        if (isGroup) {
          if (attendeeNamesRaw === null || attendeeNamesRaw.length !== totalLines) {
            throw validationError({ attendee_names: "count_mismatch" });
          }
          if (attendeeNamesRaw.some((n) => n.trim().length === 0)) {
            throw validationError({ attendee_names: "blank" });
          }
          specs.forEach((spec, i) => {
            spec.holderName = (attendeeNamesRaw as string[])[i].trim();
          });
        }

        // Voucher: unknown or drained vouchers are refused before any charge.
        let voucherCents = 0;
        if (voucherCode !== null && voucherCode !== "") {
          const exists = await client.query("select code from vouchers where code = $1 for update", [voucherCode]);
          if (exists.rows.length === 0) throw validationError({ voucher_code: "unknown" });
          const bal = await client.query(
            `select coalesce(sum(case when side = 'credit' then amount_cents else -amount_cents end), 0) as balance
             from ledger_entries where account = $1`,
            [`voucher:${voucherCode}`],
          );
          const balance = Number(bal.rows[0].balance);
          if (balance <= 0) throw validationError({ voucher_code: "empty" });
        }

        const subtotal = specs.reduce((sum, s) => sum + s.listCents, 0);
        const discount = isGroup ? groupDiscountCents(subtotal, Number(policy.group_discount_percent)) : 0;
        const afterDiscount = subtotal - discount;
        if (voucherCode !== null && voucherCode !== "") {
          const bal = await client.query(
            `select coalesce(sum(case when side = 'credit' then amount_cents else -amount_cents end), 0) as balance
             from ledger_entries where account = $1`,
            [`voucher:${voucherCode}`],
          );
          voucherCents = Math.min(Number(bal.rows[0].balance), afterDiscount);
        }
        const total = subtotal - discount - voucherCents;

        const allocatable = specs.map((s, i) => ({ position: i + 1, list_cents: s.listCents }));
        const allocated = allocateLines(allocatable, discount, voucherCents);

        await client.query(
          `insert into orders (id, buyer_id, buyer_name, organisation_id, kind, rate, status, subtotal_cents,
             group_discount_cents, voucher_code, voucher_cents, total_cents, proof_deadline, confirmation_mail)
           values ($1,$2,$3,$4,$5,$6,'confirmed',$7,$8,$9,$10,$11,null,'pending')`,
          [orderRef, user.id, user.name, isGroup ? user.organisation_id : null, isGroup ? "group" : "visitor", rate, subtotal, discount, voucherCode, voucherCents, total],
        );
        const lineIds: number[] = [];
        for (let i = 0; i < specs.length; i += 1) {
          const spec = specs[i];
          const a = allocated[i];
          const res = await client.query(
            `insert into lines (order_id, position, kind, session_id, festival_day, title, holder_name,
               state, list_cents, group_discount_cents, voucher_cents, charged_cents)
             values ($1,$2,$3,$4,$5,$6,$7,'held',$8,$9,$10,$11) returning id`,
            [orderRef, i + 1, spec.kind, spec.sessionId, spec.festivalDay, spec.title, spec.holderName, spec.listCents, a.discount_cents, a.voucher_cents, a.charged_cents],
          );
          lineIds.push(Number(res.rows[0].id));
        }

        // The Kill Bill account for the buyer exists from the first checkout on.
        let kbAccountId: string | null = null;
        if (isGroup) {
          const orgNameRes = await client.query("select name from organisations where id = $1", [user.organisation_id]);
          const account = await ensureKbAccount(ctx.app, client, "org", String(user.organisation_id), String(orgNameRes.rows[0].name));
          kbAccountId = account.accountId;
        } else if (total > 0) {
          const account = await ensureKbAccount(ctx.app, client, "user", String(user.id), user.name);
          kbAccountId = account.accountId;
        }

        let lineStates: string[];
        if (isGroup) {
          // The invoice stands in for authorisation and capture.
          lineStates = specs.map(() => "captured");
        } else if (rate === "reduced") {
          if (total > 0) {
            const auth = await ctx.app.killbill.authorize(orderRef, kbAccountId!, total);
            kbAuthPaymentId = auth.paymentId;
            kbAuthAmount = total;
            await recordKbTransaction(client, auth.transactionId, "AUTHORIZE", total, `${orderRef}-auth`, orderRef, auth.paymentId);
          }
          lineStates = specs.map(() => "proof_pending");
        } else {
          if (total > 0) {
            const auth = await ctx.app.killbill.authorize(orderRef, kbAccountId!, total);
            kbAuthPaymentId = auth.paymentId;
            kbAuthAmount = total;
            await recordKbTransaction(client, auth.transactionId, "AUTHORIZE", total, `${orderRef}-auth`, orderRef, auth.paymentId);
          }
          lineStates = specs.map(() => "authorised");
        }

        // Passes for full-rate and group checkouts; a reduced-rate order gets
        // its passes only at approval.
        const passInfos: Array<{ code: string; objectKey: string }> = [];
        if (!(isGroup === false && rate === "reduced")) {
          for (let i = 0; i < specs.length; i += 1) {
            const spec = specs[i];
            const info = await storePass(ctx.app.s3, client, {
              orderRef,
              holderName: spec.holderName,
              itemTitle: spec.title,
              when: spec.when,
              venue: spec.venue,
            }, lineIds[i]);
            storedObjects.push(info.objectKey);
            passInfos.push({ code: info.code, objectKey: info.objectKey });
          }
        }

        // Capture for full-rate orders.
        if (!isGroup && rate === "full" && total > 0) {
          const tx = await ctx.app.killbill.completeTransaction(kbAuthPaymentId!, "CAPTURE", `${orderRef}-capture`, total);
          await recordKbTransaction(client, tx, "CAPTURE", total, `${orderRef}-capture`, orderRef, kbAuthPaymentId);
          lineStates = specs.map(() => "captured");
        }
        for (let i = 0; i < lineIds.length; i += 1) {
          await client.query("update lines set state = $2 where id = $1", [lineIds[i], lineStates[i]]);
        }

        for (const h of holdRows) {
          await client.query("update holds set status = 'converted' where id = $1", [String(h.id)]);
        }

        if (voucherCode !== null && voucherCode !== "" && voucherCents > 0) {
          await redeemVoucher(client, voucherCode, voucherCents, user.email, orderRef);
        }

        let proofDeadline: Date | null = null;
        if (!isGroup && rate === "reduced") {
          proofDeadline = new Date(Date.now() + ctx.app.config.proofDecisionSeconds * 1000);
          await client.query("update orders set proof_deadline = $2 where id = $1", [orderRef, proofDeadline]);
        }

        // Group invoices are issued at once, due 30 billing days later.
        let invoiceNumber: string | null = null;
        if (isGroup) {
          const year = String(edition.first_day).slice(0, 4);
          const seq = await client.query("select count(*) + 1 as n from invoices where number like $1", [`INV-${year}-%`]);
          invoiceNumber = `INV-${year}-${String(Number(seq.rows[0].n)).padStart(4, "0")}`;
          const dueAt = new Date(Date.now() + 30 * ctx.app.config.billingDaySeconds * 1000);
          const invoiceRes = await client.query(
            `insert into invoices (id, number, organisation_id, order_id, status, amount_cents,
               credited_cents, paid_cents, balance_cents, issued_at, due_at, retries_used)
             values ($1,$2,$3,$4,'issued',$5,0,0,$5,now(),$6,0) returning id`,
            [invoiceNumber, invoiceNumber, user.organisation_id, orderRef, total, dueAt],
          );
          const invoiceId = String(invoiceRes.rows[0].id);
          for (let i = 0; i < specs.length; i += 1) {
            await client.query(
              "insert into invoice_lines (invoice_id, line_id, description, amount_cents) values ($1,$2,$3,$4)",
              [invoiceId, lineIds[i], `${orderRef} · ${specs[i].title} · ${specs[i].holderName}`, allocated[i].charged_cents],
            );
          }
          await client.query("update orders set invoice_id = $2 where id = $1", [orderRef, invoiceId]);
          if (total <= 0) {
            await client.query("update invoices set status = 'paid', balance_cents = 0 where id = $1", [invoiceId]);
          }
          await client.query(
            "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'invoice_issued','invoice',$3)",
            [user.email, user.role, invoiceNumber],
          );
        }

        await refreshOrderStatusTx(client, orderRef);

        // Mails enter the outbox in the same commit as the order.
        const buyer = await client.query("select * from users where id = $1", [user.id]);
        const buyerEmail = String(buyer.rows[0].email);
        const buyerName = String(buyer.rows[0].name);
        const mailAttachments = passInfos.map((p, i) => ({
          filename: `${specs[i].title}.pdf`,
          contentType: "application/pdf",
          objectKey: p.objectKey,
        }));
        const lineSummary = specs
          .map((s, i) => `${s.title} — ${euroCents(s.listCents)} (voucher share ${euroCents(allocated[i].voucher_cents)})`)
          .join("\n");
        if (isGroup && invoiceNumber !== null) {
          const invoice = await client.query("select * from invoices where id = $1", [invoiceNumber]);
          const dueDate = formatDate(new Date(String(invoice.rows[0].due_at)).toISOString().slice(0, 10));
          await ctx.app.queueMail(client, "order_confirmation", buyerEmail, `Your Kerf Frequencies order ${orderRef}`,
            `Thank you ${buyerName}.\n\n${lineSummary}\n\nGroup discount: ${euroCents(discount)}\nTotal: ${euroCents(total)}`,
            mailAttachments, orderRef);
          await ctx.app.queueMail(client, "group_invoice", buyerEmail, `Invoice ${invoiceNumber} from Kerf Collective`,
            `Invoice ${invoiceNumber}\n\n${lineSummary}\n\nAmount: ${euroCents(total)}\nDue on ${dueDate}`,
            [], orderRef);
        } else if (rate === "reduced") {
          const dl = proofDeadline ? deadlineFormat(proofDeadline) : "";
          await ctx.app.queueMail(client, "order_confirmation", buyerEmail, `Your Kerf Frequencies order ${orderRef}`,
            `Thank you ${buyerName}.\n\n${lineSummary}\n\nUpload your proof by ${dl} on /orders/${orderRef}. We hold your payment until then and only take it once your rate is approved.`,
            [], orderRef);
        } else {
          await ctx.app.queueMail(client, "order_confirmation", buyerEmail, `Your Kerf Frequencies order ${orderRef}`,
            `Thank you ${buyerName}.\n\n${lineSummary}\n\nTotal: ${euroCents(total)}\nYour passes are attached.`,
            mailAttachments, orderRef);
        }

        return orderRef;
      });

      const orderRow = (await query("select * from orders where id = $1", [orderId])).rows[0];
      return { status: 201, body: await orderJson(orderRow) };
    } catch (e) {
      // Nothing is kept: stored passes are removed and the authorisation voided.
      for (const objectKey of storedObjects) {
        await deletePassObject(ctx.app.s3, objectKey);
      }
      if (kbAuthPaymentId) {
        try {
          const tx = await ctx.app.killbill.completeTransaction(kbAuthPaymentId, "VOID", `${orderRef}-void`, kbAuthAmount);
          if (tx) {
            await query(
              `insert into kb_transactions (killbill_transaction_id, transaction_type, amount_cents, status, external_key, order_ref, payment_id)
               values ($1,'VOID',$2,'SUCCESS',$3,$4,$5)`,
              [tx, kbAuthAmount, `${orderRef}-void`, orderRef, kbAuthPaymentId],
            );
          }
        } catch {
          // Kill Bill unavailable: the sweep voids orphaned authorisations.
        }
      }
      if (e instanceof PaymentUnavailable) throw errors.paymentUnavailable();
      if (e instanceof StorageUnavailable) throw errors.storageUnavailable();
      throw e;
    }
  }

  const listOrders: Route = {
    method: "GET",
    pattern: "/api/orders",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const user = ctx.user!;
      const res = await query("select * from orders order by created_at desc, id desc");
      const visible = res.rows.filter((o) => canSeeOrder(user, o));
      const orders = [];
      for (const o of visible) {
        orders.push(await orderJson(o));
      }
      return { status: 200, body: { orders } };
    },
  };

  const orderDetail: Route = {
    method: "GET",
    pattern: "/api/orders/:id",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const res = await query("select * from orders where id = $1", [ctx.params.id]);
      const order = res.rows[0];
      if (!order || !canSeeOrder(ctx.user!, order)) throw errors.notFound();
      return { status: 200, body: await orderJson(order) };
    },
  };

  const passDownload: Route = {
    method: "GET",
    pattern: "/api/orders/:id/passes/:code",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const res = await query("select * from orders where id = $1", [ctx.params.id]);
      const order = res.rows[0];
      if (!order || !canSeeOrder(ctx.user!, order)) throw errors.notFound();
      const passRes = await query(
        "select * from passes where code = $1 and line_id in (select id from lines where order_id = $2)",
        [ctx.params.code, ctx.params.id],
      );
      const pass = passRes.rows[0];
      if (!pass) throw errors.notFound();
      try {
        const obj = await ctx.app.s3.get(passObjectKey(ctx.params.id, ctx.params.code));
        return {
          status: 200,
          body: obj.body,
          headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
        };
      } catch {
        throw errors.storageUnavailable();
      }
    },
  };

  const uploadProof: Route = {
    method: "POST",
    pattern: "/api/orders/:id/proof",
    roles: "signed_in",
    bodyLimit: "proof",
    async handler(ctx) {
      const orderId = ctx.params.id;
      const orderRes = await query("select * from orders where id = $1", [orderId]);
      const order = orderRes.rows[0];
      if (!order || !canSeeOrder(ctx.user!, order)) throw errors.notFound();
      const lines = await query("select state from lines where order_id = $1", [orderId]);
      if (!lines.rows.some((l) => String(l.state) === "proof_pending")) {
        throw errors.conflict("not_proof_pending");
      }
      if (new Date(String(order.proof_deadline)).getTime() <= Date.now()) {
        throw errors.conflict("proof_hold_expired");
      }
      const existing = await query("select 1 from proofs where order_id = $1", [orderId]);
      if (existing.rows.length > 0) throw errors.conflict("proof_already_uploaded");

      const kindPart = ctx.files.get("kind");
      const filePart = ctx.files.get("file");
      const kind = kindPart ? kindPart.bytes.toString("utf8").trim() : "";
      if (kind !== "student" && kind !== "jobseeker") throw validationError({ kind: "unknown" });
      if (!filePart || filePart.bytes.length === 0) {
        throw validationError({ file: filePart ? "empty" : "required" });
      }
      if (!validFileName(filePart.filename)) throw validationError({ file: "invalid_name" });
      const sniffed = sniffType(filePart.bytes);
      if (sniffed === null || sniffed === "image/webp") throw validationError({ file: "unsupported_type" });

      const proofId = randomUUID();
      const objectKey = `proofs/${orderId}/${proofId}`;
      try {
        await ctx.app.s3.put(objectKey, filePart.bytes, sniffed);
      } catch {
        throw errors.storageUnavailable();
      }
      await withTransaction(async (client) => {
        await client.query(
          `insert into proofs (id, order_id, kind, status, uploaded_at, deadline, content_type, size_bytes)
           values ($1,$2,$3,'pending',now(),$4,$5,$6)`,
          [proofId, orderId, kind, new Date(String(order.proof_deadline)), sniffed, filePart.bytes.length],
        );
      });
      const proofRow = (await query("select * from proofs where id = $1", [proofId])).rows[0];
      return { status: 201, body: proofJson(proofRow) };
    },
  };

  const transferLine: Route = {
    method: "POST",
    pattern: "/api/orders/:id/lines/:lineId/transfer",
    roles: "signed_in",
    bodyLimit: "json",
    async handler(ctx) {
      const user = ctx.user!;
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const recipientName = String(body.recipient_name ?? "").trim();
      const recipientEmail = String(body.recipient_email ?? "").trim();
      const problems: Record<string, string> = {};
      if (recipientName.length === 0 || recipientName.length > 200) problems.recipient_name = "invalid";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) problems.recipient_email = "invalid";
      if (Object.keys(problems).length > 0) throw validationError(problems);

      const orderId = ctx.params.id;
      const lineId = Number(ctx.params.lineId);
      const orderRes = await query("select * from orders where id = $1", [orderId]);
      const order = orderRes.rows[0];
      if (!order || !canSeeOrder(user, order)) throw errors.notFound();

      const storedObjects: string[] = [];
      let passCode: string | null = null;
      try {
        passCode = await withTransaction(async (client) => {
          const lineLock = await client.query("select * from lines where id = $1 for update", [lineId]);
          const locked = lineLock.rows[0];
          if (!locked || String(locked.order_id) !== orderId) throw errors.notFound();
          if (String(locked.state) === "transferred") throw errors.conflict("already_transferred");
          if (String(locked.state) !== "captured") throw errors.conflict("line_not_transferable");
          const passRes = await client.query("select * from passes where line_id = $1 and status = 'valid'", [lineId]);
          const pass = passRes.rows[0];
          if (!pass) throw errors.conflict("line_not_transferable");
          await client.query("update passes set status = 'transferred' where id = $1", [Number(pass.id)]);
          await client.query("update lines set holder_name = $2, state = 'transferred' where id = $1", [lineId, recipientName]);
          const when = await passWhen(locked);
          const venue = await passVenue(locked);
          const info = await storePass(ctx.app.s3, client, {
            orderRef: orderId,
            holderName: recipientName,
            itemTitle: String(locked.title),
            when,
            venue,
          }, lineId);
          storedObjects.push(info.objectKey);
          // One mail to the buyer and one to the recipient; neither carries the
          // buyer's email, prices, voucher code or payment references.
          const buyer = await client.query("select * from users where id = $1", [Number(order.buyer_id)]);
          await ctx.app.queueMail(client, "transfer_sender", String(buyer.rows[0].email),
            `You transferred a ticket — order ${orderId}`,
            `You transferred "${String(locked.title)}" to ${recipientName}. Your old pass no longer scans.`,
            [], orderId);
          await ctx.app.queueMail(client, "transfer_recipient", recipientEmail,
            `A ticket for ${String(locked.title)} is yours`,
            `${recipientName}, a ticket for ${String(locked.title)} is yours. Your new pass is attached.`,
            [{ filename: "pass.pdf", contentType: "application/pdf", objectKey: info.objectKey }], orderId);
          return info.code;
        });
      } catch (e) {
        for (const objectKey of storedObjects) {
          await deletePassObject(ctx.app.s3, objectKey);
        }
        if (e instanceof StorageUnavailable) throw errors.storageUnavailable();
        throw e;
      }
      const lineRow = (
        await query(
          "select l.*, p.code as pass_code, p.status as pass_status from lines l join passes p on p.line_id = l.id where l.id = $1 and p.status = 'valid'",
          [lineId],
        )
      ).rows[0];
      return { status: 200, body: { line: lineJson(lineRow), pass: { code: passCode, status: "valid" } } };
    },
  };

  return [checkout, listOrders, orderDetail, passDownload, uploadProof, transferLine];
}

async function venueNameIn(client: { query: (sql: string, a: unknown[]) => Promise<{ rows: Row[] }> }, venueId: string): Promise<string> {
  const res = await client.query("select name from venues where id = $1", [venueId]);
  return String(res.rows[0]?.name ?? venueId);
}
