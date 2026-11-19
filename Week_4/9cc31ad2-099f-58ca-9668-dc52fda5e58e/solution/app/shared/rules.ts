// Rules the browser and the server both apply, decided once here.

// The next-address rule: a guest start follows `next` only when, after URL decoding, it is
// `/lobby/` followed by letters, digits, `-` or `_` and nothing else.
const LOBBY_PATH = /^\/lobby\/[A-Za-z0-9_-]+$/;

export function acceptedNext(decoded: string | null): string | null {
  return decoded !== null && LOBBY_PATH.test(decoded) ? decoded : null;
}

// Where a visitor without a session lands: lobby invites keep their path as `next`.
export function sessionlessLanding(path: string): string {
  return acceptedNext(path) && path !== "/lobby/new" ? `/?next=${encodeURIComponent(path)}` : "/";
}

// The refit refund: half of what the car paid for the system's fitted stages, rounded down.
export function refitRefund(paid: number): number {
  return Math.floor(paid / 2);
}

export const LEAGUE_TARGET = 50;
export const BOARD_SIZE = 50;
