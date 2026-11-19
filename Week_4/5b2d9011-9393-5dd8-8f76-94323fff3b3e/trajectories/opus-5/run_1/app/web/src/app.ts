// The app shell: the stage, the title screen, the service banner and notices,
// the session, and the panel stack every screen opens into.

import { ApiError, Player, Status, api } from './api';
import { comfort } from './comfort';
import { clear, closeDialog, el, openDialog, scrim, OpenDialog } from './core';
import { Stage } from './stage';
import { wordmarkDataURL } from './wordmark';

/** Panel is a screen the app opens over the stage. */
export interface Panel {
  root: HTMLElement;
  dialog?: OpenDialog;
  close: () => void;
}

const statusPollMS = 2000;

/** sessionMarker remembers that a session cookie was issued, since the cookie
 *  itself is HttpOnly. */
export const sessionMarker = {
  key: 'holdfast.session',
  present(): boolean {
    try {
      return window.localStorage.getItem(this.key) === '1';
    } catch {
      return false;
    }
  },
  set(): void {
    try {
      window.localStorage.setItem(this.key, '1');
    } catch {
      // Without storage the session simply is not restored after a reload.
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      // Nothing to clear.
    }
  },
};

/** App owns everything that outlives a single screen. */
export class App {
  readonly stage = new Stage();
  readonly notices: HTMLElement;
  readonly bannerStack: HTMLElement;

  player: Player | null = null;
  status: Status | null = null;
  studioZone = 'America/Chicago';

  private root: HTMLElement;
  private titleScreen: HTMLElement;
  private buildStamp: HTMLElement;
  private startBar!: HTMLButtonElement;
  private panel: Panel | null = null;
  private roomSession: { leave: () => void } | null = null;

  constructor(root: HTMLElement, stageHost: HTMLElement) {
    this.root = root;
    stageHost.appendChild(this.stage.root);

    this.bannerStack = el('div', { class: 'banner-stack', role: 'status', 'aria-label': 'Service status' });
    this.notices = el('div', { class: 'notices', role: 'status', 'aria-label': 'Notices' });
    this.buildStamp = el('div', { class: 'build-stamp', role: 'status', 'aria-label': 'Build' });
    this.titleScreen = this.buildTitleScreen();

    this.root.append(this.bannerStack, this.titleScreen, this.buildStamp, this.notices);
  }

  /** boot resolves the session and status, then opens the first screen. */
  async boot(): Promise<void> {
    this.stage.setScene('title');
    this.stage.start();
    void this.pollStatus();
    window.setInterval(() => void this.pollStatus(), statusPollMS);

    try {
      const studio = await api.studio();
      this.studioZone = studio.zone;
    } catch {
      // The banner reports the outage; the studio zone falls back to the seed.
    }
    await this.restoreSession();

    if (comfort.noticeChoice() === null) {
      this.openNotice();
    } else {
      this.applyRoute();
    }
  }

  /** restoreSession picks the session cookie's player back up. The marker keeps a
   *  first-time visitor from asking about a session they have never had. */
  private async restoreSession(): Promise<void> {
    if (!sessionMarker.present()) return;
    try {
      const { player } = await api.me();
      this.player = player;
      comfort.adopt(await api.settings());
    } catch {
      this.player = null;
      sessionMarker.clear();
    }
  }

  // ---------- Title screen ----------

