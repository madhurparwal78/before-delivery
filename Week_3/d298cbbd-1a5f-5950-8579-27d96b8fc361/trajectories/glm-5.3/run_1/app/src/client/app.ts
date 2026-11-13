import { api, ApiRequestError, type PublicConfig, type SessionInfo, type TypistSettings } from './api.js';
import { el } from './dom.js';
import { COPY } from './copy.js';

// The client's shared state and the live channel.

export interface AppState {
  session: SessionInfo | null;
  settings: TypistSettings;
  config: PublicConfig | null;
  mailOutage: boolean;
}

export const DEFAULT_SETTINGS: TypistSettings = {
  theme: 'sand', caret: 'line', smoothCaret: true, fontSize: 1.5, blindMode: false, quickRestart: 'tab',
};

const SETTINGS_KEY = 'strikeproof-settings';
const CHOICES_KEY = 'strikeproof-choices';
const CUSTOM_KEY = 'strikeproof-custom-text';

export interface StoredChoices {
  mode: 'time' | 'words' | 'quote' | 'custom';
  timeLength: number;
  wordsLength: number;
  quoteLength: 'short' | 'medium' | 'long' | 'all';
  punctuation: boolean;
  numbers: boolean;
}

export const DEFAULT_CHOICES: StoredChoices = {
  mode: 'time', timeLength: 15, wordsLength: 10, quoteLength: 'short', punctuation: false, numbers: false,
};

export function loadSettings(): TypistSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<TypistSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettingsLocally(settings: TypistSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadChoices(): StoredChoices {
  try {
    const raw = localStorage.getItem(CHOICES_KEY);
    if (raw === null) return { ...DEFAULT_CHOICES };
    const parsed = JSON.parse(raw) as Partial<StoredChoices>;
    return { ...DEFAULT_CHOICES, ...parsed };
  } catch {
    return { ...DEFAULT_CHOICES };
  }
}

export function saveChoices(choices: StoredChoices): void {
  localStorage.setItem(CHOICES_KEY, JSON.stringify(choices));
}

export function loadCustomText(): string {
  try {
    return localStorage.getItem(CUSTOM_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveCustomText(text: string): void {
  localStorage.setItem(CUSTOM_KEY, text);
}

export class App {
  state: AppState;
  private settingsSaveQueue: Promise<void> = Promise.resolve();
  private liveEventSource: EventSource | null = null;
  private liveTopics: string[] = [];
  private liveRoom: string | null = null;
  private liveHandlers: ((event: { kind: string; payload: Record<string, unknown> }) => void)[] = [];
  root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.state = {
      session: readInitialSession(),
      settings: loadSettings(),
      config: null,
      mailOutage: false,
    };
    this.applyTheme();
  }

  applyTheme(): void {
    document.documentElement.setAttribute('data-theme', this.state.settings.theme);
    document.documentElement.style.setProperty('--font-size', `${this.state.settings.fontSize * 24}px`);
  }

  async loadConfig(): Promise<void> {
    try {
      this.state.config = await api<PublicConfig>('/api/config', 'GET');
    } catch {
      this.state.config = { focusWarningMs: 1000, maxExtraLetters: 10, raceCountdownSeconds: 3, raceRejoinSeconds: 30 };
    }
  }

  async refreshSession(): Promise<void> {
    try {
      this.state.session = await api<SessionInfo>('/api/me', 'GET');
    } catch {
      this.state.session = null;
    }
  }

  async loadSettings(): Promise<void> {
    if (this.state.session === null) return;
    try {
      const stored = await api<TypistSettings>('/api/settings', 'GET');
      this.state.settings = { ...DEFAULT_SETTINGS, ...stored };
      this.applyTheme();
    } catch {
      // Keep the local settings.
    }
  }

  /** Apply at once, then save. A late earlier answer never overwrites a later choice. */
  updateSettings(patch: Partial<TypistSettings>): void {
    this.state.settings = { ...this.state.settings, ...patch };
    this.applyTheme();
    saveSettingsLocally(this.state.settings);
    if (this.state.session !== null) {
      this.settingsSaveQueue = this.settingsSaveQueue.then(async () => {
        const snapshot = { ...this.state.settings };
        try {
          await api<TypistSettings>('/api/settings', 'PUT', snapshot);
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 401) this.signOutLocally();
        }
      }).catch(() => { /* the queue keeps its own errors */ });
    }
  }

  signOutLocally(): void {
    this.state.session = null;
  }

  async signOut(): Promise<void> {
    try {
      await api('/api/session', 'DELETE');
    } catch {
      // A failed sign-out still clears the local session.
    }
    this.state.session = null;
  }

  // Live channel.

  onLive(handler: (event: { kind: string; payload: Record<string, unknown> }) => void): void {
    this.liveHandlers.push(handler);
  }

  clearLiveHandlers(): void {
    this.liveHandlers = [];
  }

  connectLive(topics: string[], room: string | null): void {
    const key = `${topics.slice().sort().join(',')}|${room ?? ''}`;
    const currentKey = `${this.liveTopics.slice().sort().join(',')}|${this.liveRoom ?? ''}`;
    if (key === currentKey && this.liveEventSource !== null) return;
    this.disconnectLive();
    this.liveTopics = topics;
    this.liveRoom = room;
    const params = new URLSearchParams();
    if (topics.length > 0) params.set('topics', topics.join(','));
    if (room !== null) params.set('room', room);
    const source = new EventSource(`/api/live?${params.toString()}`);
    this.liveEventSource = source;
    source.addEventListener('live', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as { kind: string; payload: Record<string, unknown> };
        for (const handler of this.liveHandlers) handler(parsed);
      } catch {
        // Ignore malformed events.
      }
    });
  }

  disconnectLive(): void {
    if (this.liveEventSource !== null) {
      this.liveEventSource.close();
      this.liveEventSource = null;
    }
    this.liveTopics = [];
    this.liveRoom = null;
    this.liveHandlers = [];
  }
}

