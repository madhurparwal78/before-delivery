export const SESSION_COOKIE = "tw_session";
export const VISITOR_COOKIE = "tw_visitor";

/** The cookie as a request carries it. */
export const sessionPair = (token: string): string => `${SESSION_COOKIE}=${token}`;

export function sessionCookie(token: string): string {
  return `${sessionPair(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function visitorCookie(id: string): string {
  return `${VISITOR_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}
