import { queryOne, transact, type Transaction } from '../db/pool';
import {
  claimConflict, claimTooLong, clothMismatch, layOverlap, lotMismatch, notFound,
  panelAlreadyLaid, panelOffCloth, refuse,
} from '../http/errors';
import { FIELD_COPY } from '../shared/copy';
import {
  accountByEmail, claimView, claimsOf, drawingByCode, holdDeadline, liveStatusOf, lotOf, nameOf,
  panelGeometry, panelsOf, pinnedOrCurrentRuleSet, reader, settleDrawing, stockByCode, stockView,
  usedMmOf, type ClaimRow, type DrawingRow, type LayRow, type PanelRow, type StockRow,
} from '../domain/model';
import { firstFit, insideCloth, outlineBounds, overlapsAnyLaid, placedOutline, type LaidOutline, type Rotation } from '../domain/nest';
import { refusalForNestingAction } from '../domain/transitions';
import { COUNTER_ACCOUNTS, LEDGER_REASONS, panelsAccount, postPair, type PostedPair } from '../domain/ledger';
import { Check, normaliseEmail } from '../domain/validate';
import { audit, nextCode, opaqueId } from '../domain/records';
import { answerPage, numericIdSql, padNumber, pageClause } from './lists';
import { onlyRoles, requireVisible } from './visibility';
import { replayOrRun } from './idempotency';
import { jsonBody, reply, signedIn, type Caller, type Ctx, type Reply } from './types';

/** Claims, lays, releases and the confirmed cut. */

/** A loft hand may claim only on assigned drawings, and only under an authority. */
async function requireCuttingAuthority(
  db: Pick<Transaction, 'query' | 'one'>,
  caller: Caller,
  drawing: DrawingRow,
  at: Date,
  onClaimDate: boolean,
): Promise<void> {
  if (caller.role === 'sailmaker') return;
  if (caller.role !== 'loft-hand' || drawing.assigned_to !== caller.email) {
    throw refuse('no_cutting_authority');
  }
  const authority = await db.one<{ id: string }>(
    `SELECT id FROM authority
      WHERE loft_hand_email = $1 AND valid_from <= $2 AND (valid_until IS NULL OR valid_until > $2)`,
    [caller.email, at.toISOString()],
  );
  if (authority === null) throw refuse(onClaimDate ? 'no_authority_on_claim_date' : 'no_cutting_authority');
}

async function visibleClaim(ctx: Ctx, id: string): Promise<{ claim: ClaimRow; drawing: DrawingRow }> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker', 'loft-hand']);
  const claim = await queryOne<ClaimRow>('SELECT * FROM claim WHERE id = $1', [id]);
  if (claim === null) throw notFound();
  const drawing = await drawingByCode(reader, claim.drawing_code);
  requireVisible(
    drawing,
    drawing !== null && (caller.role === 'sailmaker' || drawing.assigned_to === caller.email),
  );
  return { claim, drawing: drawing as DrawingRow };
}

export async function getClaim(ctx: Ctx): Promise<Reply> {
  const { claim } = await visibleClaim(ctx, ctx.params['id'] as string);
  return reply(200, await claimView(reader, claim, ctx.now));
}

