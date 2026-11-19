import { Database } from "./database.js";
import { AppConfig } from "./config.js";
import {
  addMonths,
  currentMonth,
  formatInstant,
  localCalendarDate,
  monthLabel,
} from "../shared/dates.js";
import { ENQUIRY_STATUSES, EnquiryStatus, Milestone, milestoneSplit } from "../shared/domain.js";
import { AppError, illegalTransition, notFound, validationError } from "./errors.js";
import { KillBill } from "./killbill.js";
import { randomTokenString } from "./tokens.js";
import { PoolClient } from "pg";

/**
 * Domain store: the one place that decides each domain rule listed in the
 * engineering standards — read-time enquiry status, month claimed counts and
 * openness, visibility, transitions and cursor paging.
 */

export interface ProjectRecord {
  id: string;
  slug: string;
  title: string;
  credit_type: "shipped" | "jam" | "redesign";
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: "public" | "nda";
  position: number;
  thresholds: { bed: number; pulse: number; lead: number; stinger: number };
  status: "draft" | "in_review" | "published" | "withdrawn";
  stems: { id: string; layer: string; format: string; bytes: number; duration_ms: number }[];
}

export interface EnquiryRecord {
  id: string;
  reference: string;
  version: number;
  status: EnquiryStatus;
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferred_month: string | null;
  project_slug: string | null;
  attachment: { filename: string; bytes: number; url: string } | null;
  received_at: string;
  triage_notes: string | null;
  fit_score: number | null;
  rate_floor_cents: number | null;
  proposal: ProposalRecord | null;
}

export interface ProposalRecord {
  token: string;
  url: string;
  producer_name: string;
  producer_email: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  production_month: string;
  milestones: Milestone[];
  expires_at: string;
  email: "sent" | "pending" | "cancelled";
  held_email: "sent" | "pending" | null;
  deposit_email: "sent" | "pending" | null;
  invoiced_milestones: number[];
}

export interface LinkRecord {
  id: string;
  label: string;
  token: string;
  expires_at: string;
  status: "active" | "expired" | "revoked";
  project_id: string;
}

export interface MonthRecord {
  month: string;
  label: string;
  capacity: number;
  claimed: number;
  open: boolean;
}

export interface Settings {
  time_zone: string;
  operator_email: string;
}

