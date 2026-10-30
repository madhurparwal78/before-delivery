import { now } from '../clock.js';
import { transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { json, noContent, type Reply, type RequestContext } from '../http.js';
import { confirmDraft, findHour, hasDraft } from '../domain/hours.js';
import { issueLink, verifyLink } from '../domain/links.js';
import { signInLetter } from '../domain/mail.js';
import { deliverNow, enqueue } from '../domain/outbox.js';
import { FIELD_MESSAGES, isValidEmail, normaliseEmail } from '../domain/planRules.js';
import { countRequest } from '../domain/rateLimit.js';
import {
  createSession,
  endSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionEmail,
} from '../domain/sessions.js';

const cookieFor = (token: string): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** Answers the same way for every address; only an address with a saved hour is written to. */
export async function requestSignInLink(ctx: RequestContext): Promise<Reply> {
  const at = await now();
  const value = ctx.body?.['email'];
  if (!isValidEmail(value)) throw new ApiError('invalid', { fields: { email: FIELD_MESSAGES.email } });
  const email = normaliseEmail(value);
  await countRequest('signin', email, at);

  const [hour, draft] = await Promise.all([findHour(email), hasDraft(email)]);
  if (hour || draft) {
    const letterId = await transaction(async (client) => {
      const token = await issueLink(client, { email, kind: 'signin', draftId: null }, at);
      return enqueue(client, signInLetter({ email, token }), at);
    });
    await deliverNow(letterId);
  }
  return json(202, { status: 'link_sent' });
}

export async function verifySignInLink(ctx: RequestContext): Promise<Reply> {
  const at = await now();
  const token = ctx.body?.['token'];
  if (typeof token !== 'string' || token.length === 0) {
    throw new ApiError('invalid', { fields: { token: FIELD_MESSAGES.token } });
  }
  const link = await verifyLink(token, at);
  if (link.kind === 'confirm' && link.draftId) await confirmDraft(link.draftId, at);
  const confirmed = link.kind === 'confirm' ? true : (await findHour(link.email)) !== null;
  const session = await createSession(link.email, at);
  return {
    status: 200,
    body: { signed_in: true, email: link.email, confirmed },
    setCookie: cookieFor(session),
  };
}

export async function signOut(ctx: RequestContext): Promise<Reply> {
  const token = ctx.cookie(SESSION_COOKIE);
  if (token) await endSession(token);
  return { ...noContent, setCookie: clearedCookie };
}

/** The signed-in address, or the published signed-out answer. */
export async function requireEmail(ctx: RequestContext, at: Date): Promise<string> {
  const token = ctx.cookie(SESSION_COOKIE);
  const email = token ? await sessionEmail(token, at) : null;
  if (!email) throw new ApiError('signed_out');
  return email;
}