export async function takeClaim(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker', 'loft-hand']);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const lengthMm = check.lengthMm('length_mm');
  const stockCode = typeof body['stock_code'] === 'string' ? body['stock_code'] : '';
  const drawingCode = typeof body['drawing_code'] === 'string' ? body['drawing_code'] : '';

  const drawing = await drawingByCode(reader, drawingCode);
  if (drawing === null) {
    check.fail('drawing_code', FIELD_COPY.drawing);
    check.done();
  }
  const sail = drawing as DrawingRow;
  if (caller.role === 'loft-hand' && sail.assigned_to !== caller.email) throw refuse('no_cutting_authority');
  await requireCuttingAuthority(reader, caller, sail, ctx.now, false);

  const nesting = refusalForNestingAction(sail.status);
  if (nesting !== null) throw nesting;

  const stock = await stockByCode(reader, stockCode);
  if (stock === null) {
    check.fail('stock_code', FIELD_COPY.stock);
    check.done();
  }
  const item = stock as StockRow;
  if (item.cloth_code !== sail.cloth_code) throw clothMismatch();
  const claims = await claimsOf(reader, sail.code);
  const pinnedLot = await lotOf(reader, claims, ctx.now);
  if (pinnedLot !== null && item.lot !== pinnedLot) throw lotMismatch();
  check.done();

  const claim = await transact(async (tx) => {
    // Claims are checked under a lock on the stock item.
    const locked = await tx.one<StockRow>('SELECT * FROM stock WHERE code = $1 FOR UPDATE', [stockCode]);
    if (locked === null) throw notFound();
    const live = await tx.query<ClaimRow>(
      `SELECT * FROM claim WHERE stock_code = $1 AND status = 'held' AND expires_at > $2
        ORDER BY taken_at DESC, taken_seq DESC`,
      [stockCode, ctx.now.toISOString()],
    );
    const freeMm = locked.remaining_mm - live.reduce((total, held) => total + held.length_mm, 0);
    if (lengthMm > freeMm) {
      const winner = live[0];
      if (winner === undefined) throw claimTooLong(stockCode);
      const holder = await accountByEmail(tx, winner.holder_email);
      throw claimConflict(nameOf(holder), winner.id);
    }
    const id = opaqueId('CL-');
    const row = await tx.one<ClaimRow>(
      `INSERT INTO claim (id, stock_code, drawing_code, holder_email, length_mm, status, taken_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,'held',$6,$7) RETURNING *`,
      [id, stockCode, sail.code, caller.email, lengthMm, ctx.now.toISOString(),
        holdDeadline(ctx.now).toISOString()],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'claim.take',
      target: id,
      after: `${stockCode} ${lengthMm}`,
    });
    return row as ClaimRow;
  });
  return reply(201, await claimView(reader, claim, ctx.now));
}

interface NestingAnswer {
  readonly claim: Record<string, unknown>;
  readonly stock: Record<string, unknown>;
  readonly drawing_status: string;
}

async function nestingAnswer(claim: ClaimRow, now: Date): Promise<NestingAnswer> {
  const fresh = (await queryOne<ClaimRow>('SELECT * FROM claim WHERE id = $1', [claim.id])) as ClaimRow;
  const stock = (await stockByCode(reader, claim.stock_code)) as StockRow;
  const drawing = (await drawingByCode(reader, claim.drawing_code)) as DrawingRow;
  return {
    claim: await claimView(reader, fresh, now),
    stock: await stockView(reader, stock, now),
    drawing_status: drawing.status,
  };
}

function laidOutlinesOf(panels: readonly PanelRow[], lays: readonly LayRow[]): LaidOutline[] {
  const byNumber = new Map(panels.map((panel) => [panel.number, panel]));
  return lays.map((lay) => ({
    panel_number: lay.panel_number,
    outline: placedOutline(
      panelGeometry(byNumber.get(lay.panel_number) as PanelRow),
      lay.rotation as Rotation,
      lay.x_mm,
      lay.y_mm,
    ),
  }));
}

function refuseUnlessHeld(claim: ClaimRow, now: Date): void {
  const live = liveStatusOf(claim, now);
  if (live === 'lapsed') throw refuse('claim_lapsed');
  if (live !== 'held') throw refuse('claim_closed');
}

