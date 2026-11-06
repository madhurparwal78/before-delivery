import { randomBytes } from 'node:crypto';
import { isStudioRole, type TenderStatus } from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { centsToDecimal, formatInstant } from '../../shared/format.js';
import { instantOfWallClock, parseWallClockSeconds, wallClockString } from '../../shared/zoned.js';
import { config } from '../config.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import { projectContract, requireProject, requireUuid, type ProjectRecord } from '../domain/access.js';
import { csvDocument, raw as csvRaw, text as csvText } from '../domain/csv.js';
import { assignRanks, levelBid } from '../domain/levelling.js';
import { MAX_CENTS } from '../domain/money.js';
import { tenderAllows } from '../domain/transitions.js';
import { asArray, asRecord, Fields, parsePercent } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import { conflict, forbidden, illegalTransition, notFound, validation } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { sessionCookie, startSession, type Member } from '../http/session.js';
import { tenderCloseIcs } from '../services/ics.js';
import { nudgeMailDelivery, queueMail } from '../services/mail.js';

const MAX_BIDDERS = 12;
const MAX_PROVISIONAL_SUMS = 50;
const MAX_EXCLUSIONS = 50;

interface TenderRow {
  id: string;
  project_id: string;
  title: string;
  scope: string;
  closes_at: string | null;
  contingency_percent: string;
  status: TenderStatus;
  ics_sequence: number;
  awarded_bid_id: string | null;
  award_reason: string | null;
}

const TENDER_SELECT = `
  SELECT id, project_id, title, scope, closes_at, contingency_percent, status, ics_sequence,
         awarded_bid_id, award_reason
    FROM tenders`;

/** A tender counts as closed from its close instant onward. */
function effectiveStatus(row: TenderRow, now: Date): TenderStatus {
  if (row.status === 'open' && row.closes_at && new Date(row.closes_at).getTime() <= now.getTime()) {
    return 'closed';
  }
  return row.status;
}

interface BidderRow {
  id: string;
  reference: string;
  company_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  member_id: string | null;
  ord: number;
}

const BIDDER_SELECT = `
  SELECT tb.id, tb.reference, tb.company_id, c.name AS company_name, tb.contact_name,
         tb.contact_email, tb.member_id, tb.ord
    FROM tender_bidders tb JOIN companies c ON c.id = tb.company_id`;

async function biddersOf(client: Queryable, tenderId: string): Promise<BidderRow[]> {
  return rows<BidderRow>(client, `${BIDDER_SELECT} WHERE tb.tender_id = $1 ORDER BY tb.ord`, [
    tenderId,
  ]);
}

interface BidRow {
  id: string;
  bidder_id: string;
  base_cents: number;
  final_submitted_at: string;
  amendments: number;
}

async function bidParts(
  client: Queryable,
  bidId: string,
): Promise<{
  provisionalSums: { label: string; amountCents: number }[];
  allowances: { label: string; amountCents: number }[];
  exclusions: { id: string; label: string; priceCents: number | null }[];
}> {
  const provisionalSums = (
    await rows<{ label: string; amount_cents: number }>(
      client,
      'SELECT label, amount_cents FROM bid_provisional_sums WHERE bid_id = $1 ORDER BY ord',
      [bidId],
    )
  ).map((row) => ({ label: row.label, amountCents: row.amount_cents }));
  const allowances = (
    await rows<{ label: string; amount_cents: number }>(
      client,
      'SELECT label, amount_cents FROM bid_allowances WHERE bid_id = $1 ORDER BY ord',
      [bidId],
    )
  ).map((row) => ({ label: row.label, amountCents: row.amount_cents }));
  const exclusions = (
    await rows<{ id: string; label: string; price_cents: number | null }>(
      client,
      'SELECT id, label, price_cents FROM bid_exclusions WHERE bid_id = $1 ORDER BY ord',
      [bidId],
    )
  ).map((row) => ({ id: row.id, label: row.label, priceCents: row.price_cents }));
  return { provisionalSums, allowances, exclusions };
}

async function bidPayload(client: Queryable, row: BidRow): Promise<unknown> {
  const parts = await bidParts(client, row.id);
  return {
    id: row.id,
    baseCents: row.base_cents,
    provisionalSums: parts.provisionalSums,
    exclusions: parts.exclusions.map((entry) => ({ id: entry.id, label: entry.label })),
    finalSubmittedAt: new Date(row.final_submitted_at).toISOString(),
    amendments: row.amendments,
  };
}

async function loadTender(client: Queryable, tenderId: string): Promise<TenderRow> {
  const row = await firstRow<TenderRow>(client, `${TENDER_SELECT} WHERE id = $1`, [
    requireUuid(tenderId),
  ]);
  if (!row) throw notFound();
  return row;
}

