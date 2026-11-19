import { query, transact } from '../db/pool';
import { refuse } from '../http/errors';
import { instantOf, currentRuleSet, reader, ruleSetView, type RuleSetRow } from '../domain/model';
import { deriveStanding, type StandingSubmission } from '../domain/standing';
import { Check } from '../domain/validate';
import { audit } from '../domain/records';
import { answerPage, answerWholeList, numericIdSql, padNumber, pageClause } from './lists';
import { onlyRoles } from './visibility';
import { jsonBody, reply, signedIn, type Ctx, type Reply } from './types';
import { readRevision, requireMatch } from './revisions';

/** The audit trail, the tape standing and the rule-set versions. */

interface AuditRow {
  readonly id: string;
  readonly at: Date;
  readonly actor_email: string;
  readonly action: string;
  readonly target: string;
  readonly before_state: string | null;
  readonly after_state: string | null;
  readonly reason: string | null;
  readonly row_seq: string;
}

export async function listAudit(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  const order = { at: 'at', id: `lpad(row_seq::text, 18, '0')` };
  const clause = pageClause(ctx, {}, order, 1);
  const page = await answerPage<AuditRow, Record<string, unknown>>(
    clause,
    {
      sql: `SELECT * FROM audit_trail WHERE true ${clause.where}
             ORDER BY at DESC, row_seq DESC LIMIT ${clause.limit + 1}`,
      values: clause.values,
      countSql: 'SELECT count(*)::text n FROM audit_trail',
      countValues: [],
      position: (row) => ({ at: instantOf(row.at), id: padNumber(row.row_seq) }),
    },
    (row) => ({
      id: row.id,
      at: instantOf(row.at),
      actor_email: row.actor_email,
      action: row.action,
      target: row.target,
      before: row.before_state,
      after: row.after_state,
      reason: row.reason,
    }),
  );
  return reply(200, page);
}

/**
 * The standing is derived on every request from one consistent snapshot, so a
 * reversal committed while the request runs shows completely or not at all.
 */
export async function standing(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  const raw = ctx.query.get('season');
  const season = raw === null || raw === '' ? ctx.now.getUTCFullYear() : Number(raw);
  if (!Number.isInteger(season) || season < 1970 || season > 9999) {
    const check = new Check({});
    check.fail('season', 'Enter a whole number from 1970 to 9999.');
    check.done();
  }
  const rows = await transact(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    return tx.query<{
      id: string;
      owner_email: string;
      owner_name: string;
      deleted: boolean;
      status: StandingSubmission['status'];
      decided_at: Date | null;
    }>(
      `SELECT s.id, s.submitted_by AS owner_email, a.display_name AS owner_name, a.deleted,
              s.status, s.decided_at
         FROM submission s JOIN account a ON a.email = s.submitted_by
        WHERE extract(year from s.submitted_at AT TIME ZONE 'UTC') = $1`,
      [season],
    );
  });
  const { DELETED_ACCOUNT_NAME } = await import('../shared/copy');
  const items = deriveStanding(
    rows.map((row) => ({
      id: row.id,
      owner_email: row.owner_email,
      owner_name: row.deleted ? DELETED_ACCOUNT_NAME : row.owner_name,
      status: row.status,
      decided_at: row.decided_at === null ? null : instantOf(row.decided_at),
    })),
  );
  return reply(200, { season, items });
}

export async function listRuleSets(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  const current = await currentRuleSet(reader, ctx.now);
  const page = await answerWholeList<RuleSetRow, Record<string, unknown>>(
    'SELECT * FROM ruleset ORDER BY version DESC',
    [],
    (row) => ruleSetView(row, current.version),
  );
  return reply(200, page);
}

const RULE_FIGURES: readonly [string, number, number][] = [
  ['seam_overlap_mm', 0, 100],
  ['roach_permille', 1000, 1300],
  ['tolerance_mm', 1, 100],
  ['min_offcut_width_mm', 1, 2000],
  ['min_offcut_length_mm', 1, 60000],
];

export async function createRuleSet(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const figures: Record<string, number> = {};
  for (const [member, min, max] of RULE_FIGURES) figures[member] = check.wholeNumber(member, min, max);
  const effectiveAt = check.requiredFutureInstant('effective_at', ctx.now);
  check.done();

  const created = await transact(async (tx) => {
    const top = await tx.one<{ version: number }>('SELECT max(version) AS version FROM ruleset');
    const version = (top?.version ?? 0) + 1;
    const row = await tx.one<RuleSetRow>(
      `INSERT INTO ruleset (version, effective_at, seam_overlap_mm, roach_permille, tolerance_mm,
         min_offcut_width_mm, min_offcut_length_mm, revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1) RETURNING *`,
      [version, effectiveAt, figures['seam_overlap_mm'], figures['roach_permille'], figures['tolerance_mm'],
        figures['min_offcut_width_mm'], figures['min_offcut_length_mm']],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'ruleset.create',
      target: `v${version}`,
      after: effectiveAt,
    });
    return row as RuleSetRow;
  });
  const current = await currentRuleSet(reader, ctx.now);
  return reply(201, ruleSetView(created, current.version), { etag: `"${created.revision}"` });
}

export async function patchRuleSet(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const version = Number(ctx.params['version'] as string);
  const rows = await query<RuleSetRow>('SELECT * FROM ruleset WHERE version = $1', [version]);
  const row = rows[0];
  if (row === undefined) throw refuse('not_found');
  const wanted = readRevision(ctx);
  requireMatch(wanted, row.revision);
  // Once a version is current or past it is sealed.
  if (row.effective_at.getTime() <= ctx.now.getTime()) throw refuse('sealed');

  const body = jsonBody(ctx);
  const check = new Check(body);
  const figures: Record<string, number> = {};
  for (const [member, min, max] of RULE_FIGURES) figures[member] = check.wholeNumber(member, min, max);
  const effectiveAt = check.requiredFutureInstant('effective_at', ctx.now);
  check.done();

  const updated = await transact(async (tx) => {
    const next = await tx.one<RuleSetRow>(
      `UPDATE ruleset SET effective_at = $2, seam_overlap_mm = $3, roach_permille = $4, tolerance_mm = $5,
          min_offcut_width_mm = $6, min_offcut_length_mm = $7, revision = revision + 1
        WHERE version = $1 AND revision = $8 RETURNING *`,
      [version, effectiveAt, figures['seam_overlap_mm'], figures['roach_permille'], figures['tolerance_mm'],
        figures['min_offcut_width_mm'], figures['min_offcut_length_mm'], row.revision],
    );
    if (next === null) throw refuse('stale_revision');
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'ruleset.update',
      target: `v${version}`,
      before: instantOf(row.effective_at),
      after: effectiveAt,
    });
    return next;
  });
  const current = await currentRuleSet(reader, ctx.now);
  return reply(200, ruleSetView(updated, current.version), { etag: `"${updated.revision}"` });
}

export { numericIdSql };
