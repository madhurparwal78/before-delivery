import { randomUUID } from "node:crypto";
import type { Route, Ctx } from "../http.js";
import { query, withTransaction, type Row } from "../db.js";
import { errors, validationError, ApiError } from "../errors.js";
import { newVoucherCode } from "../../shared/money.js";
import { utcIso } from "../../shared/time.js";
import { mismatchJson, orderJson, invoiceJson } from "../services/shapes.js";
import { refundLines } from "../services/refunds.js";
import { issueVoucher, readLedger, movementEntries } from "../services/vouchers.js";
import { recordBankReturn, queueBankReturnMail } from "../services/invoices.js";
import { beginIdempotent, finishIdempotent } from "../services/idempotency.js";
import { amountToCents, PaymentUnavailable } from "../killbill.js";


export function financeRoutes(): Route[] {
  const searchOrders: Route = {
    method: "GET",
    pattern: "/api/finance/orders",
    roles: "finance",
    bodyLimit: "none",
    async handler(ctx) {
      const q = (ctx.query.get("q") ?? "").trim().toLowerCase();
      const res = await query(
        `select o.* from orders o join users u on u.id = o.buyer_id
         where $1 = '' or lower(o.id) like '%' || $1 || '%' or lower(u.email) like '%' || $1 || '%'
         order by o.created_at desc`,
        [q],
      );
      const orders = [];
      for (const o of res.rows) orders.push(await orderJson(o));
      return { status: 200, body: { orders } };
    },
  };

  const refundOrder: Route = {
    method: "POST",
    pattern: "/api/finance/orders/:id/refunds",
    roles: "finance",
    bodyLimit: "json",
    async handler(ctx) {
      const user = ctx.user!;
      const key = ctx.req.headers["idempotency-key"] as string | undefined;
      const outcome = await beginIdempotent(user.id, key, ctx.body);
      if (outcome.replay) {
        return { status: outcome.storedStatus ?? 201, body: outcome.storedBody, headers: outcome.headers };
      }
      let result: { status: number; body?: unknown };
      try {
        result = await runRefund(ctx);
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

  async function runRefund(ctx: Ctx): Promise<{ status: number; body?: unknown }> {
    const user = ctx.user!;
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const orderId = ctx.params.id;
    const orderRes = await query("select * from orders where id = $1", [orderId]);
    const order = orderRes.rows[0];
    if (!order) throw errors.notFound();
    const lineIds = Array.isArray(body.line_ids) ? (body.line_ids as unknown[]).map(Number) : [];
    if (lineIds.length === 0) throw validationError({ line_ids: "empty" });
    const reason = String(body.reason ?? "").trim();
    if (reason.length === 0) throw validationError({ reason: "required" });

    const notRefundable: number[] = [];
    const lines: Row[] = [];
    for (const lineId of lineIds) {
      const res = await query("select * from lines where id = $1 and order_id = $2", [lineId, orderId]);
      const line = res.rows[0];
      if (!line) throw errors.notFound();
      if (String(line.state) !== "captured" && String(line.state) !== "transferred") {
        notRefundable.push(lineId);
      } else {
        lines.push(line);
      }
    }
    if (notRefundable.length > 0) {
      throw errors.conflict("line_not_refundable", { line_ids: notRefundable });
    }

    const refundId = await withTransaction(async (client) => {
      const started = await refundLines(ctx.app, client, [{ order, lines }], reason);
      void started;
      await client.query(
        "insert into audit (actor, actor_role, action, target_type, target_id, detail) values ($1,$2,'refund_issued','order',$3,$4)",
        [user.email, user.role, orderId, reason],
      );
      const refund = await client.query("select * from refunds where order_id = $1 order by created_at desc limit 1", [orderId]);
      return String(refund.rows[0].id);
    });
    const refundRow = (await query("select * from refunds where id = $1", [refundId])).rows[0];
    return {
      status: 201,
      body: {
        id: String(refundRow.id),
        order_id: orderId,
        line_ids: refundRow.line_ids,
        card_cents: Number(refundRow.card_cents),
        voucher_cents: Number(refundRow.voucher_cents),
        credit_note_id: refundRow.credit_note_id === null || refundRow.credit_note_id === undefined ? null : String(refundRow.credit_note_id),
        status: String(refundRow.status),
        reason: String(refundRow.reason),
        created_at: utcIso(new Date(String(refundRow.created_at))),
      },
    };
  }

  const listRefunds: Route = {
    method: "GET",
    pattern: "/api/finance/refunds",
    roles: "finance",
    bodyLimit: "none",
    async handler(ctx) {
      const status = ctx.query.get("status");
      const res = await query(
        status ? "select * from refunds where status = $1 order by created_at" : "select * from refunds order by created_at",
        status ? [status] : [],
      );
      return {
        status: 200,
        body: {
          refunds: res.rows.map((r) => ({
            id: String(r.id),
            order_id: String(r.order_id),
            line_ids: r.line_ids,
            card_cents: Number(r.card_cents),
            voucher_cents: Number(r.voucher_cents),
            credit_note_id: r.credit_note_id === null || r.credit_note_id === undefined ? null : String(r.credit_note_id),
            status: String(r.status),
            reason: String(r.reason),
            created_at: utcIso(new Date(String(r.created_at))),
          })),
        },
      };
    },
  };

  const issueVoucherRoute: Route = {
    method: "POST",
    pattern: "/api/finance/vouchers",
    roles: "finance",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const amountCents = Number(body.amount_cents ?? 0);
      const note = String(body.note ?? "");
      if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100000) {
        throw validationError({ amount_cents: "out_of_range" });
      }
      const code = newVoucherCode();
      await withTransaction(async (client) => {
        await issueVoucher(client, code, amountCents, ctx.user!.email, note);
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id, detail) values ($1,$2,'voucher_issued','voucher',$3,$4)",
          [ctx.user!.email, ctx.user!.role, code, note],
        );
      });
      return { status: 201, body: { code, balance_cents: amountCents } };
    },
  };

  const ledger: Route = {
    method: "GET",
    pattern: "/api/finance/ledger",
    roles: "finance",
    bodyLimit: "none",
    async handler(ctx) {
      const account = ctx.query.get("account") ?? "";
      if (!/^(voucher:[A-Z0-9-]+|order:[A-Z0-9-]+|voucher-sales)$/.test(account)) {
        throw validationError({ account: "unknown" });
      }
      const balanceRes = await query(
        `select coalesce(sum(case when side = 'credit' then amount_cents else -amount_cents end), 0) as balance
         from ledger_entries where account = $1`,
        [account],
      );
      const movements = await readLedger(account);
      const entriesByMovement = await movementEntries(movements.map((m) => Number(m.id)));
      return {
        status: 200,
        body: {
          account,
          balance_cents: Number(balanceRes.rows[0].balance),
          movements: movements.map((m) => ({
            id: Number(m.id),
            kind: String(m.kind),
            amount_cents: Number(m.amount_cents),
            created_at: utcIso(new Date(String(m.created_at))),
            actor: String(m.actor),
            order_ref: m.order_ref === null || m.order_ref === undefined ? null : String(m.order_ref),
            entries: (entriesByMovement.get(Number(m.id)) ?? []).map((e) => ({
              account: String(e.account),
              side: String(e.side),
              amount_cents: Number(e.amount_cents),
            })),
          })),
        },
      };
    },
  };

  const bankReturn: Route = {
    method: "POST",
    pattern: "/api/finance/invoices/:id/returns",
    roles: "finance",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const note = String(body.note ?? "").trim();
      if (note.length === 0) throw validationError({ note: "required" });
      const invoiceRes = await query("select * from invoices where id = $1", [ctx.params.id]);
      const invoice = invoiceRes.rows[0];
      if (!invoice) throw errors.notFound();
      const status = String(invoice.status);
      if (status !== "paid" && status !== "retried") throw errors.conflict("not_collected");
      await withTransaction(async (client) => {
        const lock = await client.query("select * from invoices where id = $1 for update", [ctx.params.id]);
        const locked = lock.rows[0];
        const lockedStatus = String(locked.status);
        if (lockedStatus !== "paid" && lockedStatus !== "retried") throw errors.conflict("not_collected");
        const result = await recordBankReturn(ctx.app, client, locked, note, { email: ctx.user!.email, role: ctx.user!.role });
        const updated = await client.query("select * from invoices where id = $1", [ctx.params.id]);
        await queueBankReturnMail(ctx.app, client, updated.rows[0], result);
      });
      const after = (await query("select * from invoices where id = $1", [ctx.params.id])).rows[0];
      return { status: 200, body: await invoiceJson(after) };
    },
  };

  const runReconciliation: Route = {
    method: "POST",
    pattern: "/api/finance/reconciliation-runs",
    roles: "finance",
    bodyLimit: "none",
    async handler(ctx) {
      const accounts = await query("select * from kb_accounts");
      const runId = randomUUID();
      const appRecords = await query("select * from kb_transactions");
      const appById = new Map(appRecords.rows.map((r) => [String(r.killbill_transaction_id), r]));
      const kbTransactions = new Map<string, { type: string; amount: number; status: string; paymentExternalKey: string }>();
      let checked = 0;
      for (const account of accounts.rows) {
        let payments: Array<Record<string, unknown>> = [];
        try {
          payments = await ctx.app.killbill.listPayments(String(account.kb_account_id)) as unknown as Array<Record<string, unknown>>;
        } catch (e) {
          if (e instanceof PaymentUnavailable) throw errors.paymentUnavailable();
          throw e;
        }
        for (const payment of payments) {
          const txns = (payment.transactions as Array<Record<string, unknown>>) ?? [];
          for (const t of txns) {
            checked += 1;
            kbTransactions.set(String(t.transactionId), {
              type: String(t.transactionType),
              amount: amountToCents(Number(t.amount ?? 0)),
              status: String(t.status),
              paymentExternalKey: String(payment.paymentExternalKey ?? ""),
            });
          }
        }
      }

      await query("insert into reconciliation_runs (id, started_at) values ($1, now())", [runId]);
      const found: Array<Record<string, unknown>> = [];
      // unknown_in_app: a successful Kill Bill transaction with no app record.
      for (const [txId, kb] of kbTransactions) {
        if (!appById.has(txId)) {
          const paymentExternalKey = kb.paymentExternalKey;
          const orderRef = /^KF-[A-Z2-9]{6}$/.test(paymentExternalKey) ? paymentExternalKey : null;
          found.push({
            type: "unknown_in_app",
            order_ref: orderRef,
            killbill_transaction_id: txId,
            transaction_type: kb.type,
            app_amount_cents: null,
            killbill_amount_cents: kb.amount,
          });
        }
      }
      for (const record of appRecords.rows) {
        const txId = String(record.killbill_transaction_id);
        const kb = kbTransactions.get(txId);
        if (!kb) {
          found.push({
            type: "missing_in_killbill",
            order_ref: record.order_ref === null || record.order_ref === undefined ? null : String(record.order_ref),
            killbill_transaction_id: txId,
            transaction_type: String(record.transaction_type),
            app_amount_cents: Number(record.amount_cents),
            killbill_amount_cents: null,
          });
          continue;
        }
        if (kb.amount !== Number(record.amount_cents)) {
          found.push({
            type: "amount_mismatch",
            order_ref: record.order_ref === null || record.order_ref === undefined ? null : String(record.order_ref),
            killbill_transaction_id: txId,
            transaction_type: kb.type,
            app_amount_cents: Number(record.amount_cents),
            killbill_amount_cents: kb.amount,
          });
        }
        const appStatus = String(record.status);
        if (appStatus !== kb.status) {
          found.push({
            type: "status_mismatch",
            order_ref: record.order_ref === null || record.order_ref === undefined ? null : String(record.order_ref),
            killbill_transaction_id: txId,
            transaction_type: kb.type,
            app_amount_cents: Number(record.amount_cents),
            killbill_amount_cents: kb.amount,
          });
        }
      }

      const mismatchRows: Row[] = [];
      for (const m of found) {
        const existing = await query(
          `select * from mismatches where type = $1 and coalesce(killbill_transaction_id,'') = $2`,
          [String(m.type), String(m.killbill_transaction_id ?? "")],
        );
        if (existing.rows.length > 0) {
          mismatchRows.push(existing.rows[0]);
          continue;
        }
        const id = randomUUID();
        await query(
          `insert into mismatches (id, run_id, type, order_ref, killbill_transaction_id, transaction_type,
             app_amount_cents, killbill_amount_cents, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'open')`,
          [
            id,
            runId,
            m.type,
            m.order_ref ?? null,
            m.killbill_transaction_id ?? null,
            m.transaction_type ?? null,
            m.app_amount_cents ?? null,
            m.killbill_amount_cents ?? null,
          ],
        );
        mismatchRows.push((await query("select * from mismatches where id = $1", [id])).rows[0]);
      }
      await query("update reconciliation_runs set finished_at = now(), checked_transactions = $2 where id = $1", [runId, checked]);
      await query(
        "insert into audit (actor, actor_role, action, target_type, target_id, detail) values ($1,$2,'reconciliation_run','reconciliation_run',$3,$4)",
        [ctx.user!.email, ctx.user!.role, runId, `${mismatchRows.length} open mismatches`],
      );
      const run = (await query("select * from reconciliation_runs where id = $1", [runId])).rows[0];
      return {
        status: 201,
        body: {
          id: runId,
          started_at: utcIso(new Date(String(run.started_at))),
          finished_at: utcIso(new Date(String(run.finished_at))),
          checked_transactions: checked,
          mismatches: await Promise.all(mismatchRows.map((m) => mismatchJson(m))),
        },
      };
    },
  };

  const getRun: Route = {
    method: "GET",
    pattern: "/api/finance/reconciliation-runs/:id",
    roles: "finance",
    bodyLimit: "none",
    async handler(ctx) {
      const run = (await query("select * from reconciliation_runs where id = $1", [ctx.params.id])).rows[0];
      if (!run) throw errors.notFound();
      const mismatches = await query("select * from mismatches where run_id = $1", [ctx.params.id]);
      return {
        status: 200,
        body: {
          id: String(run.id),
          started_at: utcIso(new Date(String(run.started_at))),
          finished_at: run.finished_at ? utcIso(new Date(String(run.finished_at))) : null,
          checked_transactions: Number(run.checked_transactions),
          mismatches: await Promise.all(mismatches.rows.map((m) => mismatchJson(m))),
        },
      };
    },
  };

  const listMismatches: Route = {
    method: "GET",
    pattern: "/api/finance/mismatches",
    roles: "finance",
    bodyLimit: "none",
    async handler(ctx) {
      const status = ctx.query.get("status");
      const res = await query(
        status ? "select * from mismatches where status = $1 order by id" : "select * from mismatches order by id",
        status ? [status] : [],
      );
      return { status: 200, body: { mismatches: await Promise.all(res.rows.map((m) => mismatchJson(m))) } };
    },
  };

  const resolveMismatch: Route = {
    method: "POST",
    pattern: "/api/finance/mismatches/:id/resolve",
    roles: "finance",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const mismatchRes = await query("select * from mismatches where id = $1", [ctx.params.id]);
      const mismatch = mismatchRes.rows[0];
      if (!mismatch) throw errors.notFound();
      await withTransaction(async (client) => {
        const lock = await client.query("select * from mismatches where id = $1 for update", [ctx.params.id]);
        if (String(lock.rows[0].status) === "resolved") throw errors.conflict("already_resolved");
        const note = String(body.note ?? "").trim();
        if (note.length === 0) throw validationError({ note: "required" });
        await client.query(
          "update mismatches set status = 'resolved', note = $2, resolved_by = $3, resolved_at = now() where id = $1",
          [ctx.params.id, note, ctx.user!.email],
        );
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id, detail) values ($1,$2,'mismatch_resolved','mismatch',$3,$4)",
          [ctx.user!.email, ctx.user!.role, ctx.params.id, note],
        );
      });
      const after = (await query("select * from mismatches where id = $1", [ctx.params.id])).rows[0];
      return { status: 200, body: mismatchJson(after) };
    },
  };

  return [
    searchOrders,
    refundOrder,
    listRefunds,
    issueVoucherRoute,
    ledger,
    bankReturn,
    runReconciliation,
    getRun,
    listMismatches,
    resolveMismatch,
  ];
}
