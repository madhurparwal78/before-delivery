import { timingSafeEqual } from 'node:crypto';
import { FIELD_MESSAGES, UI } from '../../../shared/copy.js';
import type { StaffRole } from '../../../shared/types.js';
import { db } from '../../db/pool.js';
import { boundedText, parseBody, readEmail } from '../../http/body.js';
import { COOKIE, type ApiResponse, type RequestContext } from '../../http/context.js';
import { sealSession } from '../../http/cookies.js';
import { ApiError } from '../../http/errors.js';
import { errors } from '../../http/errors.js';
import { requireStaff } from '../sessions.js';

const SIGN_IN_SHAPE = {
  email: readEmail,
  password: boundedText(FIELD_MESSAGES.name, 1, 200),
} as const;

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function staffSignIn(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, SIGN_IN_SHAPE);
  const invalid = new ApiError(401, 'invalid_credentials', UI.studioSignInFailed);
  if (!parsed.ok) throw invalid;
  const result = await db.query<{ email: string; name: string; role: StaffRole; password: string }>(
    'SELECT email, name, role, password FROM staff WHERE email = $1',
    [parsed.value.email],
  );
  const row = result.rows[0];
  if (!row || !sameSecret(row.password, parsed.value.password)) throw invalid;
  ctx.setSessionCookie(COOKIE.staff, sealSession({ email: row.email }));
  return { status: 200, body: { staff: { email: row.email, name: row.name, role: row.role } } };
}

export async function staffSignOut(ctx: RequestContext): Promise<ApiResponse> {
  ctx.clearCookie(COOKIE.staff);
  return { status: 204 };
}

export async function staffMe(ctx: RequestContext): Promise<ApiResponse> {
  const staff = requireStaff(ctx);
  return { status: 200, body: { staff } };
}

export function auditImmutable(): Promise<ApiResponse> {
  throw errors.auditImmutable();
}
