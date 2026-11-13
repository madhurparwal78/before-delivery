import type { Request, RequestHandler } from 'express';

export interface SessionPerson {
  id: string;
  name: string;
  first_name: string;
  email: string;
  role: 'founder_admin' | 'board_member' | 'option_holder' | 'leaver' | 'investor';
  access: 'active' | 'removed' | 'none';
  terminated_at: string | null;
  termination_date: string | null;
  window_ends_at: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    person?: SessionPerson;
    sessionId?: string;
  }
}

export const SESSION_COOKIE = 'holdfast_session';

export function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export type Handler = RequestHandler;
export type Req = Request;

