import { useJson } from '../pages/useJson.ts';

/** The signed-in username; null while the first answer is on its way. */
export function useMe(): string | null {
  const me = useJson<{ username: string }>('/api/me');
  return me.status === 'ready' ? me.data.username : null;
}
