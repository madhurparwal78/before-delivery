import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { announce } from '../../announce';
import { useLive } from '../../live';
import type { Profile } from '../../types';
import { pathKey, type PathItem } from './ConnectionPath';

interface ProfileData {
  status: 'loading' | 'ready' | 'unavailable';
  /** The last profile read; kept after the page stops being available so a block can finish its sequence. */
  profile: Profile | undefined;
  path: PathItem[];
  refresh: () => Promise<void>;
}

/**
 * Reads a profile and, at degree 2 or 3, its connection path; reads both again when the server says the graph,
 * the network or this member's skills changed. A changed path that still exists is announced.
 */
export function useProfile(handle: string): ProfileData {
  const [status, setStatus] = useState<ProfileData['status']>('loading');
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [path, setPath] = useState<PathItem[]>([]);
  const lastPath = useRef('');
  const latest = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const ticket = ++latest.current;
    try {
      const loaded = await api.get<Profile>(`/api/profiles/${handle}`);
      const nextPath = loaded.degree === '2' || loaded.degree === '3' ? (await api.get<{ path: PathItem[] }>(`/api/profiles/${handle}/path`)).path : [];
      if (ticket !== latest.current) return;
      const key = pathKey(nextPath);
      if (lastPath.current !== '' && key !== '' && key !== lastPath.current) announce('Network announcements', 'Connection path changed.');
      lastPath.current = key;
      setProfile(loaded);
      setPath(nextPath);
      setStatus('ready');
    } catch (error) {
      if (ticket !== latest.current) return;
      if (error instanceof ApiError && error.status === 404) setStatus('unavailable');
    }
  }, [handle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLive(['graph', 'network', 'connected', 'skills', 'reconnected'], (event) => {
    if (event.type === 'skills' && event.member_id !== profile?.id) return;
    void refresh();
  });

  return { status, profile, path, refresh };
}
