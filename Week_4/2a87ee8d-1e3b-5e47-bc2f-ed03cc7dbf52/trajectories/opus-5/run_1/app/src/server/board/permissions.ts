import { AppError } from '../errors.js';
import { statusLabel, TERMINAL_STATUSES, type WorkshopStatus } from '../domain/states.js';
import type { ViewerRole } from '../domain/views.js';

/** Every write the board endpoints can perform. Reads are allowed in every state. */
export type BoardOperation =
  | 'frame.create'
  | 'frame.patch'
  | 'frame.trash'
  | 'trash.restore'
  | 'note.create'
  | 'note.editText'
  | 'note.editPosition'
  | 'note.editPlacement'
  | 'note.editFacilitatorOnly'
  | 'note.delete'
  | 'cluster.create'
  | 'cluster.patch'
  | 'cluster.delete'
  | 'connector.create'
  | 'connector.delete'
  | 'dot.spend'
  | 'dot.return'
  | 'version.restore';

const FACILITATOR_BOARD_EDITS: readonly BoardOperation[] = [
  'frame.create',
  'frame.patch',
  'frame.trash',
  'trash.restore',
  'note.create',
  'note.editText',
  'note.editPosition',
  'note.editPlacement',
  'note.editFacilitatorOnly',
  'note.delete',
  'cluster.create',
  'cluster.patch',
  'cluster.delete',
  'connector.create',
  'connector.delete',
];

/**
 * The one place "what each role may do in each state" lives. A write this table does not
 * list answers `phase_locked`, or `workshop_closed` in `closed` and `archived`.
 */
const PERMITTED: Readonly<Record<ViewerRole, Readonly<Record<WorkshopStatus, readonly BoardOperation[]>>>> = {
  facilitator: {
    draft: [...FACILITATOR_BOARD_EDITS, 'version.restore'],
    open: [...FACILITATOR_BOARD_EDITS, 'version.restore'],
    silent_round: FACILITATOR_BOARD_EDITS,
    revealed: [...FACILITATOR_BOARD_EDITS, 'version.restore'],
    voting: FACILITATOR_BOARD_EDITS,
    closed: [],
    archived: [],
  },
  participant: {
    draft: [],
    open: [],
    // Until the deadline: create notes, and change the text or position of their own
    // unrevealed notes, or delete them.
    silent_round: ['note.create', 'note.editText', 'note.editPosition', 'note.delete'],
    revealed: [
      'note.create',
      'note.editText',
      'note.editPosition',
      'note.editPlacement',
      'note.delete',
      'cluster.create',
      'cluster.patch',
      'cluster.delete',
      'connector.create',
      'connector.delete',
    ],
    voting: ['dot.spend', 'dot.return'],
    closed: [],
    archived: [],
  },
};

/** Operations the facilitator may never perform, whatever the state. */
const FACILITATOR_FORBIDDEN: ReadonlySet<BoardOperation> = new Set<BoardOperation>(['dot.spend', 'dot.return']);

/** Operations a participant may never perform, whatever the state. */
const PARTICIPANT_FORBIDDEN: ReadonlySet<BoardOperation> = new Set<BoardOperation>([
  'frame.create',
  'frame.patch',
  'frame.trash',
  'trash.restore',
  'note.editFacilitatorOnly',
  'version.restore',
]);

export function assertOperationAllowed(
  role: ViewerRole,
  status: WorkshopStatus,
  operation: BoardOperation,
): void {
  const forbidden = role === 'facilitator' ? FACILITATOR_FORBIDDEN : PARTICIPANT_FORBIDDEN;
  if (forbidden.has(operation)) throw new AppError('forbidden');
  if (PERMITTED[role][status].includes(operation)) return;
  if (TERMINAL_STATUSES.has(status)) throw new AppError('workshop_closed');
  throw new AppError('phase_locked', {
    message: `That isn't available while the workshop is ${statusLabel(status)}`,
  });
}

/** Rejects a write that arrives at or after the deadline the server holds. */
export function assertBeforeDeadline(deadlineMs: number | null, nowMs: number): void {
  if (deadlineMs !== null && nowMs >= deadlineMs) throw new AppError('deadline_passed');
}
