import { useEffect, useState, useSyncExternalStore, type ReactNode, createContext, useContext } from 'react';
import type { ProjectResponse } from '../../shared/protocol';
import { api, ApiError } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import { EditorContext, type Editor } from './model';
import { EditorStore } from './store';

const StoreContext = createContext<EditorStore | null>(null);

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; store: EditorStore };

export function useEditorStore(): EditorStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useEditorStore needs an EditorProvider');
  return store;
}

/** Re-renders only when the selected value changes, so playback does not redraw every panel. */
export function useEditorSelector<T>(select: (editor: Editor) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}

function Live({ store, children }: { store: EditorStore; children: ReactNode }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <StoreContext.Provider value={store}>
      <EditorContext.Provider value={snapshot}>{children}</EditorContext.Provider>
    </StoreContext.Provider>
  );
}

/** Loads the project for the signed-in person and provides the editor state to `children`. */
export function EditorProvider({ projectId, loading, missing, children }: { projectId: string; loading: ReactNode; missing: ReactNode; children: ReactNode }) {
  const session = useSession();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (session.status === 'out') navigate('/signin', true);
  }, [session.status]);

  useEffect(() => {
    if (session.status !== 'in' || !session.user) return;
    const user = session.user;
    let store: EditorStore | undefined;
    let cancelled = false;
    api
      .get<ProjectResponse>(`/api/projects/${projectId}`)
      .then((response) => {
        if (cancelled) return;
        store = new EditorStore(projectId, user, response);
        setState({ status: 'ready', store });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) navigate('/signin', true);
        else if (error instanceof ApiError && error.status === 404) setState({ status: 'missing' });
        else throw error;
      });
    return () => {
      cancelled = true;
      store?.dispose();
    };
  }, [projectId, session.status, session.user]);

  if (state.status === 'loading') return <>{loading}</>;
  if (state.status === 'missing') return <>{missing}</>;
  return <Live store={state.store}>{children}</Live>;
}
