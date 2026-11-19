import { randomBytes } from "node:crypto";
import { checkEnquiry, MESSAGES, trimmedValues } from "../shared/rules.js";
import type { EnquiryAnswer, EnquiryErrors, EnquiryValues, MailOutcome } from "../shared/types.js";
import { ENQUIRY_LOCK, inTransaction, pool } from "./db.js";
import { sendEnquiryMail, type StoredEnquiry } from "./mail.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EnquiryRow extends StoredEnquiry {
  brief_token: string;
  mail: MailOutcome;
}

type Outcome =
  | { kind: "answered"; answer: EnquiryAnswer; created: boolean }
  | { kind: "invalid"; errors: EnquiryErrors }
  | { kind: "unavailable" };

const running = new Map<string, Promise<Outcome>>();

function answerOf(row: EnquiryRow): EnquiryAnswer {
  return { reference: row.reference, brief_url: `/briefs/${row.brief_token}.pdf`, mail: row.mail };
}

const COLUMNS = "reference, brief_token, name, email, project_type, budget, description, mail";

async function findBySubmission(submissionId: string): Promise<EnquiryRow | undefined> {
  const { rows } = await pool.query<EnquiryRow>(`SELECT ${COLUMNS} FROM enquiries WHERE submission_id = $1`, [submissionId]);
  return rows[0];
}

export async function findByToken(token: string): Promise<EnquiryRow | undefined> {
  const { rows } = await pool.query<EnquiryRow>(`SELECT ${COLUMNS} FROM enquiries WHERE brief_token = $1`, [token]);
  return rows[0];
}

export async function listEnquiries(): Promise<(StoredEnquiry & { mail: MailOutcome })[]> {
  const { rows } = await pool.query<StoredEnquiry & { mail: MailOutcome }>(
    "SELECT reference, name, email, project_type, budget, description, mail FROM enquiries ORDER BY number",
  );
  return rows;
}

/** Stores one enquiry under the next reference, or returns the one already stored under the same submission id. */
async function store(submissionId: string, values: EnquiryValues): Promise<{ row: EnquiryRow; created: boolean }> {
  return inTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ENQUIRY_LOCK]);
    const { rows } = await client.query<EnquiryRow>(
      `WITH next AS (SELECT COALESCE(MAX(number), 0) + 1 AS number FROM enquiries)
       INSERT INTO enquiries (number, reference, submission_id, brief_token, name, email, project_type, budget, description, mail)
       SELECT next.number, 'SOL-' || lpad(next.number::text, 4, '0'), $1, $2, $3, $4, $5, $6, $7, 'not_sent' FROM next
       ON CONFLICT (submission_id) DO NOTHING RETURNING ${COLUMNS}`,
      [submissionId, randomBytes(16).toString("hex"), values.name, values.email, values.project_type, values.budget, values.description],
    );
    const [inserted] = rows;
    if (inserted) return { row: inserted, created: true };
    const { rows: stored } = await client.query<EnquiryRow>(`SELECT ${COLUMNS} FROM enquiries WHERE submission_id = $1`, [submissionId]);
    const [winner] = stored as [EnquiryRow];
    return { row: winner, created: false };
  });
}

async function handleSubmission(submissionId: string | null, raw: Record<string, unknown>): Promise<Outcome> {
  try {
    if (submissionId !== null) {
      const stored = await findBySubmission(submissionId);
      if (stored) return { kind: "answered", answer: answerOf(stored), created: false };
    }
    const values = trimmedValues(raw);
    const errors = checkEnquiry(values);
    if (submissionId === null) errors.submission_id = MESSAGES.submissionId;
    if (submissionId === null || Object.keys(errors).length > 0) return { kind: "invalid", errors };
    const { row, created } = await store(submissionId, values);
    if (!created) return { kind: "answered", answer: answerOf(row), created: false };
    const mail = await sendEnquiryMail(row);
    if (mail === "sent") await pool.query("UPDATE enquiries SET mail = 'sent' WHERE reference = $1", [row.reference]);
    return { kind: "answered", answer: answerOf({ ...row, mail }), created: true };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Decides one enquiry submission: replay, refusal, or one stored enquiry with its two messages. */
export async function submitEnquiry(raw: Record<string, unknown>): Promise<Outcome> {
  const given = raw["submission_id"];
  const submissionId = typeof given === "string" && UUID.test(given) ? given.toLowerCase() : null;
  if (submissionId === null) return handleSubmission(null, raw);
  for (let waiting = running.get(submissionId); waiting; waiting = running.get(submissionId)) {
    const outcome = await waiting;
    if (outcome.kind === "answered") return { kind: "answered", answer: outcome.answer, created: false };
  }
  const attempt = handleSubmission(submissionId, raw).finally(() => running.delete(submissionId));
  running.set(submissionId, attempt);
  return attempt;
}
