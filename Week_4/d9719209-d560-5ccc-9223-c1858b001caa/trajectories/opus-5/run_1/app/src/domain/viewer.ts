import { db, many, one, type Queryable } from '../core/db.js';
import { iso } from '../core/time.js';

export interface Member {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  totpSecret: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  suspendedAt: string | null;
}

export interface Viewer {
  member: Member | null;
  /** Community ids the viewer moderates. */
  moderatorOf: Set<string>;
}

const MEMBER_FIELDS = [
  'id',
  'username',
  'email',
  'email_verified',
  'totp_enabled',
  'totp_secret',
  'role',
  'created_at',
  'suspended_at',
];

export function memberColumns(alias: string | null = 'm'): string {
  const prefix = alias === null ? '' : `${alias}.`;
  return MEMBER_FIELDS.map((field) => `${prefix}${field}`).join(', ');
}

export function toMember(row: Record<string, unknown>): Member {
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    emailVerified: row.email_verified === true,
    totpEnabled: row.totp_enabled === true,
    totpSecret: row.totp_secret === null || row.totp_secret === undefined ? null : String(row.totp_secret),
    role: row.role === 'admin' ? 'admin' : 'user',
    createdAt: iso(row.created_at),
    suspendedAt: row.suspended_at ? iso(row.suspended_at) : null,
  };
}

export async function loadMemberById(source: Queryable, id: string): Promise<Member | null> {
  const row = await one(source, `select ${memberColumns()} from members m where m.id = $1`, [id]);
  return row ? toMember(row) : null;
}

export async function loadMemberByUsername(username: string): Promise<Member | null> {
  const row = await one(db, `select ${memberColumns()} from members m where m.username_ci = $1`, [
    username.toLowerCase(),
  ]);
  return row ? toMember(row) : null;
}

export async function buildViewer(member: Member | null): Promise<Viewer> {
  if (!member) return { member: null, moderatorOf: new Set() };
  const rows = await many(db, 'select community_id from moderators where member_id = $1', [member.id]);
  return { member, moderatorOf: new Set(rows.map((row) => String(row.community_id))) };
}

export function viewerId(viewer: Viewer): string | null {
  return viewer.member ? viewer.member.id : null;
}

export function moderates(viewer: Viewer, communityId: string): boolean {
  return viewer.moderatorOf.has(String(communityId));
}

export function publicUser(username: unknown, createdAt: unknown): { username: string; createdAt: string } {
  return { username: String(username), createdAt: iso(createdAt) };
}

export function ownAccount(member: Member): Record<string, unknown> {
  return {
    id: member.id,
    username: member.username,
    email: member.email,
    emailVerified: member.emailVerified,
    totpEnabled: member.totpEnabled,
    role: member.role,
    createdAt: member.createdAt,
  };
}
