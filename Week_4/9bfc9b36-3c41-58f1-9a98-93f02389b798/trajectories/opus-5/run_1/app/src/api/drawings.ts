import { queryOne, transact, type Transaction } from '../db/pool';
import { notFound, refuse, storeUnavailable } from '../http/errors';
import { FIELD_COPY } from '../shared/copy';
import { pounds } from '../shared/units';
import {
  accountByEmail, boatByCode, clothByCode, currentRuleSet, dimensionsOfBoat, drawingByCode,
  drawingFacts, drawingView, instantOf, loftClosures, luffAndFoot, nameOf, panelsOf, reader,
  ruleSetByVersion, sailAreaView, usedDimensions, type AccountRow, type BoatRow, type ClothRow,
  type DrawingRow, type RuleSetRow,
} from '../domain/model';
import { buildPanels } from '../domain/panels';
import {
  isSealed, refusalForAssign, refusalForDraw, refusalForIssue, refusalForRevise, stepReachable,
  type DrawingStatus,
} from '../domain/transitions';
import { sailAccountFigures } from '../domain/sailaccount';
import { renderSheet, tryIssue } from '../domain/issue';
import { getObject, StoreUnreachable } from '../services/s3';
import { CUT_SHEET_CONTENT_TYPE } from '../services/store';
import { Check, normaliseEmail } from '../domain/validate';
import { audit, nextCode, opaqueId } from '../domain/records';
import { answerPage, numericIdSql, padNumber, pageClause } from './lists';
import { asOwner, drawingVisible, onlyRoles, requireVisible } from './visibility';
import { chargeOwnerLimit } from './submissions';
import { replayOrRun } from './idempotency';
import { bytes, jsonBody, reply, signedIn, type Ctx, type Reply } from './types';
import { config } from '../config';

/** Sail drawings: the four steps, Draw, assignment, issuing, revisions and the sail account. */

export async function visibleDrawing(ctx: Ctx, code: string): Promise<DrawingRow> {
  const caller = signedIn(ctx);
  const row = await drawingByCode(reader, code);
  return requireVisible(row, row !== null && (await drawingVisible(reader, caller, row, ctx.now)));
}

export async function listDrawings(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const status = ctx.query.get('status');
  const boat = ctx.query.get('boat');
  const order = { at: null, id: numericIdSql('code') };
  const clause = pageClause(ctx, { status, boat }, order, 1);
  const filters: string[] = [];
  const values: unknown[] = [...clause.values];
  if (status !== null && status !== '') {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }
  if (boat !== null && boat !== '') {
    values.push(boat);
    filters.push(`boat_code = $${values.length}`);
  }
  if (caller.role === 'loft-hand') {
    values.push(caller.email);
    filters.push(`assigned_to = $${values.length}`);
  } else if (caller.role === 'yacht-owner') {
    values.push(caller.email, ctx.now.toISOString());
    filters.push(
      `code IN (SELECT drawing_code FROM sight_grant WHERE owner_email = $${values.length - 1}
          AND status = 'granted' AND (ends_at IS NULL OR ends_at > $${values.length}))`,
    );
  }
  const where = filters.length === 0 ? '' : ` AND ${filters.join(' AND ')}`;
  const countValues = values.slice(clause.values.length);
  let placeholder = 0;
  const countWhere = filters.map((text) => text.replace(/\$\d+/g, () => `$${++placeholder}`)).join(' AND ');
  const page = await answerPage<DrawingRow, Record<string, unknown>>(
    clause,
    {
      sql: `SELECT * FROM drawing WHERE true ${clause.where} ${where}
             ORDER BY code_number(code) DESC LIMIT ${clause.limit + 1}`,
      values,
      countSql: `SELECT count(*)::text n FROM drawing ${countWhere === '' ? '' : `WHERE ${countWhere}`}`,
      countValues,
      position: (row) => ({ at: '', id: padNumber(row.code) }),
    },
    (row) => drawingView(reader, row, ctx.now, asOwner(caller)),
  );
  return reply(200, page);
}