interface TenderScope {
  member: Member;
  project: ProjectRecord;
  tender: TenderRow;
  status: TenderStatus;
  bidder: BidderRow | null;
}

/** The tender the caller may see: studio roles, or a contractor invited to it. */
async function tenderScope(
  member: Member,
  tenderId: string,
  now: Date,
): Promise<TenderScope> {
  const tender = await loadTender(pool, tenderId);
  const project = await requireProject(pool, tender.project_id, member);
  const status = effectiveStatus(tender, now);
  if (isStudioRole(member.role)) {
    return { member, project, tender, status, bidder: null };
  }
  if (member.role !== 'contractor' || tender.status === 'draft') throw notFound();
  const bidder = await firstRow<BidderRow>(
    pool,
    `${BIDDER_SELECT} WHERE tb.tender_id = $1 AND tb.company_id = $2`,
    [tender.id, member.companyId],
  );
  if (!bidder) throw notFound();
  return { member, project, tender, status, bidder };
}

async function studioTenderPayload(scope: TenderScope): Promise<unknown> {
  const { tender, project, status } = scope;
  const bidders = await biddersOf(pool, tender.id);
  const withBids = await Promise.all(
    bidders.map(async (bidder) => {
      const bid = await firstRow<BidRow>(
        pool,
        'SELECT id, bidder_id, base_cents, final_submitted_at, amendments FROM bids WHERE bidder_id = $1',
        [bidder.id],
      );
      return {
        reference: bidder.reference,
        companyName: bidder.company_name,
        contactName: bidder.contact_name,
        contactEmail: bidder.contact_email,
        hasBid: bid !== null,
        finalSubmittedAt: bid ? new Date(bid.final_submitted_at).toISOString() : null,
      };
    }),
  );
  return {
    id: tender.id,
    title: tender.title,
    scope: tender.scope,
    project: { id: project.id, reference: project.reference, name: project.name },
    closesAt: tender.closes_at ? new Date(tender.closes_at).toISOString() : null,
    closesAtLocal: tender.closes_at
      ? wallClockString(new Date(tender.closes_at), project.timeZone)
      : null,
    timeZone: project.timeZone,
    status,
    contingencyPercent: tender.contingency_percent,
    icsSequence: tender.ics_sequence,
    bidders: withBids,
    awardedBidId: tender.awarded_bid_id,
  };
}

async function contractorTenderPayload(scope: TenderScope): Promise<unknown> {
  const { tender, project, status, bidder } = scope;
  const bid = bidder
    ? await firstRow<BidRow>(
        pool,
        'SELECT id, bidder_id, base_cents, final_submitted_at, amendments FROM bids WHERE bidder_id = $1',
        [bidder.id],
      )
    : null;
  return {
    id: tender.id,
    title: tender.title,
    scope: tender.scope,
    project: { id: project.id, reference: project.reference, name: project.name },
    closesAt: tender.closes_at ? new Date(tender.closes_at).toISOString() : null,
    closesAtLocal: tender.closes_at
      ? wallClockString(new Date(tender.closes_at), project.timeZone)
      : null,
    timeZone: project.timeZone,
    status,
    myBid: bid ? await bidPayload(pool, bid) : null,
  };
}

interface BidderInput {
  companyName: string;
  contactName: string;
  contactEmail: string;
}

async function readBidders(
  fields: Fields,
  value: unknown,
): Promise<BidderInput[]> {
  const list = asArray(value);
  if (list.length < 1 || list.length > MAX_BIDDERS) {
    fields.add('bidders', fieldErrorCopy.outOfRange('Bidders', '1', String(MAX_BIDDERS)));
  }
  const bidders = list.map((entry, index) => {
    const record = asRecord(entry);
    return {
      companyName: fields.text(`bidders[${index}].companyName`, record.companyName, {
        label: 'Company name',
        max: 120,
        oneLine: true,
      }),
      contactName: fields.text(`bidders[${index}].contactName`, record.contactName, {
        label: 'Contact name',
        max: 120,
        oneLine: true,
      }),
      contactEmail: fields.email(`bidders[${index}].contactEmail`, record.contactEmail),
    };
  });
  for (const [index, bidder] of bidders.entries()) {
    if (bidder.contactEmail === '') continue;
    const existing = await firstRow<{ role: string }>(
      pool,
      'SELECT role FROM members WHERE lower(email) = lower($1)',
      [bidder.contactEmail],
    );
    if (existing && existing.role !== 'contractor') {
      fields.add(`bidders[${index}].contactEmail`, fieldErrorCopy.badEmail());
    }
  }
  return bidders;
}