export async function layPanel(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const { claim, drawing } = await visibleClaim(ctx, ctx.params['id'] as string);
  await requireCuttingAuthority(reader, caller, drawing, ctx.now, false);
  refuseUnlessHeld(claim, ctx.now);
  const nesting = refusalForNestingAction(drawing.status);
  if (nesting !== null) throw nesting;

  const body = jsonBody(ctx);
  const check = new Check(body);
  const panels = await panelsOf(reader, drawing.code);
  const panelNumber = typeof body['panel_number'] === 'number' ? body['panel_number'] : -1;
  const panel = panels.find((item) => item.number === panelNumber);
  if (panel === undefined) check.fail('panel_number', FIELD_COPY.panelNumber);

  const hasX = body['x_mm'] !== undefined;
  const hasY = body['y_mm'] !== undefined;
  const hasRotation = body['rotation'] !== undefined;
  const allThree = hasX && hasY && hasRotation;
  const noneOfThree = !hasX && !hasY && !hasRotation;
  if (!allThree && !noneOfThree) check.fail('position', FIELD_COPY.positionTogether);
  if (allThree && body['rotation'] !== 0 && body['rotation'] !== 180) {
    check.fail('rotation', FIELD_COPY.badRotation);
  }
  check.done();

  const stock = (await stockByCode(reader, claim.stock_code)) as StockRow;
  const geometry = panelGeometry(panel as PanelRow);

  const answer = await transact(async (tx) => {
    const locked = await tx.one<ClaimRow>('SELECT * FROM claim WHERE id = $1 FOR UPDATE', [claim.id]);
    if (locked === null) throw notFound();
    refuseUnlessHeld(locked, ctx.now);
    const lays = await tx.query<LayRow>('SELECT * FROM lay WHERE claim_id = $1 ORDER BY laid_seq ASC', [
      locked.id,
    ]);
    if (lays.some((lay) => lay.panel_number === geometry.number)) throw panelAlreadyLaid(geometry.number);
    const laid = laidOutlinesOf(panels, lays);

    let placement: { x_mm: number; y_mm: number; rotation: Rotation };
    if (allThree) {
      placement = {
        x_mm: body['x_mm'] as number,
        y_mm: body['y_mm'] as number,
        rotation: body['rotation'] as Rotation,
      };
    } else {
      const fit = firstFit(geometry, laid, locked.length_mm, stock.usable_width_mm);
      if (fit === null) throw panelOffCloth(geometry.number);
      placement = fit;
    }

    const outline = placedOutline(geometry, placement.rotation, placement.x_mm, placement.y_mm);
    if (!insideCloth(outline, locked.length_mm, stock.usable_width_mm)) throw panelOffCloth(geometry.number);
    const clash = overlapsAnyLaid(outline, laid);
    if (clash !== null) throw layOverlap(geometry.number, clash.panel_number);

    await tx.query(
      'INSERT INTO lay (claim_id, panel_number, x_mm, y_mm, rotation) VALUES ($1,$2,$3,$4,$5)',
      [locked.id, geometry.number, placement.x_mm, placement.y_mm, placement.rotation],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'claim.lay',
      target: `${locked.id} ${geometry.number}`,
      after: `${placement.x_mm},${placement.y_mm},${placement.rotation}`,
    });
    await settleDrawing(tx, drawing, ctx.now);
    return locked;
  });
  return reply(201, await nestingAnswer(answer, ctx.now));
}

export async function unlayPanel(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const { claim, drawing } = await visibleClaim(ctx, ctx.params['id'] as string);
  await requireCuttingAuthority(reader, caller, drawing, ctx.now, false);
  const panelNumber = Number(ctx.params['panel'] as string);

  await transact(async (tx) => {
    const locked = await tx.one<ClaimRow>('SELECT * FROM claim WHERE id = $1 FOR UPDATE', [claim.id]);
    if (locked === null) throw notFound();
    refuseUnlessHeld(locked, ctx.now);
    await tx.query('DELETE FROM lay WHERE claim_id = $1 AND panel_number = $2', [locked.id, panelNumber]);
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'claim.unlay',
      target: `${locked.id} ${panelNumber}`,
    });
    await settleDrawing(tx, drawing, ctx.now);
  });
  return reply(200, await nestingAnswer(claim, ctx.now));
}

export async function releaseClaim(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const { claim, drawing } = await visibleClaim(ctx, ctx.params['id'] as string);
  await requireCuttingAuthority(reader, caller, drawing, ctx.now, false);

  await transact(async (tx) => {
    const locked = await tx.one<ClaimRow>('SELECT * FROM claim WHERE id = $1 FOR UPDATE', [claim.id]);
    if (locked === null) throw notFound();
    refuseUnlessHeld(locked, ctx.now);
    await tx.query(`UPDATE claim SET status = 'released' WHERE id = $1`, [locked.id]);
    await tx.query('DELETE FROM lay WHERE claim_id = $1', [locked.id]);
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'claim.release',
      target: locked.id,
      before: 'held',
      after: 'released',
    });
    await settleDrawing(tx, drawing, ctx.now);
  });
  const fresh = (await queryOne<ClaimRow>('SELECT * FROM claim WHERE id = $1', [claim.id])) as ClaimRow;
  return reply(200, await claimView(reader, fresh, ctx.now));
}

export async function confirmCut(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const { claim, drawing } = await visibleClaim(ctx, ctx.params['id'] as string);
  // Authority is read as it stood when the hold was taken.
  await requireCuttingAuthority(reader, caller, drawing, claim.taken_at, true);
  return replayOrRun(ctx, 'cut', claim.id, claim.id, () => runCut(ctx, claim, drawing));
}