export class Store {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly killbill: KillBill,
  ) {}

  async readSettings(): Promise<Settings> {
    const rows = await this.db.query<Settings>(
      `SELECT time_zone, operator_email FROM settings WHERE singleton = true`,
    );
    return rows[0];
  }

  async writeTimeZone(timeZone: string): Promise<void> {
    await this.db.query(`UPDATE settings SET time_zone = $1 WHERE singleton = true`, [timeZone]);
  }

  // ---------------------------------------------------------------- months

  /**
   * A month's claimed count is always exactly its accepted, deposit-paid and
   * booked enquiries whose proposal names that month (DP-54). Never a
   * separately adjusted tally.
   */
  async claimedFor(month: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM enquiries e
         JOIN proposals p ON p.enquiry_id = e.id
        WHERE p.production_month = $1 AND e.status IN ('accepted', 'deposit_paid', 'booked')`,
      [month],
    );
    return Number(rows[0].count);
  }

  async monthRecord(month: string): Promise<MonthRecord> {
    const rows = await this.db.query<{ capacity: number | null }>(
      `SELECT capacity FROM production_months WHERE month = $1`,
      [month],
    );
    const capacity = rows.length > 0 && rows[0].capacity !== null ? rows[0].capacity : 0;
    const claimed = await this.claimedFor(month);
    return { month, label: monthLabel(month, ""), capacity, claimed, open: claimed < capacity };
  }

  async monthsFromCurrent(): Promise<MonthRecord[]> {
    const settings = await this.readSettings();
    const start = currentMonth(new Date(), settings.time_zone);
    const rows = await this.db.query<{ month: string; capacity: number }>(
      `SELECT month, capacity FROM production_months WHERE month >= $1 ORDER BY month ASC`,
      [start],
    );
    const records: MonthRecord[] = [];
    for (const row of rows) {
      records.push(await this.monthRecord(row.month));
    }
    return records;
  }

  async openMonths(): Promise<MonthRecord[]> {
    const all = await this.monthsFromCurrent();
    return all.filter((month) => month.open);
  }

  async setMonthCapacity(month: string, capacity: number): Promise<MonthRecord> {
    return this.db.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [month]);
      const claimed = await this.claimedFor(month);
      if (capacity < claimed) {
        throw validationError({
          capacity: `Capacity can't be below the ${claimed} places already claimed.`,
        });
      }
      await client.query(
        `INSERT INTO production_months (month, capacity) VALUES ($1, $2)
         ON CONFLICT (month) DO UPDATE SET capacity = $2`,
        [month, capacity],
      );
      return { month, label: monthLabel(month, ""), capacity, claimed, open: claimed < capacity };
    });
  }

  // ------------------------------------------------------------- enquiries

  /** The single read-time enquiry status rule (DP-22, DP-26). */
  static readTimeStatus(row: {
    status: string;
    expires_at: string | null;
    accepted_at: string | null;
  }): EnquiryStatus {
    const stored = row.status as EnquiryStatus;
    if (stored === "proposal_sent" && !row.accepted_at && row.expires_at) {
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        return "expired";
      }
    }
    return stored;
  }

  async listEnquiries(options: {
    status?: string;
    limit: number;
    cursor?: string;
  }): Promise<{ enquiries: EnquiryRecord[]; next_cursor: string | null }> {
    const statusFilter = options.status && options.status !== "" ? options.status : null;
    if (statusFilter && !ENQUIRY_STATUSES.includes(statusFilter as EnquiryStatus)) {
      throw validationError({ status: "Choose a status from the list." });
    }
    const limit = options.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw validationError({ limit: "Choose a page size from 1 to 100." });
    }
    let cursorReference: string | null = null;
    if (options.cursor !== undefined && options.cursor !== null && options.cursor !== "") {
      const decoded = decodeCursor(options.cursor);
      if (!decoded) {
        throw validationError({ cursor: "That cursor is not valid. Reload the list." });
      }
      if ((decoded.status || null) !== statusFilter) {
        throw validationError({
          cursor: "That cursor was issued under a different status filter. Reload the list.",
        });
      }
      cursorReference = decoded.reference;
    }
    const rows = await this.db.query<EnquiryRow>(
      `SELECT e.*, p.token AS proposal_token, p.producer_name, p.producer_email, p.project_title,
              p.scope, p.fee_cents, p.production_month, p.m1_cents, p.m2_cents, p.m3_cents,
              p.m4_cents, p.expires_at AS proposal_expires_at, p.accepted_at, p.invoiced_milestones
         FROM enquiries e
         LEFT JOIN proposals p ON p.enquiry_id = e.id
        WHERE ($1::text IS NULL OR e.reference < $1)
        ORDER BY e.reference DESC
        LIMIT $2`,
      [cursorReference, limit + 1],
    );
    const page = rows.slice(0, limit);
    const hasOlder = rows.length > limit;
    const lastReference = page.length > 0 ? page[page.length - 1].reference : cursorReference;
    const olderExists = await this.olderMatchingExists(lastReference, statusFilter);
    const records = [];
    for (const row of page) {
      const status = Store.readTimeStatus({
        status: row.status,
        expires_at: row.proposal_expires_at,
        accepted_at: row.accepted_at,
      });
      if (statusFilter && status !== statusFilter) continue;
      records.push(await this.enquiryFromRow(row, status));
    }
    // The page boundary must be computed against matching enquiries only, so
    // filter after paging and keep paging by reference.
    const nextCursor = hasOlder && olderExists ? encodeCursor(lastReference ?? "", statusFilter) : null;
    return { enquiries: records, next_cursor: nextCursor };
  }

  private async olderMatchingExists(reference: string | null, status: string | null): Promise<boolean> {
    if (reference === null) return false;
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enquiries e
         LEFT JOIN proposals p ON p.enquiry_id = e.id
        WHERE e.reference < $1
          AND ($2::text IS NULL OR e.status = $2)`,
      [reference, status],
    );
    return Number(rows[0].count) > 0;
  }

  async getEnquiry(id: string): Promise<EnquiryRecord | null> {
    const rows = await this.db.query<EnquiryRow>(
      `SELECT e.*, p.token AS proposal_token, p.producer_name, p.producer_email, p.project_title,
              p.scope, p.fee_cents, p.production_month, p.m1_cents, p.m2_cents, p.m3_cents,
              p.m4_cents, p.expires_at AS proposal_expires_at, p.accepted_at, p.invoiced_milestones
         FROM enquiries e
         LEFT JOIN proposals p ON p.enquiry_id = e.id
        WHERE e.id = $1`,
      [id],
    );
    if (rows.length === 0) return null;
    const status = Store.readTimeStatus({
      status: rows[0].status,
      expires_at: rows[0].proposal_expires_at,
      accepted_at: rows[0].accepted_at,
    });
    return this.enquiryFromRow(rows[0], status);
  }

  async getEnquiryByReference(reference: string): Promise<EnquiryRecord | null> {
    const rows = await this.db.query<EnquiryRow>(
      `SELECT e.*, p.token AS proposal_token, p.producer_name, p.producer_email, p.project_title,
              p.scope, p.fee_cents, p.production_month, p.m1_cents, p.m2_cents, p.m3_cents,
              p.m4_cents, p.expires_at AS proposal_expires_at, p.accepted_at, p.invoiced_milestones
         FROM enquiries e
         LEFT JOIN proposals p ON p.enquiry_id = e.id
        WHERE e.reference = $1`,
      [reference],
    );
    if (rows.length === 0) return null;
    const status = Store.readTimeStatus({
      status: rows[0].status,
      expires_at: rows[0].proposal_expires_at,
      accepted_at: rows[0].accepted_at,
    });
    return this.enquiryFromRow(rows[0], status);
  }

  private async enquiryFromRow(row: EnquiryRow, status: EnquiryStatus): Promise<EnquiryRecord> {
    const emailStates = await this.db.query<{ kind: string; state: string }>(
      `SELECT kind, state FROM mail_queue WHERE enquiry_id = $1`,
      [row.id],
    );
    const state = (kind: string): "sent" | "pending" | "cancelled" | null => {
      const found = emailStates.find((entry) => entry.kind === kind);
      return found ? (found.state as "sent" | "pending" | "cancelled") : null;
    };
    let proposal: ProposalRecord | null = null;
    if (row.proposal_token) {
      const milestones: Milestone[] = [
        { number: 1, name: "Deposit", percent: 30, amount_cents: row.m1_cents as number },
        { number: 2, name: "Vertical slice", percent: 20, amount_cents: row.m2_cents as number },
        { number: 3, name: "Content complete", percent: 20, amount_cents: row.m3_cents as number },
        { number: 4, name: "Final delivery", percent: 30, amount_cents: row.m4_cents as number },
      ];
      const proposalEmail = state("proposal");
      const cancelled = proposalEmail === "cancelled";
      proposal = {
        token: row.proposal_token,
        url: `${this.config.publicUrl}/p/${row.proposal_token}`,
        producer_name: row.producer_name as string,
        producer_email: row.producer_email as string,
        project_title: row.project_title as string,
        scope: row.scope as string,
        fee_cents: row.fee_cents as number,
        production_month: row.production_month as string,
        milestones,
        expires_at: new Date(row.proposal_expires_at as string).toISOString(),
        email: cancelled ? "cancelled" : proposalEmail || "pending",
        held_email: (state("month_held") as "sent" | "pending" | null) ?? null,
        deposit_email: (state("deposit") as "sent" | "pending" | null) ?? null,
        invoiced_milestones: row.invoiced_milestones || [],
      };
    }
    return {
      id: row.id,
      reference: row.reference,
      version: row.version,
      status,
      name: row.name,
      email: row.email,
      studio: row.studio,
      brief: row.brief,
      preferred_month: row.preferred_month,
      project_slug: row.project_slug,
      attachment: row.attachment_id
        ? {
            filename: row.attachment_filename as string,
            bytes: row.attachment_bytes as number,
            url: `/api/console/enquiries/${row.id}/attachment`,
          }
        : null,
      received_at: new Date(row.received_at).toISOString(),
      triage_notes: row.triage_notes,
      fit_score: row.fit_score,
      rate_floor_cents: row.rate_floor_cents,
      proposal,
    };
  }

  /** The single console enquiry transition rule (DP-22, DP-33). */
  async transitionEnquiry(
    id: string,
    ifMatch: string | null,
    to: "qualified" | "declined" | "booked",
  ): Promise<{ enquiry: EnquiryRecord; cancelled: boolean }> {
    return this.db.transaction(async (client) => {
      await this.lockEnquiry(client, id);
      const row = await this.fetchEnquiryForUpdate(client, id);
      if (ifMatch === null) throw preconditionRequiredError();
      if (String(row.version) !== ifMatch) throw staleError(await this.getEnquiry(id));
      const from = Store.readTimeStatus({
        status: row.status,
        expires_at: row.proposal_expires_at,
        accepted_at: row.accepted_at,
      });
      let cancelled = false;
      if (to === "qualified") {
        if (from !== "new") throw illegalTransition(from, to);
      } else if (to === "declined") {
        if (!["new", "qualified", "proposal_sent"].includes(from)) throw illegalTransition(from, to);
        cancelled = from === "proposal_sent" || from === "new" || from === "qualified";
        await this.cancelProposalEmailInTransaction(client, id);
      } else {
        if (from !== "deposit_paid") throw illegalTransition(from, to);
        await client.query(
          `UPDATE proposals SET production_started_at = now() WHERE enquiry_id = $1`,
          [id],
        );
      }
      await client.query(
        `UPDATE enquiries SET status = $2, version = version + 1 WHERE id = $1`,
        [id, to],
      );
      const enquiry = await this.getEnquiryInTransaction(client, id);
      if (!enquiry) throw notFound("That enquiry does not exist.");
      return { enquiry, cancelled };
    });
  }

  async cancelProposalEmailInTransaction(client: PoolClient, enquiryId: string): Promise<void> {
    await client.query(
      `UPDATE mail_queue
         SET state = 'cancelled', cancelled_at = now(), claim_token = NULL, claim_expires_at = NULL
       WHERE enquiry_id = $1 AND kind = 'proposal' AND state = 'pending'`,
      [enquiryId],
    );
  }

  async saveTriage(
    id: string,
    ifMatch: string | null,
    fields: { triage_notes?: string | null; fit_score?: number | null; rate_floor_cents?: number | null },
  ): Promise<EnquiryRecord> {
    return this.db.transaction(async (client) => {
      await this.lockEnquiry(client, id);
      const row = await this.fetchEnquiryForUpdate(client, id);
      if (ifMatch === null) throw preconditionRequiredError();
      if (String(row.version) !== ifMatch) throw staleError(await this.getEnquiry(id));
      const updates: string[] = [];
      const params: unknown[] = [id];
      let index = 2;
      if (fields.triage_notes !== undefined) {
        updates.push(`triage_notes = $${index}`);
        params.push(fields.triage_notes);
        index += 1;
      }
      if (fields.fit_score !== undefined) {
        updates.push(`fit_score = $${index}`);
        params.push(fields.fit_score);
        index += 1;
      }
      if (fields.rate_floor_cents !== undefined) {
        updates.push(`rate_floor_cents = $${index}`);
        params.push(fields.rate_floor_cents);
        index += 1;
      }
      if (updates.length > 0) {
        await client.query(
          `UPDATE enquiries SET ${updates.join(", ")}, version = version + 1 WHERE id = $1`,
          params,
        );
      }
      const enquiry = await this.getEnquiryInTransaction(client, id);
      if (!enquiry) throw notFound("That enquiry does not exist.");
      return enquiry;
    });
  }

  /** Reads an enquiry inside the caller's transaction so a write's response sees its own commit. */
  private async getEnquiryInTransaction(client: PoolClient, id: string): Promise<EnquiryRecord | null> {
    const rows = await client.query<EnquiryRow>(
      `SELECT e.*, p.token AS proposal_token, p.producer_name, p.producer_email, p.project_title,
              p.scope, p.fee_cents, p.production_month, p.m1_cents, p.m2_cents, p.m3_cents,
              p.m4_cents, p.expires_at AS proposal_expires_at, p.accepted_at, p.invoiced_milestones
         FROM enquiries e
         LEFT JOIN proposals p ON p.enquiry_id = e.id
        WHERE e.id = $1`,
      [id],
    );
    if (rows.rows.length === 0) return null;
    const row = rows.rows[0];
    const status = Store.readTimeStatus({
      status: row.status,
      expires_at: row.proposal_expires_at,
      accepted_at: row.accepted_at,
    });
    return this.enquiryFromRow(row, status);
  }

  /** Reads an enquiry inside the caller's transaction so a write's response sees its own commit. */
  async getEnquiryInTransactionForRoutes(client: PoolClient, id: string): Promise<EnquiryRecord> {
    const enquiry = await this.getEnquiryInTransaction(client, id);
    if (!enquiry) throw notFound("That enquiry does not exist.");
    return enquiry;
  }

  async lockEnquiry(client: PoolClient, id: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`enquiry:${id}`]);
  }

  async fetchEnquiryForUpdate(client: PoolClient, id: string): Promise<EnquiryRow> {
    const result = await client.query<EnquiryRow>(
      `SELECT e.*, p.token AS proposal_token, p.producer_name, p.producer_email, p.project_title,
              p.scope, p.fee_cents, p.production_month, p.m1_cents, p.m2_cents, p.m3_cents,
              p.m4_cents, p.expires_at AS proposal_expires_at, p.accepted_at, p.invoiced_milestones
         FROM enquiries e
         LEFT JOIN proposals p ON p.enquiry_id = e.id
        WHERE e.id = $1 FOR UPDATE OF e`,
      [id],
    );
    if (result.rows.length === 0) throw notFound("That enquiry does not exist.");
    return result.rows[0];
  }

  // ------------------------------------------------------------ proposals

  async nextEnquiryReference(client: PoolClient): Promise<string> {
    const result = await client.query<{ last_number: number }>(
      `UPDATE enquiry_sequence SET last_number = last_number + 1 WHERE singleton = true RETURNING last_number`,
    );
    const number = result.rows[0].last_number;
    return `ENQ-${number.toString().padStart(6, "0")}`;
  }

  async createProposal(
    id: string,
    ifMatch: string | null,
    input: {
      producer_name: string;
      producer_email: string;
      project_title: string;
      scope: string;
      fee_cents: number;
      production_month: string;
    },
  ): Promise<EnquiryRecord> {
    const settings = await this.readSettings();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.proposalLinkTtlSeconds * 1000);
    return this.db.transaction(async (client) => {
      await this.lockEnquiry(client, id);
      const row = await this.fetchEnquiryForUpdate(client, id);
      if (ifMatch === null) throw preconditionRequiredError();
      if (String(row.version) !== ifMatch) throw staleError(await this.getEnquiry(id));
      const from = row.status as EnquiryStatus;
      if (from !== "qualified") throw illegalTransition(from, "proposal_sent");
      const month = await this.monthRecord(input.production_month);
      const current = currentMonth(now, settings.time_zone);
      if (input.production_month < current || !month.open) {
        throw validationError({ production_month: "Choose an open production month." });
      }
      const milestones = milestoneSplit(input.fee_cents);
      const token = randomTokenString();
      await client.query(
        `INSERT INTO proposals
           (enquiry_id, token, producer_name, producer_email, project_title, scope, fee_cents,
            production_month, m1_cents, m2_cents, m3_cents, m4_cents, sent_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13)`,
        [
          id,
          token,
          input.producer_name,
          input.producer_email,
          input.project_title,
          input.scope,
          input.fee_cents,
          input.production_month,
          milestones[0].amount_cents,
          milestones[1].amount_cents,
          milestones[2].amount_cents,
          milestones[3].amount_cents,
          expiresAt,
        ],
      );
      await client.query(`UPDATE enquiries SET status = 'proposal_sent', version = version + 1 WHERE id = $1`, [id]);
      const enquiry = await this.getEnquiryInTransaction(client, id);
      if (!enquiry) throw notFound("That enquiry does not exist.");
      return enquiry;
    });
  }

  async getProposalByToken(token: string): Promise<ProposalRow | null> {
    const rows = await this.db.query<ProposalRow>(
      `SELECT p.*, e.status AS enquiry_status FROM proposals p
         JOIN enquiries e ON e.id = p.enquiry_id
        WHERE p.token = $1`,
      [token],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // --------------------------------------------------------------- helpers

  async operatorEmail(): Promise<string> {
    const settings = await this.readSettings();
    return settings.operator_email;
  }

  async businessDate(): Promise<string> {
    const settings = await this.readSettings();
    return localCalendarDate(new Date(), settings.time_zone);
  }

  async formatInOperatorZone(instant: Date): Promise<string> {
    const settings = await this.readSettings();
    return formatInstant(instant, settings.time_zone);
  }

  async nextMonths(count: number): Promise<string[]> {
    const settings = await this.readSettings();
    const start = currentMonth(new Date(), settings.time_zone);
    const months: string[] = [];
    for (let index = 0; index < count; index += 1) {
      months.push(addMonths(start, index));
    }
    return months;
  }
}

interface EnquiryRow {
  id: string;
  reference: string;
  version: number;
  status: string;
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferred_month: string | null;
  project_slug: string | null;
  attachment_id: string | null;
  attachment_filename: string | null;
  attachment_bytes: number | null;
  attachment_format: string | null;
  received_at: string;
  triage_notes: string | null;
  fit_score: number | null;
  rate_floor_cents: number | null;
  proposal_token: string | null;
  producer_name: string | null;
  producer_email: string | null;
  project_title: string | null;
  scope: string | null;
  fee_cents: number | null;
  production_month: string | null;
  m1_cents: number | null;
  m2_cents: number | null;
  m3_cents: number | null;
  m4_cents: number | null;
  proposal_expires_at: string | null;
  accepted_at: string | null;
  invoiced_milestones: number[] | null;
}

export interface ProposalRow {
  enquiry_id: string;
  token: string;
  producer_name: string;
  producer_email: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  production_month: string;
  m1_cents: number;
  m2_cents: number;
  m3_cents: number;
  m4_cents: number;
  sent_at: string;
  expires_at: string;
  accepted_at: string | null;
  kb_account_id: string | null;
  kb_deposit_invoice_id: string | null;
  kb_deposit_invoice_number: string | null;
  kb_deposit_item_date: string | null;
  kb_deposit_amount_cents: number | null;
  payment_id: string | null;
  paid_at: string | null;
  production_started_at: string | null;
  invoiced_milestones: number[];
  kb_milestone_invoice_ids: string[];
  kb_milestone_invoice_numbers: string[];
  kb_milestone_item_dates: string[];
  enquiry_status: string;
  enquiry_reference?: string;
}

// Cursor encoding: opaque to clients, valid across instances (DP-58).
interface CursorPayload {
  reference: string;
  status: string | null;
}

function encodeCursor(reference: string, status: string | null): string {
  const payload: CursorPayload = { reference, status };
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as CursorPayload;
    if (typeof parsed.reference !== "string") return null;
    if (!/^ENQ-\d{6}$/.test(parsed.reference)) return null;
    if (parsed.status !== null && typeof parsed.status !== "string") return null;
    return { reference: parsed.reference, status: parsed.status ?? null };
  } catch {
    return null;
  }
}

function preconditionRequiredError(): AppError {
  return new AppError(428, "precondition_required", "Send the version you read before saving.");
}

function staleError(current: EnquiryRecord | null): AppError {
  return new AppError(412, "stale_version", "This enquiry changed in another window.", {
    current: current ?? undefined,
  });
}

export function kbMilestoneDescription(number: number, name: string, reference: string): string {
  return `Milestone ${number} of 4: ${name} (${reference})`;
}
