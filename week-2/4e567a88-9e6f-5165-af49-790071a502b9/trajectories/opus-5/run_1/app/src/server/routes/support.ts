import { createHash } from 'node:crypto';
import { fail } from '../errors';
import { Ctx } from '../http/router';
import { currentPolicy } from '../store/policy';
import { Team, allTeams } from '../store/people';
import { Caller, JsonValue, Policy, Role } from '../types';

export async function policyNow(): Promise<Policy> {
  return currentPolicy();
}

export function requireRole(caller: Caller, roles: readonly Role[]): void {
  if (!roles.includes(caller.member.role)) throw fail.forbidden();
}

/** Only a team member submits work; the call returns the team the work belongs to. */
export function requireTeamMember(caller: Caller): string {
  if (caller.member.role !== 'member' || caller.member.teamId === null) throw fail.forbidden();
  return caller.member.teamId;
}

/** The team a request is about: a member's own team, or the team an org role chose. */
export async function resolveTeam(ctx: Ctx, options: { required: boolean }): Promise<Team> {
  const requested = ctx.query.get('team');
  const teams = await allTeams();
  const member = ctx.caller.member;
  if (member.role === 'member') {
    const own = teams.find((team) => team.id === member.teamId);
    if (!own) throw fail.notFound();
    if (requested !== null && requested !== own.id) throw fail.notFound();
    return own;
  }
  if (requested === null) {
    if (options.required) throw fail.notFound();
    const first = teams[0];
    if (!first) throw fail.notFound();
    return first;
  }
  const chosen = teams.find((team) => team.id === requested);
  if (!chosen) throw fail.notFound();
  return chosen;
}

export function teamOrNotFound(teams: readonly Team[], teamId: string): Team {
  const team = teams.find((candidate) => candidate.id === teamId);
  if (!team) throw fail.notFound();
  return team;
}

/** A member reads only their own team; org roles read every team. */
export function assertTeamReadable(caller: Caller, teamId: string): void {
  if (caller.member.role === 'member' && caller.member.teamId !== teamId) throw fail.notFound();
}

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonical(value[key]!);
    return sorted;
  }
  return value;
}

/** Two bodies are the same when model, input and priority are equal after JSON parsing. */
export function submissionFingerprint(model: JsonValue, input: JsonValue, priority: string): string {
  const payload = JSON.stringify(canonical({ model, input, priority }));
  return createHash('sha256').update(payload).digest('hex');
}

export function readLimit(ctx: Ctx): number {
  const raw = ctx.query.get('limit');
  if (raw === null) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw fail.validation({ limit: 'Enter a whole number from 1 to 200.' });
  }
  return parsed;
}

export function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}
