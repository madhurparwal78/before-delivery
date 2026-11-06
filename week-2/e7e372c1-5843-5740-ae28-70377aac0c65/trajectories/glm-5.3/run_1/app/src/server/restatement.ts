// The restatement state machine service. Every transition runs inside a
// transaction that locks the restatement row, so races are decided by the
// database, never by a read followed by a separate write.

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { pool, withTransaction } from "./db.js";
import { errors, type FieldError } from "./errors.js";
import { writeAudit, loadAudit } from "./audit.js";
import {
  ROW_KEYS,
  SHARE_EVENT_KINDS,
  type RestatementRecord,
  type RestatementRows,
  type RestatementState,
  type Role,
  type ShareEventKind,
  type ShareEventRecord,
  type RowKey,
} from "./types.js";
import { Decimal } from "./decimal.js";
import { nextSunday, openSessionCloseAt, shiftDate, weekEndMs } from "./calendar.js";
import {
  validateAccession,
  validateCorrectionReason,
  validateEthRow,
  validateDilutedShares,
  validateExhibitPage,
} from "./validate.js";
import { draftShareCount, type DraftEvent } from "./ledger.js";
import { ROW_KEYS as ALL_ROW_KEYS } from "./types.js";

function isExactRowKeys(checked: string[]): boolean {
  return ALL_ROW_KEYS.every((key) => checked.includes(key)) && checked.length === ALL_ROW_KEYS.length;
}
import { publishRestatement } from "./publish.js";

export { loadAudit };

interface RestatementRow extends QueryResultRow {
  id: string;
  version: number;
  week_ending: string;
  state: RestatementState;
  supersedes: string | null;
  correction_reason: string | null;
  rows_beginning_balance: string | null;
  rows_eth_acquired: string | null;
  rows_staking_rewards: string | null;
  rows_ending_balance: string | null;
  rows_cumulative_staking_rewards: string | null;
  rows_diluted_shares: string | null;
  accession: string | null;
  exhibit_page: number | null;
  exhibit_sha256: string | null;
  exhibit_status: string | null;
  exhibit_bytes: number | null;
  exhibit_key: string | null;
  prepared_by: string;
  cleared_by: string | null;
  released_by: string | null;
  return_note: string | null;
  release_at: number | null;
  published_at: number | null;
  superseded_by: string | null;
  created_at: number;
  updated_at: number;
  preparer_name: string;
  clearer_name: string | null;
  releaser_name: string | null;
}

const SELECT_RESTATEMENT = `
  SELECT r.*, pu.name AS preparer_name, cu.name AS clearer_name, ru.name AS releaser_name
    FROM restatements r
    JOIN staff_users pu ON pu.id = r.prepared_by
    LEFT JOIN staff_users cu ON cu.id = r.cleared_by
    LEFT JOIN staff_users ru ON ru.id = r.released_by
`;

function hydrate(row: RestatementRow, events: ShareEventRecord[]): RestatementRecord {
  const rows: RestatementRows = {
    "beginning-balance": row.rows_beginning_balance,
    "eth-acquired": row.rows_eth_acquired,
    "staking-rewards": row.rows_staking_rewards,
    "ending-balance": row.rows_ending_balance,
    "cumulative-staking-rewards": row.rows_cumulative_staking_rewards,
    "diluted-shares": row.rows_diluted_shares,
  };
  const exhibit =
    row.exhibit_sha256 && row.exhibit_status && row.exhibit_bytes !== null
      ? {
          status: row.exhibit_status as "verified" | "rejected",
          sha256: row.exhibit_sha256,
          bytes: Number(row.exhibit_bytes),
          key: row.exhibit_key,
        }
      : null;
  return {
    id: row.id,
    version: row.version,
    week_ending: row.week_ending,
    state: row.state,
    supersedes: row.supersedes,
    correction_reason: row.correction_reason,
    rows,
    share_events: events,
    accession: row.accession,
    exhibit_page: row.exhibit_page,
    exhibit,
    prepared_by: { id: row.prepared_by, name: row.preparer_name },
    cleared_by: row.cleared_by ? { id: row.cleared_by, name: row.clearer_name ?? "" } : null,
    released_by: row.released_by ? { id: row.released_by, name: row.releaser_name ?? "" } : null,
    return_note: row.return_note,
    release_at: row.release_at === null ? null : Number(row.release_at),
    published_at: row.published_at === null ? null : Number(row.published_at),
    superseded_by: row.superseded_by,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

async function loadEvents(client: PoolClient, id: string): Promise<ShareEventRecord[]> {
  const { rows } = await client.query(
    `SELECT id, kind, shares, effective_date FROM share_events WHERE restatement_id = $1 ORDER BY position`,
    [id],
  );
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as ShareEventKind,
    shares: r.shares as string,
    effective_date: r.effective_date as string,
  }));
}

