export type Route =
  | { name: 'signin'; next?: string }
  | { name: 'projects' }
  | { name: 'project'; pid: string; file?: string; line?: number; thread?: string }
  | { name: 'invite'; token: string }
  | { name: 'share'; token: string; file?: string }
  | { name: 'notfound' };

export function parsePath(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  if (pathname === '/signin') return { name: 'signin', next: params.get('next') ?? undefined };
  if (pathname === '/' || pathname === '') return { name: 'projects' };
  const pMatch = /^\/p\/([^/]+)$/.exec(pathname);
  if (pMatch) {
    const line = params.get('line');
    return {
      name: 'project',
      pid: decodeURIComponent(pMatch[1]),
      file: params.get('file') ?? undefined,
      line: line === null ? undefined : Number.parseInt(line, 10),
      thread: params.get('thread') ?? undefined,
    };
  }
  const iMatch = /^\/invite\/([^/]+)$/.exec(pathname);
  if (iMatch) return { name: 'invite', token: decodeURIComponent(iMatch[1]) };
  const sMatch = /^\/s\/([^/]+)$/.exec(pathname);
  if (sMatch) return { name: 'share', token: decodeURIComponent(sMatch[1]), file: params.get('file') ?? undefined };
  return { name: 'notfound' };
}

/** A same-origin path: exactly one slash, then anything but a slash or backslash. */
export function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next[1] === '/' || next[1] === '\\') return null;
  return next;
}

export function projectUrl(pid: string, opts?: { file?: string; line?: number; thread?: string }): string {
  const params = new URLSearchParams();
  if (opts?.file) params.set('file', opts.file);
  if (opts?.line !== undefined) params.set('line', String(opts.line));
  if (opts?.thread) params.set('thread', opts.thread);
  const q = params.toString();
  return `/p/${encodeURIComponent(pid)}${q ? `?${q}` : ''}`;
}

export function shareUrl(token: string, file?: string): string {
  const q = file ? `?file=${encodeURIComponent(file)}` : '';
  return `/s/${encodeURIComponent(token)}${q}`;
}
