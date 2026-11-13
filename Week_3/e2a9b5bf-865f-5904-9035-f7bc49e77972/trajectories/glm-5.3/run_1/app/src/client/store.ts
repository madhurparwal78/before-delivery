// The device's copy of one account's data and its sync journal
// (DP-18, DP-20, DP-82, DP-88, DP-90, DP-91).
import type {
  Kit, ObjectHistory, Observation, Packet, ProgramDetail, ProgramSummary,
  SessionSummary, SessionWithObservations, Site, SyncChange, SyncResult, Account,
} from "../shared/api.js";
import { SYNC_CHANGE_LIMIT } from "../shared/strokes.js";

export interface AccountStore {
  kit: Kit | null;
  sites: Site[];
  programs: ProgramSummary[];
  programDetails: Record<string, ProgramDetail>;
  sessions: Record<string, SessionWithObservations>;
  sessionOrder: string[];
  histories: Record<string, ObjectHistory>;
  observations: Record<string, Observation>;
  strokes: Record<string, string>;
  packets: Record<string, Packet>;
  lastRefreshAt: number;
}

export function emptyAccountStore(): AccountStore {
  return {
    kit: null,
    sites: [],
    programs: [],
    programDetails: {},
    sessions: {},
    sessionOrder: [],
    histories: {},
    observations: {},
    strokes: {},
    packets: {},
    lastRefreshAt: 0,
  };
}

export interface JournalEntry {
  readonly change: SyncChange;
  readonly kind: "session.create" | "session.optics" | "observation.create" | "observation.update" | "sketch.put" | "observation.delete";
}

export interface SavedState {
  signedInAccountId: string | null;
  accountEmail: string | null;
  lastSignedInEmail: string | null;
  stores: Record<string, AccountStore>;
  journals: Record<string, JournalEntry[]>;
  drafts: Record<string, Record<string, ObservationDraft>>;
  newObservationDrafts: Record<string, Record<string, ObservationDraft>>;
  activeSessionId: Record<string, string | null>;
  activeObservationId: Record<string, string | null>;
  latestSession: string | null;
  deviceName: string;
  signedOutExplicitly: boolean;
}

export interface ObservationDraft {
  observedAt: string;
  seeing: string;
  transparencyNelm: string;
  concentrationClass: string;
  description: string;
  strokes: string | null;
  pair: { primary: [number, number] | null; secondary: [number, number] | null } | null;
  undoStack: string[];
  optics: { telescope_id: string; eyepiece_id: string; barlow_id: string | null; train: string } | null;
}

const STORAGE_KEY = "lowlamp-state-v1";

export function loadState(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as SavedState;
    return { ...freshState(), ...parsed };
  } catch {
    return freshState();
  }
}

export function freshState(): SavedState {
  return {
    signedInAccountId: null,
    accountEmail: null,
    lastSignedInEmail: null,
    stores: {},
    journals: {},
    drafts: {},
    newObservationDrafts: {},
    activeSessionId: {},
    activeObservationId: {},
    latestSession: null,
    deviceName: defaultDeviceName(),
    signedOutExplicitly: false,
  };
}

export function saveState(state: SavedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota: keep the journal, drop the largest caches.
    try {
      const slim: SavedState = { ...state, stores: {} };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      // Nothing more to do offline.
    }
  }
}

export function defaultDeviceName(): string {
  const width = window.innerWidth;
  if (width < 600) return "phone";
  if (width < 1024) return "tablet";
  return "laptop";
}

export function journalFor(state: SavedState, accountId: string): JournalEntry[] {
  return state.journals[accountId] ?? [];
}

export function queueChange(state: SavedState, accountId: string, change: SyncChange, kind: JournalEntry["kind"]): void {
  const journal = state.journals[accountId] ?? [];
  journal.push({ change, kind });
  state.journals[accountId] = journal;
}

// Divide the journal so no request body exceeds the sync limit.
export function splitJournal(entries: readonly JournalEntry[]): JournalEntry[][] {
  const batches: JournalEntry[][] = [];
  for (let i = 0; i < entries.length; i += SYNC_CHANGE_LIMIT) {
    batches.push([...entries.slice(i, i + SYNC_CHANGE_LIMIT)]);
  }
  return batches;
}

export function accountStoreFor(state: SavedState, accountId: string): AccountStore {
  if (!state.stores[accountId]) state.stores[accountId] = emptyAccountStore();
  return state.stores[accountId]!;
}

export function draftFor(state: SavedState, accountId: string, observationId: string): ObservationDraft | null {
  return (state.drafts[accountId] ?? {})[observationId] ?? null;
}

export function newDraftFor(state: SavedState, accountId: string, sessionId: string): ObservationDraft | null {
  return (state.newObservationDrafts[accountId] ?? {})[sessionId] ?? null;
}
