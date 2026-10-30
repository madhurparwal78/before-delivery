import { randomUUID } from "node:crypto";
import type pg from "pg";
import { formatTime, plainAmount } from "../../shared/format.js";
import { isStudio, memberByEmail, newToken, requireRole, startSession, tokenHash, type Member } from "../auth.js";
import { config } from "../config.js";
import { one, pool, rows, tx, type Db } from "../db.js";
import { level, type BidFigures, type Exclusion, type Sum } from "../domain/levelling.js";
import {
  assertBidWindow, assertOpenBids, assertOpened, assertPatch, assertPublish, localToUtc, MAX_BIDDERS, percentText, tenderStatus,
  studioActions, type PublishedClock, type TenderClock, type TenderStatus,
} from "../domain/tenders.js";
import { conflict, forbidden, notFound, validation } from "../http/errors.js";
import type { PageRule } from "../http/pages.js";
import { ok, type Ctx, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { canSeeProject, knownId, loadProject, visibleProject, type Project } from "../scope.js";
import { csvFile, csvHeaders, figure } from "../services/csv.js";
import { tenderCloseIcs } from "../services/ics.js";
import { queueMail } from "../services/mail.js";

const MAX_CENTS = 99_999_999_999;
const CLOSE_AFTER_NOW = "Choose a close time after now.";

type TenderRow = TenderClock & {
  id: string;
  project_id: string;
  title: string;
  scope: string;
  closes_at_local: string | null;
  contingency_basis_points: number;
  ics_sequence: number;
  awarded_bid_id: string | null;
};

interface BidderRow {
  id: string;
  reference: string;
  company_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  member_id: string;
}

interface BidRow {
  id: string;
  bidder_id: string;
  base_cents: number;
  provisional_sums: Sum[];
  exclusions: Exclusion[];
  allowances: Sum[];
  final_submitted_at: Date;
  amendments: number;
}

/** The tender as the caller sees it; an invited contractor also gets their bidder row, never on a draft. */
type Access = { project: Project; status: TenderStatus } & (
  | { tender: TenderRow; bidder: null }
  | { tender: TenderRow & PublishedClock; bidder: BidderRow });

async function loadTender(db: Db, id: string, lock = false): Promise<TenderRow | undefined> {
  return one<TenderRow>(db, `SELECT * FROM tenders WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [knownId(id)]);
}

/**
 * The tender as the caller may see it: studio roles see every tender, a client approver of the brand sees
 * the project's tenders, and a contractor only tenders their company bids on once they leave draft.
 */
async function access(db: Db, member: Member, id: string, lock = false): Promise<Access> {
  const tender = await loadTender(db, id, lock);
  if (!tender) throw notFound();
  const project = await loadProject(db, tender.project_id);
  if (!project) throw notFound();
  const status = tenderStatus(tender);
  if (member.role === "contractor") {
    const bidder = await one<BidderRow>(db, "SELECT * FROM tender_bidders WHERE tender_id = $1 AND company_id = $2", [tender.id, member.companyId]);
    if (!bidder || tender.status === "draft") throw notFound();
    return { tender, project, status, bidder };
  }
  if (!isStudio(member) && !canSeeProject(member, project)) throw notFound();
  return { tender, project, status, bidder: null };
}

const bidJson = (bid: BidRow) => ({
  id: bid.id, baseCents: Number(bid.base_cents), provisionalSums: bid.provisional_sums,
  exclusions: bid.exclusions.map(({ id, label }) => ({ id, label })), finalSubmittedAt: bid.final_submitted_at.toISOString(),
  amendments: bid.amendments,
});

const projectRef = (project: Project) => ({ id: project.id, reference: project.reference, name: project.name });

function summaryJson({ tender, project, status }: Access) {
  return {
    id: tender.id, title: tender.title, scope: tender.scope, project: projectRef(project),
    closesAt: tender.closes_at?.toISOString() ?? null, closesAtLocal: tender.closes_at_local, timeZone: project.timeZone, status,
  };
}

async function studioJson(db: Db, view: Access) {
  const bidders = await rows<BidderRow & { final_submitted_at: Date | null }>(db,
    `SELECT b.*, d.final_submitted_at FROM tender_bidders b LEFT JOIN bids d ON d.bidder_id = b.id
     WHERE b.tender_id = $1 ORDER BY b.position`, [view.tender.id]);
  return {
    ...summaryJson(view), contingencyPercent: percentText(view.tender.contingency_basis_points), icsSequence: view.tender.ics_sequence,
    bidders: bidders.map((b) => ({
      reference: b.reference, companyName: b.company_name, contactName: b.contact_name, contactEmail: b.contact_email,
      hasBid: b.final_submitted_at !== null, finalSubmittedAt: b.final_submitted_at?.toISOString() ?? null,
    })),
    awardedBidId: view.tender.awarded_bid_id,
    actions: studioActions(view.status),
  };
}

async function contractorJson(db: Db, view: Access) {
  const bid = view.bidder ? await one<BidRow>(db, "SELECT * FROM bids WHERE bidder_id = $1", [view.bidder.id]) : undefined;
  return { ...summaryJson(view), myBid: bid ? bidJson(bid) : null };
}

const tenderJson = (db: Db, member: Member, view: Access) => (isStudio(member) ? studioJson(db, view) : contractorJson(db, view));

// Setup validation

interface BidderInput {
  companyName: string;
  contactName: string;
  contactEmail: string;
  member: Member | undefined;
}

interface Setup {
  title?: string;
  scope?: string;
  closesAtLocal?: string | null;
  basisPoints?: number;
  bidders?: BidderInput[];
}

function percentField(fields: Fields, value: unknown): number {
  const text = typeof value === "number" ? String(value) : value;
  if (text === undefined || text === null || text === "") {
    fields.fail("contingencyPercent", "Contingency percent is required.");
    return 0;
  }
  const found = typeof text === "string" ? /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim()) : null;
  const basisPoints = found ? Number(found[1]) * 100 + Number((found[2] ?? "").padEnd(2, "0")) : NaN;
  if (!found || basisPoints > 2500) {
    fields.fail("contingencyPercent", "Contingency percent must be between 0 and 25.00.");
    return 0;
  }
  return basisPoints;
}

function closeField(fields: Fields, value: unknown, zone: Project["timeZone"]): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !localToUtc(value, zone)) {
    fields.fail("closesAtLocal", "Close date and time must be a date and time like 2026-11-03T17:00:00.");
    return null;
  }
  return value;
}

async function setupFields(db: Db, body: Record<string, unknown>, project: Project, required: boolean): Promise<{ fields: Fields; setup: Setup }> {
  const fields = new Fields(body);
  const setup: Setup = {};
  if (required || "title" in body) setup.title = fields.text("title", "Tender title", { max: 120, oneLine: true });
  if (required || "scope" in body) setup.scope = fields.text("scope", "Scope", { max: 4000 });
  if (required || "closesAtLocal" in body) setup.closesAtLocal = closeField(fields, body.closesAtLocal, project.timeZone);
  if (required || "contingencyPercent" in body) setup.basisPoints = percentField(fields, body.contingencyPercent);
  if (required || "bidders" in body) {
    const list = Array.isArray(body.bidders) ? body.bidders.map(record) : [];
    if (list.length > MAX_BIDDERS) fields.fail("bidders", `A tender can have at most ${MAX_BIDDERS} bidders.`);
    setup.bidders = [];
    for (const [index, item] of list.entries()) {
      const path = `bidders[${index}]`;
      const companyName = fields.text(`${path}.companyName`, "Company name", { max: 120, oneLine: true }, item.companyName);
      const contactName = fields.text(`${path}.contactName`, "Contact name", { max: 120, oneLine: true }, item.contactName);
      const contactEmail = fields.email(`${path}.contactEmail`, "Contact email", item.contactEmail);
      const member = contactEmail ? await memberByEmail(db, contactEmail) : undefined;
      if (member && member.role !== "contractor") {
        fields.fail(`${path}.contactEmail`, "This email belongs to a member who isn't a contractor. Use the contractor's own email.");
      }
      setup.bidders.push({ companyName, contactName, contactEmail, member });
    }
  }
  return { fields, setup };
}

async function companyId(client: pg.PoolClient, name: string): Promise<string> {
  await client.query("INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
  const row = await one<{ id: string }>(client, "SELECT id FROM companies WHERE name = $1", [name]);
  return row?.id ?? "";
}

/** Writes the bidder list: B-01, B-02 … in order, creating a passwordless contractor member for a new email. */
async function writeBidders(client: pg.PoolClient, tenderId: string, bidders: BidderInput[]): Promise<void> {
  await client.query("DELETE FROM tender_bidders WHERE tender_id = $1", [tenderId]);
  for (const [index, bidder] of bidders.entries()) {
    let memberId = bidder.member?.id;
    let company = bidder.member?.companyId ?? "";
    if (!memberId) {
      company = await companyId(client, bidder.companyName);
      const created = await one<{ id: string }>(client,
        `INSERT INTO members (email, name, role, company_id) VALUES ($1, $2, 'contractor', $3)
         ON CONFLICT (lower(email)) DO UPDATE SET email = members.email RETURNING id`, [bidder.contactEmail, bidder.contactName, company]);
      memberId = created?.id ?? "";
    }
    await client.query(
      `INSERT INTO tender_bidders (tender_id, position, reference, company_id, company_name, contact_name, contact_email, member_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenderId, index + 1, `B-${String(index + 1).padStart(2, "0")}`, company, bidder.companyName, bidder.contactName, bidder.contactEmail, memberId]);
  }
}

