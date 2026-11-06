/**
 * The leave-kind and private-field projections. Kept to the server alone, so the health
 * information a line manager may not read never reaches a page or script it should not.
 */

const LEAVE_LABELS = {
  annual: 'Annual leave',
  sickness: 'Sickness',
  absence: 'Absence',
};

/** The raiser and people operations read the stored kind; a manager reads sickness as absence. */
export function projectLeaveKind(kind, readerSeesStoredKind) {
  if (readerSeesStoredKind) return kind;
  return kind === 'annual' ? 'annual' : 'absence';
}

export function leaveLabel(kind, status) {
  return `${LEAVE_LABELS[kind]}, ${status}`;
}

export function readerSeesStoredLeaveKind(caller, raiserId) {
  return caller.role === 'admin' || caller.id === raiserId;
}

/** Phone and private note reach people operations' request detail and nowhere else. */
export function projectContact(caller, raiserRow) {
  if (caller.role !== 'admin') return undefined;
  return { phone: raiserRow.phone, private_note: raiserRow.private_note };
}
