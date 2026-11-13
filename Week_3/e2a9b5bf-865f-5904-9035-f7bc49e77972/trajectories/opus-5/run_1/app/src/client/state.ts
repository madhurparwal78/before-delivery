import type {
  Account,
  CatalogueObject,
  Kit,
  Observation,
  ObservingSession,
  Packet,
  Program,
  ProgramObjectRow,
  Site,
} from '../shared/types.js';
import { get, put, STORE_CACHE, STORE_META } from './idb.js';

/** The last state the server told this device about, kept per account. */
export interface DeviceCopy {
  kit: Kit | null;
  sites: Site[];
  objects: CatalogueObject[];
  programs: Program[];
  program_objects: Record<string, ProgramObjectRow[]>;
  sessions: Record<string, ObservingSession>;
  observations: Record<string, Observation>;
  stroke_files: Record<string, string>;
  packets: Record<string, Packet>;
  complete: boolean;
}

export function emptyCopy(): DeviceCopy {
  return {
    kit: null,
    sites: [],
    objects: [],
    programs: [],
    program_objects: {},
    sessions: {},
    observations: {},
    stroke_files: {},
    packets: {},
    complete: false,
  };
}

export interface AppState {
  account: Account | null;
  copy: DeviceCopy;
  waiting: number;
  offline: boolean;
  /** A sync answered 401 while the journal still holds changes. */
  signedOutWithWork: boolean;
  deviceName: string;
}

const state: AppState = {
  account: null,
  copy: emptyCopy(),
  waiting: 0,
  offline: typeof navigator !== 'undefined' && !navigator.onLine,
  signedOutWithWork: false,
  deviceName: 'laptop',
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function appState(): AppState {
  return state;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceStateChange(): void {
  for (const listener of [...listeners]) listener();
}

export function setAccount(account: Account | null): void {
  state.account = account;
  if (account === null) state.copy = emptyCopy();
}

/** The account the device last had signed in, so a reload opens on its work. */
export async function rememberAccount(account: Account | null): Promise<void> {
  await put(STORE_META, account, 'account').catch(() => undefined);
}

export async function readRememberedAccount(): Promise<Account | null> {
  return (await get<Account | null>(STORE_META, 'account').catch(() => null)) ?? null;
}

export function setOffline(offline: boolean): void {
  if (state.offline === offline) return;
  state.offline = offline;
  announceStateChange();
}

export function setSignedOutWithWork(value: boolean): void {
  if (state.signedOutWithWork === value) return;
  state.signedOutWithWork = value;
  announceStateChange();
}

export function setWaiting(count: number): void {
  if (state.waiting === count) return;
  state.waiting = count;
  announceStateChange();
}

function copyKey(accountId: string): string {
  return `${accountId}:copy`;
}

export async function loadCopy(accountId: string): Promise<void> {
  const stored = await get<DeviceCopy>(STORE_CACHE, copyKey(accountId)).catch(() => undefined);
  state.copy = stored ? { ...emptyCopy(), ...stored } : emptyCopy();
}

let saveTimer: number | null = null;

export function saveCopy(): void {
  const account = state.account;
  if (!account) return;
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void put(STORE_CACHE, state.copy, copyKey(account.id)).catch(() => undefined);
  }, 120);
}

export function updateCopy(change: (copy: DeviceCopy) => void): void {
  change(state.copy);
  saveCopy();
  announceStateChange();
}

/** The name this device reports in sync, defaulting by viewport width. */
export function defaultDeviceName(): string {
  const width = window.innerWidth;
  if (width < 600) return 'phone';
  if (width < 1024) return 'tablet';
  return 'laptop';
}

export async function loadDeviceName(): Promise<void> {
  const stored = await get<string>(STORE_META, 'device_name').catch(() => undefined);
  state.deviceName = stored ?? defaultDeviceName();
}

export async function setDeviceName(name: string): Promise<void> {
  state.deviceName = name;
  await put(STORE_META, name, 'device_name').catch(() => undefined);
}