/** One message per bidder with a fresh single-use sign-in link and the calendar file. */
async function sendTenderMail(client: pg.PoolClient, tender: TenderRow, project: Project, closesAt: Date, moved: boolean): Promise<number> {
  const bidders = await rows<BidderRow>(client, "SELECT * FROM tender_bidders WHERE tender_id = $1 ORDER BY position", [tender.id]);
  const close = formatTime(closesAt, project.timeZone);
  const minutes = Math.round(config.tenderLinkTtlSeconds / 60);
  for (const bidder of bidders) {
    const token = newToken();
    await client.query(
      "INSERT INTO tender_links (token_hash, tender_id, member_id, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))",
      [tokenHash(token), tender.id, bidder.member_id, config.tenderLinkTtlSeconds]);
    const link = `${config.baseUrl}/tender-sign-in/${token}`;
    const lines = moved
      ? [`Hello ${bidder.contact_name},`, "", `The close of the tender ${tender.title} for ${project.name} has moved.`, "",
        `New close: ${close}`, "", `Sign in to the tender with this link: ${link}`,
        `The link works once, for ${minutes} minutes. The attached calendar file replaces the earlier one.`]
      : [`Hello ${bidder.contact_name},`, "", `Marrow Hall Interiors invites ${bidder.company_name} to tender for ${tender.title} on ${project.name}.`,
        "", "Scope:", tender.scope, "", `Bids close at ${close}.`, "", `Sign in to the tender with this link: ${link}`,
        `The link works once, for ${minutes} minutes. Bids stay sealed until the studio opens them after close.`];
    await queueMail(client, {
      to: bidder.contact_email,
      subject: moved ? `Tender close moved: ${tender.title}` : `Invitation to tender: ${tender.title} for ${bidder.company_name}`,
      text: lines.join("\n"),
      attachments: [{ filename: "tender-close.ics", contentType: "text/calendar; method=REQUEST; charset=utf-8",
        content: tenderCloseIcs({ id: tender.id, title: tender.title, closesAt, sequence: tender.ics_sequence }, bidder.contact_email) }],
    });
  }
  return bidders.length;
}

