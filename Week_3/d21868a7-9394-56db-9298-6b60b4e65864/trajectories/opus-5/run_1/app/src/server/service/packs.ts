import { createHash } from 'node:crypto';
import { ApiError, ValidationError } from '../../domain/errors.ts';
import { packDocument, type PackStrokeLine, type PackWindowLine } from '../../domain/packDocument.ts';
import { type Period, periodCoversOpening, requirePeriod } from '../../domain/period.ts';
import type { SignedInUser } from '../auth.ts';
import { pool, transaction } from '../db.ts';
import { windowRows } from '../reads.ts';
import { labelOf, packRecord, type PackRow, windowFigures, type WindowRow } from '../records.ts';
import { nextPackNumber } from '../schema.ts';
import { requireText } from './validate.ts';

/** The regulator delivery pack: previewed, signed, stored and then mailed once. */

interface StrokeRow {
  turnout: string;
  kind: 'start' | 'finish';
  from_ml_day: string;
  to_ml_day: string;
  operator_code: string;
  committed_at: Date;
}

async function coveredWindows(period: Period): Promise<WindowRow[]> {
  const all = await windowRows({});
  return all.filter((window) => periodCoversOpening(period, window.opens_at));
}

async function buildDocument(period: Period, signatory: string): Promise<string> {
  const windows = await coveredWindows(period);
  const lines: PackWindowLine[] = [];
  for (const window of windows) {
    const figures = windowFigures(window);
    const strokes = await pool.query<StrokeRow>(
      `select o.turnout, gc.kind, gc.from_ml_day, gc.to_ml_day, gc.operator_code, gc.committed_at
         from gate_cards gc join orders o on o.number = gc.order_number
        where o.window_id = $1 and gc.state = 'spent'
        order by gc.confirmed_at, gc.id`,
      [window.id],
    );
    const strokeLines: PackStrokeLine[] = strokes.rows.map((row) => ({
      turnout: row.turnout,
      kind: row.kind,
      fromMlDay: BigInt(row.from_ml_day),
      toMlDay: BigInt(row.to_ml_day),
      operatorCode: row.operator_code,
      committedAt: row.committed_at,
    }));
    lines.push({
      windowId: window.id,
      channelName: window.channel_name,
      label: labelOf(window),
      effectiveCapMlDay: figures.effectiveCapMlDay,
      capVolumeMl: figures.capVolumeMl,
      committedMl: figures.committedMl,
      deliveredMl: figures.deliveredMl,
      restrictionCapMlDay: figures.restrictionCapMlDay,
      restrictionEffectiveAt: window.restriction_effective_at,
      strokes: strokeLines,
    });
  }
  return packDocument(period, signatory, lines);
}

function requireSignatory(input: unknown): string {
  return requireText('signatory', input, 2, 80, 'Signatory');
}

export async function previewPack(from: string | null, to: string | null, signatory: unknown): Promise<string> {
  const period = requirePeriod(from, to);
  return buildDocument(period, requireSignatory(signatory));
}

export async function submitPack(user: SignedInUser, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const period = requirePeriod(
    typeof input.from === 'string' ? input.from : null,
    typeof input.to === 'string' ? input.to : null,
  );
  const signatory = requireSignatory(input.signatory);
  if (typeof input.document !== 'string' || input.document.length === 0) {
    throw ValidationError.field('document', 'Preview the pack before signing.');
  }

  const rebuilt = await buildDocument(period, signatory);
  if (Buffer.compare(Buffer.from(rebuilt, 'utf8'), Buffer.from(input.document, 'utf8')) !== 0) {
    throw new ApiError('pack_stale');
  }

  const number = await transaction(async (client) => {
    const packNumber = await nextPackNumber(client);
    await client.query(
      `insert into packs (number, from_date, to_date, signatory, state, stalled_on, object_key, document, created_by)
       values ($1,$2,$3,$4,'building',null,$5,$6,$7)`,
      [packNumber, period.from, period.to, signatory, `packs/${packNumber}.txt`, Buffer.from(rebuilt, 'utf8'), user.id],
    );
    return packNumber;
  });

  return { pack: packRecord((await packRow(number)) as PackRow) };
}

export async function packRow(number: string): Promise<PackRow | null> {
  const found = await pool.query<PackRow>('select * from packs where number = $1', [number]);
  return found.rows[0] ?? null;
}

export async function packList(mailedOnly: boolean): Promise<Record<string, unknown>[]> {
  const found = await pool.query<PackRow>(
    mailedOnly
      ? "select * from packs where state = 'mailed' order by number desc"
      : 'select * from packs order by number desc',
  );
  return found.rows.map(packRecord);
}

export async function packDocumentBytes(number: string): Promise<Buffer> {
  const found = await pool.query<{ document: Buffer }>('select document from packs where number = $1', [number]);
  return (found.rows[0] as { document: Buffer }).document;
}

export function digestOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function withdrawPack(number: string): Promise<Record<string, unknown>> {
  const pack = await packRow(number);
  if (pack === null) throw new ApiError('not_found');

  await transaction(async (client) => {
    const locked = await client.query<{ state: string }>('select state from packs where number = $1 for update', [
      number,
    ]);
    const state = (locked.rows[0] as { state: string }).state;
    if (state === 'mailed') throw new ApiError('pack_mailed');
    if (state === 'withdrawn') throw new ApiError('illegal_transition');
    await client.query(
      "update packs set state = 'withdrawn', stalled_on = null, object_deleted = false where number = $1",
      [number],
    );
  });

  return { pack: packRecord((await packRow(number)) as PackRow) };
}
