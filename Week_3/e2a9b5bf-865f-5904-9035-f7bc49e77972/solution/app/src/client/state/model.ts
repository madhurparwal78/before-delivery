import type {
  Account,
  CatalogueObject,
  Change,
  Kit,
  Observation,
  Program,
  ProgramDetail,
  Session,
  Site,
} from "../../shared/types";
import { createStore } from "../lib/store";

export interface ServerCopy {
  kit: Kit | null;
  sites: Site[] | null;
  objects: CatalogueObject[] | null;
  programs: Program[] | null;
  programDetails: Record<string, ProgramDetail>;
  sessions: Record<string, Session>;
  observations: Record<string, Observation>;
  strokes: Record<string, string>;
}

export function emptyServerCopy(): ServerCopy {
  return { kit: null, sites: null, objects: null, programs: null, programDetails: {}, sessions: {}, observations: {}, strokes: {} };
}

export interface EntryMeta {
  designation: string | null;
  date: string;
  observationId: string | null;
  sessionId: string | null;
}

export interface JournalEntry {
  change: Change;
  announce: "save" | "queue";
  meta: EntryMeta;
}

interface AppState {
  phase: "booting" | "ready";
  /** The account this tab shows; null before sign-in or after sign-out. */
  account: Account | null;
  /** 'in' includes the offline device mode; 'out' sends visitors to sign-in. */
  auth: "unknown" | "in" | "out";
  /** The server answered 401 while changes were waiting: automatic sends stop. */
  expired: boolean;
  online: boolean;
  reachable: boolean;
  deviceLoaded: boolean;
  server: ServerCopy;
  journal: JournalEntry[];
  syncSentences: string[];
  deviceName: string;
  /** A one-off sentence for the Connection region (for example a sign-out that needed signal). */
  notice: string | null;
}

const DEVICE_KEY = "lowlamp:device";

function defaultDeviceName(): string {
  const stored = window.localStorage.getItem(DEVICE_KEY);
  if (stored) return stored;
  return window.innerWidth < 600 ? "phone" : window.innerWidth < 1024 ? "tablet" : "laptop";
}

export const app = createStore<AppState>({
  phase: "booting",
  account: null,
  auth: "unknown",
  expired: false,
  online: navigator.onLine,
  reachable: true,
  deviceLoaded: false,
  server: emptyServerCopy(),
  journal: [],
  syncSentences: [],
  deviceName: defaultDeviceName(),
  notice: null,
});

export function isOffline(state: AppState): boolean {
  return !state.online || !state.reachable;
}

export function accountId(): string | null {
  return app.get().account?.id ?? null;
}