function readInitialSession(): SessionInfo | null {
  const initial = (window as unknown as { __INITIAL__?: { signedIn: boolean; typist: { name: string; verified: boolean } | null } }).__INITIAL__;
  if (initial === undefined || !initial.signedIn || initial.typist === null) return null;
  return { id: '', name: initial.typist.name, verified: initial.typist.verified };
}

// The shared top row, navigation and footer.

export interface ShellOptions {
  current: 'test' | 'history' | 'boards' | 'race' | 'settings' | 'other';
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

export function shell(app: App, options: ShellOptions): { header: HTMLElement; nav: HTMLElement; footer: HTMLElement; topRow: HTMLElement } {
  const brand = el('div', { class: 'wordmark' }, 'STRIKEPROOF');
  const signIn = el('a', { href: '/signin', class: 'top-link' }, 'Sign in');
  const account = el('a', { href: '/account', class: 'top-link' }, 'Account');
  const signOutButton = el('button', { class: 'button button-quiet' }, 'Sign out');
  signOutButton.addEventListener('click', () => options.onSignOut());

  const topRow = el('div', { class: 'top-row' }, '');
  topRow.appendChild(brand);
  const right = el('div', { class: 'top-row-right' }, '');
  if (app.state.session !== null) {
    right.append(account, signOutButton);
  } else {
    right.appendChild(signIn);
  }
  topRow.appendChild(right);

  const links: { path: string; label: string; key: ShellOptions['current'] }[] = [
    { path: '/', label: 'Test', key: 'test' },
    { path: '/history', label: 'History', key: 'history' },
    { path: '/boards', label: 'Boards', key: 'boards' },
    { path: '/race', label: 'Race rooms', key: 'race' },
    { path: '/settings', label: 'Settings', key: 'settings' },
  ];
  const nav = el('nav', { class: 'folders', 'aria-label': 'Folders' }, '');
  for (const link of links) {
    const anchor = el('a', { href: link.path, class: `folder-tab${options.current === link.key ? ' current' : ''}`, 'data-folder': link.path }, link.label);
    anchor.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      options.onNavigate(link.path);
    });
    nav.appendChild(anchor);
  }

  const footer = el('footer', { class: 'footer' }, COPY.footer);
  footer.setAttribute('role', 'contentinfo');
  return { header: topRow, nav, footer, topRow };
}

/** Re-render the top row after a session change. */
export function renderTopRow(app: App, topRow: HTMLElement, onSignOut: () => void): void {
  const right = topRow.querySelector('.top-row-right');
  if (right === null) return;
  right.textContent = '';
  if (app.state.session !== null) {
    const account = el('a', { href: '/account', class: 'top-link' }, 'Account');
    const signOutButton = el('button', { class: 'button button-quiet' }, 'Sign out');
    signOutButton.addEventListener('click', () => onSignOut());
    right.append(account, signOutButton);
  } else {
    right.appendChild(el('a', { href: '/signin', class: 'top-link' }, 'Sign in'));
  }
}
