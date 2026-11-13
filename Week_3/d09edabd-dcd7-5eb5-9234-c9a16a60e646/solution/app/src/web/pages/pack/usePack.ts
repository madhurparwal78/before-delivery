import { useEffect, useState } from 'react';
import { ApiFailure, get } from '../../api';
import type { Pack } from '../../../shared/types';

type PackLoad = { state: 'loading' } | { state: 'missing' } | { state: 'failed' } | { state: 'ready'; pack: Pack };

/** Loads the build pack a capability token opens: a refused token is `missing`, anything else that goes wrong is `failed`. */
export function usePack(token: string): PackLoad {
  const [load, setLoad] = useState<PackLoad>({ state: 'loading' });
  useEffect(() => {
    let waiting = true;
    const settle = (next: PackLoad): void => {
      if (waiting) setLoad(next);
    };
    get<Pack>(`/api/pack/${encodeURIComponent(token)}`).then(
      (pack) => settle({ state: 'ready', pack }),
      (error: unknown) => settle({ state: error instanceof ApiFailure && error.status === 404 ? 'missing' : 'failed' }),
    );
    return () => {
      waiting = false;
    };
  }, [token]);
  return load;
}
