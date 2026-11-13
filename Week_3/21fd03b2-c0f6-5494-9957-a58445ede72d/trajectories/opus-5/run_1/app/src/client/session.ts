import { useEffect, useState } from 'react';
import type { MeResponse } from '../shared/api.js';
import { api } from './api.js';

let cached: MeResponse | null = null;

export interface SessionState {
  me: MeResponse | null;
  loading: boolean;
  reload: () => void;
}

/** The signed-in account and its workspaces. */
export function useSession(): SessionState {
  const [me, setMe] = useState<MeResponse | null>(cached);
  const [loading, setLoading] = useState(cached === null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    void api<MeResponse>('/api/me')
      .then((response) => {
        if (!live) return;
        cached = response;
        setMe(response);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [nonce]);
  return { me, loading, reload: () => setNonce((value) => value + 1) };
}

export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