  private buildTitleScreen(): HTMLElement {
    const wordmark = el('img', {
      class: 'wordmark',
      src: wordmarkDataURL(),
      alt: 'Holdfast Nights',
      draggable: 'false',
    });
    const subtitle = el(
      'div',
      {
        'aria-hidden': 'true',
        style:
          'font-size:12px;letter-spacing:0.52em;text-transform:uppercase;color:#8fae9b;' +
          'text-align:center;margin-top:-10px;',
      },
      'Nights',
    );

    this.startBar = el('button', { class: 'start-bar', type: 'button' }, 'START A ROOM');
    this.startBar.setAttribute('aria-label', 'Start a room');
    this.startBar.addEventListener('click', () => void this.startRoom('siege'));

    const link = (label: string, handler: () => void) => {
      const button = el(
        'button',
        { class: 'btn-link', type: 'button' },
        el('span', { class: 'glyph', 'aria-hidden': 'true' }, '\u2500'),
        label,
      );
      button.setAttribute('aria-label', label);
      button.addEventListener('click', handler);
      return button;
    };

    const rowOne = el(
      'div',
      { class: 'menu-row' },
      link('Join by code', () => void this.openJoin()),
      link('Convoy race', () => void this.startRoom('convoy')),
      link('Nights', () => void this.openNights()),
    );
    const rowTwo = el(
      'div',
      { class: 'menu-row' },
      link('History', () => void this.openHistory()),
      link('Settings', () => void this.openSettings()),
      link('Callsign', () => void this.openCallsign()),
    );

    return el(
      'div',
      { class: 'title-screen' },
      wordmark,
      subtitle,
      this.startBar,
      el('div', { class: 'menu-rows' }, rowOne, rowTwo),
    );
  }

  focusStartBar(): void {
    this.startBar.focus();
  }

  showTitle(): void {
    this.titleScreen.style.display = '';
    this.buildStamp.style.display = '';
    this.stage.setScene('title');
    this.stage.setSnapshot(null, null);
  }

  hideTitle(): void {
    this.titleScreen.style.display = 'none';
    this.buildStamp.style.display = 'none';
  }

  // ---------- Notices and banners ----------

  /** notify prints one line in the notices live region. */
  notify(message: string): void {
    this.notices.textContent = message;
  }

  clearNotice(): void {
    this.notices.textContent = '';
  }

  /** reportError prints an error's published copy. */
  reportError(error: unknown, overrides: Record<string, string> = {}): void {
    this.notify(this.errorCopy(error, overrides));
  }

  errorCopy(error: unknown, overrides: Record<string, string> = {}): string {
    if (!(error instanceof ApiError)) return 'Something went wrong on the server. Try again.';
    if (overrides[error.code]) return overrides[error.code];
    if (error.status >= 500 && error.code !== 'storage_unavailable' && error.code !== 'rooms_unavailable') {
      return 'Something went wrong on the server. Try again.';
    }
    return error.message;
  }

  private async pollStatus(): Promise<void> {
    try {
      this.status = await api.status();
    } catch {
      this.status = null;
    }
    this.renderBanner();
    this.renderBuildStamp();
  }

  private renderBuildStamp(): void {
    const status = this.status;
    this.buildStamp.textContent = status ? `build ${status.build} · ${status.tick_hz} Hz` : '';
  }

  /** renderBanner prints one line per down service, in the published order. */
  private renderBanner(): void {
    clear(this.bannerStack);
    const services = this.status?.services;
    if (!services) return;
    const lines: string[] = [];
    if (services.valkey === 'down') {
      lines.push('Rooms offline — the room registry is reconnecting. Nights and sign-ups still work.');
    }
    if (services.mail === 'down') {
      lines.push('Mail delayed — emails are queued and send when mail is back.');
    }
    if (services.postgres === 'down') {
      lines.push('Storage offline — sign-ups, prices, settings and history are unavailable.');
    }
    for (const line of lines) this.bannerStack.appendChild(el('div', { class: 'banner' }, line));
  }

  // ---------- Panels ----------

  /** openPanel replaces whatever panel is open. */
  openPanel(panel: Panel): void {
    this.closePanel();
    this.panel = panel;
  }

  closePanel(): void {
    if (!this.panel) return;
    const panel = this.panel;
    this.panel = null;
    panel.close();
  }

  currentPanel(): Panel | null {
    return this.panel;
  }

