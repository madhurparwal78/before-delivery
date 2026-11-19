const STORAGE_KEY = 'dotgain.key';

let cached: string | null = null;
let loaded = false;

export function heldKey(): string | null {
  if (!loaded) {
    cached = window.localStorage.getItem(STORAGE_KEY);
    loaded = true;
  }
  return cached;
}

export function holdKey(key: string): void {
  cached = key;
  loaded = true;
  window.localStorage.setItem(STORAGE_KEY, key);
}