async function runCut(ctx: Ctx, claim: ClaimRow, drawing: DrawingRow): Promise<Reply> {
  const caller = signedIn(ctx);
  const answer = await transact(async (tx) => {
    const locked = await tx.one<ClaimRow>('SELECT * FROM claim WHERE id = $1 FOR UPDATE', [claim.id]);
    if (locked === null) throw notFound();
    const live = liveStatusOf(locked, ctx.now);
    if (live === 'lapsed') throw refuse('claim_lapsed');
    if (live === 'cut') throw refuse('already_cut');
    if (live !== 'held') throw refuse('claim_closed');

    const stock = (await tx.one<StockRow>('SELECT * FROM stock WHERE code = $1 FOR UPDATE', [
      locked.stock_code,
    ])) as StockRow;
    const panels = await panelsOf(tx, drawing.code);
    const lays = await tx.query<LayRow>('SELECT * FROM lay WHERE claim_id = $1 ORDER BY laid_seq ASC', [
      locked.id,
    ]);
    if (lays.length === 0) throw refuse('claim_empty');

    // Every uncut panel must be laid on a Held claim.
    const heldClaims = await tx.query<ClaimRow>(
      `SELECT * FROM claim WHERE drawing_code = $1 AND status = 'held' AND expires_at > $2`,
      [drawing.code, ctx.now.toISOString()],
    );
    const laidOnHeld = new Set<number>();
    for (const held of heldClaims) {
      const rows = await tx.query<LayRow>('SELECT panel_number FROM lay WHERE claim_id = $1', [held.id]);
      for (const row of rows) laidOnHeld.add(row.panel_number);
    }
    const uncut = panels.filter((panel) => !panel.cut);
    if (!uncut.every((panel) => laidOnHeld.has(panel.number))) throw refuse('not_nested');

    const ruleset = await pinnedOrCurrentRuleSet(tx, drawing, ctx.now);
    const usedMm = usedMmOf(panels, lays);
    const wholeLength = locked.length_mm;
    const tailMm = wholeLength - usedMm;
    const panelArea = lays.reduce((sum, lay) => {
      const panel = panels.find((item) => item.number === lay.panel_number);
      return sum + (panel === undefined ? 0 : Number(panel.area_mm2));
    }, 0);

    const makesOffcut =
      tailMm >= ruleset.min_offcut_length_mm && stock.width_mm >= ruleset.min_offcut_width_mm;
    let offcutCode: string | null = null;
    if (makesOffcut) {
      offcutCode = await nextCode(tx, 'offcut');
      await tx.query(
        `INSERT INTO stock (code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm,
           on_hand_mm2, shelf_location, note, revision)
         VALUES ($1,'offcut',$2,$3,$4,$5,$6,0,'Offcut bin','',1)`,
        [offcutCode, stock.cloth_code, stock.lot, stock.width_mm, stock.usable_width_mm, tailMm],
      );
    }

    // The stock gives up width × L, posted as balanced pairs.
    const pairs: PostedPair[] = [];
    pairs.push(
      await postPair(tx, ctx.now, {
        stockCode: stock.code,
        stockAmountMm2: -panelArea,
        counterAccount: panelsAccount(drawing.code),
        drawingCode: drawing.code,
        actorEmail: caller.email,
        reason: LEDGER_REASONS.panelsCut,
      }),
    );
    if (offcutCode !== null) {
      pairs.push(
        await postPair(tx, ctx.now, {
          stockCode: stock.code,
          stockAmountMm2: -(stock.width_mm * tailMm),
          counterAccount: offcutCode,
          counterStockCode: offcutCode,
          drawingCode: drawing.code,
          actorEmail: caller.email,
          reason: LEDGER_REASONS.offcutReceived,
        }),
      );
    }
    const wasteArea = stock.width_mm * wholeLength - panelArea - (offcutCode === null ? 0 : stock.width_mm * tailMm);
    if (wasteArea > 0) {
      pairs.push(
        await postPair(tx, ctx.now, {
          stockCode: stock.code,
          stockAmountMm2: -wasteArea,
          counterAccount: COUNTER_ACCOUNTS.waste,
          drawingCode: drawing.code,
          actorEmail: caller.email,
          reason: LEDGER_REASONS.waste,
        }),
      );
    }

    await tx.query('UPDATE stock SET remaining_mm = remaining_mm - $2 WHERE code = $1', [
      stock.code,
      wholeLength,
    ]);
    await tx.query(`UPDATE claim SET status = 'cut' WHERE id = $1`, [locked.id]);
    for (const lay of lays) {
      await tx.query('UPDATE panel SET cut = true WHERE drawing_code = $1 AND number = $2', [
        drawing.code,
        lay.panel_number,
      ]);
    }
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'claim.cut',
      target: locked.id,
      before: 'held',
      after: 'cut',
    });
    const status = await settleDrawing(tx, drawing, ctx.now);
    return { offcutCode, pairs, status };
  });

  const fresh = (await queryOne<ClaimRow>('SELECT * FROM claim WHERE id = $1', [claim.id])) as ClaimRow;
  const stock = (await stockByCode(reader, claim.stock_code)) as StockRow;
  const offcut = answer.offcutCode === null ? null : await stockByCode(reader, answer.offcutCode);
  return reply(200, {
    claim: await claimView(reader, fresh, ctx.now),
    stock: await stockView(reader, stock, ctx.now),
    offcut: offcut === null ? null : await stockView(reader, offcut, ctx.now),
    pairs: answer.pairs,
    drawing_status: answer.status,
  });
}

