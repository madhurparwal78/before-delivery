import { useSyncExternalStore } from 'react';

// Notices and errors: the toast band `status "Page notice"` and the lemon band `alert`.
interface NoticeState { page: string; error: string; toastMs: number; live: boolean }

let state: NoticeState = { page: '', error: '', toastMs: 4000, live: true };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function set(patch: Partial<NoticeState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export const setToastLifetime = (ms: number): void => set({ toastMs: ms });

// A notice disappears after the toast lifetime.
export function notify(text: string): void {
  if (timer) clearTimeout(timer);
  set({ page: text });
  timer = setTimeout(() => set({ page: '' }), state.toastMs);
}

export const pending = (): void => notify('Saving...');
export const raise = (text: string): void => set({ error: text });
export const clearError = (): void => set({ error: '' });
export const setLiveConnection = (live: boolean): void => set({ live });

function useNotices(): NoticeState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export function Bands(): React.ReactNode {
  const { page, error, live } = useNotices();
  return (
    <div className="bands">
      <div role="status" aria-label="Page notice" className={`band ${page ? 'band-on' : ''}`}>{page}</div>
      <div role="alert" className={`band ${error ? 'band-on band-lemon' : ''}`}>{error}</div>
      <div role="status" aria-label="Live connection" className={`band ${live ? '' : 'band-on band-lemon'}`}>
        {live ? '' : 'Live updates paused. Reconnecting...'}
      </div>
    </div>
  );
}
