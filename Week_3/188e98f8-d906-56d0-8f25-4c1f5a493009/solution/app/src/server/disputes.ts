import type { Dispute } from "../shared/api-types";
import type { Ctx, Reply } from "./context";
import { json, requireRole } from "./context";
import { isUniqueViolation, pool, tx } from "./db";
import { Fields, conflict, forbidden, notFound } from "./errors";
import { loadAnswer, loadDispute, loadDisputes } from "./query";
import { send } from "./mail";
import { asObject, checkText, positiveInteger } from "./validate";

const RETRY_MS = 10_000;

export async function raiseDispute(ctx: Ctx): Promise<Reply> {
  const body = asObject(ctx.body);
  const answerId = positiveInteger(body["answer_id"]);
  const answer = answerId === null ? null : await loadAnswer(pool, answerId);
  if (answerId !== null && answer === null) throw notFound();
  const session = requireRole(ctx, "captain");
  if (answer !== null && answer.team_id !== session.teamId) throw forbidden();
  const id = await tx(async (client) => {
    if (answer !== null) {
      const round = await client.query<{ status: string }>("SELECT status FROM rounds WHERE number = $1 FOR SHARE", [answer.round]);
      if (round.rows[0]?.status !== "marked") throw conflict("dispute_window_closed");
      const fresh = await loadAnswer(client, answer.id);
      if (!fresh?.current) throw conflict("answer_superseded");
      if (fresh.mark !== 0) throw conflict("answer_not_marked_wrong");
      const existing = await client.query("SELECT 1 FROM disputes WHERE answer_id = $1", [answer.id]);
      if (existing.rowCount !== 0) throw conflict("dispute_exists");
    }
    const fields = new Fields();
    if (answerId === null) fields.set("answer_id", body["answer_id"] === undefined || body["answer_id"] === null ? "required" : "invalid");
    const reason = checkText(body["reason"], "reason");
    if (!reason.ok) fields.set("reason", reason.error);
    fields.assertEmpty();
    try {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO disputes (answer_id, team_id, reason, raised_at)
         VALUES ($1, $2, $3, clock_timestamp()) RETURNING id`,
        [answerId, session.teamId, (reason as { text: string }).text],
      );
      return (inserted.rows[0] as { id: number }).id;
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("dispute_exists");
      throw error;
    }
  });
  return json(201, { dispute: await loadDispute(pool, id) });
}

export async function listDisputes(ctx: Ctx): Promise<Reply> {
  const session = requireRole(ctx, "quizmaster", "captain");
  return json(200, { disputes: await loadDisputes(pool, session.role === "captain" ? session.teamId : null) });
}

/** Sends the ruling note once. It is skipped while another sender holds the dispute. */
async function deliverNote(id: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      round: number;
      title: string;
      question: number;
      text: string;
      status: string;
      email: string;
    }>(
      `SELECT a.round, r.title, a.question, a.text, d.status, t.captain_email AS email
       FROM disputes d JOIN answers a ON a.id = d.answer_id JOIN rounds r ON r.number = a.round
         JOIN teams t ON t.id = d.team_id
       WHERE d.id = $1 AND d.note = 'queued' FOR UPDATE OF d SKIP LOCKED`,
      [id],
    );
    const row = found.rows[0];
    if (row === undefined) {
      await client.query("ROLLBACK");
      return;
    }
    await send({
      to: row.email,
      subject: `Ruling on round ${row.round}, question ${row.question}`,
      lines: [
        `Round ${row.round}: ${row.title}`,
        `Question: ${row.question}`,
        `Your answer: ${row.text}`,
        `Ruling: ${row.status === "upheld" ? "Upheld" : "Dismissed"}`,
      ],
    });
    await client.query("UPDATE disputes SET note = 'sent' WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
  }
}

export async function ruleOnDispute(ctx: Ctx): Promise<Reply> {
  const id = Number(ctx.params[0]);
  const dispute = /^\d+$/.test(ctx.params[0] ?? "") ? await loadDispute(pool, id) : null;
  if (dispute === null) throw notFound();
  requireRole(ctx, "quizmaster");
  if (dispute.status !== "raised") throw conflict("dispute_already_ruled");
  const ruling = asObject(ctx.body)["ruling"];
  const fields = new Fields();
  if (ruling === undefined || ruling === null) fields.set("ruling", "required");
  else if (ruling !== "upheld" && ruling !== "dismissed") fields.set("ruling", "invalid");
  fields.assertEmpty();
  const ruled = await pool.query(
    `UPDATE disputes SET status = $2, ruled_at = clock_timestamp(), note = 'queued'
     WHERE id = $1 AND status = 'raised'`,
    [id, ruling],
  );
  if (ruled.rowCount === 0) throw conflict("dispute_already_ruled");
  await deliverNote(id);
  return json(200, { dispute: (await loadDispute(pool, id)) as Dispute });
}

/** Retries every queued note until the mail server accepts it. */
export function retryQueuedNotes(): void {
  setInterval(() => {
    void (async () => {
      const queued = await pool.query<{ id: number }>("SELECT id FROM disputes WHERE note = 'queued' ORDER BY id");
      for (const row of queued.rows) await deliverNote(row.id);
    })().catch(() => undefined);
  }, RETRY_MS);
}