interface AuthorityRow {
  readonly id: string;
  readonly loft_hand_email: string;
  readonly valid_from: Date;
  readonly valid_until: Date | null;
}

function authorityView(row: AuthorityRow, name: string, now: Date): Record<string, unknown> {
  const from = row.valid_from.getTime();
  const until = row.valid_until === null ? null : row.valid_until.getTime();
  const status = from > now.getTime() ? 'not_yet' : until !== null && until <= now.getTime() ? 'ended' : 'in_force';
  return {
    id: row.id,
    loft_hand: { email: row.loft_hand_email, display_name: name },
    valid_from: row.valid_from.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    valid_until: row.valid_until === null ? null : row.valid_until.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    status,
  };
}

export async function listAuthorities(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  const order = { at: 'valid_from', id: numericIdSql('id') };
  const clause = pageClause(ctx, {}, order, 1);
  const page = await answerPage<AuthorityRow, Record<string, unknown>>(
    clause,
    {
      sql: `SELECT * FROM authority WHERE true ${clause.where}
             ORDER BY valid_from DESC, code_number(id) DESC LIMIT ${clause.limit + 1}`,
      values: clause.values,
      countSql: 'SELECT count(*)::text n FROM authority',
      countValues: [],
      position: (row) => ({ at: row.valid_from.toISOString().replace(/\.\d{3}Z$/, 'Z'), id: padNumber(row.id) }),
    },
    async (row) => authorityView(row, nameOf(await accountByEmail(reader, row.loft_hand_email)), ctx.now),
  );
  return reply(200, page);
}

export async function createAuthority(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const validFrom = check.requiredFutureInstant('valid_from', ctx.now);
  const validUntil = check.futureInstant('valid_until', ctx.now);
  const email = typeof body['loft_hand_email'] === 'string' ? normaliseEmail(body['loft_hand_email']) : '';
  const hand = await queryOne<{ display_name: string; deleted: boolean }>(
    `SELECT display_name, deleted FROM account WHERE email = $1 AND role = 'loft-hand' AND deleted = false`,
    [email],
  );
  if (hand === null) check.fail('loft_hand_email', FIELD_COPY.loftHandEmail);
  check.done();

  const created = await transact(async (tx) => {
    const id = opaqueId('AU-');
    const row = await tx.one<AuthorityRow>(
      `INSERT INTO authority (id, loft_hand_email, valid_from, valid_until) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, email, validFrom, validUntil],
    );
    await audit(tx, ctx.now, { actorEmail: caller.email, action: 'authority.create', target: id, after: email });
    return row as AuthorityRow;
  });
  return reply(201, authorityView(created, nameOf(hand as never), ctx.now));
}

export async function withdrawAuthority(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const id = ctx.params['id'] as string;
  const row = await queryOne<AuthorityRow>('SELECT * FROM authority WHERE id = $1', [id]);
  if (row === null) throw notFound();
  if (row.valid_until !== null && row.valid_until.getTime() <= ctx.now.getTime()) throw refuse('wrong_state');

  const updated = await transact(async (tx) => {
    const next = await tx.one<AuthorityRow>(
      'UPDATE authority SET valid_until = $2 WHERE id = $1 RETURNING *',
      [id, ctx.now.toISOString()],
    );
    await audit(tx, ctx.now, { actorEmail: caller.email, action: 'authority.withdraw', target: id });
    return next as AuthorityRow;
  });
  const hand = await accountByEmail(reader, updated.loft_hand_email);
  return reply(200, authorityView(updated, nameOf(hand), ctx.now));
}

export { outlineBounds, nextCode };