  /** mountDialog shows a dialog panel over the blur scrim. */
  mountDialog(
    root: HTMLElement,
    opener: HTMLElement | null,
    onClose?: () => void,
    options: { escapeCloses?: boolean; withScrim?: boolean } = {},
  ): Panel {
    const veil = options.withScrim === false ? undefined : scrim();
    if (veil) this.root.appendChild(veil);
    this.root.appendChild(root);

    const entry: OpenDialog = {
      root,
      opener,
      scrim: veil,
      close: () => {
        closeDialog(entry);
        onClose?.();
      },
    };
    openDialog(entry, { escapeCloses: options.escapeCloses });
    const panel: Panel = { root, dialog: entry, close: () => entry.close() };
    return panel;
  }

  /** layer mounts a non-dialog layer such as the HUD. */
  layer(node: HTMLElement): void {
    this.root.appendChild(node);
  }

  setRoomSession(session: { leave: () => void } | null): void {
    this.roomSession = session;
  }

  roomOpen(): boolean {
    return this.roomSession !== null;
  }

  leaveRoom(): void {
    this.roomSession?.leave();
    this.roomSession = null;
  }

  // ---------- Pre-match notice panel ----------

  private openNotice(): void {
    const title = el('h1', { id: 'notice-title' }, 'BEFORE YOU PLAY');
    const body = el(
      'div',
      { class: 'panel-body' },
      el(
        'p',
        { style: 'margin:0;font-size:13px;color:#cbd8d3;' },
        'This yard answers in flashes. Muzzle light, barrel blasts and the stage ' +
          'shaking when something goes off close by.',
      ),
      el(
        'p',
        { style: 'margin:0;font-size:13px;color:#cbd8d3;' },
        'Every timer is a numeral that rolls as it counts down. Calm effects holds ' +
          'all of it still and keeps every reading exactly where it is.',
      ),
    );

    const calm = el('button', { class: 'btn-ghost', type: 'button' }, 'Calm effects');
    const enter = el('button', { class: 'btn-mint', type: 'button' }, 'Enter');
    const buttons = el('div', { class: 'row end' }, calm, enter);

    const root = el(
      'div',
      {
        class: 'panel narrow',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Before you play',
        'aria-labelledby': 'notice-title',
      },
      title,
      body,
      buttons,
    );

    const finish = async (choice: 'standard' | 'calm') => {
      comfort.storeNoticeChoice(choice);
      if (choice === 'calm') await comfort.set({ reduce_effects: true });
      this.closePanel();
      this.focusStartBar();
      this.applyRoute();
    };

    calm.addEventListener('click', () => void finish('calm'));
    enter.addEventListener('click', () => void finish('standard'));

    // Escape acts as Enter, so the dialog manager must not close it itself.
    const escape = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      document.removeEventListener('keydown', escape, true);
      void finish('standard');
    };
    document.addEventListener('keydown', escape, true);

    const panel = this.mountDialog(root, null, () => document.removeEventListener('keydown', escape, true), {
      escapeCloses: false,
    });
    this.openPanel(panel);
    (comfort.systemAsksReduced() ? calm : enter).focus();
  }

  // ---------- Routing ----------

  /** applyRoute opens the panel the path asks for. */
  applyRoute(): void {
    const path = window.location.pathname;
    if (path === '/nights') {
      void this.openNights();
      return;
    }
    const match = /^\/room\/([^/]+)$/.exec(path);
    if (match) {
      void this.openJoin(decodeURIComponent(match[1]).toUpperCase());
    }
  }

  // ---------- Session gating ----------

  /** requireSession opens the Callsign panel first when there is no session,
   *  then continues the original action. */
  async requireSession(next: () => void | Promise<void>): Promise<void> {
    if (this.player) {
      await next();
      return;
    }
    this.openCallsign(next);
  }

  // These are assigned by main.ts, which owns the screens themselves. Keeping the
  // wiring here would make the shell depend on every screen.
  openCallsign: (next?: () => void | Promise<void>) => void = () => undefined;
  openJoin: (code?: string) => void = () => undefined;
  openNights: () => void = () => undefined;
  openHistory: () => void = () => undefined;
  openSettings: () => void = () => undefined;
  startRoom: (mode: 'siege' | 'convoy') => Promise<void> = async () => undefined;
  enterRoom: (state: import('./api').RoomState) => Promise<void> = async () => undefined;
}
