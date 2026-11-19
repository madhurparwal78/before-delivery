import { config } from '../config.js';
import { ApiError, conflict, invalid, mailUnavailable, notSignedIn, rateLimited, tooLong } from '../http/errors.js';
import { clearedSessionCookie, sendJson, sessionCookie } from '../http/respond.js';
import { requireSignedIn, sessionIdOf, viewerOf } from '../http/context.js';
import type { Route } from '../http/router.js';
import {
  confirmMessage,
  confirmWithToken,
  createAccount,
  endSession,
  findUserByEmail,
  issueConfirmToken,
  NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordMatches,
  startSession,
  toSessionUser,
} from '../domain/accounts.js';
import { checkRate, recordRateEvent } from '../domain/ratelimit.js';
import { MailRefused, sendMail } from '../mail/smtp.js';
import { codePointLength } from '../../shared/limits.js';

const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

function readString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw invalid(field);
  return value;
}

function checkCredentials(name: string, email: string, password: string): void {
  if (codePointLength(name) < 1 || codePointLength(name) > NAME_MAX) {
    throw tooLong('name', NAME_MAX);
  }
  if (!EMAIL_SHAPE.test(email)) throw invalid('email');
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw invalid('password');
  }
}

async function deliverConfirmation(userId: string, email: string): Promise<void> {
  const token = await issueConfirmToken(userId);
  const message = confirmMessage(token);
  try {
    await sendMail({ to: email, subject: message.subject, body: message.body });
  } catch (error) {
    if (error instanceof MailRefused) throw mailUnavailable();
    throw error;
  }
}

function clientAddress(exchange: { req: { socket: { remoteAddress?: string | undefined } } }): string {
  return exchange.req.socket.remoteAddress ?? 'unknown';
}

export const accountRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/accounts',
    body: 'json',
    handle: async (exchange) => {
      const body = exchange.json<Record<string, unknown>>();
      const name = readString(body, 'name');
      const email = readString(body, 'email');
      const password = readString(body, 'password');
      checkCredentials(name, email, password);

      const created = await createAccount(name, email, password);
      if (created === null) throw conflict({ error: 'email_taken' });
      const sessionId = await startSession(created.id);
      const cookie = { 'Set-Cookie': sessionCookie(sessionId) };
      try {
        await deliverConfirmation(created.id, created.email);
      } catch (error) {
        if (error instanceof ApiError && error.status === 503) {
          sendJson(exchange.res, exchange.isEmbed, 503, error.body, cookie);
          return;
        }
        throw error;
      }
      sendJson(exchange.res, exchange.isEmbed, 201, { user: created, message_sent: true }, cookie);
    },
  },
  {
    method: 'POST',
    path: '/api/session',
    body: 'json',
    handle: async (exchange) => {
      const body = exchange.json<Record<string, unknown>>();
      const email = readString(body, 'email');
      const password = readString(body, 'password');
      const subject = `${email.toLowerCase()}|${clientAddress(exchange)}`;

      const verdict = await checkRate(
        'signin',
        subject,
        config.limits.signin_limit,
        config.limits.signin_window_seconds,
      );
      if (!verdict.allowed) throw rateLimited(verdict.retryAfter);

      const row = await findUserByEmail(email);
      if (row === null || !(await passwordMatches(password, row.password_hash))) {
        await recordRateEvent('signin', subject);
        throw new ApiError(401, { error: 'bad_credentials' });
      }
      const sessionId = await startSession(row.id);
      sendJson(exchange.res, exchange.isEmbed, 200, { user: toSessionUser(row) }, {
        'Set-Cookie': sessionCookie(sessionId),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/session',
    body: 'none',
    handle: async (exchange) => {
      const user = await viewerOf(exchange);
      if (user === null) throw notSignedIn();
      sendJson(exchange.res, exchange.isEmbed, 200, { user });
    },
  },
  {
    method: 'DELETE',
    path: '/api/session',
    body: 'none',
    handle: async (exchange) => {
      const sessionId = sessionIdOf(exchange);
      if (sessionId !== null) await endSession(sessionId);
      exchange.res.writeHead(204, {
        'Set-Cookie': clearedSessionCookie(),
        'Content-Security-Policy': "frame-ancestors 'self'",
      });
      exchange.res.end();
    },
  },
  {
    method: 'POST',
    path: '/api/account/resend',
    body: 'json',
    handle: async (exchange) => {
      const user = requireSignedIn(await viewerOf(exchange));
      if (user.confirmed) throw conflict({ error: 'already_confirmed' });
      const verdict = await checkRate(
        'resend',
        user.id,
        config.limits.resend_limit,
        config.limits.resend_window_seconds,
      );
      if (!verdict.allowed) throw rateLimited(verdict.retryAfter);
      await recordRateEvent('resend', user.id);
      await deliverConfirmation(user.id, user.email);
      sendJson(exchange.res, exchange.isEmbed, 200, { sent: true });
    },
  },
  {
    method: 'POST',
    path: '/api/account/confirm',
    body: 'json',
    handle: async (exchange) => {
      const body = exchange.json<Record<string, unknown>>();
      const token = readString(body, 'token');
      const outcome = await confirmWithToken(token);
      if (outcome === 'invalid') throw new ApiError(410, { error: 'token_invalid' });
      sendJson(exchange.res, exchange.isEmbed, 200, { confirmed: true });
    },
  },
];
