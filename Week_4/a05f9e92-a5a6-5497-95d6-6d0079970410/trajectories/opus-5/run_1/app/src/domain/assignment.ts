/**
 * Assignment rules and round robin. The first matching rule picks the group,
 * then the pointer moves to the next member who can take the work.
 */

export interface AssignmentRule {
  readonly name: string;
  readonly order: number;
  readonly table: string;
  readonly condition: string;
  readonly group: string;
  readonly active: boolean;
}

export interface GroupMember {
  readonly username: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly outOfOffice: boolean;
  readonly capacity: number | null;
  readonly openRecords: number;
}

export const triageGroup = 'Triage';

/** Active rules for the table, in ascending order then name in code-point order. */
export function sortRules(rules: readonly AssignmentRule[], table: string): AssignmentRule[] {
  return rules
    .filter((r) => r.active && r.table === table)
    .sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A member is skipped when inactive, out of office, or at capacity. */
export function canTake(member: GroupMember, defaultCapacity: number): boolean {
  if (!member.active) return false;
  if (member.outOfOffice) return false;
  const capacity = member.capacity ?? defaultCapacity;
  return member.openRecords < capacity;
}

/**
 * The next member who can take the work, starting after the one assigned last
 * and wrapping round. Null when no member fits.
 */
export function nextAssignee(
  members: readonly GroupMember[],
  lastAssigned: string | null,
  defaultCapacity: number,
): GroupMember | null {
  if (members.length === 0) return null;
  const lastIndex = lastAssigned === null ? -1 : members.findIndex((m) => m.username === lastAssigned);
  for (let step = 1; step <= members.length; step += 1) {
    const member = members[(lastIndex + step + members.length * 2) % members.length];
    if (canTake(member, defaultCapacity)) return member;
  }
  return null;
}

export function assignedLine(displayName: string, ruleName: string): string {
  return `Assigned to ${displayName} by rule "${ruleName}".`;
}

export function triageLine(group: string, number: string): string {
  return `No one in ${group} could take ${number}; sent to Triage.`;
}
