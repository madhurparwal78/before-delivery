export function readParam(name: string): string | null {
  return new URL(window.location.href).searchParams.get(name);
}

export function writeParam(name: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(window.history.state, '', url);
}

export function writeHash(hash: string): void {
  const url = new URL(window.location.href);
  url.hash = hash;
  window.history.replaceState(window.history.state, '', url);
}
