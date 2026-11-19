import type { SessionUser } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionToken?: string;
    }
  }
}

export {};
