// What a reload (or a returning session) keeps: per-account screen state in this tab's session storage.

const STATE = "tramela:state:";

export function loadScreen<T>(owner: string, key: string): T | null {
  const raw = sessionStorage.getItem(`${STATE}${owner}:${key}`);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveScreen(owner: string, key: string, value: unknown): void {
  sessionStorage.setItem(`${STATE}${owner}:${key}`, JSON.stringify(value));
}

export function dropScreen(owner: string, key: string): void {
  sessionStorage.removeItem(`${STATE}${owner}:${key}`);
}

function removeWhere(test: (key: string) => boolean): void {
  for (const key of Object.keys(sessionStorage)) if (test(key)) sessionStorage.removeItem(key);
}

/** Sign out: nothing of the person stays behind (saved screens, order messages, announced hold minutes). */
export function clearAllScreens(): void {
  removeWhere((key) => key.startsWith("tramela:"));
}

/** A different person signed in: the earlier person's saved screens are discarded. */
export function clearScreensExcept(owner: string): void {
  removeWhere((key) => key.startsWith(STATE) && !key.startsWith(`${STATE}${owner}:`));
}