async function companyIdFor(client: Queryable, name: string): Promise<string> {
  const existing = await firstRow<{ id: string }>(
    client,
    'SELECT id FROM companies WHERE lower(name) = lower($1)',
    [name],
  );
  if (existing) return existing.id;
  const created = await rows<{ id: string }>(
    client,
    `INSERT INTO companies (id, name) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = companies.name RETURNING id`,
    [newId(), name],
  );
  const id = created[0]?.id;
  if (!id) throw new Error('Company could not be recorded');
  return id;
}

/** Finds, or creates with no password, the contractor member who bids by link. */
async function bidderMemberId(
  client: Queryable,
  bidder: BidderInput,
  companyId: string,
): Promise<string> {
  const existing = await firstRow<{ id: string }>(
    client,
    'SELECT id FROM members WHERE lower(email) = lower($1)',
    [bidder.contactEmail],
  );
  if (existing) return existing.id;
  const id = newId();
  await client.query(
    `INSERT INTO members (id, name, email, role, company_id, updated_by)
     VALUES ($1, $2, $3, 'contractor', $4, $1)`,
    [id, bidder.contactName, bidder.contactEmail, companyId],
  );
  return id;
}

async function writeBidders(
  client: Queryable,
  tenderId: string,
  bidders: readonly BidderInput[],
): Promise<void> {
  await client.query('DELETE FROM tender_bidders WHERE tender_id = $1', [tenderId]);
  for (const [index, bidder] of bidders.entries()) {
    const companyId = await companyIdFor(client, bidder.companyName);
    await client.query(
      `INSERT INTO tender_bidders (id, tender_id, reference, company_id, contact_name,
                                   contact_email, member_id, ord)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(),
        tenderId,
        `B-${String(index + 1).padStart(2, '0')}`,
        companyId,
        bidder.contactName,
        bidder.contactEmail,
        await bidderMemberId(client, bidder, companyId),
        index,
      ],
    );
  }
}

/** Queues one message per bidder, each with its own single-use sign-in link. */
async function sendTenderInvitations(
  client: Queryable,
  options: {
    tender: TenderRow;
    project: ProjectRecord;
    closesAt: Date;
    sequence: number;
    moved: boolean;
  },
): Promise<number> {
  const bidders = await biddersOf(client, options.tender.id);
  const calendar = {
    fileName: 'tender-close.ics',
    content: tenderCloseIcs({
      tenderId: options.tender.id,
      tenderTitle: options.tender.title,
      closesAt: options.closesAt,
      sequence: options.sequence,
    }),
  };
  const lifetimeMinutes = Math.round(config.tenderLinkTtlSeconds / 60);
  const closeText = formatInstant(options.closesAt, options.project.timeZone);

  for (const bidder of bidders) {
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO tender_links (id, token, tender_id, member_id, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
      [
        newId(),
        token,
        options.tender.id,
        bidder.member_id,
        String(config.tenderLinkTtlSeconds),
      ],
    );
    const link = `${config.baseUrl}/tender-sign-in/${token}`;
    const body = options.moved
      ? [
          `The close of ${options.tender.title} has moved.`,
          '',
          `Project: ${options.project.reference} ${options.project.name}`,
          `New close: ${closeText}`,
          '',
          'Sign in to review or amend your bid:',
          link,
          '',
          `The sign-in link works once and lasts ${lifetimeMinutes} minutes.`,
        ].join('\n')
      : [
          `${bidder.company_name} is invited to tender for ${options.tender.title}.`,
          '',
          `Project: ${options.project.reference} ${options.project.name}`,
          `Close: ${closeText}`,
          '',
          'Scope',
          options.tender.scope,
          '',
          'Sign in to bid:',
          link,
          '',
          `The sign-in link works once and lasts ${lifetimeMinutes} minutes.`,
        ].join('\n');

    await queueMail(client, {
      to: bidder.contact_email,
      subject: options.moved
        ? `Tender close moved: ${options.tender.title}`
        : `Invitation to tender: ${options.tender.title} for ${bidder.company_name}`,
      body,
      calendar,
    });
  }
  return bidders.length;
}

function readCloseLocal(
  fields: Fields,
  value: unknown,
  project: ProjectRecord,
  now: Date,
): Date | null {
  if (typeof value !== 'string' || value === '') {
    fields.add('closesAtLocal', fieldErrorCopy.required('Close date and time'));
    return null;
  }
  const wall = parseWallClockSeconds(value);
  if (!wall) {
    fields.add('closesAtLocal', fieldErrorCopy.required('Close date and time'));
    return null;
  }
  const instant = instantOfWallClock(wall, project.timeZone);
  if (instant.getTime() <= now.getTime()) {
    fields.add('closesAtLocal', fieldErrorCopy.closeNotAfterNow());
    return null;
  }
  return instant;
}

interface LevelledBid {
  id: string;
  reference: string;
  companyName: string;
  baseCents: number;
  provisionalSums: { label: string; amountCents: number }[];
  provisionalSumsCents: number;
  allowances: { label: string; amountCents: number }[];
  allowancesCents: number;
  exclusions: { id: string; label: string; priceCents: number | null }[];
  pricedExclusionsCents: number;
  unpricedExclusions: number;
  subtotalCents: number;
  contingencyCents: number;
  levelledTotalCents: number;
  finalSubmittedAt: string;
  rank: number;
}

async function levellingOf(
  client: Queryable,
  tender: TenderRow,
): Promise<LevelledBid[]> {
  const bidders = await biddersOf(client, tender.id);
  const unranked = [];
  for (const bidder of bidders) {
    const bid = await firstRow<BidRow>(
      client,
      'SELECT id, bidder_id, base_cents, final_submitted_at, amendments FROM bids WHERE bidder_id = $1',
      [bidder.id],
    );
    if (!bid) continue;
    const parts = await bidParts(client, bid.id);
    const figures = levelBid(
      {
        baseCents: bid.base_cents,
        provisionalSums: parts.provisionalSums,
        allowances: parts.allowances,
        exclusions: parts.exclusions,
      },
      tender.contingency_percent,
    );
    unranked.push({
      id: bid.id,
      reference: bidder.reference,
      companyName: bidder.company_name,
      baseCents: bid.base_cents,
      ...parts,
      ...figures,
      finalSubmittedAt: new Date(bid.final_submitted_at).toISOString(),
    });
  }
  return assignRanks(unranked).sort((left, right) => left.rank - right.rank);
}

export function registerTenderRoutes(router: Router): void {
  router.post('/api/projects/:id/tenders', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const project = await requireProject(pool, context.param('id'), member);
    const body = await context.json();
    const now = new Date();

    const fields = new Fields();
    const title = fields.text('title', body.title, { label: 'Tender title', max: 120, oneLine: true });
    const scope = fields.text('scope', body.scope, { label: 'Scope', max: 4000 });
    const percent = parsePercent(body.contingencyPercent, 25);
    if (percent === null) {
      fields.add('contingencyPercent', fieldErrorCopy.outOfRange('Contingency percent', '0', '25'));
    }
    const closesAt =
      body.closesAtLocal === undefined || body.closesAtLocal === null
        ? null
        : readCloseLocal(fields, body.closesAtLocal, project, now);
    const bidders = await readBidders(fields, body.bidders);
    fields.finish();

    const tenderId = newId();
    await transact(async (client) => {
      await client.query(
        `INSERT INTO tenders (id, project_id, title, scope, closes_at, contingency_percent, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
        [tenderId, project.id, title, scope, closesAt, percent ?? '0'],
      );
      await writeBidders(client, tenderId, bidders);
    });

    const scope2 = await tenderScope(member, tenderId, now);
    return jsonReply(201, { tender: await studioTenderPayload(scope2) });
  });

  router.get('/api/projects/:id/tenders', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await requireProject(pool, context.param('id'), member);
    const now = new Date();
    const found = await rows<TenderRow>(
      pool,
      `${TENDER_SELECT} WHERE project_id = $1 ORDER BY created_at`,
      [project.id],
    );
    const studio = isStudioRole(member.role);
    const payload: unknown[] = [];
    for (const tender of found) {
      const scope = { member, project, tender, status: effectiveStatus(tender, now), bidder: null };
      if (studio) {
        payload.push(await studioTenderPayload(scope));
        continue;
      }
      if (tender.status === 'draft') continue;
      const bidder = await firstRow<BidderRow>(
        pool,
        `${BIDDER_SELECT} WHERE tb.tender_id = $1 AND tb.company_id = $2`,
        [tender.id, member.companyId],
      );
      if (!bidder) continue;
      payload.push(await contractorTenderPayload({ ...scope, bidder }));
    }
    return jsonReply(200, { tenders: payload });
  });

  router.get('/api/tenders/:id', async (context): Promise<Reply> => {
    const member = await context.member();
    const scope = await tenderScope(member, context.param('id'), new Date());
    return jsonReply(200, {
      tender: isStudioRole(member.role)
        ? await studioTenderPayload(scope)
        : await contractorTenderPayload(scope),
    });
  });

  router.patch('/api/tenders/:id', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const now = new Date();
    const scope = await tenderScope(member, context.param('id'), now);
    const body = await context.json();

    if (scope.status === 'draft') {
      const fields = new Fields();
      const title =
        body.title === undefined
          ? scope.tender.title
          : fields.text('title', body.title, { label: 'Tender title', max: 120, oneLine: true });
      const tenderScopeText =
        body.scope === undefined
          ? scope.tender.scope
          : fields.text('scope', body.scope, { label: 'Scope', max: 4000 });
      let percent = scope.tender.contingency_percent;
      if (body.contingencyPercent !== undefined) {
        const parsed = parsePercent(body.contingencyPercent, 25);
        if (parsed === null) {
          fields.add('contingencyPercent', fieldErrorCopy.outOfRange('Contingency percent', '0', '25'));
        } else {
          percent = parsed;
        }
      }
      const closesAt =
        body.closesAtLocal === undefined
          ? scope.tender.closes_at
            ? new Date(scope.tender.closes_at)
            : null
          : readCloseLocal(fields, body.closesAtLocal, scope.project, now);
      const bidders =
        body.bidders === undefined ? null : await readBidders(fields, body.bidders);
      fields.finish();

      await transact(async (client) => {
        await client.query(
          `UPDATE tenders SET title = $2, scope = $3, contingency_percent = $4, closes_at = $5
            WHERE id = $1`,
          [scope.tender.id, title, tenderScopeText, percent, closesAt],
        );
        if (bidders) await writeBidders(client, scope.tender.id, bidders);
      });
      const after = await tenderScope(member, scope.tender.id, now);
      return jsonReply(200, { tender: await studioTenderPayload(after) });
    }

    if (scope.status === 'open') {
      if (!tenderAllows(scope.status, 'move_close')) {
        throw illegalTransition(scope.status, 'move_close');
      }
      const fields = new Fields();
      const closesAt = readCloseLocal(fields, body.closesAtLocal, scope.project, now);
      fields.finish();
      if (!closesAt) throw illegalTransition(scope.status, 'move_close');

      const sequence = scope.tender.ics_sequence + 1;
      const count = await transact(async (client) => {
        await client.query('UPDATE tenders SET closes_at = $2, ics_sequence = $3 WHERE id = $1', [
          scope.tender.id,
          closesAt,
          sequence,
        ]);
        return sendTenderInvitations(client, {
          tender: scope.tender,
          project: scope.project,
          closesAt,
          sequence,
          moved: true,
        });
      });
      nudgeMailDelivery();
      const after = await tenderScope(member, scope.tender.id, now);
      return jsonReply(200, {
        tender: await studioTenderPayload(after),
        invitationsSent: count,
      });
    }

    if (scope.status === 'opened') {
      const fields = new Fields();
      const parsed = parsePercent(body.contingencyPercent, 25);
      if (parsed === null) {
        fields.add('contingencyPercent', fieldErrorCopy.outOfRange('Contingency percent', '0', '25'));
      }
      fields.finish();
      await pool.query('UPDATE tenders SET contingency_percent = $2 WHERE id = $1', [
        scope.tender.id,
        parsed,
      ]);
      const after = await tenderScope(member, scope.tender.id, now);
      return jsonReply(200, { tender: await studioTenderPayload(after) });
    }

    throw illegalTransition(scope.status, 'edit_setup');
  });

  router.post('/api/tenders/:id/publish', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const now = new Date();
    const scope = await tenderScope(member, context.param('id'), now);
    if (!tenderAllows(scope.status, 'publish')) throw illegalTransition(scope.status, 'publish');

    const bidders = await biddersOf(pool, scope.tender.id);
    if (bidders.length < 1 || bidders.length > MAX_BIDDERS) {
      throw validation({
        bidders: fieldErrorCopy.outOfRange('Bidders', '1', String(MAX_BIDDERS)),
      });
    }
    const closesAt = scope.tender.closes_at ? new Date(scope.tender.closes_at) : null;
    if (!closesAt || closesAt.getTime() <= now.getTime()) {
      throw validation({ closesAtLocal: fieldErrorCopy.closeNotAfterNow() });
    }

    const count = await transact(async (client) => {
      const updated = await rows(
        client,
        `UPDATE tenders SET status = 'open', ics_sequence = 0
          WHERE id = $1 AND status = 'draft' RETURNING id`,
        [scope.tender.id],
      );
      if (updated.length === 0) throw illegalTransition(scope.status, 'publish');
      return sendTenderInvitations(client, {
        tender: scope.tender,
        project: scope.project,
        closesAt,
        sequence: 0,
        moved: false,
      });
    });
    nudgeMailDelivery();

    const after = await tenderScope(member, scope.tender.id, now);
    return jsonReply(200, {
      tender: await studioTenderPayload(after),
      invitationsSent: count,
    });
  });

  router.get('/api/tenders/:id/bid', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('contractor');
    const scope = await tenderScope(member, context.param('id'), new Date());
    if (!scope.bidder) throw notFound();
    const bid = await firstRow<BidRow>(
      pool,
      'SELECT id, bidder_id, base_cents, final_submitted_at, amendments FROM bids WHERE bidder_id = $1',
      [scope.bidder.id],
    );
    return jsonReply(200, { bid: bid ? await bidPayload(pool, bid) : null });
  });

  router.post('/api/tenders/:id/bid', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('contractor');
    const now = new Date();
    const scope = await tenderScope(member, context.param('id'), now);
    if (!scope.bidder) throw notFound();

    const existing = await firstRow<{ id: string }>(pool, 'SELECT id FROM bids WHERE bidder_id = $1', [
      scope.bidder.id,
    ]);
    if (existing) throw conflict('bid_exists');
    refuseLateBid(scope);

    const parsed = await readBid(context);
    const bidId = newId();
    await transact(async (client) => {
      await client.query(
        `INSERT INTO bids (id, tender_id, bidder_id, base_cents, final_submitted_at)
         VALUES ($1, $2, $3, $4, now())`,
        [bidId, scope.tender.id, scope.bidder?.id, parsed.baseCents],
      );
      await writeBidParts(client, bidId, parsed);
    });

    const bid = await firstRow<BidRow>(
      pool,
      'SELECT id, bidder_id, base_cents, final_submitted_at, amendments FROM bids WHERE id = $1',
      [bidId],
    );
    if (!bid) throw notFound();
    return jsonReply(201, { bid: await bidPayload(pool, bid) });
  });

  router.put('/api/tenders/:id/bid', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('contractor');
    const now = new Date();
    const scope = await tenderScope(member, context.param('id'), now);
    if (!scope.bidder) throw notFound();
    const existing = await firstRow<{ id: string }>(pool, 'SELECT id FROM bids WHERE bidder_id = $1', [
      scope.bidder.id,
    ]);
    if (!existing) throw notFound();
    refuseLateBid(scope);

    const parsed = await readBid(context);
    await transact(async (client) => {
      await client.query(
        `UPDATE bids SET base_cents = $2, final_submitted_at = now(), amendments = amendments + 1
          WHERE id = $1`,
        [existing.id, parsed.baseCents],
      );
      await client.query('DELETE FROM bid_provisional_sums WHERE bid_id = $1', [existing.id]);
      await client.query('DELETE FROM bid_exclusions WHERE bid_id = $1', [existing.id]);
      await writeBidParts(client, existing.id, parsed);
    });

    const bid = await firstRow<BidRow>(
      pool,
      'SELECT id, bidder_id, base_cents, final_submitted_at, amendments FROM bids WHERE id = $1',
      [existing.id],
    );
    if (!bid) throw notFound();
    return jsonReply(200, { bid: await bidPayload(pool, bid) });
  });

  router.post('/api/tenders/:id/open-bids', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const now = new Date();
    const scope = await tenderScope(member, context.param('id'), now);
    if (scope.status === 'open' && scope.tender.closes_at) {
      throw conflict('tender_still_open', {
        closesAt: new Date(scope.tender.closes_at).toISOString(),
      });
    }
    if (!tenderAllows(scope.status, 'open_bids')) {
      throw illegalTransition(scope.status, 'open_bids');
    }
    await pool.query(`UPDATE tenders SET status = 'opened' WHERE id = $1`, [scope.tender.id]);
    const after = await tenderScope(member, scope.tender.id, now);
    const bids = await levellingOf(pool, after.tender);
    return jsonReply(200, {
      tender: await studioTenderPayload(after),
      openedBids: bids.length,
    });
  });

  router.get('/api/tenders/:id/levelling', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'designer', 'finance');
    const now = new Date();
    const scope = await tenderScope(member, context.param('id'), now);
    if (scope.status !== 'opened' && scope.status !== 'awarded') {
      throw conflict('tender_not_opened');
    }
    return jsonReply(200, {
      contingencyPercent: scope.tender.contingency_percent,
      currency: scope.project.currency,
      bids: await levellingOf(pool, scope.tender),
    });
  });

  router.get('/api/tenders/:id/levelling.csv', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'designer', 'finance');
    const now = new Date();
    const scope = await tenderScope(member, context.param('id'), now);
    if (scope.status !== 'opened' && scope.status !== 'awarded') {
      throw conflict('tender_not_opened');
    }
    const bids = await levellingOf(pool, scope.tender);
    const document = csvDocument(
      [
        'rank',
        'bidder_reference',
        'company',
        'base',
        'provisional_sums',
        'allowances',
        'priced_exclusions',
        'unpriced_exclusions',
        'subtotal',
        'contingency',
        'levelled_total',
        'final_submission',
        'provisional_sum_labels',
        'exclusion_labels',
      ],
      bids.map((bid) => [
        csvRaw(String(bid.rank)),
        csvText(bid.reference),
        csvText(bid.companyName),
        csvRaw(centsToDecimal(bid.baseCents)),
        csvRaw(centsToDecimal(bid.provisionalSumsCents)),
        csvRaw(centsToDecimal(bid.allowancesCents)),
        csvRaw(centsToDecimal(bid.pricedExclusionsCents)),
        csvRaw(String(bid.unpricedExclusions)),
        csvRaw(centsToDecimal(bid.subtotalCents)),
        csvRaw(centsToDecimal(bid.contingencyCents)),
        csvRaw(centsToDecimal(bid.levelledTotalCents)),
        csvRaw(formatInstant(new Date(bid.finalSubmittedAt), scope.project.timeZone)),
        csvText(bid.provisionalSums.map((entry) => entry.label).join('; ')),
        csvText(bid.exclusions.map((entry) => entry.label).join('; ')),
      ]),
    );
    return {
      status: 200,
      bytes: Buffer.from(document, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      headers: { 'Content-Disposition': 'attachment; filename="levelling.csv"' },
    };
  });

  router.patch('/api/bids/:id/levelling', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const bidId = requireUuid(context.param('id'));
    const bid = await firstRow<{ id: string; tender_id: string }>(
      pool,
      'SELECT id, tender_id FROM bids WHERE id = $1',
      [bidId],
    );
    if (!bid) throw notFound();
    const now = new Date();
    const scope = await tenderScope(member, bid.tender_id, now);
    if (scope.status !== 'opened') throw illegalTransition(scope.status, 'level');

    const body = await context.json();
    const fields = new Fields();
    const allowances = asArray(body.allowances).map((entry, index) => {
      const record = asRecord(entry);
      return {
        label: fields.text(`allowances[${index}].label`, record.label, {
          label: 'Allowance label',
          max: 120,
          oneLine: true,
        }),
        amountCents: fields.cents(
          `allowances[${index}].amountCents`,
          record.amountCents,
          'Allowance amount',
          1,
          MAX_CENTS,
        ),
      };
    });

    const exclusions = await rows<{ id: string }>(
      pool,
      'SELECT id FROM bid_exclusions WHERE bid_id = $1',
      [bid.id],
    );
    const prices = asArray(body.exclusionPrices).map((entry, index) => {
      const record = asRecord(entry);
      const exclusionId = typeof record.exclusionId === 'string' ? record.exclusionId : '';
      if (!exclusions.some((exclusion) => exclusion.id === exclusionId)) {
        fields.add(`exclusionPrices[${index}].exclusionId`, fieldErrorCopy.required('Exclusion'));
      }
      if (record.priceCents === 0) {
        fields.add(`exclusionPrices[${index}].priceCents`, fieldErrorCopy.exclusionZero());
        return { exclusionId, priceCents: 0 };
      }
      return {
        exclusionId,
        priceCents: fields.cents(
          `exclusionPrices[${index}].priceCents`,
          record.priceCents,
          'Price',
          1,
          MAX_CENTS,
        ),
      };
    });
    fields.finish();

    await transact(async (client) => {
      await client.query('DELETE FROM bid_allowances WHERE bid_id = $1', [bid.id]);
      for (const [index, allowance] of allowances.entries()) {
        await client.query(
          `INSERT INTO bid_allowances (id, bid_id, label, amount_cents, ord)
           VALUES ($1, $2, $3, $4, $5)`,
          [newId(), bid.id, allowance.label, allowance.amountCents, index],
        );
      }
      for (const price of prices) {
        await client.query('UPDATE bid_exclusions SET price_cents = $2 WHERE id = $1', [
          price.exclusionId,
          price.priceCents,
        ]);
      }
    });

    const levelled = await levellingOf(pool, scope.tender);
    const updated = levelled.find((entry) => entry.id === bid.id);
    if (!updated) throw notFound();
    return jsonReply(200, { bid: updated });
  });

  router.post('/api/tenders/:id/award', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const now = new Date();
    const scope = await tenderScope(member, context.param('id'), now);
    if (!tenderAllows(scope.status, 'award')) throw illegalTransition(scope.status, 'award');

    const body = await context.json();
    const bids = await levellingOf(pool, scope.tender);
    const unpriced = bids.reduce((total, bid) => total + bid.unpricedExclusions, 0);
    if (unpriced > 0) throw conflict('unpriced_exclusions', { count: unpriced });
    if (await projectContract(pool, scope.project.id)) throw conflict('contract_exists');

    const chosen = bids.find((bid) => bid.id === body.bidId);
    if (!chosen) throw validation({ bidId: fieldErrorCopy.required('Bidder') });
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (chosen.rank !== 1 && reason.trim() === '') {
      throw validation({ reason: fieldErrorCopy.awardReasonMissing() });
    }

    const bidder = (await biddersOf(pool, scope.tender.id)).find(
      (entry) => entry.reference === chosen.reference,
    );
    if (!bidder) throw notFound();

    await transact(async (client) => {
      const updated = await rows(
        client,
        `UPDATE tenders SET status = 'awarded', awarded_bid_id = $2, award_reason = $3
          WHERE id = $1 AND status = 'opened' RETURNING id`,
        [scope.tender.id, chosen.id, reason],
      );
      if (updated.length === 0) throw illegalTransition(scope.status, 'award');
      await client.query(
        'INSERT INTO contracts (id, project_id, company_id, contract_sum_cents) VALUES ($1, $2, $3, $4)',
        [newId(), scope.project.id, bidder.company_id, chosen.baseCents],
      );
    });

    const after = await tenderScope(member, scope.tender.id, now);
    return jsonReply(200, {
      tender: await studioTenderPayload(after),
      contract: { companyName: bidder.company_name, contractSumCents: chosen.baseCents },
    });
  });

  router.post('/api/tender-links/consume', async (context): Promise<Reply> => {
    const body = await context.json();
    const token = typeof body.token === 'string' ? body.token : '';
    const claimed = await rows<{ tender_id: string; member_id: string }>(
      pool,
      `UPDATE tender_links SET used_at = now()
        WHERE token = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING tender_id, member_id`,
      [token],
    );
    const link = claimed[0];
    if (!link) throw notFound();
    context.setCookies.push(sessionCookie(await startSession(link.member_id)));
    return jsonReply(200, { tenderId: link.tender_id });
  });
}

