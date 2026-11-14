import type pg from "pg";
import type { Config } from "./config.js";
import { itemOf, validateEnquiry, type EnquiryErrors } from "../shared/rules.js";
import type { Content } from "../shared/types.js";

export type IntakeState = "pending" | "sent" | "failed";

interface EnquiryRow {
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

export type EnquiryOutcome =
  | { kind: "invalid"; errors: EnquiryErrors }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "sent"; reference: string; intakeReference: string }
  | { kind: "intake_failed"; reference: string };

const allowedChanges: Record<IntakeState, readonly IntakeState[]> = {
  pending: ["sent", "failed"],
  failed: ["pending"],
  sent: [],
};

export class EnquiryDesk {
  private readonly pool: pg.Pool;
  private readonly content: Content;
  private readonly config: Config;
  private readonly submissionQueues = new Map<string, Promise<unknown>>();

  constructor(pool: pg.Pool, content: Content, config: Config) {
    this.pool = pool;
    this.content = content;
    this.config = config;
  }

  async submit(input: Record<string, unknown>): Promise<EnquiryOutcome> {
    const errors = validateEnquiry(input, this.content);
    if (Object.keys(errors).length > 0) return { kind: "invalid", errors };
    const submissionId = String(input.submission_id);
    return this.oneAtATime(submissionId, async () => {
      const stored = await this.pool.query<EnquiryRow>("SELECT * FROM enquiries WHERE submission_id = $1", [submissionId]);
      if (stored.rows.length > 0) return this.replay(stored.rows[0]);
      const created = await this.store(input, submissionId);
      return "retryAfterSeconds" in created ? created : this.handOff(created);
    });
  }

  /** Runs posts that share a submission id one after another, so a later post sees the earlier hand-off's result. */
  private oneAtATime<T>(submissionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.submissionQueues.get(submissionId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.catch(() => undefined);
    this.submissionQueues.set(submissionId, settled);
    void settled.then(() => {
      if (this.submissionQueues.get(submissionId) === settled) this.submissionQueues.delete(submissionId);
    });
    return run;
  }

  private async replay(row: EnquiryRow): Promise<EnquiryOutcome> {
    if (row.intake_state === "sent") return { kind: "sent", reference: row.reference, intakeReference: row.intake_reference ?? "" };
    if (row.intake_state === "failed") await this.changeState(row.reference, "failed", "pending", null);
    return this.handOff(row);
  }

  private async store(
    input: Record<string, unknown>,
    submissionId: string,
  ): Promise<EnquiryRow | { kind: "rate_limited"; retryAfterSeconds: number }> {
    const email = String(input.email);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)))", [email]);
      const window = await client.query<{ count: string; retry_after: string | null }>(
        `SELECT count(*) AS count,
                ceil(EXTRACT(EPOCH FROM (min(created_at) + make_interval(secs => $2) - now()))) AS retry_after
           FROM enquiries
          WHERE lower(email) = lower($1) AND created_at > now() - make_interval(secs => $2)`,
        [email, this.config.enquiryWindowSeconds],
      );
      if (Number(window.rows[0].count) >= this.config.enquiryLimit) {
        await client.query("ROLLBACK");
        return { kind: "rate_limited", retryAfterSeconds: Math.max(1, Number(window.rows[0].retry_after)) };
      }
      const inserted = await client.query<EnquiryRow>(
        `INSERT INTO enquiries (reference, submission_id, name, email, business_name, service, budget, description, item, intake_state)
         VALUES ('VO-' || lpad(nextval('enquiry_reference_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         RETURNING *`,
        [
          submissionId,
          input.name,
          email,
          input.business_name,
          input.service,
          input.budget,
          input.description,
          itemOf(input.item),
        ],
      );
      await client.query("COMMIT");
      return inserted.rows[0];
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async changeState(reference: string, from: IntakeState, to: IntakeState, intakeReference: string | null): Promise<void> {
    if (!allowedChanges[from].includes(to)) throw new Error(`Intake state cannot change from ${from} to ${to}`);
    await this.pool.query(
      "UPDATE enquiries SET intake_state = $3, intake_reference = coalesce($4, intake_reference) WHERE reference = $1 AND intake_state = $2",
      [reference, from, to, intakeReference],
    );
  }

  private async handOff(row: EnquiryRow): Promise<EnquiryOutcome> {
    const intakeReference = await this.requestIntake(row);
    if (intakeReference === null) {
      await this.changeState(row.reference, "pending", "failed", null);
      return { kind: "intake_failed", reference: row.reference };
    }
    await this.changeState(row.reference, "pending", "sent", intakeReference);
    return { kind: "sent", reference: row.reference, intakeReference };
  }

  /** Returns the intake reference, or null when the intake service did not accept the enquiry in time. */
  private async requestIntake(row: EnquiryRow): Promise<string | null> {
    try {
      const response = await fetch(`${this.config.wiremockUrl}/v1/intake/enquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: row.reference,
          name: row.name,
          email: row.email,
          business_name: row.business_name,
          service: row.service,
          budget: row.budget,
          description: row.description,
          item: row.item,
          source: "vellum-orbit-site",
        }),
        signal: AbortSignal.timeout(this.config.intakeTimeoutMs),
      });
      const body: unknown = await response.json();
      if (response.status !== 201 || typeof body !== "object" || body === null) return null;
      const reference = (body as Record<string, unknown>).intake_reference;
      return typeof reference === "string" && reference !== "" ? reference : null;
    } catch {
      return null;
    }
  }

  async listForGrading(email: string): Promise<Array<Record<string, unknown>>> {
    const { rows } = await this.pool.query<EnquiryRow>(
      "SELECT * FROM enquiries WHERE lower(email) = lower($1) ORDER BY created_at, reference",
      [email],
    );
    return rows.map((r) => ({
      reference: r.reference,
      submission_id: r.submission_id,
      name: r.name,
      email: r.email,
      business_name: r.business_name,
      service: r.service,
      budget: r.budget,
      description: r.description,
      item: r.item,
      intake_state: r.intake_state,
      intake_reference: r.intake_reference,
      created_at: r.created_at.toISOString(),
    }));
  }
}