// Levelling

async function levelledBids(db: Db, tender: TenderRow) {
  const found = await rows<BidRow & { reference: string; company_name: string }>(db,
    `SELECT d.*, b.reference, b.company_name FROM bids d JOIN tender_bidders b ON b.id = d.bidder_id
     WHERE d.tender_id = $1 ORDER BY b.position`, [tender.id]);
  const figures = found.map((bid) => ({
    id: bid.id, reference: bid.reference, companyName: bid.company_name, finalSubmittedAt: bid.final_submitted_at,
    baseCents: Number(bid.base_cents), provisionalSums: bid.provisional_sums, allowances: bid.allowances, exclusions: bid.exclusions,
  } satisfies BidFigures & { companyName: string }));
  return level(figures, tender.contingency_basis_points);
}

type LevelledBid = Awaited<ReturnType<typeof levelledBids>>[number];

const levelledJson = (bid: LevelledBid) => ({
  id: bid.id, reference: bid.reference, companyName: bid.companyName, baseCents: bid.baseCents, provisionalSums: bid.provisionalSums,
  provisionalSumsCents: bid.provisionalSumsCents, allowances: bid.allowances, allowancesCents: bid.allowancesCents,
  exclusions: bid.exclusions, pricedExclusionsCents: bid.pricedExclusionsCents, unpricedExclusions: bid.unpricedExclusions,
  subtotalCents: bid.subtotalCents, contingencyCents: bid.contingencyCents, levelledTotalCents: bid.levelledTotalCents,
  finalSubmittedAt: bid.finalSubmittedAt.toISOString(), rank: bid.rank,
});

