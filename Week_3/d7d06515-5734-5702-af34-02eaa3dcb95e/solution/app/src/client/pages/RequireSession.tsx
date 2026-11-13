// Signed-in guard: GET /api/me, a 401 sends the visitor to /signin (brief: Pages).
import { useEffect, useState, type ReactNode } from 'react';
import type { MeResponse } from '../../shared/types.ts';
import { get } from '../api.ts';
import { navigate } from '../router.tsx';
import { LoadingStrokes } from '../ui/LoadingStrokes.tsx';
import { isUnauthenticated } from './errors.ts';

const RETRY_MS = 2000;

export function RequireSession({ children }: { children: (me: MeResponse) => ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (): void => {
      get<MeResponse>('/api/me').then(
        (value) => { if (active) setMe(value); },
        (error: unknown) => {
          if (!active) return;
          if (isUnauthenticated(error)) navigate('/signin', { replace: true });
          else timer = setTimeout(load, RETRY_MS);
        },
      );
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  if (!me) return <main className="page-loading"><h1 className="sr-only">Loading</h1><LoadingStrokes /></main>;
  return <>{children(me)}</>;
}
