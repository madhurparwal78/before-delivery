import { ConflictDto } from '../../shared/api';
import { qualifiedRef } from '../../shared/refs';
import { query, transaction } from '../db';
import { jsonBody, requireMember, sendJson } from '../http/context';
import { apiErrors } from '../http/errors';
import { addRoute } from '../http/pipeline';
import { checkReapply } from '../domain/editChecks';
import { insertOp, loadWorkbookState, touchWorkbook } from '../domain/state';
import { loadWorkbook, loadWorkbookForUpdate, cutoffHasPassed } from '../domain/workbooks';
import { applyOp } from '../../shared/ops';

interface ConflictRow {
  id: string;
  kind: 'conflict' | 'rejected';
  sheet_id: string;
  sheet_name: string;
  cell: string;
  my_input: string;
  current_input: string;
  current_author_id: string | null;
  current_author_name: string | null;
  reason: string | null;
  created_at: Date;
}

const CONFLICT_SQL = `select c.id, c.kind, c.sheet_id, c.sheet_name, c.cell, c.my_input, c.current_input,
    c.current_author_id, a.name as current_author_name, c.reason, c.created_at
  from conflicts c left join members a on a.id = c.current_author_id`;

function conflictDto(row: ConflictRow): ConflictDto {
  return {
    id: row.id,
    kind: row.kind,
    ref: qualifiedRef(row.sheet_name, row.cell),
    sheetId: row.sheet_id,
    cell: row.cell,
    myInput: row.my_input,
    currentInput: row.current_input,
    currentAuthor:
      row.current_author_id && row.current_author_name
        ? { id: row.current_author_id, name: row.current_author_name }
        : null,
    reason: row.kind === 'rejected' ? row.reason : null,
    createdAt: row.created_at.toISOString(),
  };
}

export function registerConflictRoutes(): void {
  addRoute({
    method: 'GET',
    pattern: '/api/workbooks/:id/conflicts',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const rows = await query<ConflictRow>(
        `${CONFLICT_SQL} where c.workbook_id = $1 and c.member_id = $2 and c.resolved_at is null
         order by c.created_at asc, c.id asc`,
        [workbook.id, member.id],
      );
      sendJson(ctx.res, 200, { conflicts: rows.map(conflictDto) });
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/:id/conflicts/:conflictId/resolve',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const body = jsonBody(ctx);
      const choice = body.choice;
      if (choice !== 'reapply' && choice !== 'keep_current') {
        throw apiErrors.validation({ choice: 'Pick re-apply or keep current.' });
      }
      const payload = await transaction(async (client) => {
        const row = await loadWorkbookForUpdate(client, workbook.id, member.stationId);
        const found = (
          await client.query(
            `select id, sheet_id, cell, my_input, resolved_at from conflicts
             where id = $1 and workbook_id = $2 and member_id = $3`,
            [ctx.params.conflictId, row.id, member.id],
          )
        ).rows[0] as { id: string; sheet_id: string; cell: string; my_input: string; resolved_at: Date | null } | undefined;
        if (!found) throw apiErrors.notFound();
        if (found.resolved_at) throw apiErrors.conflictResolved();

        if (choice === 'keep_current') {
          await client.query("update conflicts set resolved_at = now(), choice = 'keep_current' where id = $1", [
            found.id,
          ]);
          return { resolved: { id: found.id, choice }, result: null };
        }

        const { state, headSeq } = await loadWorkbookState(row.id, client);
        const check = checkReapply(found.sheet_id, {
          state,
          season: row.state,
          cutoffPassed: cutoffHasPassed(row),
          role: member.role,
        });
        if (!check.ok) {
          if (check.reason === 'season_locked') throw apiErrors.seasonLocked();
          if (check.reason === 'season_archived') throw apiErrors.seasonArchived();
          if (check.reason === 'role_cannot_edit') throw apiErrors.roleCannotEdit();
          throw apiErrors.sheetMissing();
        }
        const seq = headSeq + 1;
        const op = {
          opId: `reapply-${found.id}`,
          type: 'setCell' as const,
          sheetId: found.sheet_id,
          cell: found.cell,
          input: found.my_input,
        };
        await insertOp(client, row.id, seq, member.id, op);
        applyOp(state, op, seq, member.id);
        await touchWorkbook(client, row.id, seq);
        await client.query("update conflicts set resolved_at = now(), choice = 'reapply' where id = $1", [found.id]);
        return { resolved: { id: found.id, choice }, result: { status: 'applied', seq } };
      });
      sendJson(ctx.res, 200, payload);
    },
  });
}
