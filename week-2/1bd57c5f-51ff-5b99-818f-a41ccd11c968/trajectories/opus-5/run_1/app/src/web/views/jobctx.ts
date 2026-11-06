import { COPY } from '../../shared/domain.js';
import { Offline, RequestFailed } from '../lib/api.js';
import { announce, isOffline } from '../lib/shell.js';
import type { JobState } from '../lib/jobstate.js';
import type { AccessCard, LocalItem } from '../lib/types.js';
import type { PlanViewport } from './planpane.js';

export type TabKey = 'punch' | 'setup' | 'people' | 'costs' | 'access' | 'outbox';

export type LayoutMode = 'wide' | 'rail' | 'sheet';

/** The published breakpoints: list beside plan, list with a rail, list with a bottom sheet. */
export function currentMode(): LayoutMode {
  if (window.matchMedia('(min-width: 1024px)').matches) return 'wide';
  if (window.matchMedia('(min-width: 768px)').matches) return 'rail';
  return 'sheet';
}

export type Ui = {
  tab: TabKey;
  selectedItemId: string | null;
  filters: { room: string; status: string; trade: string };
  quickAddRoom: string | null;
  showPlan: boolean;
  codes: AccessCard | null;
  codesError: string | null;
  placement: { itemId: string; x: number; y: number } | null;
  noteEditing: Set<string>;
  drafts: Record<string, string>;
  assignTrade: string;
  nothingChanged: { number: number; message: string }[] | null;
  planAspect: number;
  planViewport: PlanViewport | null;
  uploadingPhotos: Set<string>;
  pendingFrame: string | null;
};

export function freshUi(): Ui {
  return {
    tab: 'punch',
    selectedItemId: null,
    filters: { room: 'all', status: 'all', trade: 'all' },
    quickAddRoom: null,
    showPlan: false,
    codes: null,
    codesError: null,
    placement: null,
    noteEditing: new Set<string>(),
    drafts: {},
    assignTrade: 'all',
    nothingChanged: null,
    planAspect: 2 / 3,
    planViewport: null,
    uploadingPhotos: new Set<string>(),
    pendingFrame: null,
  };
}

export type JobCtx = {
  state: JobState;
  ui: Ui;
  render: () => void;
  navigate: (path: string) => void;
};

export function itemNumberText(item: LocalItem): string {
  return item.local === true || item.number === 0 ? 'new' : String(item.number);
}

export function rowName(item: LocalItem): string {
  return `Item ${itemNumberText(item)}: ${item.title}`;
}

/** Every async control: disabled and busy while pending, then one Activity sentence. */
export async function withPending<T>(
  control: HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null,
  run: () => Promise<T>,
  success: (value: T) => string,
  failure: (message: string) => string,
): Promise<T | null> {
  if (control !== null) {
    control.disabled = true;
    control.setAttribute('aria-busy', 'true');
  }
  announce(COPY.saving);
  try {
    const value = await run();
    announce(success(value));
    return value;
  } catch (error) {
    announce(failure(messageOf(error)));
    return null;
  } finally {
    if (control !== null) {
      control.disabled = false;
      control.removeAttribute('aria-busy');
    }
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof RequestFailed) {
    const fields = error.body.fields;
    if (fields !== undefined) {
      const first = Object.values(fields)[0];
      if (typeof first === 'string') return first;
    }
    return error.body.message;
  }
  if (error instanceof Offline) return COPY.offlineBanner;
  return String(error);
}

export function fieldMessages(error: unknown): Record<string, string> {
  return error instanceof RequestFailed ? (error.body.fields ?? {}) : {};
}

export function offlineNow(): boolean {
  return isOffline();
}
