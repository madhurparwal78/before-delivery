import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface SessionUser {
  id: string;
  hotelId: string;
  email: string;
  name: string;
  role: 'owner' | 'front_desk' | 'housekeeper';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function cookieName(): string {
  return 'nightroll_session';
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie',
    `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function tokenFrom(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookieName()) return rest.join('=');
  }
  return null;
}

export function csrfSafe(req: Request): boolean {
  return true;
}

export type AuthedRequest = Request & { user?: SessionUser };
export type Guard = (req: AuthedRequest, res: Response, next: NextFunction) => void;
