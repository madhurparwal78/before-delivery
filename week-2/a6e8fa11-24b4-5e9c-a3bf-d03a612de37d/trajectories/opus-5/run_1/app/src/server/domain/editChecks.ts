import { OpRejectionReason } from '../../shared/api';
import { ClientOp, contentRulesPass } from '../../shared/ops';
import { canEditCells, canEditStructure } from '../../shared/roles';
import { MemberRole, SeasonState, WorkbookState, findSheetById } from '../../shared/workbook';

export interface EditContext {
  state: WorkbookState;
  season: SeasonState;
  cutoffPassed: boolean;
  role: MemberRole;
}

export type EditCheck = { ok: true } | { ok: false; reason: OpRejectionReason };

const PASS: EditCheck = { ok: true };

function refuse(reason: OpRejectionReason): EditCheck {
  return { ok: false, reason };
}

/** Season state and cutoff (edit check 2). */
export function checkSeason(context: EditContext): EditCheck {
  if (context.season === 'archived') return refuse('season_archived');
  if (context.season === 'locked' || context.cutoffPassed) return refuse('season_locked');
  return PASS;
}

/** Role, per the role table for the current state (edit check 3). */
export function checkRole(op: { type: ClientOp['type'] }, context: EditContext): EditCheck {
  const allowed =
    op.type === 'setCell' || op.type === 'setFormat'
      ? canEditCells(context.role, context.season)
      : canEditStructure(context.role, context.season);
  return allowed ? PASS : refuse('role_cannot_edit');
}

/** Sheet existence (edit check 4). */
export function checkSheet(op: ClientOp, context: EditContext): EditCheck {
  if (op.type === 'removeChart' || op.type === 'addSheet') return PASS;
  return findSheetById(context.state, op.sheetId) ? PASS : refuse('sheet_missing');
}

/**
 * The edit check order: shape, season, role, sheet, content rules. Conflict detection
 * (check 6) is decided by the sync sequencer.
 */
export function checkEdit(op: ClientOp, context: EditContext): EditCheck {
  const season = checkSeason(context);
  if (!season.ok) return season;
  const role = checkRole(op, context);
  if (!role.ok) return role;
  const sheet = checkSheet(op, context);
  if (!sheet.ok) return sheet;
  return contentRulesPass(op, context.state) ? PASS : refuse('invalid_op');
}

/** Re-apply runs checks 2, 3 and 4 only. */
export function checkReapply(sheetId: string, context: EditContext): EditCheck {
  const season = checkSeason(context);
  if (!season.ok) return season;
  const role = checkRole({ type: 'setCell' }, context);
  if (!role.ok) return role;
  return findSheetById(context.state, sheetId) ? PASS : refuse('sheet_missing');
}

/** Rejections kept in the author's conflict tray. */
export function rejectionKeptInTray(op: ClientOp, reason: OpRejectionReason): boolean {
  if (op.type !== 'setCell') return false;
  return reason === 'season_locked' || reason === 'season_archived' || reason === 'role_cannot_edit';
}
