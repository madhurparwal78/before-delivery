import type { Session } from './api.js';

const ME_KEY = 'lf.me';
const SIGN_OUT_KEY = 'lf.pending_sign_out';

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    (record['role'] === 'dreamer' || record['role'] === 'coach') &&
    typeof record['name'] === 'string' &&
    typeof record['id'] === 'string'
  );
}

export function rememberedSession(): Session | null {
  const raw = localStorage.getItem(ME_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberSession(session: Session): void {
  localStorage.setItem(ME_KEY, JSON.stringify(session));
}

export function forgetSession(): void {
  localStorage.removeItem(ME_KEY);
}

export function markSignOutPending(): void {
  localStorage.setItem(SIGN_OUT_KEY, '1');
}

export function signOutPending(): boolean {
  return localStorage.getItem(SIGN_OUT_KEY) === '1';
}

export function clearSignOutPending(): void {
  localStorage.removeItem(SIGN_OUT_KEY);
}
