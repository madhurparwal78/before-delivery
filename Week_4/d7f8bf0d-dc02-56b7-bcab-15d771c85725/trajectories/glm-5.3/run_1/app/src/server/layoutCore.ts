import type { Db, Tx } from './db';
import { errors } from './httpTypes';
import type {
  LayoutContent,
  StandardsProfile,
  Finding,
} from '../shared/domain';
import { canonicalHash } from '../shared/canonical';
import { checkLayout, checkPieceRules, placePiece, endWithRise, curveLength, randomId, type PieceInput } from '../shared/geometry';

export interface LayoutRow {
  id: string;
  workspace_id: string;
  name: string;
  revision: number;
  working_hash: string;
  content: LayoutContent;
}

export async function getLayout(db: Db, layoutId: string): Promise<LayoutRow | null> {
  const res = await db.query('SELECT id, workspace_id, name, revision, working_hash, content FROM layouts WHERE id = $1', [layoutId]);
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, revision: Number(row.revision), content: row.content as LayoutContent };
}

export async function getStandards(db: Db, workspaceId: string): Promise<{ profile: StandardsProfile; revision: number }> {
  const res = await db.query('SELECT profile, revision FROM standards WHERE workspace_id = $1', [workspaceId]);
  const row = res.rows[0];
  if (!row) throw errors.notFound();
  return { profile: row.profile as StandardsProfile, revision: Number(row.revision) };
}

export async function addHistory(tx: Tx, layoutId: string, actor: string, action: string, objectId: string | null, from: string | null, to: string | null): Promise<void> {
  await tx.query(
    `INSERT INTO layout_history (id, layout_id, actor, action, object_id, from_value, to_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [`h-${randomId()}`, layoutId, actor, action, objectId, from, to],
  );
}

export async function commitLayoutEvent(
  tx: Tx,
  layout: { id: string; revision: number },
  type: string,
  detail: unknown,
  actor: string,
): Promise<number> {
  const seq = layout.revision + 1;
  await tx.query(
    `INSERT INTO event_outbox (stream, seq, type, payload)
     VALUES ($1,$2,$3,$4)`,
    [
      `gandyboard:layout:${layout.id}:events`,
      seq,
      type,
      { seq, type, actor, detail },
    ],
  );
  return seq;
}

export function layoutCounts(content: LayoutContent): { modules: number; pieces: number; blocks: number; trash: number } {
  const live = content.modules.filter((m) => !m.trashed);
  return {
    modules: live.length,
    pieces: live.reduce((n, m) => n + m.pieces.length, 0),
    blocks: content.blocks.length,
    trash: content.modules.filter((m) => m.trashed).length,
  };
}

/** A checked append: returns the stored piece or rule findings; nothing is stored on failure. */
export function appendPiece(
  profile: StandardsProfile,
  module: LayoutContent['modules'][number],
  openEndId: string,
  input: PieceInput,
): { piece: LayoutContent['modules'][number]['pieces'][number]; openEnds: LayoutContent['modules'][number]['open_ends'] } | { findings: Finding[] } {
  const openEnd = module.open_ends.find((o) => o.id === openEndId);
  if (!openEnd) return { findings: [{ rule: 'open_end', module_id: module.id, piece_id: null, measured_mm: 0, limit_mm: 0, message: 'That open end is not in this module.' }] };
  const previous = module.pieces[module.pieces.length - 1] ?? null;
  let straightSinceReverse = Infinity;
  for (let i = module.pieces.length - 1; i >= 0; i--) {
    const p = module.pieces[i];
    if (!p) break;
    if (p.kind === 'straight' || p.kind === 'turnout') straightSinceReverse += p.length_mm;
    else break;
  }
  const findings = checkPieceRules(profile, input, previous, straightSinceReverse === Infinity ? 0 : straightSinceReverse);
  if (findings.length > 0) return { findings };

  const start = { x_mm: openEnd.x_mm, y_mm: openEnd.y_mm, elevation_mm: openEnd.elevation_mm, heading_deg: openEnd.heading_deg };
  const rise = input.rise_mm ?? 0;
  const piece = buildPieceRecord(randomId(), input, start, module.pieces[0]?.block_id ?? null, rise);
  return { piece, openEnds: [] };
}

export function buildPieceRecord(id: string, input: PieceInput, start: { x_mm: number; y_mm: number; elevation_mm: number; heading_deg: number }, blockId: string | null, rise: number): LayoutContent['modules'][number]['pieces'][number] {
  if (input.kind === 'curve') {
    const radius = input.radius_mm ?? 1067;
    const angle = input.angle_deg ?? 15;
    const placement = placePiece('curve', { ...start, elevation_mm: start.elevation_mm }, { length_mm: 0, radius_mm: radius, angle_deg: angle, hand: input.hand });
    const end = endWithRise({ ...start }, placement, rise);
    return {
      id,
      kind: 'curve',
      length_mm: curveLength(radius, angle),
      rise_mm: rise,
      mainline: input.mainline ?? true,
      block_id: blockId,
      note: '',
      start,
      end,
      radius_mm: radius,
      angle_deg: angle,
      hand: input.hand ?? 'left',
    };
  }
  const length = input.length_mm ?? 305;
  const placement = placePiece(input.kind, { ...start }, { length_mm: length });
  const end = endWithRise({ ...start }, placement, rise);
  const piece: LayoutContent['modules'][number]['pieces'][number] = {
    id,
    kind: input.kind,
    length_mm: length,
    rise_mm: rise,
    mainline: input.mainline ?? true,
    block_id: blockId,
    note: '',
    start,
    end,
  };
  if (input.kind === 'turnout') piece.frog_number = input.frog_number ?? 6;
  return piece;
}