export async function getDrawing(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const row = await visibleDrawing(ctx, ctx.params['code'] as string);
  return reply(200, await drawingView(reader, row, ctx.now, asOwner(caller)));
}

export async function createDrawing(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const sail = check.choice<'mainsail' | 'headsail'>('sail', ['mainsail', 'headsail'], FIELD_COPY.sail);
  const boatCode = typeof body['boat_code'] === 'string' ? body['boat_code'] : '';
  const clothCode = typeof body['cloth_code'] === 'string' ? body['cloth_code'] : '';
  const boat = await boatByCode(reader, boatCode);
  if (boat === null) check.fail('boat_code', FIELD_COPY.boat);
  const cloth = await clothByCode(reader, clothCode);
  if (cloth === null) check.fail('cloth_code', FIELD_COPY.cloth);
  check.done();

  const closures = await loftClosures(reader);
  const states = await dimensionsOfBoat(reader, (boat as BoatRow).code, closures);
  const flagged = usedDimensions(sail).some((key) => states.get(key)?.status === 'remeasure');

  const created = await transact(async (tx) => {
    const code = await nextCode(tx, 'drawing');
    const row = await tx.one<DrawingRow>(
      `INSERT INTO drawing (code, boat_code, sail, cloth_code, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, (boat as BoatRow).code, sail, (cloth as ClothRow).code, flagged ? 'remeasure' : 'measuring'],
    );
    await audit(tx, ctx.now, { actorEmail: caller.email, action: 'drawing.create', target: code, after: 'measuring' });
    return row as DrawingRow;
  });
  return reply(201, await drawingView(reader, created, ctx.now, false));
}

export async function drawSail(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const drawing = await visibleDrawing(ctx, code);
  const refusal = refusalForDraw(drawing.status);
  if (refusal !== null) throw refusal;

  const closures = await loftClosures(reader);
  const states = await dimensionsOfBoat(reader, drawing.boat_code, closures);
  const keys = usedDimensions(drawing.sail);
  if (keys.some((key) => states.get(key)?.status === 'remeasure')) throw refuse('remeasure_required');

  const boat = (await boatByCode(reader, drawing.boat_code)) as BoatRow;
  const owner = await accountByEmail(reader, boat.owner_email);
  const cloth = (await clothByCode(reader, drawing.cloth_code)) as ClothRow;
  // Draw pins the version current at this instant, and the drawing keeps it.
  const ruleset = await currentRuleSet(reader, ctx.now);

  const values: Record<string, number> = {};
  for (const key of ['I', 'J', 'P', 'E', 'LL', 'LP']) {
    values[key] = states.get(key)?.value_mm ?? 0;
  }
  const area = sailAreaView(drawing.sail, values, ruleset.roach_permille, ruleset.tolerance_mm, ruleset.version);
  const figures = luffAndFoot(drawing.sail, values);
  const panels = buildPanels(figures.luffMm, figures.footMm, cloth.usable_width_mm - ruleset.seam_overlap_mm);
  const drawDimensions = keys.map((key) => ({ key, value_mm: values[key] as number }));

  const updated = await transact(async (tx) => {
    const row = await tx.one<DrawingRow>(
      `UPDATE drawing SET status = 'drawn', ruleset_version = $2, luff_mm = $3, foot_mm = $4,
          area_mm2 = $5, area_basis = $6, draw_boat_name = $7, draw_owner_name = $8, draw_dimensions = $9
        WHERE code = $1 AND status = 'measuring' RETURNING *`,
      [code, ruleset.version, figures.luffMm, figures.footMm, area.area_mm2, area.basis, boat.name,
        nameOf(owner), JSON.stringify(drawDimensions)],
    );
    if (row === null) throw refuse('wrong_state');
    await tx.query('DELETE FROM panel WHERE drawing_code = $1', [code]);
    for (const panel of panels) {
      await tx.query(
        `INSERT INTO panel (drawing_code, number, outline, length_mm, width_mm, area_mm2, cut)
         VALUES ($1,$2,$3,$4,$5,$6,false)`,
        [code, panel.number, JSON.stringify(panel.outline), panel.length_mm, panel.width_mm, panel.area_mm2],
      );
    }
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'drawing.draw',
      target: code,
      before: 'measuring',
      after: 'drawn',
    });
    return row;
  });
  return reply(200, await drawingView(reader, updated, ctx.now, false));
}

export async function assignDrawing(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const drawing = await visibleDrawing(ctx, code);
  const refusal = refusalForAssign(drawing.status);
  if (refusal !== null) throw refusal;
  const body = jsonBody(ctx);
  const check = new Check(body);
  const email = typeof body['loft_hand_email'] === 'string' ? normaliseEmail(body['loft_hand_email']) : '';
  const hand = await queryOne<AccountRow>(
    `SELECT * FROM account WHERE email = $1 AND role = 'loft-hand' AND deleted = false`,
    [email],
  );
  if (hand === null) check.fail('loft_hand_email', FIELD_COPY.loftHandEmail);
  check.done();

  const updated = await transact(async (tx) => {
    const row = await tx.one<DrawingRow>(
      'UPDATE drawing SET assigned_to = $2 WHERE code = $1 RETURNING *',
      [code, email],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'drawing.assign',
      target: code,
      before: drawing.assigned_to,
      after: email,
    });
    return row as DrawingRow;
  });
  return reply(200, await drawingView(reader, updated, ctx.now, false));
}

export async function issueDrawing(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const drawing = await visibleDrawing(ctx, code);
  const refusal = refusalForIssue(drawing.status);
  if (refusal !== null) throw refusal;

  // Of two simultaneous issues of one drawing, exactly one proceeds.
  const claimed = await transact(async (tx) => {
    const row = await tx.one<DrawingRow>(
      `UPDATE drawing SET status = 'pending_store' WHERE code = $1 AND status = 'cut' RETURNING *`,
      [code],
    );
    if (row === null) throw refuse('already_issued');
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'drawing.issue',
      target: code,
      before: 'cut',
      after: 'pending_store',
    });
    return row;
  });

  const confirmed = await tryIssue(reader, claimed, ctx.now);
  const after = (await drawingByCode(reader, code)) as DrawingRow;
  return reply(confirmed ? 200 : 202, await drawingView(reader, after, ctx.now, false));
}

export async function reviseDrawing(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const drawing = await visibleDrawing(ctx, code);
  const refusal = refusalForRevise(drawing.status, drawing.successor !== null);
  if (refusal !== null) throw refusal;

  const successor = await transact(async (tx) => {
    const locked = await tx.one<DrawingRow>('SELECT * FROM drawing WHERE code = $1 FOR UPDATE', [code]);
    if (locked === null) throw notFound();
    if (locked.successor !== null) throw refuse('already_revised');
    const nextCodeValue = await nextCode(tx, 'drawing');
    const row = await tx.one<DrawingRow>(
      `INSERT INTO drawing (code, boat_code, sail, cloth_code, status, predecessor)
       VALUES ($1,$2,$3,$4,'measuring',$5) RETURNING *`,
      [nextCodeValue, locked.boat_code, locked.sail, locked.cloth_code, code],
    );
    await tx.query('UPDATE drawing SET successor = $2 WHERE code = $1', [code, nextCodeValue]);
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'drawing.revise',
      target: code,
      after: nextCodeValue,
    });
    return row as DrawingRow;
  });
  return reply(201, await drawingView(reader, successor, ctx.now, false));
}

export async function previewCutSheet(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const drawing = await visibleDrawing(ctx, ctx.params['code'] as string);
  if (!['cut', 'pending_store', 'issued'].includes(drawing.status)) throw refuse('wrong_state');
  const sheet = await renderSheet(reader, drawing, ctx.now);
  return bytes(200, sheet.bytes, CUT_SHEET_CONTENT_TYPE);
}

export async function fetchCutSheet(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const digest = ctx.params['sha256'] as string;
  const drawing = await queryOne<DrawingRow>('SELECT * FROM drawing WHERE cut_sheet_sha256 = $1', [digest]);
  if (drawing === null) throw notFound();
  return streamSheet(drawing, 'ownerSheet');
}

export async function streamSheet(
  drawing: DrawingRow,
  outage: 'ownerSheet' | 'photo',
): Promise<Reply> {
  if (drawing.cut_sheet_key === null) throw notFound();
  let stored;
  try {
    stored = await getObject(drawing.cut_sheet_key);
  } catch (cause) {
    if (cause instanceof StoreUnreachable) throw storeUnavailable(outage);
    throw cause;
  }
  if (stored === null) throw storeUnavailable(outage);
  const headers: Record<string, string> = { etag: `"${drawing.cut_sheet_sha256 as string}"` };
  if (drawing.successor !== null) {
    const successor = await queryOne<{ status: string }>('SELECT status FROM drawing WHERE code = $1', [
      drawing.successor,
    ]);
    if (successor !== null && successor.status === 'issued') {
      headers['boltrope-superseded-by'] = drawing.successor;
    }
  }
  if (drawing.predecessor !== null) headers['boltrope-supersedes'] = drawing.predecessor;
  return bytes(200, stored.bytes, CUT_SHEET_CONTENT_TYPE, headers);
}

interface EntryRow {
  readonly id: string;
  readonly drawing_code: string;
  readonly kind: 'payment' | 'credit_note';
  readonly amount_pence: number;
  readonly at: Date;
  readonly note: string | null;
  readonly reason: string | null;
  readonly recorded_by: string;
}

export async function sailAccount(
  db: Pick<Transaction, 'query' | 'one'>,
  drawing: DrawingRow,
  forOwner: boolean,
): Promise<Record<string, unknown>> {
  const cloth = (await clothByCode(db, drawing.cloth_code)) as ClothRow;
  const entries = await db.query<EntryRow>(
    'SELECT * FROM account_entry WHERE drawing_code = $1 ORDER BY at DESC, entry_seq DESC',
    [drawing.code],
  );
  const paid = entries.filter((entry) => entry.kind === 'payment').reduce((sum, entry) => sum + entry.amount_pence, 0);
  const credited = entries
    .filter((entry) => entry.kind === 'credit_note')
    .reduce((sum, entry) => sum + entry.amount_pence, 0);
  const figures = sailAccountFigures(Number(drawing.area_mm2), cloth.rate_pence_per_m2, paid, credited);
  return {
    drawing_code: drawing.code,
    status: figures.status,
    cloth_code: cloth.code,
    rate_pence_per_m2: figures.rate_pence_per_m2,
    area_mm2: figures.area_mm2,
    charge_pence: figures.charge_pence,
    tax_rate_percent: figures.tax_rate_percent,
    tax_pence: figures.tax_pence,
    total_pence: figures.total_pence,
    deposit_pence: figures.deposit_pence,
    paid_pence: figures.paid_pence,
    credited_pence: figures.credited_pence,
    balance_pence: figures.balance_pence,
    entries: entries.map((entry) => {
      const common = {
        id: entry.id,
        kind: entry.kind,
        amount_pence: entry.amount_pence,
        at: instantOf(entry.at),
        note: entry.note,
        reason: entry.reason,
      };
      return forOwner ? common : { ...common, recorded_by: entry.recorded_by };
    }),
  };
}

function requireAccountState(status: DrawingStatus): void {
  if (status !== 'cut' && status !== 'pending_store' && status !== 'issued') throw refuse('wrong_state');
}

export async function getSailAccount(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker', 'yacht-owner']);
  const drawing = await visibleDrawing(ctx, ctx.params['code'] as string);
  requireAccountState(drawing.status);
  return reply(200, await sailAccount(reader, drawing, asOwner(caller)));
}

async function recordEntry(
  ctx: Ctx,
  kind: 'payment' | 'credit_note',
  amountPence: number,
  note: string | null,
  reason: string | null,
): Promise<Record<string, unknown>> {
  const caller = signedIn(ctx);
  const code = ctx.params['code'] as string;
  return transact(async (tx) => {
    // Payments and credit notes are applied under a lock on the drawing's account.
    const locked = await tx.one<DrawingRow>('SELECT * FROM drawing WHERE code = $1 FOR UPDATE', [code]);
    if (locked === null) throw notFound();
    requireAccountState(locked.status);
    const before = await sailAccount(tx, locked, false);
    if (amountPence > (before['balance_pence'] as number)) throw refuse('exceeds_balance');
    await tx.query(
      `INSERT INTO account_entry (id, drawing_code, kind, amount_pence, at, note, reason, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [opaqueId('EN-'), code, kind, amountPence, ctx.now.toISOString(), note, reason, caller.email],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: kind === 'payment' ? 'payment.record' : 'credit_note.record',
      target: code,
      after: pounds(amountPence),
      reason,
    });
    return sailAccount(tx, locked, false);
  });
}