function refuseLateBid(scope: TenderScope): void {
  if (scope.status === 'open') return;
  const closesAt = scope.tender.closes_at;
  if (closesAt) {
    throw conflict('tender_closed', { closedAt: new Date(closesAt).toISOString() });
  }
  throw illegalTransition(scope.status, 'bid');
}

interface ParsedBid {
  baseCents: number;
  provisionalSums: { label: string; amountCents: number }[];
  exclusions: { label: string }[];
}

async function readBid(context: { json: () => Promise<Record<string, unknown>> }): Promise<ParsedBid> {
  const body = await context.json();
  const fields = new Fields();
  const baseCents = fields.cents('baseCents', body.baseCents, 'Base amount', 1, MAX_CENTS);

  const provisionalList = asArray(body.provisionalSums);
  if (provisionalList.length > MAX_PROVISIONAL_SUMS) {
    fields.add(
      'provisionalSums',
      fieldErrorCopy.outOfRange('Provisional sums', '0', String(MAX_PROVISIONAL_SUMS)),
    );
  }
  const provisionalSums = provisionalList.map((entry, index) => {
    const record = asRecord(entry);
    return {
      label: fields.text(`provisionalSums[${index}].label`, record.label, {
        label: 'Provisional sum label',
        max: 120,
        oneLine: true,
      }),
      amountCents: fields.cents(
        `provisionalSums[${index}].amountCents`,
        record.amountCents,
        'Provisional sum amount',
        1,
        MAX_CENTS,
      ),
    };
  });
  const provisionalTotal = provisionalSums.reduce((total, entry) => total + entry.amountCents, 0);
  if (provisionalTotal > baseCents) {
    fields.add('provisionalSums', fieldErrorCopy.provisionalSumsOverBase());
  }

  const exclusionList = asArray(body.exclusions);
  if (exclusionList.length > MAX_EXCLUSIONS) {
    fields.add('exclusions', fieldErrorCopy.outOfRange('Exclusions', '0', String(MAX_EXCLUSIONS)));
  }
  const exclusions = exclusionList.map((entry, index) => {
    const record = asRecord(entry);
    return {
      label: fields.text(`exclusions[${index}].label`, record.label, {
        label: 'Exclusion',
        max: 200,
        oneLine: true,
      }),
    };
  });
  fields.finish();
  return { baseCents, provisionalSums, exclusions };
}

async function writeBidParts(
  client: Queryable,
  bidId: string,
  parsed: ParsedBid,
): Promise<void> {
  for (const [index, sum] of parsed.provisionalSums.entries()) {
    await client.query(
      `INSERT INTO bid_provisional_sums (id, bid_id, label, amount_cents, ord)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId(), bidId, sum.label, sum.amountCents, index],
    );
  }
  for (const [index, exclusion] of parsed.exclusions.entries()) {
    await client.query(
      'INSERT INTO bid_exclusions (id, bid_id, label, ord) VALUES ($1, $2, $3, $4)',
      [newId(), bidId, exclusion.label, index],
    );
  }
}
