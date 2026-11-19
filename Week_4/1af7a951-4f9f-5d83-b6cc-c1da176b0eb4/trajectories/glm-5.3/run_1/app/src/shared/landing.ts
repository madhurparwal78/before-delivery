// The sign-in landing rule, decided in exactly one place.

export function landingFor(next: string | null, role: 'dreamer' | 'coach'): string {
  const own = role === 'dreamer' ? '/logbook' : '/coach';
  if (next === null || next === '') return own;
  // one leading slash, second char not / or backslash
  if (!next.startsWith('/') || next.length < 2) return own;
  if (next[1] === '/' || next[1] === '\\') return own;
  // no backslash anywhere, no colon before the first ? or #
  if (next.includes('\\')) return own;
  const cut = Math.min(...[next.indexOf('?'), next.indexOf('#')].filter((i) => i !== -1).concat([next.length]));
  const pathPart = next.slice(0, cut);
  if (pathPart.includes(':')) return own;
  const expected = role === 'dreamer' ? '/logbook' : '/coach';
  if (pathPart !== expected) return own;
  if (role === 'dreamer') return '/logbook';
  const q = next.indexOf('?');
  return q === -1 ? '/coach' : `/coach${next.slice(q)}`;
}
