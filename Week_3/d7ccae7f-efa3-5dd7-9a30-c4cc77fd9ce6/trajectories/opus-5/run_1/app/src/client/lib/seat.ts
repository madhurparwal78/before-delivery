const PREFIX = 'lastbell.rejoin.';

export function rememberRejoinToken(roomId: string, token: string): void {
  window.localStorage.setItem(PREFIX + roomId, token);
}

export function storedRejoinToken(roomId: string): string | null {
  return window.localStorage.getItem(PREFIX + roomId);
}

export function forgetRejoinToken(roomId: string): void {
  window.localStorage.removeItem(PREFIX + roomId);
}

const STAGE_CLIENT_PREFIX = 'lastbell.stage.';

/** One stable client id per stage tab, so presence follows the tab. */
export function stageClientId(roomId: string): string {
  const key = STAGE_CLIENT_PREFIX + roomId;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const fresh = `stage-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  window.sessionStorage.setItem(key, fresh);
  return fresh;
}
