import { randomUUID } from "node:crypto";
import { one, type Tx } from "./db.js";
import { fail } from "./errors.js";
import { emit, webhookStatusOf } from "./events.js";
import type { Ctx } from "./http.js";
import { legJson, type Leg, type LegJson } from "./ledger.js";
import { noticeStatusOf } from "./notices.js";
import { pdfKey } from "./pdf.js";
import { assetOf } from "./pools.js";
import { statementLines, statementText, type SettlementKind, type StatementFacts } from "./statements.js";
import { exists, storeAll } from "./storage.js";
import { toInstant } from "./time.js";

// Settlements: draws, liquidity withdrawals and liquidations. Each commits its posting, its statement objects and
// its integrator event together; a receipt reads Settled only when storage confirms, at the time of asking, that
// both the statement and its PDF are there.

type Scalar = string | number | null;

interface Settlement {
  settlement_id: string;
  kind: SettlementKind;
  actor_id: string;
  position_id: string | null;
  asset: string;
  amount: string;
  legs: LegJson[];
  statement_key: string;
  pdf_key: string;
  event_id: string;
  created_at: string;
  [field: string]: Scalar | LegJson[];
}

export function newSettlementId(): string {
  return randomUUID();
}

/**
 * Records a settlement: its row, its integrator event and its statement objects, all before the transaction
 * commits. When storage fails, the request answers statement_store_unavailable and everything, posting included,
 * rolls back.
 */
export async function settle(
  ctx: Ctx,
  head: { settlementId: string; kind: SettlementKind; positionId: string | null; asset: string; amount: bigint; legs: Leg[] },
  fields: Record<string, Scalar>,
  liquidation?: StatementFacts["liquidation"],
): Promise<Settlement & { statement_status: "pending_statement"; webhook_status: "queued"; pdf_rendered_at: null }> {
  const statementKey = `statements/${head.kind}/${head.settlementId}.json`;
  const eventId = randomUUID();
  const body: Settlement = {
    settlement_id: head.settlementId,
    kind: head.kind,
    actor_id: ctx.member.actor_id,
    position_id: head.positionId,
    asset: head.asset,
    amount: head.amount.toString(),
    legs: head.legs.map(legJson),
    statement_key: statementKey,
    pdf_key: pdfKey(head.kind, head.settlementId),
    event_id: eventId,
    created_at: toInstant(ctx.now),
    ...fields,
  };
  const text = statementText(
    statementLines(
      {
        settlementId: head.settlementId,
        kind: head.kind,
        member: { name: ctx.member.name, actorId: ctx.member.actor_id },
        asset: head.asset,
        amount: head.amount,
        createdAt: body.created_at,
        legs: body.legs,
        liquidation,
      },
      (asset) => assetOf(ctx.market, asset).decimals,
    ),
  );
  await ctx.tx.query(
    "INSERT INTO settlements (settlement_id, kind, position_id, event_id, body, statement_text, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [head.settlementId, head.kind, head.positionId, eventId, JSON.stringify(body), text, ctx.now],
  );
  await emit(ctx.tx, {
    id: eventId,
    type: "settlement.committed",
    positionId: head.positionId,
    occurredAt: ctx.now,
    data: { settlement_id: head.settlementId, kind: head.kind, asset: head.asset, amount: body.amount, statement_key: statementKey },
  });
  const textKey = statementKey.replace(/\.json$/, ".txt");
  await storeAll([
    { key: statementKey, data: JSON.stringify(body, null, 2), contentType: "application/json" },
    { key: textKey, data: text, contentType: "text/plain; charset=utf-8" },
  ]);
  ctx.stored.push(statementKey, textKey);
  return { ...body, pdf_rendered_at: null, statement_status: "pending_statement", webhook_status: "queued" };
}

interface SettlementRow {
  body: Settlement;
  event_id: string;
  pdf_rendered_at: Date | null;
}

async function findSettlement(tx: Tx, settlementId: string): Promise<SettlementRow> {
  const row = /^[0-9a-f-]{36}$/i.test(settlementId)
    ? await one<SettlementRow>(tx, "SELECT body, event_id, pdf_rendered_at FROM settlements WHERE settlement_id = $1", [settlementId])
    : undefined;
  if (!row) throw fail("not_found");
  return row;
}

/** The settlement as the API shows it, with its statuses determined at the time of asking. */
export async function readSettlement(tx: Tx, settlementId: string) {
  const { body, event_id: eventId, pdf_rendered_at: renderedAt } = await findSettlement(tx, settlementId);
  const [statementStored, pdfStored] = await Promise.all([exists(body.statement_key), exists(body.pdf_key)]);
  return {
    ...body,
    pdf_rendered_at: renderedAt ? toInstant(renderedAt) : null,
    statement_status: statementStored && pdfStored ? "stored" : "pending_statement",
    webhook_status: await webhookStatusOf(tx, eventId),
    ...(body.kind === "liquidation" ? { notice_status: await noticeStatusOf(tx, settlementId) } : {}),
  };
}

/** The stored PDF's key, once it has been rendered. */
export async function renderedPdfKey(tx: Tx, settlementId: string): Promise<string | null> {
  const { body, pdf_rendered_at: renderedAt } = await findSettlement(tx, settlementId);
  return renderedAt ? body.pdf_key : null;
}
