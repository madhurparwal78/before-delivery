import { brusselsDate, monthBounds } from "../../shared/brussels";
import type { Payout, Run, RunSummary } from "../../shared/api";
import { HELD_BACK_REASON } from "../../shared/catalog";
import { formatDate, formatEuros, formatInstant, formatMoney, formatMonth } from "../../shared/format";
import { lockKey, pool, transaction, type Db } from "../db";
import { conflict, mailUnavailable, notFound, storageUnavailable, validationFailed } from "../errors";
import { MailDown, prepareMails, type Mail } from "../mail";
import { file, reply, type Context, type Reply, type SignedIn } from "../pipeline";
import { ibanIsValid, storedIban } from "../rules/iban";
import { sepaName } from "../rules/sepa";
import { tagCodeOf } from "../rules/tagCode";
import { deleteObject, getObject, putObject, StorageDown } from "../storage";
import { isMonth } from "../validate";

const SHOP_LEGAL_NAME = "Atelier Ourlet SRL";
const SHOP_IBAN = storedIban("BE68 5390 0754 7034");
const STORAGE_DOWN_COPY = "The payout run didn't start: the bank file can't be stored right now. Nothing was paid or sent.";
const MAIL_DOWN_COPY = "The payout run didn't start: statements can't be sent by mail right now. Nothing was paid or sent.";
const NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03";

const msgId = (month: string): string => `PAYOUT-${month}`;
const fileKey = (month: string): string => `payouts/${msgId(month)}.xml`;

interface RunRow {
  month: string;
  started_at: Date;
  started_by: string;
  started_by_name: string;
  ready_at: Date;
  control_sum_cents: number;
}

const SELECT_RUNS = "SELECT r.*, m.name AS started_by_name FROM payout_runs r JOIN members m ON m.id = r.started_by";

const runSummary = (row: RunRow): RunSummary => ({
  month: row.month,
  status: "ready",
  startedAt: formatInstant(row.started_at),
  startedBy: { id: row.started_by, name: row.started_by_name },
  readyAt: formatInstant(row.ready_at),
  msgId: msgId(row.month),
  controlSumCents: row.control_sum_cents,
});

interface PayoutRow {
  id: string;
  consignor_id: string;
  consignor_name: string;
  iban: string | null;
  amount_cents: number;
  status: Payout["status"];
  reason: string | null;
}

export const payoutView = (row: PayoutRow): Payout => ({
  id: row.id,
  consignorId: row.consignor_id,
  consignorName: row.consignor_name,
  iban: row.iban,
  amountCents: row.amount_cents,
  status: row.status,
  reason: row.reason,
});

export const SELECT_PAYOUTS = "SELECT p.*, c.name AS consignor_name FROM payouts p JOIN consignors c ON c.id = p.consignor_id";

async function fullRun(db: Db, month: string): Promise<Run | null> {
  const { rows } = await db.query<RunRow>(`${SELECT_RUNS} WHERE r.month = $1`, [month]);
  const row = rows[0];
  if (!row) return null;
  const payouts = await db.query<PayoutRow>(`${SELECT_PAYOUTS} WHERE p.month = $1 ORDER BY p.id`, [month]);
  return { ...runSummary(row), payouts: payouts.rows.map(payoutView) };
}

export async function listRuns(): Promise<Reply> {
  const { rows } = await pool.query<RunRow>(`${SELECT_RUNS} ORDER BY r.month DESC`);
  return reply(200, { runs: rows.map(runSummary) });
}

export async function runExists({ params }: Context): Promise<void> {
  const { rowCount } = await pool.query("SELECT 1 FROM payout_runs WHERE month = $1", [params.month]);
  if (!rowCount) throw notFound();
}

export async function getRun({ params }: Context): Promise<Reply> {
  return reply(200, { run: await fullRun(pool, params.month) });
}

export async function runFile({ params }: Context): Promise<Reply> {
  const bytes = await getObject(fileKey(params.month)).catch((error: unknown) => {
    if (error instanceof StorageDown) throw storageUnavailable("The bank file can't be read right now. Try again in a moment.");
    throw error;
  });
  return file(bytes, "application/xml", { "Content-Disposition": `attachment; filename="${msgId(params.month)}.xml"` });
}

interface DueSale {
  sale_id: string;
  consignor_id: string;
  consignor_name: string;
  consignor_email: string | null;
  iban: string | null;
  tag_number: number;
  description: string;
  sold_at: Date;
  share: number;
}

/** Unrefunded sales of the month, and earlier held-back sales not yet paid, for consignors who are not erased. */
async function dueSales(db: Db, month: string): Promise<DueSale[]> {
  const [from, to] = monthBounds(month);
  const { rows } = await db.query<DueSale>(
    `SELECT s.id AS sale_id, c.id AS consignor_id, c.name AS consignor_name, c.email AS consignor_email, c.iban,
            p.tag_number, p.description, s.sold_at, s.consignor_share_cents AS share
     FROM sales s JOIN pieces p ON p.id = s.piece_id JOIN consignors c ON c.id = p.consignor_id
     WHERE s.refunded_at IS NULL AND c.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM payout_sales ps JOIN payouts po ON po.id = ps.payout_id WHERE ps.sale_id = s.id AND po.status = 'paid')
       AND ((s.sold_at >= $1 AND s.sold_at < $2) OR EXISTS (SELECT 1 FROM payout_sales ps JOIN payouts po ON po.id = ps.payout_id WHERE ps.sale_id = s.id AND po.status = 'held_back'))
     ORDER BY s.sold_at, s.id`,
    [from, to],
  );
  return rows;
}

