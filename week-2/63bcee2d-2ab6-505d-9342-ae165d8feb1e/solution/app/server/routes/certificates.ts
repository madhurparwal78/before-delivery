import { randomUUID } from "node:crypto";
import type pg from "pg";
import { memberById, memberRef, requireRole, type Member } from "../auth.js";
import { one, pool, rows, type Db, tx } from "../db.js";
import { halfRelease, interimFigures, ledgerPair, retentionActions, retentionRefusal, type RetentionAction } from "../domain/retention.js";
import { splitByWeight, type StorePart } from "../domain/split.js";
import { conflict, illegalTransition, notFound } from "../http/errors.js";
import { ok, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { knownId, visibleProject, type Project } from "../scope.js";
import { csvFile, csvHeaders, figure } from "../services/csv.js";
import { formatDate, plainAmount, zoneToday } from "../../shared/format.js";

// Payment certificates, retention releases, the retention ledger and per-store splits
// (brief: API Certificates and retention, Business rules Certificates, Retention ledger, Per-store split).

const MAX_CENTS = 99_999_999_999;

type Kind = "interim" | "retention_release_half" | "retention_release_final";

interface CertificateRow {
  id: string; project_id: string; number: string; kind: Kind; period_ending: string | null;
  gross_valuation_cents: number | null; valuation_this_period_cents: number | null; retention_this_period_cents: number | null;
  retention_held_cents: number; amount_due_cents: number; currency: string; store_split: StorePart[]; issued_by: string; issued_at: Date;
}

async function certificateJson(db: Db, row: CertificateRow) {
  const issuer = await memberById(db, row.issued_by);
  return {
    id: row.id, number: row.number, kind: row.kind, periodEnding: row.period_ending, grossValuationCents: row.gross_valuation_cents,
    valuationThisPeriodCents: row.valuation_this_period_cents, retentionThisPeriodCents: row.retention_this_period_cents,
    retentionHeldCents: Number(row.retention_held_cents), amountDueCents: Number(row.amount_due_cents), currency: row.currency,
    storeSplit: row.store_split, issuedBy: issuer && memberRef(issuer), issuedAt: row.issued_at.toISOString(),
  };
}

/** Retention held: the credits minus the debits on retention_held. */
async function heldCents(db: Db, projectId: string): Promise<number> {
  const [{ held }] = await rows<{ held: number }>(db,
    `SELECT coalesce(sum(CASE WHEN side = 'credit' THEN amount_cents ELSE -amount_cents END), 0)::bigint AS held
     FROM retention_entries WHERE project_id = $1 AND account = 'retention_held'`, [projectId]);
  return held;
}

/** Inserts a certificate and its ledger movement, returning the stored row. */
async function issue(client: pg.PoolClient, project: Project, member: Member, values: {
  number: string; kind: Kind; periodEnding: string | null; gross: number | null; valuation: number | null; retention: number | null;
  held: number; amountDue: number; movement: "hold" | "release"; movementCents: number;
}): Promise<CertificateRow> {
  const [row] = await rows<CertificateRow>(client,
    `INSERT INTO certificates (project_id, number, kind, period_ending, gross_valuation_cents, valuation_this_period_cents,
       retention_this_period_cents, retention_held_cents, amount_due_cents, currency, store_split, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [project.id, values.number, values.kind, values.periodEnding, values.gross, values.valuation, values.retention, values.held,
      values.amountDue, project.currency, JSON.stringify(splitByWeight(values.amountDue, project.stores)), member.id]);
  const movementId = randomUUID();
  for (const entry of ledgerPair(values.movement, values.movementCents)) {
    await client.query(
      `INSERT INTO retention_entries (project_id, movement_id, certificate_id, kind, account, side, amount_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`, [project.id, movementId, row.id, entry.kind, entry.account, entry.side, entry.amountCents]);
  }
  return row;
}

async function releaseNumber(db: Db, projectId: string): Promise<string> {
  const [{ n }] = await rows<{ n: number }>(db, "SELECT count(*)::int AS n FROM certificates WHERE project_id = $1 AND kind <> 'interim'", [projectId]);
  return `RR-${String(n + 1).padStart(2, "0")}`;
}

async function visibleCertificate(db: Db, member: Member, id: string): Promise<{ row: CertificateRow; project: Project }> {
  const row = await one<CertificateRow>(db, "SELECT * FROM certificates WHERE id = $1", [knownId(id)]);
  if (!row) throw notFound();
  return { row, project: await visibleProject(db, member, row.project_id) };
}

/** Where the project's retention stands, as the retention rules read it. */
async function retentionPosition(db: Db, project: Project) {
  const final = await one(db, "SELECT 1 FROM certificates WHERE project_id = $1 AND kind = 'retention_release_final'", [project.id]);
  return { hasContract: project.contract !== null, practicalCompletionOn: project.practicalCompletionOn,
    defectsPeriodMonths: project.defectsPeriodMonths, finalReleased: !!final, today: zoneToday("Asia/Hong_Kong") };
}

/** Opens a certificate action: project visible, director or project lead, then the retention rules' refusal. */
async function lockedFor(client: pg.PoolClient, member: Member, id: string, action: RetentionAction): Promise<Project> {
  const project = await visibleProject(client, member, id, true);
  requireRole(member, "director", "project_lead");
  const refusal = retentionRefusal(await retentionPosition(client, project), action);
  if (refusal?.kind === "no_contract") throw conflict("no_contract");
  if (refusal?.kind === "defects_period_running") throw conflict("defects_period_running", { defectsEndOn: refusal.defectsEndOn });
  if (refusal) throw illegalTransition(refusal.from, action);
  return project;
}

export const routes: Route[] = [
  {
    method: "GET", path: "/api/projects/:id/certificates", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      const list = await rows<CertificateRow>(pool, "SELECT * FROM certificates WHERE project_id = $1 ORDER BY issued_at, number", [project.id]);
      const lead = ctx.me.role === "director" || ctx.me.role === "project_lead";
      return ok({
        certificates: await Promise.all(list.map((row) => certificateJson(pool, row))),
        actions: lead ? retentionActions(await retentionPosition(pool, project)) : [],
      });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/certificates", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const project = await lockedFor(client, member, ctx.params.id, "issue");
        const fields = new Fields(record(ctx.json()));
        const periodEnding = fields.date("periodEnding", "Period ending");
        const gross = fields.cents("grossValuationCents", "Gross valuation to date", { min: 0, max: MAX_CENTS });
        const previous = await one<CertificateRow>(client,
          "SELECT * FROM certificates WHERE project_id = $1 AND kind = 'interim' ORDER BY period_ending DESC LIMIT 1", [project.id]);
        if (previous?.period_ending && !fields.has("periodEnding") && periodEnding <= previous.period_ending) {
          fields.fail("periodEnding", `Period ending must be after ${formatDate(previous.period_ending)}.`);
        }
        const previousGross = Number(previous?.gross_valuation_cents ?? 0);
        if (!fields.has("grossValuationCents") && gross < previousGross) {
          fields.fail("grossValuationCents", "Gross valuation can't be lower than the last certificate's.");
        }
        fields.done();
        const held = await heldCents(client, project.id);
        const figures = interimFigures({ grossValuationCents: gross, previousGrossCents: previousGross, heldCents: held,
          contractSumCents: (project.contract as NonNullable<Project["contract"]>).contractSumCents, practicalCompletion: project.practicalCompletionOn !== null });
        const [{ n }] = await rows<{ n: number }>(client, "SELECT count(*)::int AS n FROM certificates WHERE project_id = $1 AND kind = 'interim'", [project.id]);
        const row = await issue(client, project, member, {
          number: `PC-${String(n + 1).padStart(2, "0")}`, kind: "interim", periodEnding, gross,
          valuation: figures.valuationThisPeriodCents, retention: figures.retentionThisPeriodCents,
          held: held + figures.retentionThisPeriodCents, amountDue: figures.amountDueCents,
          movement: "hold", movementCents: figures.retentionThisPeriodCents,
        });
        return ok({ certificate: await certificateJson(client, row) }, 201);
      });
    },
  },
  {
    method: "GET", path: "/api/certificates/:id", auth: "member",
    handler: async (ctx) => {
      const { row } = await visibleCertificate(pool, ctx.me, ctx.params.id);
      return ok({ certificate: await certificateJson(pool, row) });
    },
  },
  {
    method: "GET", path: "/api/certificates/:id/split.csv", auth: "member",
    handler: async (ctx) => {
      const { row } = await visibleCertificate(pool, ctx.me, ctx.params.id);
      requireRole(ctx.me, "director", "project_lead", "finance");
      const body = csvFile(["store_code", "store_name", "weight", "amount"],
        row.store_split.map((part) => [part.storeCode, part.storeName, figure(part.weight), figure(plainAmount(part.amountCents))]));
      return { status: 200, body, headers: csvHeaders(`${row.number}-store-split.csv`) };
    },
  },
  {
    method: "POST", path: "/api/projects/:id/practical-completion", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const project = await lockedFor(client, member, ctx.params.id, "record_practical_completion");
        const fields = new Fields(record(ctx.json()));
        const date = fields.date("date", "Practical completion date");
        if (!fields.has("date") && date > zoneToday("Asia/Hong_Kong")) fields.fail("date", "Practical completion date can't be in the future.");
        fields.done();
        const held = await heldCents(client, project.id);
        const release = halfRelease(held);
        await client.query("UPDATE projects SET practical_completion_on = $2 WHERE id = $1", [project.id, date]);
        const row = await issue(client, project, member, {
          number: await releaseNumber(client, project.id), kind: "retention_release_half", periodEnding: date, gross: null,
          valuation: null, retention: null, held: held - release, amountDue: release, movement: "release", movementCents: release,
        });
        return ok({ certificate: await certificateJson(client, row) }, 201);
      });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/retention/final-release", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const project = await lockedFor(client, member, ctx.params.id, "release_final");
        const held = await heldCents(client, project.id);
        const row = await issue(client, project, member, {
          number: await releaseNumber(client, project.id), kind: "retention_release_final", periodEnding: null, gross: null,
          valuation: null, retention: null, held: 0, amountDue: held, movement: "release", movementCents: held,
        });
        return ok({ certificate: await certificateJson(client, row) }, 201);
      });
    },
  },
  {
    method: "GET", path: "/api/projects/:id/retention-ledger", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      requireRole(ctx.me, "director", "project_lead", "finance");
      const entries = await rows<{ id: string; movement_id: string; number: string; kind: string; account: string; side: string;
        amount_cents: number; posted_at: Date }>(pool,
        `SELECT e.id, e.movement_id, c.number, e.kind, e.account, e.side, e.amount_cents, e.posted_at
         FROM retention_entries e JOIN certificates c ON c.id = e.certificate_id
         WHERE e.project_id = $1 ORDER BY e.posted_at, c.number, e.side DESC`, [project.id]);
      return ok({
        entries: entries.map((e) => ({ id: e.id, movementId: e.movement_id, certificateNumber: e.number, kind: e.kind, account: e.account,
          side: e.side, amountCents: Number(e.amount_cents), postedAt: e.posted_at.toISOString() })),
        retentionHeldCents: await heldCents(pool, project.id),
      });
    },
  },
];
