import { useEffect, useRef, useState } from 'react';
import { ApiFailure, Role, apiGet, collectionPath } from './api';
import { Validator, parseValidator } from '../shared/validator';
import { fromJson } from '../shared/values';

export type Viewport = 'phone' | 'tablet' | 'desktop';

export function useViewport(): Viewport {
  const read = (): Viewport => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.matchMedia('(min-width: 1280px)').matches) return 'desktop';
    if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
    return 'phone';
  };
  const [viewport, setViewport] = useState<Viewport>(read);
  useEffect(() => {
    const update = (): void => setViewport(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return viewport;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export interface CollectionState {
  loading: boolean;
  missing: boolean;
  name: string;
  count: number;
  role: Role;
  projectName: string;
  validator: Validator | null;
  reload: () => void;
  setRole: (role: Role) => void;
  setCount: (count: number) => void;
}

interface CollectionAnswer {
  id: string;
  name: string;
  count: number;
  sequence: number;
  validator: unknown;
}

/** The collection a workspace screen works on, with the caller's current role. */
export function useCollection(pid: string, cid: string): CollectionState {
  const [state, setState] = useState<{
    loading: boolean;
    missing: boolean;
    name: string;
    count: number;
    role: Role;
    projectName: string;
    validator: Validator | null;
  }>({ loading: true, missing: false, name: '', count: 0, role: 'reader', projectName: '', validator: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      try {
        const project = await apiGet<{ id: string; name: string; role: Role }>(`/api/projects/${pid}`);
        const collection = await apiGet<CollectionAnswer>(collectionPath(pid, cid));
        if (!live) return;
        setState({
          loading: false,
          missing: false,
          name: collection.name,
          count: collection.count,
          role: project.role,
          projectName: project.name,
          validator: parseValidator(fromJson(collection.validator)),
        });
      } catch (error) {
        if (!live) return;
        if (error instanceof ApiFailure && error.status === 401) {
          setState((current) => ({ ...current, loading: false, missing: true }));
          return;
        }
        setState((current) => ({ ...current, loading: false, missing: true }));
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [pid, cid, nonce]);

  return {
    ...state,
    reload: () => setNonce((value) => value + 1),
    setRole: (role) => setState((current) => ({ ...current, role })),
    setCount: (count) => setState((current) => ({ ...current, count })),
  };
}

export interface ChangeEvent {
  seq: number;
  op: 'insert' | 'update' | 'delete';
  _id: string;
}

/** Listens to a collection's change feed, catching up from the last applied sequence. */
export function useCollectionEvents(
  pid: string,
  cid: string,
  onChange: (change: ChangeEvent) => void,
  onRole: (role: Role) => void,
): void {
  const changeRef = useRef(onChange);
  const roleRef = useRef(onRole);
  changeRef.current = onChange;
  roleRef.current = onRole;

  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let lastSeq = 0;
    const open = (): void => {
      if (closed) return;
      const query = lastSeq > 0 ? `?after=${lastSeq}` : '';
      source = new EventSource(`${collectionPath(pid, cid)}/events${query}`);
      source.addEventListener('change', (event) => {
        const change = JSON.parse((event as MessageEvent<string>).data) as ChangeEvent;
        lastSeq = change.seq;
        changeRef.current(change);
      });
      source.addEventListener('role', (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { role: Role };
        roleRef.current(payload.role);
      });
      source.onerror = () => {
        source?.close();
        if (!closed) window.setTimeout(open, 500);
      };
    };
    open();
    return () => {
      closed = true;
      source?.close();
    };
  }, [pid, cid]);
}
