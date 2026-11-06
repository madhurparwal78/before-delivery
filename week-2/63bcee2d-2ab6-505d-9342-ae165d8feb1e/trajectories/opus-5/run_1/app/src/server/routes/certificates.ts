import { HK_ZONE, type CertificateKind, type Currency } from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { centsToDecimal } from '../../shared/format.js';
import { addDays, dateInZone, parseCalendarDate } from '../../shared/zoned.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import {
  contractorHoldsContract,
  projectContract,
  projectStores,
  requireProject,
  requireUuid,
  type ProjectRecord,
} from '../domain/access.js';
import { csvDocument, raw as csvRaw, text as csvText } from '../domain/csv.js';
import { defectsEndOn } from '../domain/defects.js';
import { MAX_CENTS } from '../domain/money.js';
import { halfReleaseCents, interimCertificate } from '../domain/retention.js';
import { allocateStoreSplit } from '../domain/storeSplit.js';
import { Fields } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import { conflict, illegalTransition, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { Member } from '../http/session.js';
import { retentionHeldCents } from './projects.js';

interface CertificateRow {
  id: string;
  project_id: string;
  number: string;
  kind: CertificateKind;
  period_ending: string | null;
  gross_valuation_cents: number | null;
  valuation_this_period_cents: number | null;
  retention_this_period_cents: number | null;
  retention_held_cents: number;
  amount_due_cents: number;
  currency: Currency;
  issued_by_name: string;
  issued_at: string;
  seq: number;
}

const CERTIFICATE_SELECT = `
  SELECT c.id, c.project_id, c.number, c.kind, c.period_ending, c.gross_valuation_cents,
         c.valuation_this_period_cents, c.retention_this_period_cents, c.retention_held_cents,
         c.amount_due_cents, c.currency, m.name AS issued_by_name, c.issued_at, c.seq
    FROM certificates c JOIN members m ON m.id = c.issued_by`;

async function splitOf(client: Queryable, certificateId: string): Promise<unknown[]> {
  return rows<{
    store_code: string;
    store_name: string;
    weight: number;
    amount_cents: number;
  }>(
    client,
    `SELECT store_code, store_name, weight, amount_cents FROM certificate_splits
      WHERE certificate_id = $1 ORDER BY ord`,
    [certificateId],
  ).then((found) =>
    found.map((row) => ({
      storeCode: row.store_code,
      storeName: row.store_name,
      weight: row.weight,
      amountCents: row.amount_cents,
    })),
  );
}

async function certificatePayload(client: Queryable, row: CertificateRow): Promise<unknown> {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    periodEnding: row.period_ending,
    grossValuationCents: row.gross_valuation_cents,
    valuationThisPeriodCents: row.valuation_this_period_cents,
    retentionThisPeriodCents: row.retention_this_period_cents,
    retentionHeldCents: row.retention_held_cents,
    amountDueCents: row.amount_due_cents,
    currency: row.currency,
    storeSplit: await splitOf(client, row.id),
    issuedBy: row.issued_by_name,
    issuedAt: new Date(row.issued_at).toISOString(),
  };
}

async function certificateScope(
  member: Member,
  projectId: string,
): Promise<ProjectRecord> {
  const project = await requireProject(pool, projectId, member);
  if (member.role === 'contractor' && !(await contractorHoldsContract(pool, project.id, member))) {
    throw notFound();
  }
  return project;
}

async function lastInterim(
  client: Queryable,
  projectId: string,
): Promise<CertificateRow | null> {
  return firstRow<CertificateRow>(
    client,
    `${CERTIFICATE_SELECT} WHERE c.project_id = $1 AND c.kind = 'interim'
      ORDER BY c.seq DESC LIMIT 1`,
    [projectId],
  );
}

async function nextSeq(client: Queryable, projectId: string): Promise<number> {
  const row = await firstRow<{ seq: number }>(
    client,
    'SELECT COALESCE(MAX(seq), 0) AS seq FROM certificates WHERE project_id = $1',
    [projectId],
  );
  return (row?.seq ?? 0) + 1;
}

