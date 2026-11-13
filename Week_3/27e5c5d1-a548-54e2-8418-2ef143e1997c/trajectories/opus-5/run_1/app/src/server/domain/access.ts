import type { BoardRole, MembershipState, Visibility, WorkspaceRole } from '../../shared/types';

/**
 * The one place that decides a person's effective role on a board.
 * `workspaceRole` is null when the person is not a current member of the board's workspace.
 */
export function effectiveBoardRole(
  workspaceRole: WorkspaceRole | null,
  visibility: Visibility,
  state: MembershipState,
): BoardRole | null {
  if (workspaceRole === null) return null;
  if (state === 'removed') return null;
  if (state === 'none') return visibility === 'workspace' ? 'observer' : null;
  return state;
}

export function canEditCards(role: BoardRole): boolean {
  return role === 'member' || role === 'admin';
}

export function isBoardAdmin(role: BoardRole): boolean {
  return role === 'admin';
}

/** A card is private when its private member list is not empty. */
export function canSeeCard(role: BoardRole, privateMembers: readonly string[], userId: string): boolean {
  if (privateMembers.length === 0) return true;
  if (role === 'observer') return false;
  return privateMembers.includes(userId);
}
