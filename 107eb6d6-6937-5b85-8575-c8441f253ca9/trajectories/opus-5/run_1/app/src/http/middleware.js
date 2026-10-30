import express from 'express';
import { config } from '../config.js';
import { memberForToken } from '../domain/auth.js';
import {
  AppError,
  COPY,
  badRequest,
  forbidden,
  tooLarge,
  unauthenticated,
  unsupportedMediaType
} from '../domain/errors.js';

export const bearerToken = (req) => {
  const header = req.get('authorization') ?? '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
};

export const sessionToken = (req) => {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === config.sessionCookie) return decodeURIComponent(rest.join('='));
  }
  return null;
};

const hasBody = (req) =>
  req.get('transfer-encoding') !== undefined || Number.parseInt(req.get('content-length') ?? '0', 10) > 0;

export function requireJsonBody(req, res, next) {
  if (hasBody(req) && !req.is('application/json')) return next(unsupportedMediaType());
  next();
}

export const jsonBody = express.json({ limit: config.bodyLimitBytes });
export const formBody = express.urlencoded({ extended: true, limit: config.bodyLimitBytes });

export function bodyErrors(error, req, res, next) {
  if (error?.type === 'entity.too.large') return next(tooLarge());
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    return next(badRequest(COPY.notJson));
  }
  next(error);
}

export function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    const host = URL.canParse(origin) ? new URL(origin).host : null;
    if (host !== req.get('host')) return next(forbidden());
  }
  next();
}

export const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export const apiSession = asyncRoute(async (req, res, next) => {
  const member = await memberForToken(bearerToken(req));
  if (!member) throw unauthenticated();
  req.member = member;
  next();
});

export const pageSession = asyncRoute(async (req, res, next) => {
  const member = await memberForToken(sessionToken(req));
  if (!member) {
    const signIn = `/login?next=${encodeURIComponent(req.originalUrl.split('?')[0])}`;
    if (req.get('hx-request')) {
      res.set('HX-Redirect', signIn);
      return res.status(200).end();
    }
    return res.redirect(303, signIn);
  }
  req.member = member;
  next();
});

export const apiErrors = (error, req, res, next) => {
  if (error instanceof AppError) {
    return res.status(error.status).set(error.headers).json(error.body);
  }
  console.error('unhandled API error', error);
  return res.status(500).json({ error: 'server_error' });
};