async function interimCount(client: Queryable, projectId: string): Promise<number> {
  const row = await firstRow<{ count: number }>(
    client,
    `SELECT COUNT(*)::int AS count FROM certificates WHERE project_id = $1 AND kind = 'interim'`,
    [projectId],
  );
  return row?.count ?? 0;
}

/** Writes the split, and posts the one balanced retention pair when it moves. */
async function writeCertificate(
  client: Queryable,
  options: {
    project: ProjectRecord;
    member: Member;
    number: string;
    kind: CertificateKind;
    periodEnding: string | null;
    grossValuationCents: number | null;
    valuationThisPeriodCents: number | null;
    retentionThisPeriodCents: number | null;
    retentionHeldCents: number;
    amountDueCents: number;
    retentionMovement: { kind: 'hold' | 'release'; amountCents: number } | null;
  },
): Promise<string> {
  const certificateId = newId();
  await client.query(
    `INSERT INTO certificates (id, project_id, number, kind, period_ending, gross_valuation_cents,
                               valuation_this_period_cents, retention_this_period_cents,
                               retention_held_cents, amount_due_cents, currency, issued_by, seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      certificateId,
      options.project.id,
      options.number,
      options.kind,
      options.periodEnding,
      options.grossValuationCents,
      options.valuationThisPeriodCents,
      options.retentionThisPeriodCents,
      options.retentionHeldCents,
      options.amountDueCents,
      options.project.currency,
      options.member.id,
      await nextSeq(client, options.project.id),
    ],
  );

  const stores = await projectStores(client, options.project.id);
  const split = allocateStoreSplit(options.amountDueCents, stores);
  for (const [index, part] of split.entries()) {
    await client.query(
      `INSERT INTO certificate_splits (id, certificate_id, store_code, store_name, weight,
                                       amount_cents, ord)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId(),
        certificateId,
        part.storeCode,
        part.storeName,
        part.weight,
        part.amountCents,
        index,
      ],
    );
  }

  const movement = options.retentionMovement;
  if (movement && movement.amountCents !== 0) {
    const movementId = newId();
    const pair =
      movement.kind === 'hold'
        ? [
            { account: 'contractor_payable', side: 'debit' },
            { account: 'retention_held', side: 'credit' },
          ]
        : [
            { account: 'retention_held', side: 'debit' },
            { account: 'contractor_payable', side: 'credit' },
          ];
    for (const entry of pair) {
      await client.query(
        `INSERT INTO retention_entries (id, project_id, movement_id, certificate_id,
                                        certificate_number, kind, account, side, amount_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newId(),
          options.project.id,
          movementId,
          certificateId,
          options.number,
          movement.kind,
          entry.account,
          entry.side,
          movement.amountCents,
        ],
      );
    }
  }

  return certificateId;
}

export function registerCertificateRoutes(router: Router): void {
  router.get('/api/projects/:id/certificates', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await certificateScope(member, context.param('id'));
    const found = await rows<CertificateRow>(
      pool,
      `${CERTIFICATE_SELECT} WHERE c.project_id = $1 ORDER BY c.seq`,
      [project.id],
    );
    return jsonReply(200, {
      certificates: await Promise.all(found.map((row) => certificatePayload(pool, row))),
    });
  });

  router.get('/api/certificates/:id', async (context): Promise<Reply> => {
    const member = await context.member();
    const row = await firstRow<CertificateRow>(pool, `${CERTIFICATE_SELECT} WHERE c.id = $1`, [
      requireUuid(context.param('id')),
    ]);
    if (!row) throw notFound();
    await certificateScope(member, row.project_id);
    return jsonReply(200, { certificate: await certificatePayload(pool, row) });
  });

  router.get('/api/certificates/:id/split.csv', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'finance');
    const row = await firstRow<CertificateRow>(pool, `${CERTIFICATE_SELECT} WHERE c.id = $1`, [
      requireUuid(context.param('id')),
    ]);
    if (!row) throw notFound();
    await requireProject(pool, row.project_id, member);
    const split = (await splitOf(pool, row.id)) as {
      storeCode: string;
      storeName: string;
      weight: number;
      amountCents: number;
    }[];
    const document = csvDocument(
      ['store_code', 'store_name', 'weight', 'amount'],
      split.map((part) => [
        csvText(part.storeCode),
        csvText(part.storeName),
        csvRaw(String(part.weight)),
        csvRaw(centsToDecimal(part.amountCents)),
      ]),
    );
    return {
      status: 200,
      bytes: Buffer.from(document, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      headers: { 'Content-Disposition': `attachment; filename="${row.number}-split.csv"` },
    };
  });

  router.post('/api/projects/:id/certificates', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const project = await requireProject(pool, context.param('id'), member);
    const contract = await projectContract(pool, project.id);
    if (!contract) throw conflict('no_contract');

    const body = await context.json();
    const previous = await lastInterim(pool, project.id);
    const fields = new Fields();

    const periodEndingText =
      typeof body.periodEnding === 'string' ? body.periodEnding : '';
    const periodEnding = parseCalendarDate(periodEndingText);
    if (!periodEnding) {
      fields.add('periodEnding', fieldErrorCopy.required('Period ending'));
    } else if (previous?.period_ending && periodEndingText <= previous.period_ending) {
      fields.add('periodEnding', fieldErrorCopy.periodEndingNotAfter(previous.period_ending));
    }

    const grossValuationCents = fields.cents(
      'grossValuationCents',
      body.grossValuationCents,
      'Gross valuation to date',
      0,
      MAX_CENTS,
    );
    const previousGross = previous?.gross_valuation_cents ?? 0;
    if (grossValuationCents < previousGross) {
      fields.add('grossValuationCents', fieldErrorCopy.grossValuationLower());
    }
    fields.finish();

    const held = await retentionHeldCents(pool, project.id);
    const figures = interimCertificate({
      grossValuationCents,
      previousGrossValuationCents: previousGross,
      retentionHeldCents: held,
      contractSumCents: contract.contractSumCents,
      practicalCompletionRecorded: project.practicalCompletionOn !== null,
    });

    const number = `PC-${String((await interimCount(pool, project.id)) + 1).padStart(2, '0')}`;
    const certificateId = await transact((client) =>
      writeCertificate(client, {
        project,
        member,
        number,
        kind: 'interim',
        periodEnding: periodEndingText,
        grossValuationCents,
        valuationThisPeriodCents: figures.valuationThisPeriodCents,
        retentionThisPeriodCents: figures.retentionThisPeriodCents,
        retentionHeldCents: figures.retentionHeldCents,
        amountDueCents: figures.amountDueCents,
        retentionMovement: { kind: 'hold', amountCents: figures.retentionThisPeriodCents },
      }),
    );

    const row = await firstRow<CertificateRow>(pool, `${CERTIFICATE_SELECT} WHERE c.id = $1`, [
      certificateId,
    ]);
    if (!row) throw notFound();
    return jsonReply(201, { certificate: await certificatePayload(pool, row) });
  });

  router.post('/api/projects/:id/practical-completion', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const project = await requireProject(pool, context.param('id'), member);
    const contract = await projectContract(pool, project.id);
    if (!contract) throw conflict('no_contract');
    if (project.practicalCompletionOn) {
      throw illegalTransition('recorded', 'record_practical_completion');
    }

    const body = await context.json();
    const fields = new Fields();
    const dateText = typeof body.date === 'string' ? body.date : '';
    const date = parseCalendarDate(dateText);
    if (!date) {
      fields.add('date', fieldErrorCopy.required('Practical completion date'));
    } else if (dateText > dateInZone(new Date(), HK_ZONE)) {
      fields.add('date', fieldErrorCopy.future('Practical completion date'));
    }
    fields.finish();
    if (!date) throw notFound();

    const held = await retentionHeldCents(pool, project.id);
    const released = halfReleaseCents(held);
    const endOn = defectsEndOn(date, project.defectsPeriodMonths);

    const certificateId = await transact(async (client) => {
      const claimed = await rows(
        client,
        `UPDATE projects SET practical_completion_on = $2, defects_end_on = $3
          WHERE id = $1 AND practical_completion_on IS NULL RETURNING id`,
        [project.id, dateText, endOn],
      );
      if (claimed.length === 0) {
        throw illegalTransition('recorded', 'record_practical_completion');
      }
      return writeCertificate(client, {
        project,
        member,
        number: 'RR-01',
        kind: 'retention_release_half',
        periodEnding: null,
        grossValuationCents: null,
        valuationThisPeriodCents: null,
        retentionThisPeriodCents: null,
        retentionHeldCents: held - released,
        amountDueCents: released,
        retentionMovement: { kind: 'release', amountCents: released },
      });
    });

    const row = await firstRow<CertificateRow>(pool, `${CERTIFICATE_SELECT} WHERE c.id = $1`, [
      certificateId,
    ]);
    if (!row) throw notFound();
    return jsonReply(201, { certificate: await certificatePayload(pool, row) });
  });

  router.post('/api/projects/:id/retention/final-release', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead');
    const project = await requireProject(pool, context.param('id'), member);
    const contract = await projectContract(pool, project.id);
    if (!contract) throw conflict('no_contract');
    if (!project.practicalCompletionOn || !project.defectsEndOn) {
      throw illegalTransition('not_started', 'final_release');
    }
    const already = await firstRow(
      pool,
      `SELECT 1 FROM certificates WHERE project_id = $1 AND kind = 'retention_release_final'`,
      [project.id],
    );
    if (already) throw illegalTransition('released', 'final_release');

    const today = dateInZone(new Date(), HK_ZONE);
    const defectsEnd = parseCalendarDate(project.defectsEndOn);
    if (!defectsEnd) throw notFound();
    const firstAllowed = addDays(defectsEnd, 1);
    const firstAllowedText = `${String(firstAllowed.year).padStart(4, '0')}-${String(
      firstAllowed.month,
    ).padStart(2, '0')}-${String(firstAllowed.day).padStart(2, '0')}`;
    if (today < firstAllowedText) {
      throw conflict('defects_period_running', { defectsEndOn: project.defectsEndOn });
    }

    const held = await retentionHeldCents(pool, project.id);
    const certificateId = await transact((client) =>
      writeCertificate(client, {
        project,
        member,
        number: 'RR-02',
        kind: 'retention_release_final',
        periodEnding: null,
        grossValuationCents: null,
        valuationThisPeriodCents: null,
        retentionThisPeriodCents: null,
        retentionHeldCents: 0,
        amountDueCents: held,
        retentionMovement: { kind: 'release', amountCents: held },
      }),
    );

    const row = await firstRow<CertificateRow>(pool, `${CERTIFICATE_SELECT} WHERE c.id = $1`, [
      certificateId,
    ]);
    if (!row) throw notFound();
    return jsonReply(201, { certificate: await certificatePayload(pool, row) });
  });

  router.get('/api/projects/:id/retention-ledger', async (context): Promise<Reply> => {
    const member = await context.memberWithRole('director', 'project_lead', 'finance');
    const project = await requireProject(pool, context.param('id'), member);
    const entries = await rows<{
      id: string;
      movement_id: string;
      certificate_number: string;
      kind: string;
      account: string;
      side: string;
      amount_cents: number;
      posted_at: string;
    }>(
      pool,
      `SELECT id, movement_id, certificate_number, kind, account, side, amount_cents, posted_at
         FROM retention_entries WHERE project_id = $1 ORDER BY seq`,
      [project.id],
    );
    return jsonReply(200, {
      entries: entries.map((entry) => ({
        id: entry.id,
        movementId: entry.movement_id,
        certificateNumber: entry.certificate_number,
        kind: entry.kind,
        account: entry.account,
        side: entry.side,
        amountCents: entry.amount_cents,
        postedAt: new Date(entry.posted_at).toISOString(),
      })),
      retentionHeldCents: await retentionHeldCents(pool, project.id),
    });
  });
}


