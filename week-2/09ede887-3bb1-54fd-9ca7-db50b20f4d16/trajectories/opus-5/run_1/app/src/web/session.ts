import { api, setBearer, type AccountView } from './api.js';

const TOKEN_KEY = 'keel-outpost-token';

let account: AccountView | null = null;
const listeners = new Set<() => void>();

export function storedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function keepToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A browser with storage switched off still works for this visit.
  }
  setBearer(token);
}

export function currentAccount(): AccountView | null {
  return account;
}

export function onAccountChange(listener: () => void): void {
  listeners.add(listener);
}

function announceChange(): void {
  for (const listener of listeners) listener();
}

export async function restoreSession(): Promise<void> {
  const token = storedToken();
  if (token === null) return;
  setBearer(token);
  try {
    account = await api.me();
  } catch {
    account = null;
    keepToken(null);
  }
  announceChange();
}

export function adopt(token: string, next: AccountView): void {
  keepToken(token);
  account = next;
  announceChange();
}

export async function signOut(): Promise<void> {
  try {
    await api.logout();
  } finally {
    keepToken(null);
    account = null;
    announceChange();
  }
}