function assertLevellingVisible(status: TenderStatus): void {
  if (status !== "opened" && status !== "awarded") throw conflict("tender_not_opened");
}

// Bids

function bidFields(body: Record<string, unknown>): { fields: Fields; bid: { baseCents: number; provisionalSums: Sum[]; exclusions: { label: string }[] } } {
  const fields = new Fields(body);
  const baseCents = fields.cents("baseCents", "Base amount", { min: 1, max: MAX_CENTS });
  const sums = Array.isArray(body.provisionalSums) ? body.provisionalSums.map(record) : [];
  const exclusions = Array.isArray(body.exclusions) ? body.exclusions.map(record) : [];
  if (sums.length > 50) fields.fail("provisionalSums", "A bid can have at most 50 provisional sums.");
  if (exclusions.length > 50) fields.fail("exclusions", "A bid can have at most 50 exclusions.");
  const provisionalSums = sums.map((sum, index) => ({
    label: fields.text(`provisionalSums[${index}].label`, "Provisional sum label", { max: 120 }, sum.label),
    amountCents: fields.cents(`provisionalSums[${index}].amountCents`, "Provisional sum amount", { min: 1, max: MAX_CENTS }, sum.amountCents),
  }));
  if (!fields.has("baseCents") && provisionalSums.reduce((total, sum) => total + sum.amountCents, 0) > baseCents) {
    fields.fail("provisionalSums", "Provisional sums can't add up to more than the base amount.");
  }
  return {
    fields,
    bid: { baseCents, provisionalSums, exclusions: exclusions.map((item, index) => ({ label: fields.text(`exclusions[${index}].label`, "Exclusion", { max: 200 }, item.label) })) },
  };
}

