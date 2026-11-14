import type { Config } from "./config";
import { LOCKS, type Db } from "./db";
import { fieldErrors, intakeFailed, rateLimited, type ApiReply } from "./errors";
import { INITIAL_STATE, TRANSITIONS, type IntakeState, type Transition } from "./intake-state";
import { sleep } from "./time";
import { validateEnquiry, type EnquiryCatalog } from "../shared/enquiry-rules";

const WAIT_STEP_MS = 100;

interface EnquiryRow {
  sequence: number;
  reference: string;
  submission_id: string;
  name: string;
  email: string;
  business_name: string;
  service: string;
  budget: string;
  description: string;
  item: string | null;
  intake_state: IntakeState;
  intake_reference: string | null;
  created_at: Date;
}

type Admission = { kind: "replay"; row: EnquiryRow } | { kind: "created"; row: EnquiryRow } | { kind: "limited"; retryAfterSeconds: number };

export class Enquiries {
  constructor(private readonly db: Db, private readonly config: Config) {}

  /** Applies the checks after the field rules, in order: replay, then limit, then storage and hand-off. */
  async submit(body: Record<string, unknown>, catalog: EnquiryCatalog): Promise<ApiReply> {
    const errors = validateEnquiry(body, catalog);
    if (Object.keys(errors).length > 0) return fieldErrors(errors);
    const admission = await this.admit(body);
    if (admission.kind === "limited") return rateLimited(admission.retryAfterSeconds);
    if (admission.kind === "created") return this.handOff(admission.row);
    return this.answerReplay(admission.row);
  }

  private async admit(body: Record<string, unknown>): Promise<Admission> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [LOCKS.enquiry]);
      const existing = await client.query<EnquiryRow>("SELECT * FROM enquiries WHERE lower(submission_id) = lower($1)", [body.submission_id]);
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { kind: "replay", row: existing.rows[0] };
      }
      const counted = await client.query<{ total: string; wait: string }>(
        `SELECT count(*) AS total, ceil(extract(epoch FROM (min(created_at) + make_interval(secs => $2) - now()))) AS wait
           FROM enquiries WHERE lower(email) = lower($1) AND created_at > now() - make_interval(secs => $2)`,
        [body.email, this.config.enquiryWindowSeconds],
      );
      const { total, wait } = counted.rows[0] as { total: string; wait: string };
      if (Number(total) >= this.config.enquiryLimit) {
        await client.query("COMMIT");
        return { kind: "limited", retryAfterSeconds: Number(wait) };
      }
      const last = await client.query<{ next: number }>("SELECT coalesce(max(sequence), 0) + 1 AS next FROM enquiries");
      const sequence = (last.rows[0] as { next: number }).next;
      const inserted = await client.query<EnquiryRow>(
        `INSERT INTO enquiries (sequence, reference, submission_id, name, email, business_name, service, budget, description, item, intake_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [sequence, `VO-${String(sequence).padStart(6, "0")}`, body.submission_id, body.name, body.email, body.business_name, body.service, body.budget, body.description, body.item ?? null, INITIAL_STATE],
      );
      await client.query("COMMIT");
      return { kind: "created", row: inserted.rows[0] as EnquiryRow };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** A stored enquiry answers from its intake state; a failed one is handed over again, a pending one is waited for. */
  private async answerReplay(first: EnquiryRow): Promise<ApiReply> {
    let row = first;
    const deadline = Date.now() + this.config.intakeTimeoutMs + 2000;
    for (;;) {
      if (row.intake_state === "sent") return this.sentReply(row);
      if (row.intake_state === "failed") {
        const claimed = await this.change(row, TRANSITIONS.retry);
        if (claimed) return this.handOff(claimed);
      }
      if (Date.now() > deadline) return intakeFailed(row.reference);
      await sleep(WAIT_STEP_MS);
      const current = await this.db.query<EnquiryRow>("SELECT * FROM enquiries WHERE lower(submission_id) = lower($1)", [row.submission_id]);
      row = current.rows[0] as EnquiryRow;
    }
  }

  /** Applies a transition only while the row is still in the state it starts from; undefined when another caller got there first. */
  private async change(row: EnquiryRow, transition: Transition, intakeReference: string | null = null): Promise<EnquiryRow | undefined> {
    const updated = await this.db.query<EnquiryRow>(
      "UPDATE enquiries SET intake_state = $3, intake_reference = $4 WHERE lower(submission_id) = lower($1) AND intake_state = $2 RETURNING *",
      [row.submission_id, transition.from, transition.to, intakeReference],
    );
    return updated.rows[0];
  }

  private async handOff(pending: EnquiryRow): Promise<ApiReply> {
    const intakeReference = await this.requestIntake(pending);
    const settled = (await this.change(pending, intakeReference ? TRANSITIONS.deliver : TRANSITIONS.fail, intakeReference)) as EnquiryRow;
    return settled.intake_state === "sent" ? this.sentReply(settled) : intakeFailed(settled.reference);
  }

  private async requestIntake(row: EnquiryRow): Promise<string | null> {
    try {
      const response = await fetch(`${this.config.intakeUrl}/v1/intake/enquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: row.reference, name: row.name, email: row.email, business_name: row.business_name, service: row.service,
          budget: row.budget, description: row.description, item: row.item, source: "vellum-orbit-site",
        }),
        signal: AbortSignal.timeout(this.config.intakeTimeoutMs),
      });
      if (response.status !== 201) return null;
      const answer: unknown = await response.json();
      const reference = typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>).intake_reference : undefined;
      return typeof reference === "string" && reference !== "" ? reference : null;
    } catch {
      return null;
    }
  }

  private sentReply(row: EnquiryRow): ApiReply {
    return { status: 201, body: { reference: row.reference, intake_reference: row.intake_reference, status: "sent" } };
  }

  async stored(email: string): Promise<unknown[]> {
    const { rows } = await this.db.query<EnquiryRow>("SELECT * FROM enquiries WHERE lower(email) = lower($1) ORDER BY created_at, sequence", [email]);
    return rows.map((row) => ({
      reference: row.reference, submission_id: row.submission_id, name: row.name, email: row.email, business_name: row.business_name,
      service: row.service, budget: row.budget, description: row.description, item: row.item, intake_state: row.intake_state,
      intake_reference: row.intake_reference, created_at: row.created_at.toISOString(),
    }));
  }
}
