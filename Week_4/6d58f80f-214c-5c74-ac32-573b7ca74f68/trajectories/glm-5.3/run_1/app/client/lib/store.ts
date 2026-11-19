import type { ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Person, Folder } from './types.js';
import { api } from './api.js';

export interface AppNotice {
  id: string;
  text: string;
  kind: 'info' | 'warning';
}

interface StoreState {
  person: Person | null;
  folders: Folder[];
  storage: { usedBytes: number; binBytes: number; quotaBytes: number } | null;
  services: { storage: 'up' | 'down'; directory: 'up' | 'down' };
  today: string;
  notices: AppNotice[];
  clockOffsetMs: number;
}

type Listener = () => void;

class Store {
  state: StoreState = {
    person: null,
    folders: [],
    storage: null,
    services: { storage: 'up', directory: 'up' },
    today: '',
    notices: [],
    clockOffsetMs: 0,
  };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  set(patch: Partial<StoreState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  addNotice(text: string, kind: 'info' | 'warning' = 'info'): void {
    const notice: AppNotice = { id: Math.random().toString(36).slice(2), text, kind };
    this.set({ notices: [notice, ...this.state.notices].slice(0, 5) });
  }

  removeNotice(id: string): void {
    this.set({ notices: this.state.notices.filter(n => n.id !== id) });
  }
}

export const store = new Store();

export function useStore<T>(selector: (s: StoreState) => T): T {
  const [value, setValue] = useState(selector(store.state));
  useEffect(() => {
    const update = () => setValue(selector(store.state));
    update();
    return store.subscribe(update);
  }, []);
  return value;
}

export async function bootstrapSession(): Promise<void> {
  try {
    const { person } = await api.session();
    store.set({ person });
    if (person.kind === 'staff') {
      const [{ folders }, storageRes] = await Promise.all([api.folders(), api.storage()]);
      store.set({ folders, storage: storageRes });
    }
  } catch {
    store.set({ person: null });
  }
  const clock = await api.clock();
  store.set({ today: clock.today, clockOffsetMs: Date.parse(clock.now) - Date.now() });
  const status = await api.status();
  store.set({ services: status as { storage: 'up' | 'down'; directory: 'up' | 'down' } });
}

export function connectEvents(): void {
  let ws: WebSocket | null = null;
  let retryTimer: number | null = null;
  let lastToday = store.state.today;

  const refetchFolders = async (): Promise<void> => {
    if (!store.state.person) return;
    try { store.set({ folders: (await api.folders()).folders }); } catch { /* keep old */ }
  };

  const refetchStorage = async (): Promise<void> => {
    if (store.state.person?.kind !== 'staff') return;
    try { store.set({ storage: await api.storage() }); } catch { /* keep old */ }
  };

  const handlers: Record<string, (data: Record<string, unknown>) => void> = {
    status: data => { store.set({ services: data as { storage: 'up' | 'down'; directory: 'up' | 'down' } }); },
    files_moved: () => { void refetchFolders(); },
    file_locked: () => { void refetchFolders(); },
    file_renamed: () => { void refetchFolders(); },
    folder_created: () => { void refetchFolders(); },
    files_binned: () => { void refetchFolders(); void refetchStorage(); },
    file_restored: () => { void refetchFolders(); void refetchStorage(); },
    file_purged: () => { void refetchFolders(); void refetchStorage(); },
    upload_confirmed: () => { void refetchFolders(); void refetchStorage(); },
    grant_created: () => { void refetchFolders(); },
    grant_changed: () => { void refetchFolders(); },
    grant_removed: () => { void refetchFolders(); },
    grant_ended: () => { void refetchFolders(); },
    handover_offered: () => { void refetchFolders(); },
    handover_accepted: () => { void refetchFolders(); },
    handover_declined: () => { void refetchFolders(); },
    handover_lapsed: () => { void refetchFolders(); },
    policy_scheduled: () => { /* settings screen refetches */ },
    policy_withdrawn: () => { /* settings screen refetches */ },
    notice: data => {
      const text = noticeText(data);
      if (text) store.addNotice(text);
    },
  };

  function connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/api/events`);
    ws.onopen = () => {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    };
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data as string) as { type: string; data: Record<string, unknown> };
        const handler = handlers[message.type];
        if (handler) handler(message.data);
        const clockPoll = async (): Promise<void> => {
          const clock = await api.clock();
          if (clock.today !== lastToday) {
            lastToday = clock.today;
            store.set({ today: clock.today });
            document.dispatchEvent(new CustomEvent('lintel:day-change'));
          }
        };
        void clockPoll();
      } catch { /* ignore bad frames */ }
    };
    ws.onclose = () => {
      retryTimer = window.setTimeout(() => { connect(); }, 3000);
    };
  }
  connect();
}

function noticeText(data: Record<string, unknown>): string | null {
  const kind = data['kind'] as string | undefined;
  const item = data['item'] as string | undefined;
  const date = data['date'] as string | undefined;
  const person = data['person'] as string | undefined;
  const folder = data['folder'] as string | undefined;
  switch (kind) {
    case 'gone': return `Your access to ${item} ended at the end of ${date}, Phoenix time.`;
    case 'editor_parent': return `Your editor access to ${item} ended at the end of ${date}, Phoenix time. You can still view it.`;
    case 'downgraded': return `Your access to ${item} is now view only.`;
    case 'removed': return `Your access to ${item} has been removed.`;
    case 'forbidden_write': return `You no longer have edit access to ${item}.`;
    case 'not_found': return `${item} is no longer available to you.`;
    case 'handover_accepted': return `${person} accepted ${folder}.`;
    case 'handover_declined': return `${person} declined ${folder}.`;
    case 'handover_lapsed': return `Your handover of ${folder} to ${person} lapsed. You still own it.`;
    default: return null;
  }
}