async function submitBid(ctx: Ctx, amend: boolean) {
  const receivedAt = new Date();
  const member = ctx.me;
  return tx(async (client) => {
    const view = await access(client, member, ctx.params.id, true);
    if (!view.bidder) throw forbidden();
    assertBidWindow(view.tender, receivedAt);
    const existing = await one<BidRow>(client, "SELECT * FROM bids WHERE bidder_id = $1", [view.bidder.id]);
    if (!amend && existing) throw conflict("bid_exists");
    if (amend && !existing) throw notFound();
    const { fields, bid } = bidFields(record(ctx.json()));
    fields.done();
    const exclusions = bid.exclusions.map((item) => ({ id: randomUUID(), label: item.label, priceCents: null }));
    const saved = existing
      ? await one<BidRow>(client,
        `UPDATE bids SET base_cents = $2, provisional_sums = $3, exclusions = $4, allowances = '[]', final_submitted_at = $5,
           amendments = amendments + 1 WHERE id = $1 RETURNING *`,
        [existing.id, bid.baseCents, JSON.stringify(bid.provisionalSums), JSON.stringify(exclusions), receivedAt.toISOString()])
      : await one<BidRow>(client,
        `INSERT INTO bids (tender_id, bidder_id, base_cents, provisional_sums, exclusions, final_submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [view.tender.id, view.bidder.id, bid.baseCents, JSON.stringify(bid.provisionalSums), JSON.stringify(exclusions), receivedAt.toISOString()]);
    return ok({ bid: saved && bidJson(saved) }, existing ? 200 : 201);
  });
}

async function studioAccess(db: Db, member: Member, id: string, lock = false): Promise<Access> {
  const view = await access(db, member, id, lock);
  requireRole(member, "director", "project_lead");
  return view;
}

export const routes: Route[] = [
  {
    method: "POST", path: "/api/projects/:id/tenders", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      const project = await visibleProject(pool, member, ctx.params.id);
      requireRole(member, "director", "project_lead");
      const { fields, setup } = await setupFields(pool, record(ctx.json()), project, true);
      fields.done();
      return tx(async (client) => {
        const closesAt = setup.closesAtLocal ? localToUtc(setup.closesAtLocal, project.timeZone) : null;
        const created = await one<{ id: string }>(client,
          `INSERT INTO tenders (project_id, title, scope, closes_at, closes_at_local, contingency_basis_points, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft') RETURNING id`,
          [project.id, setup.title, setup.scope, closesAt?.toISOString() ?? null, setup.closesAtLocal ?? null, setup.basisPoints]);
        await writeBidders(client, created?.id ?? "", setup.bidders ?? []);
        const view = await access(client, member, created?.id ?? "");
        return ok({ tender: await studioJson(client, view) }, 201);
      });
    },
  },
  {
    method: "GET", path: "/api/projects/:id/tenders", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      const project = await visibleProject(pool, member, ctx.params.id);
      const list = await rows<{ id: string }>(pool, "SELECT id FROM tenders WHERE project_id = $1 ORDER BY created_at", [project.id]);
      const tenders = [];
      for (const { id } of list) {
        const view = await access(pool, member, id).catch(() => null);
        if (view) tenders.push(isStudio(member) ? await studioJson(pool, view) : summaryJson(view));
      }
      return ok({ tenders });
    },
  },
  {
    method: "GET", path: "/api/tenders/:id", auth: "member",
    handler: async (ctx) => {
      const view = await access(pool, ctx.me, ctx.params.id);
      if (!isStudio(ctx.me)) requireRole(ctx.me, "contractor");
      return ok({ tender: await tenderJson(pool, ctx.me, view) });
    },
  },
  {
    method: "PATCH", path: "/api/tenders/:id", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const view = await studioAccess(client, member, ctx.params.id, true);
        const body = record(ctx.json());
        assertPatch(view.status, Object.keys(body));
        const { fields, setup } = await setupFields(client, body, view.project, false);
        const closesAt = setup.closesAtLocal ? localToUtc(setup.closesAtLocal, view.project.timeZone) : null;
        if (view.status === "open" && !fields.has("closesAtLocal")) {
          if (!closesAt) fields.fail("closesAtLocal", "Close date and time is required.");
          else if (closesAt.getTime() <= Date.now()) fields.fail("closesAtLocal", CLOSE_AFTER_NOW);
        }
        fields.done();
        const { tender } = view;
        await client.query(
          `UPDATE tenders SET title = $2, scope = $3, closes_at = $4, closes_at_local = $5, contingency_basis_points = $6,
             ics_sequence = ics_sequence + $7 WHERE id = $1`,
          [tender.id, setup.title ?? tender.title, setup.scope ?? tender.scope,
            "closesAtLocal" in setup ? closesAt?.toISOString() ?? null : tender.closes_at?.toISOString() ?? null,
            "closesAtLocal" in setup ? setup.closesAtLocal : tender.closes_at_local, setup.basisPoints ?? tender.contingency_basis_points,
            view.status === "open" ? 1 : 0]);
        if (setup.bidders) await writeBidders(client, tender.id, setup.bidders);
        const saved = await access(client, member, tender.id);
        if (view.status === "open" && closesAt) await sendTenderMail(client, saved.tender, saved.project, closesAt, true);
        return ok({ tender: await studioJson(client, saved) });
      });
    },
  },
  {
    method: "POST", path: "/api/tenders/:id/publish", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const view = await studioAccess(client, member, ctx.params.id, true);
        assertPublish(view.status);
        const fields = new Fields({});
        const count = Number((await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM tender_bidders WHERE tender_id = $1", [view.tender.id]))?.n);
        const closesAt = view.tender.closes_at;
        if (count < 1 || count > MAX_BIDDERS) fields.fail("bidders", `A tender needs 1 to ${MAX_BIDDERS} bidders.`);
        if (closesAt === null) {
          fields.fail("closesAtLocal", "Close date and time is required.");
          throw validation(fields.errors);
        }
        if (closesAt.getTime() <= Date.now()) fields.fail("closesAtLocal", CLOSE_AFTER_NOW);
        fields.done();
        await client.query("UPDATE tenders SET status = 'open' WHERE id = $1", [view.tender.id]);
        const saved = await access(client, member, view.tender.id);
        await sendTenderMail(client, saved.tender, saved.project, closesAt, false);
        return ok({ tender: await studioJson(client, saved) });
      });
    },
  },
  {
    method: "POST", path: "/api/tenders/:id/bid", auth: "member",
    handler: (ctx) => submitBid(ctx, false),
  },
  {
    method: "PUT", path: "/api/tenders/:id/bid", auth: "member",
    handler: (ctx) => submitBid(ctx, true),
  },
  {
    method: "GET", path: "/api/tenders/:id/bid", auth: "member",
    handler: async (ctx) => {
      const view = await access(pool, ctx.me, ctx.params.id);
      if (!view.bidder) throw forbidden();
      const bid = await one<BidRow>(pool, "SELECT * FROM bids WHERE bidder_id = $1", [view.bidder.id]);
      return ok({ bid: bid ? bidJson(bid) : null });
    },
  },
  {
    method: "POST", path: "/api/tenders/:id/open-bids", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const view = await studioAccess(client, member, ctx.params.id, true);
        assertOpenBids(view.tender);
        await client.query("UPDATE tenders SET status = 'opened' WHERE id = $1", [view.tender.id]);
        return ok({ tender: await studioJson(client, await access(client, member, view.tender.id)) });
      });
    },
  },
  {
    method: "GET", path: "/api/tenders/:id/levelling", auth: "member",
    handler: async (ctx) => {
      const view = await access(pool, ctx.me, ctx.params.id);
      requireRole(ctx.me, "director", "project_lead", "designer", "finance");
      assertLevellingVisible(view.status);
      const bids = await levelledBids(pool, view.tender);
      return ok({ contingencyPercent: percentText(view.tender.contingency_basis_points), currency: view.project.currency, bids: bids.map(levelledJson) });
    },
  },
  {
    method: "GET", path: "/api/tenders/:id/levelling.csv", auth: "member",
    handler: async (ctx) => {
      const view = await access(pool, ctx.me, ctx.params.id);
      requireRole(ctx.me, "director", "project_lead", "designer", "finance");
      assertLevellingVisible(view.status);
      const bids = (await levelledBids(pool, view.tender)).sort((a, b) => a.rank - b.rank);
      const file = csvFile(
        ["rank", "bidder_reference", "company", "base", "provisional_sums", "allowances", "priced_exclusions", "unpriced_exclusions",
          "subtotal", "contingency", "levelled_total", "final_submission", "provisional_sum_labels", "exclusion_labels"],
        bids.map((bid) => [figure(bid.rank), bid.reference, bid.companyName, figure(plainAmount(bid.baseCents)),
          figure(plainAmount(bid.provisionalSumsCents)), figure(plainAmount(bid.allowancesCents)), figure(plainAmount(bid.pricedExclusionsCents)),
          figure(bid.unpricedExclusions), figure(plainAmount(bid.subtotalCents)), figure(plainAmount(bid.contingencyCents)),
          figure(plainAmount(bid.levelledTotalCents)), figure(formatTime(bid.finalSubmittedAt, view.project.timeZone)),
          bid.provisionalSums.map((sum) => sum.label).join("; "), bid.exclusions.map((exclusion) => exclusion.label).join("; ")]));
      return { status: 200, body: `﻿${file}`, headers: csvHeaders(`levelling-${view.project.reference}.csv`) };
    },
  },
  {
    method: "PATCH", path: "/api/bids/:id/levelling", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const bid = await one<BidRow & { tender_id: string }>(client, "SELECT * FROM bids WHERE id = $1 FOR UPDATE", [knownId(ctx.params.id)]);
        if (!bid) throw notFound();
        const view = await studioAccess(client, member, bid.tender_id);
        assertOpened(view.status, "level");
        const body = record(ctx.json());
        const fields = new Fields(body);
        const allowanceList = Array.isArray(body.allowances) ? body.allowances.map(record) : [];
        const allowances = allowanceList.map((item, index) => ({
          label: fields.text(`allowances[${index}].label`, "Allowance label", { max: 120 }, item.label),
          amountCents: fields.cents(`allowances[${index}].amountCents`, "Allowance amount", { min: 1, max: MAX_CENTS }, item.amountCents),
        }));
        const prices = new Map<string, number | null>();
        const priceList = Array.isArray(body.exclusionPrices) ? body.exclusionPrices.map(record) : [];
        priceList.forEach((item, index) => {
          const field = `exclusionPrices[${index}].priceCents`;
          const exclusion = bid.exclusions.find((e) => e.id === item.exclusionId);
          if (!exclusion) {
            fields.fail(`exclusionPrices[${index}].exclusionId`, "Choose one of this bid's exclusions.");
            return;
          }
          if (item.priceCents === null || item.priceCents === undefined || item.priceCents === "") {
            prices.set(exclusion.id, null);
            return;
          }
          if (item.priceCents === 0) fields.fail(field, "Price this exclusion above zero.");
          else prices.set(exclusion.id, fields.cents(field, `Price for ${exclusion.label}`, { min: 1, max: MAX_CENTS }, item.priceCents));
        });
        fields.done();
        const exclusions = bid.exclusions.map((e) => {
          const price = prices.get(e.id);
          return price === undefined ? e : { ...e, priceCents: price };
        });
        await client.query("UPDATE bids SET allowances = $2, exclusions = $3 WHERE id = $1", [bid.id, JSON.stringify(allowances), JSON.stringify(exclusions)]);
        const levelled = (await levelledBids(client, view.tender)).find((b) => b.id === bid.id);
        return ok({ bid: levelled && levelledJson(levelled) });
      });
    },
  },
  {
    method: "POST", path: "/api/tenders/:id/award", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const view = await studioAccess(client, member, ctx.params.id, true);
        assertOpened(view.status, "award");
        const locked = await loadProject(client, view.project.id, true);
        if (locked?.contract) throw conflict("contract_exists");
        const bids = await levelledBids(client, view.tender);
        const unpriced = bids.reduce((sum, bid) => sum + bid.unpricedExclusions, 0);
        if (unpriced > 0) throw conflict("unpriced_exclusions", { count: unpriced });
        const body = record(ctx.json());
        const fields = new Fields(body);
        const chosen = bids.find((bid) => bid.id === body.bidId);
        if (!chosen) fields.fail("bidId", "Choose a bid to award.");
        const reason = typeof body.reason === "string" && body.reason.trim() ? fields.text("reason", "Reason for not awarding the lowest", { max: 1000 }) : "";
        if (chosen && chosen.rank !== 1 && !reason) fields.fail("reason", "Give a reason for not awarding the lowest levelled bid.");
        fields.done();
        const winner = chosen as LevelledBid;
        const bidder = await one<{ company_id: string }>(client, "SELECT b.company_id FROM bids d JOIN tender_bidders b ON b.id = d.bidder_id WHERE d.id = $1", [winner.id]);
        await client.query("INSERT INTO contracts (project_id, company_id, contract_sum_cents) VALUES ($1, $2, $3)",
          [view.project.id, bidder?.company_id, winner.baseCents]);
        await client.query("UPDATE tenders SET status = 'awarded', awarded_bid_id = $2, award_reason = $3 WHERE id = $1",
          [view.tender.id, winner.id, reason || null]);
        const saved = await access(client, member, view.tender.id);
        return ok({ tender: await studioJson(client, saved), contract: { companyName: winner.companyName, contractSumCents: winner.baseCents } });
      });
    },
  },
  {
    method: "POST", path: "/api/tender-links/consume", auth: "public",
    handler: async (ctx) => {
      const body = record(ctx.json());
      if (typeof body.token !== "string" || !body.token) throw notFound();
      const link = await one<{ tender_id: string; member_id: string }>(pool,
        `UPDATE tender_links SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING tender_id, member_id`, [tokenHash(body.token)]);
      if (!link) throw notFound();
      return ok({ tenderId: link.tender_id }, 200, { "Set-Cookie": await startSession(pool, link.member_id) });
    },
  },
];

/** The tender sign-in page names its tender without using the link. */
export const pages: PageRule[] = [{
  path: "/tender-sign-in/:token",
  exists: async () => true,
  meta: async (params): Promise<Record<string, string>> => {
    const found = await one<{ title: string }>(pool,
      "SELECT t.title FROM tender_links l JOIN tenders t ON t.id = l.tender_id WHERE l.token_hash = $1", [tokenHash(params.token)]);
    return found ? { "tender-title": found.title } : {};
  },
}];
