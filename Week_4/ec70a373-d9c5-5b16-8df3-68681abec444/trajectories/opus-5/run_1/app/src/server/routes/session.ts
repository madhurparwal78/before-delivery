import { nowMs } from '../clock';
import { pool } from '../db';
import { ApiError, validationError } from '../http/errors';
import { closedBody, isEmail, requireString } from '../http/request';
import type { HandlerResult, RequestContext } from '../http/context';
import {
  destroySessionValue,
  issueSession,
  recordSignInFailure,
  signInThrottle,
  verifyCredentials,
  type SignedInUser,
} from '../domain/sessions';
import { memberByUser, truckByMember, validThroughFor } from '../domain/members';
import { accountQuarters } from '../domain/ledger';
import { siteJson, sitesOfTenant, siteById } from '../domain/sites';
import { sweepExpiredHolds } from '../domain/bookings';
import { sweepMemberExpiry } from '../domain/expiry';
import type { MeJson } from '../../shared/types';

function cookie(name: string, value: string, secure: boolean, httpOnly: boolean): string {
  const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Strict'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearedCookie(name: string, secure: boolean, httpOnly: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

async function meBody(user: SignedInUser): Promise<MeJson> {
  const tenant = await pool.query<{ id: string; name: string; legal_name: string }>(
    'select id, name, legal_name from tenants where id = $1',
    [user.tenant_id],
  );
  const tenantRow = tenant.rows[0] as { id: string; name: string; legal_name: string };
  const member = user.role === 'member' ? await memberByUser(user.user_id) : null;
  let memberJson: MeJson['member'] = null;
  if (member !== null) {
    await sweepMemberExpiry(member);
    const truck = await truckByMember(member.id);
    const available = await accountQuarters(pool, member.id, 'available');
    const committed = await accountQuarters(pool, member.id, 'committed');
    memberJson = {
      id: member.id,
      business_name: member.business_name,
      home_site_id: member.home_site_id,
      available_hours: available / 4,
      committed_hours: committed / 4,
      valid_through: await validThroughFor(null, member),
      truck:
        truck === null
          ? null
          : { id: truck.id, name: truck.name, permit_number: truck.permit_number },
    };
  }
  return {
    user: {
      id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenant: { id: tenantRow.id, name: tenantRow.name, legal_name: tenantRow.legal_name },
      site_id: user.site_id,
    },
    member: memberJson,
  };
}

export async function postSession(ctx: RequestContext): Promise<HandlerResult> {
  const body = ctx.json();
  closedBody(body, ['email', 'password']);
  const email = requireString(body, 'email', { message: 'Enter a valid email address.' });
  const password = requireString(body, 'password', {
    min: 1,
    max: 200,
    message: 'Enter your password.',
  });
  if (!isEmail(email)) throw validationError({ email: 'Enter a valid email address.' });
  const emailLower = email.toLowerCase();
  const throttle = await signInThrottle(emailLower, ctx.clientAddress);
  if (throttle.throttled) {
    throw new ApiError('too_many_attempts', {
      headers: { 'Retry-After': String(throttle.retryAfterSeconds) },
    });
  }
  const user = await verifyCredentials({ emailLower, password });
  if (user === null) {
    await recordSignInFailure(emailLower, ctx.clientAddress);
    const subject = await pool.query<{ id: string }>(
      'select id from users where email_lower = $1',
      [emailLower],
    );
    ctx.audit.subjectUserId = subject.rows.length === 0 ? null : (subject.rows[0] as { id: string }).id;
    throw new ApiError('invalid_credentials');
  }
  const issued = await issueSession(user.user_id, ctx.presentedSessionValue);
  ctx.audit.subjectUserId = user.user_id;
  ctx.user = user;
  return {
    status: 200,
    body: await meBody(user),
    setCookies: [
      cookie('pl_session', issued.sessionValue, ctx.secure, true),
      cookie('pl_csrf', issued.csrfValue, ctx.secure, false),
    ],
  };
}

export async function deleteSession(ctx: RequestContext): Promise<HandlerResult> {
  if (ctx.presentedSessionValue !== null) await destroySessionValue(ctx.presentedSessionValue);
  return {
    status: 204,
    setCookies: [
      clearedCookie('pl_session', ctx.secure, true),
      clearedCookie('pl_csrf', ctx.secure, false),
    ],
  };
}

export async function getMe(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  return { status: 200, body: await meBody(user) };
}

export async function getSites(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  await sweepExpiredHolds();
  const sites = await sitesOfTenant(user.tenant_id);
  const scoped =
    user.role === 'kitchen_manager'
      ? sites.filter((site) => site.id === user.site_id)
      : sites;
  return {
    status: 200,
    body: { sites: scoped.map((site) => siteJson(site, nowMs())) },
  };
}

/** A site the caller's role and scope may use, or the same 404 an unknown id gives. */
export async function requireSiteInScope(ctx: RequestContext, siteId: string) {
  const user = ctx.requireUser();
  const site = await siteById(siteId);
  if (site === null || site.tenant_id !== user.tenant_id) throw new ApiError('not_found');
  if (user.role === 'kitchen_manager' && site.id !== user.site_id) throw new ApiError('not_found');
  return site;
}

