import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { query, queryOne } from '../db';
import { notSignedIn, refuse } from '../domain/errors';

const scryptAsync = promisify(scrypt);
const COOKIE_NAME = 'ob_owner';

export const hashPassphrase = async (passphrase: string, salt = randomBytes(16).toString('hex')): Promise<string> => {
  const derived = (await scryptAsync(passphrase, salt, 32)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
};

const passphraseMatches = async (passphrase: string, stored: string): Promise<boolean> => {
  const [salt, expected] = stored.split(':');
  const derived = (await scryptAsync(passphrase, salt, 32)) as Buffer;
  const expectedBuffer = Buffer.from(expected, 'hex');
  return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
};

export const readCookie = (header: string | undefined, name: string): string | null => {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

export const signIn = async (passphrase: string, response: Response): Promise<void> => {
  const credential = await queryOne<{ passphrase_hash: string }>('SELECT passphrase_hash FROM owner_credential WHERE id = 1');
  if (credential === null || !(await passphraseMatches(passphrase, credential.passphrase_hash))) {
    throw refuse(401, 'bad_passphrase', 'That passphrase is not right');
  }
  const token = randomBytes(32).toString('base64url');
  await query('INSERT INTO owner_session (token) VALUES ($1)', [token]);
  response.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', path: '/' });
};

/** Signing out ends every owner session on every device. */
export const signOutEverywhere = async (response: Response): Promise<void> => {
  await query('DELETE FROM owner_session');
  response.clearCookie(COOKIE_NAME, { path: '/' });
};

export const hasOwnerSession = async (request: Request): Promise<boolean> => {
  const token = readCookie(request.headers.cookie, COOKIE_NAME);
  if (token === null) return false;
  const row = await queryOne<{ token: string }>('SELECT token FROM owner_session WHERE token = $1', [token]);
  return row !== null;
};

/** Every owner API call refuses anyone without an owner session. */
export const requireOwner = async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
  try {
    if (!(await hasOwnerSession(request))) throw notSignedIn();
    next();
  } catch (error) {
    next(error);
  }
};