export async function recordPayment(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  await visibleDrawing(ctx, code);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const amountPence = check.amountPence('amount_pence');
  check.text('note', 0, 200);
  check.done();
  const note = typeof body['note'] === 'string' ? body['note'] : '';
  return replayOrRun(ctx, 'payment', code, `${code}:${amountPence}`, async () =>
    reply(201, await recordEntry(ctx, 'payment', amountPence, note, null)),
  );
}

export async function recordCreditNote(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  await visibleDrawing(ctx, code);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const amountPence = check.amountPence('amount_pence');
  const reason = check.reason('reason', FIELD_COPY.reasonRequired);
  check.done();
  return reply(201, await recordEntry(ctx, 'credit_note', amountPence, null, reason));
}

/**
 * Stepping back: when a used dimension's current value changes, a Drawn or
 * Nested drawing returns to Measuring, discarding its panels and area, and every
 * lay on its Held claims is lifted. Drawings in Cutting or later keep their figures.
 */
export async function settleDependentDrawings(
  tx: Transaction,
  boatCode: string,
  dimension: string,
  now: Date,
): Promise<void> {
  const closures = await loftClosures(tx);
  const states = await dimensionsOfBoat(tx, boatCode, closures);
  const state = states.get(dimension);
  const rows = await tx.query<DrawingRow>('SELECT * FROM drawing WHERE boat_code = $1', [boatCode]);
  for (const drawing of rows) {
    if (!usedDimensions(drawing.sail).includes(dimension)) continue;
    if (isSealed(drawing.status) || drawing.status === 'cut' || drawing.status === 'cutting') continue;
    const flagged = usedDimensions(drawing.sail).some((key) => states.get(key)?.status === 'remeasure');
    if (drawing.status === 'drawn' || drawing.status === 'nested') {
      await tx.query('DELETE FROM lay WHERE claim_id IN (SELECT id FROM claim WHERE drawing_code = $1)', [
        drawing.code,
      ]);
      await tx.query('DELETE FROM panel WHERE drawing_code = $1', [drawing.code]);
      await tx.query(
        `UPDATE drawing SET status = $2, ruleset_version = NULL, area_mm2 = NULL, area_basis = NULL,
            luff_mm = NULL, foot_mm = NULL, draw_boat_name = NULL, draw_owner_name = NULL,
            draw_dimensions = NULL WHERE code = $1`,
        [drawing.code, flagged ? 'remeasure' : 'measuring'],
      );
      continue;
    }
    const settled: DrawingStatus = flagged ? 'remeasure' : 'measuring';
    if (settled !== drawing.status) {
      await tx.query('UPDATE drawing SET status = $2 WHERE code = $1', [drawing.code, settled]);
    }
  }
  if (state === undefined) return;
}

export async function drawingStep(ctx: Ctx, code: string): Promise<string> {
  const drawing = await visibleDrawing(ctx, code);
  const facts = await drawingFacts(reader, drawing, ctx.now);
  return facts.step;
}

export { stepReachable, panelsOf, ruleSetByVersion, config };
export type { RuleSetRow };