async function loadRow(client: PoolClient, id: string, lock: boolean): Promise<RestatementRow> {
  const { rows } = await client.query<RestatementRow>(
    `${SELECT_RESTATEMENT} WHERE r.id = $1${lock ? " FOR UPDATE OF r" : ""}`,
    [id],
  );
  if (rows.length === 0) throw errors.notFound();
  return rows[0] as RestatementRow;
}

async function hydrateById(client: PoolClient, id: string): Promise<RestatementRecord> {
  const row = await loadRow(client, id, false);
  return hydrate(row, await loadEvents(client, id));
}

async function lockedRecord(client: PoolClient, id: string): Promise<RestatementRecord> {
  const row = await loadRow(client, id, true);
  return hydrate(row, await loadEvents(client, id));
}

export async function getRestatement(id: string): Promise<RestatementRecord> {
  const client = await pool.connect();
  try {
    return await hydrateById(client, id);
  } finally {
    client.release();
  }
}

export async function listRestatements(): Promise<RestatementRecord[]> {
  const { rows } = await pool.query<RestatementRow>(
    `${SELECT_RESTATEMENT}
     ORDER BY r.week_ending DESC,
              CASE WHEN r.state = 'published' THEN 0 ELSE 1 END,
              r.published_at DESC NULLS LAST`,
  );
  const client = await pool.connect();
  try {
    const out: RestatementRecord[] = [];
    for (const row of rows) {
      out.push(hydrate(row, await loadEvents(client, row.id)));
    }
    return out;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Two-person rule checks, in the brief's order: role, then preparer, then clearer.

export function checkRole(userRoles: Role[], required: Role): void {
  if (!userRoles.includes(required)) throw errors.forbidden();
}

function assertNotPreparer(userId: string, record: RestatementRecord): void {
  if (record.prepared_by.id === userId) throw errors.preparerCannotClear();
}

function assertNotPreparerForRelease(userId: string, record: RestatementRecord): void {
  if (record.prepared_by.id === userId) throw errors.preparerCannotRelease();
}

function assertClearerMayRelease(userId: string, record: RestatementRecord): void {
  if (record.cleared_by && record.cleared_by.id === userId) throw errors.clearerCannotRelease();
}

// ---------------------------------------------------------------------------
// Create: the single decision point for opening a draft.

const CREATE_WEEKLY_MEMBERS = new Set(["week_ending", "rows", "share_events", "accession", "exhibit_page"]);
const CREATE_CORRECTION_MEMBERS = new Set([
  "supersedes",
  "correction_reason",
  "rows",
  "share_events",
  "accession",
  "exhibit_page",
]);

export async function createRestatement(
  userId: string,
  body: Record<string, unknown>,
  now: number,
): Promise<RestatementRecord> {
  const isCorrection = body.supersedes !== undefined;
  const allowed = isCorrection ? CREATE_CORRECTION_MEMBERS : CREATE_WEEKLY_MEMBERS;
  const fields: FieldError = {};
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) fields[key] = "This field cannot be changed here.";
  }

  return withTransaction(async (client) => {
    const latest = await client.query(
      `SELECT id, week_ending FROM restatements WHERE state = 'published'
        ORDER BY week_ending DESC, published_at DESC LIMIT 1 FOR UPDATE`,
    );
    const latestRow = latest.rows[0] as { id: string; week_ending: string } | undefined;
    if (!latestRow) throw errors.notFound();

    let weekEnding: string;
    let supersedes: string | null = null;

    if (isCorrection) {
      if (typeof body.supersedes !== "string") {
        throw errors.validationFailed({ ...fields, supersedes: "Name the restatement to correct." });
      }
      const target = await client.query(
        `SELECT id, week_ending, state FROM restatements WHERE id = $1 FOR UPDATE`,
        [body.supersedes],
      );
      const targetRow = target.rows[0] as { id: string; week_ending: string; state: string } | undefined;
      if (!targetRow) throw errors.notFound();
      if (targetRow.id !== latestRow.id || targetRow.state !== "published") throw errors.notLatestWeek();
      weekEnding = targetRow.week_ending;
      supersedes = targetRow.id;
      if (body.week_ending !== undefined) {
        fields.week_ending = "This field cannot be changed here.";
      }
    } else {
      const nextWeek = nextSunday(latestRow.week_ending);
      if (body.week_ending !== undefined && body.week_ending !== nextWeek) throw errors.weekOutOfSequence();
      weekEnding = nextWeek;
      if (now < weekEndMs(weekEnding)) throw errors.weekNotEnded();
      if (body.correction_reason !== undefined) {
        fields.correction_reason = "This field cannot be changed here.";
      }
    }
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

    const id = randomUUID();
    try {
      await client.query(
        `INSERT INTO restatements (id, version, week_ending, state, supersedes, correction_reason,
            rows_beginning_balance, rows_eth_acquired, rows_staking_rewards, rows_ending_balance,
            rows_cumulative_staking_rewards, rows_diluted_shares, accession, exhibit_page,
            prepared_by, created_at, updated_at)
         VALUES ($1, 1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          id,
          weekEnding,
          supersedes,
          (body.correction_reason as string | undefined) ?? null,
          rowOrNull(body.rows, "beginning-balance"),
          rowOrNull(body.rows, "eth-acquired"),
          rowOrNull(body.rows, "staking-rewards"),
          rowOrNull(body.rows, "ending-balance"),
          rowOrNull(body.rows, "cumulative-staking-rewards"),
          rowOrNull(body.rows, "diluted-shares"),
          (body.accession as string | undefined) ?? null,
          (body.exhibit_page as number | undefined) ?? null,
          userId,
          String(now),
        ],
      );
      const events = parseEvents(body.share_events);
      let position = 0;
      for (const ev of events) {
        await client.query(
          `INSERT INTO share_events (restatement_id, kind, shares, effective_date, position) VALUES ($1, $2, $3, $4, $5)`,
          [id, ev.kind, ev.shares, ev.effective_date, position],
        );
        position += 1;
      }
      await writeAudit(client, id, 1, "create", userId, now, null, "draft", null);
      return hydrateById(client, id);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        const constraint = (e as { constraint?: string }).constraint;
        if (constraint === "one_open_restatement") throw errors.restatementOpen();
        if (constraint === "one_published_per_week") throw errors.notLatestWeek();
      }
      throw e;
    }
  });
}

function rowOrNull(rows: unknown, key: RowKey): string | null {
  if (typeof rows !== "object" || rows === null) return null;
  const value = (rows as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function parseEvents(events: unknown): { kind: ShareEventKind; shares: string; effective_date: string }[] {
  if (!Array.isArray(events)) return [];
  return events.map((raw) => {
    const ev = raw as Record<string, unknown>;
    return {
      kind: ev.kind as ShareEventKind,
      shares: String(ev.shares ?? ""),
      effective_date: String(ev.effective_date ?? ""),
    };
  });
}

// ---------------------------------------------------------------------------
// Save (PATCH): version-checked edit, validated as a merged draft.

const SAVE_MEMBERS = new Set(["version", "rows", "share_events", "accession", "exhibit_page", "correction_reason"]);

export interface SaveBody {
  version?: unknown;
  rows?: unknown;
  share_events?: unknown[];
  accession?: unknown;
  exhibit_page?: unknown;
  correction_reason?: unknown;
  [key: string]: unknown;
}

export async function saveRestatement(
  userId: string,
  id: string,
  body: SaveBody,
  now: number,
): Promise<RestatementRecord> {
  const fields: FieldError = {};
  for (const key of Object.keys(body)) {
    if (!SAVE_MEMBERS.has(key)) fields[key] = "This field cannot be changed here.";
  }
  if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1) {
    fields.version = "version must be a positive integer.";
  }
  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

  return withTransaction(async (client) => {
    const record = await lockedRecord(client, id);
    if (record.prepared_by.id !== userId) throw errors.notPreparer();
    if (record.state !== "draft" && record.state !== "returned") throw errors.invalidTransition();

    const merged = await validateMergedDraft(client, record, body);
    if (Object.keys(merged.fields).length > 0) throw errors.validationFailed(merged.fields);
    if (body.version !== record.version) throw errors.versionConflict();

    const newVersion = record.version + 1;
    const detach = body.accession !== undefined && merged.accession !== record.accession;
    await client.query(
      `UPDATE restatements SET
         version = $2,
         rows_beginning_balance = $3, rows_eth_acquired = $4, rows_staking_rewards = $5,
         rows_ending_balance = $6, rows_cumulative_staking_rewards = $7, rows_diluted_shares = $8,
         accession = $9, exhibit_page = $10, correction_reason = $11,
         exhibit_sha256 = CASE WHEN $12::boolean THEN NULL ELSE exhibit_sha256 END,
         exhibit_status = CASE WHEN $12::boolean THEN NULL ELSE exhibit_status END,
         exhibit_bytes = CASE WHEN $12::boolean THEN NULL ELSE exhibit_bytes END,
         exhibit_key = CASE WHEN $12::boolean THEN NULL ELSE exhibit_key END,
         updated_at = $13
       WHERE id = $1`,
      [
        id,
        newVersion,
        merged.rows["beginning-balance"],
        merged.rows["eth-acquired"],
        merged.rows["staking-rewards"],
        merged.rows["ending-balance"],
        merged.rows["cumulative-staking-rewards"],
        merged.rows["diluted-shares"],
        merged.accession,
        merged.exhibit_page,
        merged.correction_reason,
        detach,
        String(now),
      ],
    );
    await client.query(`DELETE FROM share_events WHERE restatement_id = $1`, [id]);
    let position = 0;
    for (const ev of merged.events) {
      await client.query(
        `INSERT INTO share_events (restatement_id, kind, shares, effective_date, position) VALUES ($1, $2, $3, $4, $5)`,
        [id, ev.kind, ev.shares, ev.effective_date, position],
      );
      position += 1;
    }
    await writeAudit(client, id, newVersion, "edit", userId, now, record.state, record.state, null);
    return hydrateById(client, id);
  });
}

interface MergedDraft {
  fields: FieldError;
  rows: Record<RowKey, string | null>;
  events: { kind: ShareEventKind; shares: string; effective_date: string }[];
  accession: string | null;
  exhibit_page: number | null;
  correction_reason: string | null;
}

/** Builds the merged draft; arithmetic checks run in full on submit. */
async function validateMergedDraft(
  client: PoolClient,
  record: RestatementRecord,
  body: SaveBody,
): Promise<MergedDraft> {
  void client;
  const fields: FieldError = {};

  const rows: Record<RowKey, string | null> = { ...record.rows };
  if (body.rows !== undefined) {
    if (typeof body.rows !== "object" || body.rows === null) {
      fields.rows = "rows must be an object.";
    } else {
      for (const key of Object.keys(body.rows as Record<string, unknown>)) {
        if (!(ROW_KEYS as string[]).includes(key)) {
          fields[`rows.${key}`] = "This field cannot be changed here.";
        }
      }
      for (const key of ROW_KEYS) {
        if (key in (body.rows as Record<string, unknown>)) {
          const value = (body.rows as Record<string, unknown>)[key];
          if (typeof value !== "string" && value !== null) {
            fields[`rows.${key}`] = "Enter a value.";
          } else {
            rows[key] = value as string | null;
          }
        }
      }
    }
  }

  const events: { kind: ShareEventKind; shares: string; effective_date: string }[] = record.share_events.map(
    (e) => ({ kind: e.kind, shares: e.shares, effective_date: e.effective_date }),
  );
  if (body.share_events !== undefined) {
    if (!Array.isArray(body.share_events)) {
      fields.share_events = "share_events must be a list.";
    } else {
      const parsed: { kind: ShareEventKind; shares: string; effective_date: string }[] = [];
      body.share_events.forEach((raw, index) => {
        const ev = (raw ?? {}) as Record<string, unknown>;
        for (const attr of Object.keys(ev)) {
          if (attr !== "kind" && attr !== "shares" && attr !== "effective_date" && attr !== "id") {
            fields[`share_events.${index}.${attr}`] = "This field cannot be changed here.";
          }
        }
        const kind = ev.kind as ShareEventKind | undefined;
        const shares = ev.shares;
        const effectiveDate = ev.effective_date;
        if (kind === undefined || !SHARE_EVENT_KINDS.includes(kind)) {
          fields[`share_events.${index}.kind`] = "Choose an event type.";
        }
        if (typeof shares !== "string" || !/^\d+$/.test(shares)) {
          fields[`share_events.${index}.shares`] = "Enter a whole number of shares.";
        }
        if (typeof effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
          fields[`share_events.${index}.effective_date`] = "Enter the effective date.";
        }
        parsed.push({
          kind: (kind ?? "atm_settlement") as ShareEventKind,
          shares: typeof shares === "string" ? shares : "",
          effective_date: typeof effectiveDate === "string" ? effectiveDate : "",
        });
      });
      events.length = 0;
      events.push(...parsed);
    }
  }

  let accession: string | null;
  if (body.accession === undefined) accession = record.accession;
  else if (body.accession === null) accession = null;
  else if (typeof body.accession === "string") accession = body.accession;
  else {
    accession = null;
    fields.accession = "Enter the accession number.";
  }

  let exhibitPage: number | null;
  if (body.exhibit_page === undefined) exhibitPage = record.exhibit_page;
  else if (body.exhibit_page === null) exhibitPage = null;
  else if (typeof body.exhibit_page === "number" && Number.isInteger(body.exhibit_page)) {
    exhibitPage = body.exhibit_page;
  } else {
    exhibitPage = null;
    fields.exhibit_page = "Enter the exhibit page.";
  }

  let correctionReason: string | null;
  if (body.correction_reason === undefined) correctionReason = record.correction_reason;
  else if (body.correction_reason === null) correctionReason = null;
  else if (typeof body.correction_reason === "string") correctionReason = body.correction_reason;
  else {
    correctionReason = null;
    fields.correction_reason = "Enter the correction reason.";
  }

  return { fields, rows, events, accession, exhibit_page: exhibitPage, correction_reason: correctionReason };
}

// ---------------------------------------------------------------------------
// Submit, return, clear, release, withdraw.

export async function submitRestatement(userId: string, id: string, now: number): Promise<RestatementRecord> {
  return withTransaction(async (client) => {
    const record = await lockedRecord(client, id);
    if (record.prepared_by.id !== userId) throw errors.notPreparer();
    if (record.state !== "draft" && record.state !== "returned") throw errors.invalidTransition();
    if (!record.exhibit || record.exhibit.status !== "verified") throw errors.exhibitNotVerified();

    const fields = await validateWholeDraft(client, record);
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

    const newVersion = record.version + 1;
    await client.query(
      `UPDATE restatements SET state = 'in_review', version = $2, updated_at = $3 WHERE id = $1`,
      [id, newVersion, String(now)],
    );
    await writeAudit(client, id, newVersion, "submit", userId, now, record.state, "in_review", null);
    return hydrateById(client, id);
  });
}

export async function returnRestatement(
  userId: string,
  userRoles: Role[],
  id: string,
  note: string,
  now: number,
): Promise<RestatementRecord> {
  checkRole(userRoles, "disclosure_counsel");
  return withTransaction(async (client) => {
    const record = await lockedRecord(client, id);
    assertNotPreparer(userId, record);
    if (record.state !== "in_review") throw errors.invalidTransition();

    const newVersion = record.version + 1;
    await client.query(
      `UPDATE restatements SET state = 'returned', return_note = $2, version = $3, updated_at = $4 WHERE id = $1`,
      [id, note, newVersion, String(now)],
    );
    await writeAudit(client, id, newVersion, "return", userId, now, record.state, "returned", note);
    return hydrateById(client, id);
  });
}

export async function clearRestatement(
  userId: string,
  userRoles: Role[],
  id: string,
  checked: string[],
  version: number,
  now: number,
): Promise<RestatementRecord> {
  checkRole(userRoles, "disclosure_counsel");
  if (!isExactRowKeys(checked)) {
    throw errors.validationFailed({ checked: "Confirm all six exhibit rows." });
  }
  return withTransaction(async (client) => {
    const record = await lockedRecord(client, id);
    assertNotPreparer(userId, record);
    if (record.state !== "in_review") throw errors.invalidTransition();
    if (version !== record.version) throw errors.versionConflict();

    const newVersion = record.version + 1;
    await client.query(
      `UPDATE restatements SET state = 'cleared', cleared_by = $2, version = $3, updated_at = $4 WHERE id = $1`,
      [id, userId, newVersion, String(now)],
    );
    await writeAudit(client, id, newVersion, "clear", userId, now, record.state, "cleared", null);
    return hydrateById(client, id);
  });
}

export type ReleaseOutcome =
  | { outcome: "queued"; restatement: RestatementRecord }
  | { outcome: "published"; restatement: RestatementRecord };

export async function releaseRestatement(
  userId: string,
  userRoles: Role[],
  id: string,
  now: number,
): Promise<ReleaseOutcome> {
  checkRole(userRoles, "disclosure_officer");
  return withTransaction(async (client) => {
    const record = await lockedRecord(client, id);
    assertNotPreparerForRelease(userId, record);
    assertClearerMayRelease(userId, record);
    if (record.state !== "cleared") throw errors.invalidTransition();

    const session = openSessionCloseAt(now);
    if (session.open && session.closeAt !== null) {
      const newVersion = record.version + 1;
      await client.query(
        `UPDATE restatements SET state = 'queued', released_by = $2, release_at = $3, version = $4, updated_at = $5 WHERE id = $1`,
        [id, userId, String(session.closeAt), newVersion, String(now)],
      );
      await writeAudit(client, id, newVersion, "release_queued", userId, now, record.state, "queued", null);
      return { outcome: "queued", restatement: await hydrateById(client, id) };
    }

    await client.query(`UPDATE restatements SET released_by = $2 WHERE id = $1`, [id, userId]);
    await publishRestatement(client, id, now);
    return { outcome: "published", restatement: await hydrateById(client, id) };
  });
}

export async function withdrawRestatement(
  userId: string,
  userRoles: Role[],
  id: string,
  note: string,
  version: number,
  now: number,
): Promise<RestatementRecord> {
  checkRole(userRoles, "disclosure_officer");
  return withTransaction(async (client) => {
    const record = await lockedRecord(client, id);
    if (record.prepared_by.id === userId) throw errors.preparerCannotRelease();
    if (record.state !== "queued") throw errors.invalidTransition();
    if (version !== record.version) throw errors.versionConflict();
    // The close wins: only a withdraw strictly before the release time succeeds.
    if (record.release_at === null || now >= record.release_at) throw errors.invalidTransition();

    const newVersion = record.version + 1;
    await client.query(
      `UPDATE restatements SET state = 'cleared', release_at = NULL, released_by = NULL, version = $2, updated_at = $3 WHERE id = $1`,
      [id, newVersion, String(now)],
    );
    await writeAudit(client, id, newVersion, "withdraw", userId, now, record.state, "cleared", note);
    return hydrateById(client, id);
  });
}

// ---------------------------------------------------------------------------
// Whole-draft validation, run on submit.

export async function validateWholeDraft(
  client: PoolClient,
  record: RestatementRecord,
): Promise<FieldError> {
  const fields: FieldError = {};
  const rows = record.rows;

  for (const key of ROW_KEYS) {
    const value = rows[key];
    if (value === null || value === "") {
      fields[`rows.${key}`] = "Enter a value.";
    }
  }
  if (Object.keys(fields).length > 0) return fields;

  const weekMonday = shiftDate(record.week_ending, -6);
  const weekSunday = record.week_ending;

  for (const key of ROW_KEYS) {
    const value = rows[key] as string;
    if (key === "diluted-shares") {
      const msg = validateDilutedShares(value);
      if (msg) fields["rows.diluted-shares"] = msg;
    } else {
      const msg = validateEthRow(value);
      if (msg) fields[`rows.${key}`] = msg;
    }
  }

  record.share_events.forEach((ev, index) => {
    if (!SHARE_EVENT_KINDS.includes(ev.kind)) {
      fields[`share_events.${index}.kind`] = "Choose an event type.";
    }
    if (typeof ev.shares !== "string" || !/^\d+$/.test(ev.shares)) {
      fields[`share_events.${index}.shares`] = "Enter a whole number of shares.";
    }
    if (ev.effective_date < weekMonday || ev.effective_date > weekSunday) {
      fields[`share_events.${index}.effective_date`] = "The effective date must fall in this week.";
    }
  });

  const accessionMsg = validateAccession(record.accession);
  if (accessionMsg) fields.accession = accessionMsg;
  const pageMsg = validateExhibitPage(record.exhibit_page);
  if (pageMsg) fields.exhibit_page = pageMsg;
  if (record.supersedes !== null) {
    const reasonMsg = validateCorrectionReason(record.correction_reason);
    if (reasonMsg) fields.correction_reason = reasonMsg;
  }

  // Arithmetic checks, exact to 18 fractional digits.
  const prior = await priorWeekData(client, record);
  if (prior) {
    const expectedBeginning = prior.endingBalance !== null ? Decimal.fromString(prior.endingBalance) : null;
    const actualBeginning = Decimal.fromString(rows["beginning-balance"] as string);
    if (expectedBeginning && actualBeginning && !expectedBeginning.equals(actualBeginning)) {
      fields["rows.beginning-balance"] = "This must equal the prior week's ending balance.";
    }
    const priorCum = prior.cumulativeRewards !== null ? Decimal.fromString(prior.cumulativeRewards) : null;
    const weekRewards = Decimal.fromString(rows["staking-rewards"] as string);
    const actualCum = Decimal.fromString(rows["cumulative-staking-rewards"] as string);
    if (priorCum && weekRewards && actualCum && !priorCum.add(weekRewards).equals(actualCum)) {
      fields["rows.cumulative-staking-rewards"] =
        "This must equal the prior week's cumulative plus this week's staking rewards.";
    }
  }

  const beginning = Decimal.fromString(rows["beginning-balance"] as string);
  const acquired = Decimal.fromString(rows["eth-acquired"] as string);
  const rewards = Decimal.fromString(rows["staking-rewards"] as string);
  const ending = Decimal.fromString(rows["ending-balance"] as string);
  if (beginning && acquired && rewards && ending) {
    if (!beginning.add(acquired).add(rewards).equals(ending)) {
      fields["rows.ending-balance"] =
        "The ending balance must equal the beginning balance plus ETH acquired plus staking rewards.";
    }
  }

  const draftEvents: DraftEvent[] = record.share_events.map((ev) => ({
    effective_date: ev.effective_date,
    shares: ev.shares,
    kind: ev.kind,
  }));
  const ledgerCount = await draftShareCount(client, weekMonday, draftEvents);
  if (ledgerCount.failedIndex !== null) {
    fields[`share_events.${ledgerCount.failedIndex}.shares`] =
      "This event would take the share count to zero or below.";
  } else if (ledgerCount.count !== null) {
    const actual = rows["diluted-shares"] as string;
    if (BigInt(actual) !== BigInt(ledgerCount.count)) {
      fields["rows.diluted-shares"] =
        "This must equal the diluted share count in effect on the week-ending date.";
    }
  }

  return fields;
}

async function priorWeekData(
  client: PoolClient,
  record: RestatementRecord,
): Promise<{ endingBalance: string | null; cumulativeRewards: string | null } | null> {
  const priorWeekEnding = shiftDate(record.week_ending, -7);
  const { rows } = await client.query(
    `SELECT rows_ending_balance, rows_cumulative_staking_rewards FROM restatements
      WHERE week_ending = $1 AND state IN ('published','superseded')
      ORDER BY CASE WHEN state = 'published' THEN 0 ELSE 1 END, published_at DESC
      LIMIT 1`,
    [priorWeekEnding],
  );
  if (rows.length === 0) return null;
  return {
    endingBalance: rows[0].rows_ending_balance as string | null,
    cumulativeRewards: rows[0].rows_cumulative_staking_rewards as string | null,
  };
}