interface PlannedPayout {
  id: string;
  consignorId: string;
  name: string;
  creditorName: string;
  email: string | null;
  iban: string | null;
  paid: boolean;
  amountCents: number;
  sales: DueSale[];
}

function planPayouts(month: string, sales: DueSale[]): PlannedPayout[] {
  const byConsignor = new Map<string, DueSale[]>();
  for (const sale of sales) byConsignor.set(sale.consignor_id, [...(byConsignor.get(sale.consignor_id) ?? []), sale]);
  const planned = [...byConsignor.entries()].map(([consignorId, own]) => {
    const [first] = own;
    return {
      consignorId,
      name: first.consignor_name,
      creditorName: sepaName(first.consignor_name),
      email: first.consignor_email,
      iban: first.iban,
      paid: first.iban !== null && ibanIsValid(first.iban),
      amountCents: own.reduce((sum, sale) => sum + sale.share, 0),
      sales: own,
    };
  });
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  planned.sort((a, b) => compare(a.creditorName, b.creditorName) || compare(a.consignorId, b.consignorId));
  return planned.map((payout, index) => ({ ...payout, id: `PO-${month}-${String(index + 1).padStart(3, "0")}` }));
}

const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function bankFile(month: string, startedAt: Date, paid: PlannedPayout[], total: number): Buffer {
  const count = String(paid.length);
  const transactions = paid
    .map(
      (payout) => `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${payout.id}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${formatEuros(payout.amountCents)}</InstdAmt></Amt>
        <Cdtr><Nm>${escapeXml(payout.creditorName)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${payout.iban}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>Consignment payout ${formatMonth(month)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`,
    )
    .join("\n");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${NAMESPACE}">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${msgId(month)}</MsgId>
      <CreDtTm>${formatInstant(startedAt)}</CreDtTm>
      <NbOfTxs>${count}</NbOfTxs>
      <CtrlSum>${formatEuros(total)}</CtrlSum>
      <InitgPty><Nm>${SHOP_LEGAL_NAME}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${msgId(month)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${count}</NbOfTxs>
      <CtrlSum>${formatEuros(total)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${brusselsDate(startedAt)}</ReqdExctnDt>
      <Dbtr><Nm>${SHOP_LEGAL_NAME}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${SHOP_IBAN}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${transactions}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`);
}

function statement(month: string, payout: PlannedPayout, to: string): Mail {
  return {
    to,
    subject: `Your Atelier Ourlet statement for ${formatMonth(month)}`,
    text: [
      ...payout.sales.map((sale) => `${tagCodeOf(sale.tag_number)}  ${sale.description}  ${formatDate(brusselsDate(sale.sold_at))}  ${formatMoney(sale.share)}`),
      "",
      `Total: ${formatMoney(payout.amountCents)}`,
      payout.paid ? `Paid to the account ending ${String(payout.iban).slice(-4)}` : HELD_BACK_REASON,
    ].join("\n"),
  };
}

export async function startRun({ body, now }: Context, member: SignedIn): Promise<Reply> {
  const { month } = body;
  if (!isMonth(month)) throw validationFailed({ month: "Choose a month." });
  const startedAt = new Date(now.getTime() - (now.getTime() % 1000));
  return transaction(async (db) => {
    await lockKey(db, `payout-run:${month}`);
    const existing = await fullRun(db, month);
    if (existing) return reply(200, { run: existing });
    if (now < monthBounds(month)[1]) throw conflict("month_not_ended", `${formatMonth(month)} has not ended yet.`);
    const payouts = planPayouts(month, await dueSales(db, month));
    const paid = payouts.filter((payout) => payout.paid);
    if (!paid.length) throw conflict("nothing_due", `There is nothing to pay for ${formatMonth(month)}.`);
    const total = paid.reduce((sum, payout) => sum + payout.amountCents, 0);
    await db.query("INSERT INTO payout_runs (month, started_at, started_by, ready_at, control_sum_cents) VALUES ($1, $2, $3, $2, $4)", [month, startedAt, member.id, total]);
    for (const payout of payouts) {
      await db.query("INSERT INTO payouts (id, month, consignor_id, iban, amount_cents, status, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        payout.id, month, payout.consignorId, payout.iban, payout.amountCents, payout.paid ? "paid" : "held_back", payout.paid ? null : HELD_BACK_REASON,
      ]);
      for (const sale of payout.sales) await db.query("INSERT INTO payout_sales (payout_id, sale_id) VALUES ($1, $2)", [payout.id, sale.sale_id]);
    }
    // Every statement waits at its final dot first, so an unreachable Mailpit refuses the run before anything is stored.
    try {
      const statements = await prepareMails(payouts.flatMap((payout) => (payout.email ? [statement(month, payout, payout.email)] : [])));
      try {
        await putObject(fileKey(month), bankFile(month, startedAt, paid, total), "application/xml");
      } catch (error) {
        statements.discard();
        throw error;
      }
      try {
        await statements.send();
      } catch (error) {
        await deleteObject(fileKey(month)).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (error instanceof StorageDown) throw storageUnavailable(STORAGE_DOWN_COPY);
      if (error instanceof MailDown) throw mailUnavailable(MAIL_DOWN_COPY);
      throw error;
    }
    const readyAt = new Date();
    await db.query("UPDATE payout_runs SET ready_at = $2 WHERE month = $1", [month, new Date(readyAt.getTime() - (readyAt.getTime() % 1000))]);
    return reply(201, { run: await fullRun(db, month) });
  });
}
