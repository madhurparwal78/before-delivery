/** Monthly statements: a PDF of the renter's ledger month, stored privately. */

import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import * as errors from '../http/errors.js';
import { json, redirect, type Route, type RouteResult, type SessionContext } from '../http/router.js';
import { requireResolved } from '../http/resolve.js';
import { Validator } from '../http/validate.js';
import { kitchenToday } from '../domain/clock.js';
import { availableAccount } from '../domain/ledger.js';
import {
  KITCHEN_TIME_ZONE,
  isMonthString,
  kitchenDate,
  kitchenHhmm,
  monthOf,
} from '../../shared/kitchenTime.js';
import { formatHours, formatSignedHours } from '../../shared/format.js';
import { paginate, renderTextPdf, type PdfLine } from '../services/pdf.js';
import {
  StorageUnavailable,
  assertStorageReachable,
  presignGetUrl,
  putObject,
  statementObjectKey,
} from '../services/storage.js';
import { presentStatement } from './present.js';
import type { MovementKind } from '../../shared/types.js';
import type { StatementRow } from '../rows.js';

const ALL_ROLES = ['operator', 'shift_lead', 'renter'] as const;

interface AvailableEntryRow {
  kind: MovementKind;
  direction: 'debit' | 'credit';
  minutes: number;
  created_at: Date;
}

/** The statement's own body: every movement on the renter's available account that month. */
function renderStatement(
  businessName: string,
  month: string,
  entries: readonly AvailableEntryRow[],
): Buffer {
  const lines: PdfLine[] = [
    { text: 'Brigade & Bench Commissary', bold: true, size: 16 },
    { text: `Hour statement for ${businessName}`, bold: true, size: 12 },
    { text: `Month: ${month}` },
    { text: `Kitchen time zone: ${KITCHEN_TIME_ZONE}` },
    { text: '' },
  ];

  let opening = 0;
  const inMonth: AvailableEntryRow[] = [];
  for (const entry of entries) {
    const signed = entry.direction === 'credit' ? entry.minutes : -entry.minutes;
    if (monthOf(kitchenDate(entry.created_at.getTime())) < month) opening += signed;
    else if (monthOf(kitchenDate(entry.created_at.getTime())) === month) inMonth.push(entry);
  }

  lines.push({ text: `Opening balance: ${formatHours(opening)} h`, bold: true });
  lines.push({ text: '' });
  lines.push({ text: 'Date        Time   Movement                 Hours', bold: true });

  let closing = opening;
  for (const entry of inMonth) {
    const signed = entry.direction === 'credit' ? entry.minutes : -entry.minutes;
    closing += signed;
    const date = kitchenDate(entry.created_at.getTime());
    const time = kitchenHhmm(entry.created_at.getTime());
    lines.push({
      text: `${date}  ${time}  ${entry.kind.padEnd(22)}  ${formatSignedHours(signed)}`,
    });
  }
  if (inMonth.length === 0) lines.push({ text: 'No hour movements this month.' });

  lines.push({ text: '' });
  lines.push({ text: `Closing balance: ${formatHours(closing)} h`, bold: true });
  return renderTextPdf(paginate(lines));
}

async function create(context: SessionContext): Promise<RouteResult> {
  const renter = requireResolved(context.resolved, 'renter');
  const month = context.body['month'];
  if (!isMonthString(month)) Validator.one('month', 'Enter a month as YYYY-MM.');
  if (month > monthOf(kitchenToday())) {
    Validator.one('month', 'Choose a month that has started.');
  }

  const entries = await db.query<AvailableEntryRow>(
    `SELECT m.kind, e.direction, e.minutes, e.created_at
       FROM ledger_entries e
       JOIN movements m ON m.id = e.movement_id
      WHERE e.account = $1
      ORDER BY e.seq`,
    [availableAccount(renter.id)],
  );

  const statementId = randomUUID();
  const objectKey = statementObjectKey(renter.id, month, statementId);
  try {
    await putObject(
      objectKey,
      renderStatement(renter.business_name, month, entries),
      'application/pdf',
    );
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageUnavailable();
    throw error;
  }

  const stored = await db.one<StatementRow>(
    `INSERT INTO statements (id, renter_id, month, object_key)
     VALUES ($1, $2, $3, $4) RETURNING id, renter_id, month, object_key, created_at`,
    [statementId, renter.id, month, objectKey],
  );
  return json(201, { statement: presentStatement(stored) });
}

export const statementRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/renters/:renter_id/statements',
    auth: 'session',
    roles: ['renter', 'operator'],
    body: 'json',
    resolve: ['renter'],
    handle: create,
  },
  {
    method: 'GET',
    path: '/api/renters/:renter_id/statements',
    auth: 'session',
    roles: [...ALL_ROLES],
    resolve: ['renter'],
    async handle(context) {
      const renter = requireResolved(context.resolved, 'renter');
      const rows = await db.query<StatementRow>(
        `SELECT id, renter_id, month, object_key, created_at FROM statements
          WHERE renter_id = $1 ORDER BY created_at DESC`,
        [renter.id],
      );
      return json(200, { statements: rows.map(presentStatement) });
    },
  },
  {
    method: 'GET',
    path: '/api/statements/:statement_id/file',
    auth: 'session',
    roles: [...ALL_ROLES],
    resolve: ['statement'],
    async handle(context) {
      const statement = requireResolved(context.resolved, 'statement');
      try {
        await assertStorageReachable(statement.object_key);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw errors.storageUnavailable();
        throw error;
      }
      return redirect(presignGetUrl(statement.object_key));
    },
  },
];
