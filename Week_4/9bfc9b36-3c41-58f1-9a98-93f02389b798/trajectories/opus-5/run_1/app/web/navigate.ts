/** The one place that changes the address and asks the router to paint. */

type Painter = (path: string, replace: boolean) => void;

let painter: Painter = () => undefined;

export function setPainter(next: Painter): void {
  painter = next;
}

export function go(path: string): void {
  history.pushState(null, '', path);
  painter(path, false);
}

export function replace(path: string): void {
  history.replaceState(null, '', path);
  painter(path, true);
}

/** `resume` is honoured only when it is `/`, or `/` then a character other than `/` or `\`. */
export function resumeAllowed(value: string | null): string | null {
  if (value === null || value === '') return null;
  if (value === '/') return '/';
  if (!value.startsWith('/')) return null;
  const second = value.slice(1, 2);
  if (second === '/' || second === '\\') return null;
  return value;
}

export function homeOf(role: string): string {
  if (role === 'sailmaker') return '/loft';
  if (role === 'loft-hand') return '/floor';
  return '/owner';
}
