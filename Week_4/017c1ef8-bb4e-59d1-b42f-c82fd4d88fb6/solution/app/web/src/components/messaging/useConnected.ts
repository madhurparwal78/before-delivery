import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useLive } from '../../live';
import type { Profile } from '../../types';

/** Whether the viewer is connected to this member now: only connections may message. `undefined` until the first answer. */
export function useConnected(handle: string): boolean | undefined {
  const [connected, setConnected] = useState<boolean | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const profile = await api.get<Profile>(`/api/profiles/${encodeURIComponent(handle)}`);
      setConnected(profile.connection_state === 'connected');
    } catch {
      setConnected(false);
    }
  }, [handle]);

  useEffect(() => {
    void load();
  }, [load]);

  useLive(['graph', 'reconnected'], () => void load());

  return connected;
}
