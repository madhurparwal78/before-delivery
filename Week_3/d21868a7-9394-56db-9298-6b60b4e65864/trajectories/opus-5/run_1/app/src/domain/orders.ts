/** Order statuses, their labels and the one place every order move is judged. */

export type OrderStatus = 'requested' | 'scheduled' | 'running' | 'delivered' | 'closed';
export type OrderConflict = null | 'restriction' | 'lapsed';

const LABELS: Record<OrderStatus, string> = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  running: 'Running',
  delivered: 'Delivered',
  closed: 'Closed',
};

export function orderStatusLabel(status: OrderStatus): string {
  return LABELS[status];
}

/** The board's Window orders Status cell marks a lapsed close. */
export function boardOrderStatusLabel(status: OrderStatus, conflict: OrderConflict): string {
  return status === 'closed' && conflict === 'lapsed' ? 'Closed (lapsed)' : LABELS[status];
}

/** An order counts against its window and allocation in these states. */
export function countsAgainstWindow(status: OrderStatus, closedAfterFlow: boolean): boolean {
  return status === 'scheduled' || status === 'running' || status === 'delivered' || (status === 'closed' && closedAfterFlow);
}

export type OrderMove =
  | 'cancel'
  | 'dispatcher-close'
  | 'schedule'
  | 'ration'
  | 'restriction-move'
  | 'lapse'
  | 'start-stroke'
  | 'finish-stroke'
  | 'reopen';

/**
 * Whether a move is legal from a status at all. Moves that are legal here can
 * still be refused by the capacity, turnout, window and card checks that the
 * business rules attach to them.
 */
export function isLegalMove(move: OrderMove, status: OrderStatus): boolean {
  switch (move) {
    case 'cancel':
      return status === 'requested' || status === 'scheduled';
    case 'dispatcher-close':
      return status === 'requested' || status === 'scheduled' || status === 'running';
    case 'schedule':
    case 'ration':
      return status === 'requested';
    case 'restriction-move':
      return status === 'scheduled';
    case 'lapse':
      return status === 'requested' || status === 'scheduled';
    case 'start-stroke':
      return status === 'scheduled';
    case 'finish-stroke':
      return status === 'running';
    case 'reopen':
      return status === 'closed';
  }
}
