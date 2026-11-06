export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined || header === '') return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name !== '') out[name] = value;
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly?: boolean; maxAge?: number; path?: string; sameSite?: 'Lax' | 'Strict'; session?: boolean } = {},
): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.sameSite !== undefined) parts.push(`SameSite=${options.sameSite}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.session !== true && options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
}

export function deleteCookie(name: string, path = '/'): string {
  return `${name}=; Path=${path}; Max-Age=0`;
}
