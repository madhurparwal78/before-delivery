import { queryOne, transact } from '../db/pool';
import { notFound, refuse } from '../http/errors';
import { FIELD_COPY } from '../shared/copy';
import { config } from '../config';
import { accountByEmail, drawingByCode, instantOf, nameOf, reader, type AccountRow, type DrawingRow } from '../domain/model';
import { Check, normaliseEmail } from '../domain/validate';
import { audit, nextCode } from '../domain/records';
import { answerPage, numericIdSql, padNumber, pageClause } from './lists';
import { onlyRoles } from './visibility';
import { chargeOwnerLimit } from './submissions';
import { streamSheet, visibleDrawing } from './drawings';
import { jsonBody, reply, signedIn, type Ctx, type Reply } from './types';

/** Sight grants: one owner, one Issued drawing, and a withdrawal that is final. */

export interface GrantRow {
  readonly id: string;
  readonly drawing_code: string;
  readonly owner_email: string;
  readonly status: 'granted' | 'withdrawn';
  readonly granted_at: Date;
  readonly ends_at: Date | null;
  readonly withdrawn_at: Date | null;
}

/** A grant past its `ends_at` reads withdrawn, whatever the owner's clock says. */
export function grantIsActive(row: GrantRow, now: Date): boolean {
  if (row.status !== 'granted') return false;
  return row.ends_at === null || row.ends_at.getTime() > now.getTime();
}

export function grantView(row: GrantRow, ownerName: string, now: Date): Record<string, unknown> {
  const active = grantIsActive(row, now);
  const endedAt = row.ends_at === null ? null : instantOf(row.ends_at);
  return {
    id: row.id,
    drawing_code: row.drawing_code,
    owner: { email: row.owner_email, display_name: ownerName },
    status: active ? 'granted' : 'withdrawn',
    granted_at: instantOf(row.granted_at),
    ends_at: endedAt,
    withdrawn_at: row.withdrawn_at === null ? (active ? null : endedAt) : instantOf(row.withdrawn_at),
  };
}

export async function createGrant(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const drawing = await visibleDrawing(ctx, code);
  if (drawing.status !== 'issued') throw refuse('wrong_state');
  const body = jsonBody(ctx);
  const check = new Check(body);
  const endsAt = check.futureInstant('ends_at', ctx.now);
  const email = typeof body['owner_email'] === 'string' ? normaliseEmail(body['owner_email']) : '';
  const owner = await queryOne<AccountRow>(
    `SELECT * FROM account WHERE email = $1 AND role = 'yacht-owner' AND deleted = false`,
    [email],
  );
  if (owner === null) check.fail('owner_email', FIELD_COPY.ownerEmail);
  check.done();

  const created = await transact(async (tx) => {
    const id = await nextCode(tx, 'grant');
    const row = await tx.one<GrantRow>(
      `INSERT INTO sight_grant (id, drawing_code, owner_email, status, granted_at, ends_at)
       VALUES ($1,$2,$3,'granted',$4,$5) RETURNING *`,
      [id, code, email, ctx.now.toISOString(), endsAt],
    );
    await audit(tx, ctx.now, { actorEmail: caller.email, action: 'grant.create', target: id, after: email });
    return row as GrantRow;
  });
  return reply(201, grantView(created, nameOf(owner as AccountRow), ctx.now));
}

export async function withdrawGrant(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const id = ctx.params['id'] as string;
  const row = await queryOne<GrantRow>('SELECT * FROM sight_grant WHERE id = $1', [id]);
  if (row === null) throw notFound();
  if (!grantIsActive(row, ctx.now)) throw refuse('wrong_state');

  const updated = await transact(async (tx) => {
    const next = await tx.one<GrantRow>(
      `UPDATE sight_grant SET status = 'withdrawn', withdrawn_at = $2
        WHERE id = $1 AND status = 'granted' RETURNING *`,
      [id, ctx.now.toISOString()],
    );
    if (next === null) throw refuse('wrong_state');
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'grant.withdraw',
      target: id,
      before: 'granted',
      after: 'withdrawn',
    });
    return next;
  });
  const owner = await accountByEmail(reader, updated.owner_email);
  return reply(200, grantView(updated, nameOf(owner), ctx.now));
}

export async function listGrantsOfDrawing(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  await visibleDrawing(ctx, code);
  const order = { at: 'granted_at', id: numericIdSql('id') };
  const clause = pageClause(ctx, { drawing: code }, order, 1);
  const page = await answerPage<GrantRow, Record<string, unknown>>(
    clause,
    {
      sql: `SELECT * FROM sight_grant WHERE drawing_code = $${clause.values.length + 1} ${clause.where}
             ORDER BY granted_at DESC, code_number(id) DESC LIMIT ${clause.limit + 1}`,
      values: [...clause.values, code],
      countSql: 'SELECT count(*)::text n FROM sight_grant WHERE drawing_code = $1',
      countValues: [code],
      position: (row) => ({ at: instantOf(row.granted_at), id: padNumber(row.id) }),
    },
    async (row) => grantView(row, nameOf(await accountByEmail(reader, row.owner_email)), ctx.now),
  );
  return reply(200, page);
}

/** Every request checks the grant afresh, so a withdrawal reaches the next request. */
async function activeGrantFor(ctx: Ctx, id: string): Promise<GrantRow> {
  const caller = signedIn(ctx);
  const row = await queryOne<GrantRow>('SELECT * FROM sight_grant WHERE id = $1', [id]);
  if (row === null) throw notFound();
  if (caller.role === 'sailmaker') return row;
  if (caller.role !== 'yacht-owner' || row.owner_email !== caller.email) throw notFound();
  if (!grantIsActive(row, ctx.now)) throw notFound();
  return row;
}

export async function getGrant(ctx: Ctx): Promise<Reply> {
  const row = await activeGrantFor(ctx, ctx.params['id'] as string);
  const owner = await accountByEmail(reader, row.owner_email);
  return reply(200, grantView(row, nameOf(owner), ctx.now));
}

export async function listMyCutSheets(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['yacht-owner']);
  const order = { at: 'granted_at', id: numericIdSql('id') };
  const clause = pageClause(ctx, {}, order, 1);
  const page = await answerPage<GrantRow, Record<string, unknown>>(
    clause,
    {
      sql: `SELECT * FROM sight_grant
             WHERE owner_email = $${clause.values.length + 1} AND status = 'granted'
               AND (ends_at IS NULL OR ends_at > $${clause.values.length + 2}) ${clause.where}
             ORDER BY granted_at DESC, code_number(id) DESC LIMIT ${clause.limit + 1}`,
      values: [...clause.values, caller.email, ctx.now.toISOString()],
      countSql: `SELECT count(*)::text n FROM sight_grant WHERE owner_email = $1 AND status = 'granted'
                   AND (ends_at IS NULL OR ends_at > $2)`,
      countValues: [caller.email, ctx.now.toISOString()],
      position: (row) => ({ at: instantOf(row.granted_at), id: padNumber(row.id) }),
    },
    async (row) => grantView(row, nameOf(await accountByEmail(reader, row.owner_email)), ctx.now),
  );
  return reply(200, page);
}

export async function fetchGrantCutSheet(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['yacht-owner']);
  const grant = await activeGrantFor(ctx, ctx.params['id'] as string);
  const drawing = await drawingByCode(reader, grant.drawing_code);
  if (drawing === null) throw notFound();
  await transact((tx) => chargeOwnerLimit(tx, caller.email, 'sheet', ctx.now, config.ownerSheetFetchLimit));
  return streamSheet(drawing as DrawingRow, 'ownerSheet');
}
