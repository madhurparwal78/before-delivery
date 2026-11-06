/** Local-first notebook state, persisted in localStorage; vault notes stay encrypted on the device too. */

export interface Note {
  id: string;
  title: string;
  aliases: string[];
  frontmatter: Record<string, string>;
  body: string;
  private: boolean;
  createdAt: number;
}

export type Badge = 'local only' | 'pending' | 'synced' | 'conflict' | 'sync error' | 'paused';

export interface QueuedRevision {
  noteId: string;
  baseRevision: number | null;
  idemKey: string;
  plaintext: string;
  createdAt: number;
}

export interface VaultMeta {
  id: string;
  name: string;
  role: 'owner' | 'partner';
  createdAt: string;
}

export interface Account {
  id: string;
  email: string;
  display_name: string;
  time_zone: string;
  operator: boolean;
}

export interface Device {
  id: string;
  name: string;
  approved: boolean;
  created_at: string;
}

export interface Addon {
  state: 'none' | 'active' | 'ending' | 'grace' | 'lapsed';
  period_end: string | null;
  checked_at: string;
  source: 'killbill' | 'cache';
  writable_until?: string | null;
  warning_at?: string | null;
  takedown_at?: string | null;
}

export interface Dossier {
  id: string;
  slug: string;
  root_note_id: string;
  state: 'draft' | 'in_review' | 'published' | 'unpublished' | 'lapsed';
  radius: number | null;
  public_count: number | null;
  severed_count: number | null;
  published_at: string | null;
  url: string;
  preview_link: { id: string; state: string; created_at: string; expires_at: string } | null;
}

export interface Revision {
  rev: number;
  note_id: string;
  base_revision: number | null;
  ciphertext_sha256: string;
  byte_length: number;
  device_id: string;
  device_name: string;
  created_at: string;
  restored_from: number | null;
}

const KEY = 'cairn.state.v1';

export interface PersistedState {
  localNotes: Note[];
  openNoteId: string | null;
  notebooks: Record<string, Note[]>;
  vaultKeyRaw: Record<string, string>;
  vaultPassOk: Record<string, boolean>;
  queue: QueuedRevision[];
  badges: Record<string, Badge>;
  conflictCopies: Record<string, string>;
  dismissedConflicts: string[];
  deviceName: string | null;
  deviceId: string | null;
  dossiers: Record<string, { id: string; slug: string; root_note_id: string; radius: number }>;
  lastPreviewToken: Record<string, string>;
  restoreInfo: Record<string, string>;
}

const empty = (): PersistedState => ({
  localNotes: [],
  openNoteId: null,
  notebooks: {},
  vaultKeyRaw: {},
  vaultPassOk: {},
  queue: [],
  badges: {},
  conflictCopies: {},
  dismissedConflicts: [],
  deviceName: null,
  deviceId: null,
  dossiers: {},
  lastPreviewToken: {},
  restoreInfo: {},
});

export const load = (): PersistedState => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...(JSON.parse(raw) as Partial<PersistedState>) };
  } catch {
    return empty();
  }
};

let state: PersistedState = typeof localStorage === 'undefined' ? empty() : load();

export const get = (): PersistedState => state;

export const save = (next?: Partial<PersistedState>): void => {
  if (next) state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable: the in-memory state still works for this session
  }
};

export const reset = (): void => {
  state = empty();
  save();
};

export const uuid = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export const newIdemKey = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};
