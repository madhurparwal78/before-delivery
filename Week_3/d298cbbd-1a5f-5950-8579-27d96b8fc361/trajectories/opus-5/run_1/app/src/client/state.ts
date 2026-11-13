import { api } from './api.js';

export type Theme = 'sand' | 'cobalt' | 'carbon' | 'ledger';
export type CaretStyle = 'line' | 'block' | 'underline' | 'off';
export type QuickRestart = 'tab' | 'enter';

export interface TypistSettings {
  theme: Theme;
  caret: CaretStyle;
  smoothCaret: boolean;
  fontSize: number;
  blindMode: boolean;
  quickRestart: QuickRestart;
}

export const DEFAULT_SETTINGS: TypistSettings = {
  theme: 'sand',
  caret: 'line',
  smoothCaret: true,
  fontSize: 1.5,
  blindMode: false,
  quickRestart: 'tab',
};

export interface ServerConfig {
  focusWarningMs: number;
  maxExtraLetters: number;
  raceCountdownSeconds: number;
  raceRejoinSeconds: number;
}

export interface Session {
  id: string;
  name: string;
  verified: boolean;
}

export type TestModeName = 'time' | 'words' | 'quote' | 'custom';

export interface TestChoice {
  mode: TestModeName;
  timeLength: number;
  wordsLength: number;
  quoteLength: string;
  punctuation: boolean;
  numbers: boolean;
  customText: string;
}

const CHOICE_KEY = 'strikeproof.choice';
const SETTINGS_KEY = 'strikeproof.settings';

export const DEFAULT_CHOICE: TestChoice = {
  mode: 'time',
  timeLength: 15,
  wordsLength: 10,
  quoteLength: 'all',
  punctuation: false,
  numbers: false,
  customText: '',
};

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) };
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is unavailable in private modes; the server keeps signed-in settings */
  }
}

export const state = {
  config: {
    focusWarningMs: 1000,
    maxExtraLetters: 10,
    raceCountdownSeconds: 3,
    raceRejoinSeconds: 30,
  } as ServerConfig,
  session: null as Session | null,
  settings: { ...DEFAULT_SETTINGS } as TypistSettings,
  choice: { ...DEFAULT_CHOICE } as TestChoice,
  mailOutage: false,
};

export function applyTheme(): void {
  const root = document.documentElement;
  root.dataset['theme'] = state.settings.theme;
  root.style.setProperty('--words-size', `${state.settings.fontSize * 24}px`);
  root.dataset['blind'] = state.settings.blindMode ? 'on' : 'off';
  root.dataset['smoothCaret'] = state.settings.smoothCaret ? 'on' : 'off';
}

export function loadChoice(): void {
  state.choice = readStored(CHOICE_KEY, DEFAULT_CHOICE);
}

export function saveChoice(): void {
  writeStored(CHOICE_KEY, state.choice);
}

/** One save in flight at a time, so the last choice is the one the server keeps. */
let saving: Promise<void> | null = null;
let pending: TypistSettings | null = null;

async function flushSettings(): Promise<void> {
  while (pending) {
    const next = pending;
    pending = null;
    await api.put('/api/settings', next);
  }
  saving = null;
}

export function saveSettings(): void {
  writeStored(SETTINGS_KEY, state.settings);
  if (!state.session) return;
  pending = { ...state.settings };
  if (!saving) saving = flushSettings();
}

export async function loadSettings(): Promise<void> {
  if (state.session) {
    const response = await api.get<TypistSettings>('/api/settings');
    if (response.status === 200 && response.body) {
      state.settings = { ...DEFAULT_SETTINGS, ...response.body };
    }
  } else {
    state.settings = readStored(SETTINGS_KEY, DEFAULT_SETTINGS);
  }
  applyTheme();
}

export async function loadSession(): Promise<void> {
  const response = await api.get<Session>('/api/me');
  state.session = response.status === 200 ? response.body : null;
}

export async function loadServerConfig(): Promise<void> {
  const response = await api.get<ServerConfig>('/api/config');
  if (response.status === 200 && response.body) state.config = response.body;
}
