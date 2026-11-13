import { randomUUID } from "node:crypto";
import { rows, unlocked, type Tx } from "./db.js";
import { fixedText } from "./money.js";
import type { Position } from "./positions.js";
import { liquidationPrice, type Exposure } from "./risk.js";
import { sendMail } from "./smtp.js";
import { displayAmount, displayHealth, displayPrice } from "../shared/format.js";
import { toInstant } from "./time.js";

// Margin and liquidation notices. They are queued in Postgres in the same transaction as the move that causes
// them, and a sender in every server process delivers each one exactly once, retrying while mail is down.

export interface NoticeJson {
  notice_id: string;
  kind: "margin" | "liquidation";
  status: "queued" | "sent";
  created_at: string;
  sent_at: string | null;
}

async function queue(tx: Tx, notice: { positionId: string; kind: NoticeJson["kind"]; settlementId: string | null; recipient: string; subject: string; body: string; now: Date }): Promise<void> {
  await tx.query(
    `INSERT INTO notices (notice_id, position_id, kind, settlement_id, recipient, subject, body, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)`,
    [`ntc-${randomUUID()}`, notice.positionId, notice.kind, notice.settlementId, notice.recipient, notice.subject, notice.body, notice.now],
  );
}

async function emailOf(tx: Tx, actorId: string): Promise<string> {
  const [row] = await rows<{ email: string }>(tx, "SELECT email FROM members WHERE actor_id = $1", [actorId]);
  return row?.email ?? "";
}

const amountLine = (label: string, amount: bigint, asset: { asset: string; decimals: number }) =>
  `${label}: ${displayAmount(amount, asset.decimals)} ${asset.asset}`;

export async function queueMarginNotice(tx: Tx, position: Position, exposure: Exposure, hf: bigint, now: Date): Promise<void> {
  const hfText = displayHealth(fixedText(hf, 4));
  const price = liquidationPrice(exposure);
  await queue(tx, {
    positionId: position.positionId,
    kind: "margin",
    settlementId: null,
    recipient: await emailOf(tx, position.borrowerId),
    subject: `Margin notice: ${position.positionId} at health factor ${hfText}`,
    body: [
      `Position ${position.positionId} is below the warning level of health factor ${displayHealth(fixedText(BigInt(exposure.collateralAsset.warningHealthFactorBps), 4))}.`,
      "",
      `Health factor: ${hfText}`,
      amountLine("Debt", exposure.debt, exposure.debtAsset),
      amountLine("Collateral", exposure.collateral, exposure.collateralAsset),
      `Liquidation price: ${price === null ? "none" : displayPrice(price)} per ${exposure.collateralAsset.asset}`,
      "",
      "Repay or add collateral to stay above health factor 1.",
      "",
      "Quillmoor Reserve",
    ].join("\n"),
    now,
  });
}

interface LiquidationNotice {
  position: Position;
  exposure: Exposure;
  settlementId: string;
  round: number;
  repaid: bigint;
  seized: bigint;
  bonusAmount: bigint;
  healthFactorAfter: string | null;
}

export async function queueLiquidationNotice(tx: Tx, notice: LiquidationNotice, now: Date): Promise<void> {
  const { position, exposure } = notice;
  await queue(tx, {
    positionId: position.positionId,
    kind: "liquidation",
    settlementId: notice.settlementId,
    recipient: await emailOf(tx, position.borrowerId),
    subject: `Liquidation notice: ${position.positionId} fill ${notice.round + 1}`,
    body: [
      `Position ${position.positionId} was liquidated in fill ${notice.round + 1}.`,
      "",
      amountLine("Repaid", notice.repaid, exposure.debtAsset),
      amountLine("Seized", notice.seized, exposure.collateralAsset),
      amountLine("Bonus amount", notice.bonusAmount, exposure.collateralAsset),
      `Health factor after: ${displayHealth(notice.healthFactorAfter)}`,
      `Settlement: ${notice.settlementId}`,
      "",
      "Quillmoor Reserve",
    ].join("\n"),
    now,
  });
}

interface NoticeRow {
  notice_id: string;
  position_id: string;
  kind: NoticeJson["kind"];
  status: NoticeJson["status"];
  created_at: Date;
  sent_at: Date | null;
}

const noticeJson = (n: NoticeRow): NoticeJson => ({
  notice_id: n.notice_id,
  kind: n.kind,
  status: n.status,
  created_at: toInstant(n.created_at),
  sent_at: n.sent_at ? toInstant(n.sent_at) : null,
});

/** The notices of every given position, oldest first, keyed by position id. */
export async function noticesByPosition(tx: Tx, positionIds: string[]): Promise<Map<string, NoticeJson[]>> {
  const found = await rows<NoticeRow>(
    tx,
    "SELECT notice_id, position_id, kind, status, created_at, sent_at FROM notices WHERE position_id = ANY($1) ORDER BY created_at, notice_id",
    [positionIds],
  );
  const byPosition = new Map<string, NoticeJson[]>();
  for (const notice of found) byPosition.set(notice.position_id, [...(byPosition.get(notice.position_id) ?? []), noticeJson(notice)]);
  return byPosition;
}

export async function noticeStatusOf(tx: Tx, settlementId: string): Promise<NoticeJson["status"]> {
  const [row] = await rows<{ status: NoticeJson["status"] }>(tx, "SELECT status FROM notices WHERE settlement_id = $1", [settlementId]);
  return row?.status ?? "queued";
}

/**
 * Delivers queued notices oldest first, one transaction each. A notice is claimed with a row lock that other
 * senders skip and marked sent only after the mail server accepts it; while mail is unreachable the round stops
 * and the notice stays queued for the next one.
 */
export async function deliverQueuedNotices(): Promise<void> {
  for (let delivered = true; delivered; ) {
    delivered = await unlocked(async (tx) => {
      const [notice] = await rows<{ notice_id: string; recipient: string; subject: string; body: string }>(
        tx,
        "SELECT notice_id, recipient, subject, body FROM notices WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!notice) return false;
      await sendMail({ to: notice.recipient, subject: notice.subject, text: notice.body });
      await tx.query("UPDATE notices SET status = 'sent', sent_at = now() WHERE notice_id = $1", [notice.notice_id]);
      return true;
    });
  }
}
