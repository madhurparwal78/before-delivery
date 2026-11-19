export type Role = 'dreamer' | 'coach';

const HOME_PATH: Record<Role, string> = { dreamer: '/logbook', coach: '/coach' };

export function signInLanding(role: Role, next: string | null): string {
  const home = HOME_PATH[role];
  if (next === null || next === '') return home;
  if (!next.startsWith('/')) return home;
  const second = next[1];
  if (second === '/' || second === '\\') return home;
  if (next.includes('\\')) return home;
  const queryAt = next.indexOf('?');
  const beforeQuery = queryAt === -1 ? next : next.slice(0, queryAt);
  if (beforeQuery.includes(':')) return home;
  const hashAt = beforeQuery.indexOf('#');
  const path = hashAt === -1 ? beforeQuery : beforeQuery.slice(0, hashAt);
  if (path !== home) return home;
  if (role === 'dreamer') return home;
  return queryAt === -1 ? home : `${home}${next.slice(queryAt)}`;
}
