// The smoked-glass panels: Callsign, Join by code, History, Settings, the pause
// menu, the Lobby and the Debrief.

import { ApiError, Match, LapRow, RoomState, api } from './api';
import { App, Panel, sessionMarker } from './app';
import { actionLabels, actionOrder, comfort, keyLabel } from './comfort';
import { FuseClock } from './fuseclock';
import { clear, el, formatLap, stampDayTime, dayMonthYear } from './core';

let fieldSeq = 0;

/** field builds a labelled text box with its error line linked as a description. */
function field(
  label: string,
  attrs: Record<string, string> = {},
): { wrap: HTMLElement; input: HTMLInputElement; error: HTMLElement; setError: (message: string) => void } {
  fieldSeq += 1;
  const errorID = `field-error-${fieldSeq}`;
  const input = el('input', { type: attrs.type ?? 'text', ...attrs }) as HTMLInputElement;
  input.setAttribute('aria-label', label);
  const error = el('div', { class: 'field-error', id: errorID });
  const wrap = el('div', { class: 'field' }, el('label', {}, label), input, error);
  const setError = (message: string) => {
    error.textContent = message;
    if (message) input.setAttribute('aria-describedby', errorID);
    else input.removeAttribute('aria-describedby');
  };
  return { wrap, input, error, setError };
}

function panelShell(label: string, extraClass = ''): HTMLElement {
  return el('div', {
    class: `panel ${extraClass}`.trim(),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
  });
}

// ---------- Callsign ----------

export function openCallsign(app: App, next?: () => void | Promise<void>): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = panelShell('Callsign');

  const callsign = field('Callsign', { maxlength: '16', autocomplete: 'off' });
  const studioKey = field('Studio key', { autocomplete: 'off' });
  const save = el('button', { class: 'btn-mint', type: 'button' }, 'Save callsign');
  save.setAttribute('aria-label', 'Save callsign');

  root.append(
    el('div', { class: 'panel-head' }, el('h2', {}, 'Callsign'), el('span', { class: 'panel-title' }, 'Session')),
    el('div', { class: 'panel-body' }, callsign.wrap, studioKey.wrap),
    el('div', { class: 'row end' }, save),
  );

  const submit = async () => {
    callsign.setError('');
    studioKey.setError('');
    save.disabled = true;
    app.notify('Saving callsign…');
    try {
      const { player } = await api.createSession(callsign.input.value, studioKey.input.value.trim() || undefined);
      app.player = player;
      sessionMarker.set();
      try {
        comfort.adopt(await api.settings());
      } catch {
        // Settings follow on the next successful read.
      }
      app.notify(
        player.role === 'founder'
          ? 'Studio key accepted — founder tools unlocked.'
          : `Callsign saved — you're ${player.callsign}.`,
      );
      app.closePanel();
      await next?.();
    } catch (error) {
      save.disabled = false;
      if (error instanceof ApiError) {
        if (error.code === 'studio_key_invalid') {
          studioKey.setError("That studio key isn't right.");
          app.clearNotice();
          return;
        }
        if (error.fields.callsign) {
          callsign.setError(error.fields.callsign);
          app.clearNotice();
          return;
        }
      }
      app.reportError(error);
    }
  };

  save.addEventListener('click', () => void submit());
  for (const input of [callsign.input, studioKey.input]) {
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void submit();
    });
  }

  app.openPanel(app.mountDialog(root, opener));
  callsign.input.focus();
}

// ---------- Join by code ----------

export function openJoin(app: App, prefill?: string): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = panelShell('Join by code');
  const code = field('Room code', { maxlength: '6', autocapitalize: 'characters', autocomplete: 'off' });
  if (prefill) code.input.value = prefill;
  const join = el('button', { class: 'btn-mint', type: 'button' }, 'Join room');
  join.setAttribute('aria-label', 'Join room');

  root.append(
    el('div', { class: 'panel-head' }, el('h2', {}, 'Join by code'), el('span', { class: 'panel-title' }, 'Rooms')),
    el('div', { class: 'panel-body' }, code.wrap),
    el('div', { class: 'row end' }, join),
  );

  const submit = async () => {
    const wanted = code.input.value.trim().toUpperCase();
    code.setError('');
    join.disabled = true;
    app.notify(`Joining ${wanted}…`);
    try {
      const { seat, state } = await api.join(wanted);
      app.notify(`Joined room ${state.code} — seat ${seat}.`);
      app.closePanel();
      await app.enterRoom(state);
    } catch (error) {
      join.disabled = false;
      app.notify(
        app.errorCopy(error, {
          room_not_found: `No room with code ${wanted}.`,
          room_full: `Room ${wanted} is full.`,
          match_in_progress: `Room ${wanted} is mid-match. Ask the host for the next one.`,
          invite_expired: 'This invite expired. Ask the host for a new room.',
          seat_released: `Your seat in ${wanted} was released.`,
          rooms_unavailable: 'Rooms are offline right now. Try again in a minute.',
        }),
      );
    }
  };

  join.addEventListener('click', () => void app.requireSession(submit));
  code.input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') void app.requireSession(submit);
  });

  app.openPanel(app.mountDialog(root, opener));
  code.input.focus();
}

// ---------- Lobby ----------

export interface LobbyView {
  root: HTMLElement;
  update: (state: RoomState) => void;
  inviteClock: FuseClock;
}

/** buildLobby renders the lobby region, which re-renders from each snapshot. */
export function buildLobby(
  app: App,
  handlers: {
    ready: (ready: boolean) => void;
    start: () => void;
    copyInvite: () => void;
    leave: () => void;
  },
): LobbyView {
  const heading = el('h2', {});
  const seats = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Seats' });
  const inviteClock = new FuseClock('Invite expires');
  const inviteLine = el(
    'div',
    { class: 'note' },
    'Invite expires ',
    inviteClock.root,
  );

  const ready = el('button', { class: 'btn-ghost', type: 'button', 'aria-pressed': 'false' }, 'Ready');
  ready.setAttribute('aria-label', 'Ready');
  const start = el('button', { class: 'btn-mint', type: 'button' }, 'Start match') as HTMLButtonElement;
  start.setAttribute('aria-label', 'Start match');
  const copy = el('button', { class: 'btn-ghost', type: 'button' }, 'Copy invite');
  copy.setAttribute('aria-label', 'Copy invite');
  const leave = el('button', { class: 'btn-ghost', type: 'button' }, 'Leave room');
  leave.setAttribute('aria-label', 'Leave room');

  const buttons = el('div', { class: 'row wrap end' }, ready, start, copy, leave);
  const root = el(
    'div',
    { class: 'panel', role: 'region', 'aria-label': 'Lobby' },
    el('div', { class: 'panel-head' }, heading, el('span', { class: 'panel-title' }, 'Lobby')),
    inviteLine,
    seats,
    buttons,
  );

  let readyNow = false;
  ready.addEventListener('click', () => handlers.ready(!readyNow));
  start.addEventListener('click', () => handlers.start());
  copy.addEventListener('click', () => handlers.copyInvite());
  leave.addEventListener('click', () => handlers.leave());

  const update = (state: RoomState) => {
    heading.textContent = `Room ${state.code}`;
    const self = state.players.find((p) => p.id === app.player?.id);
    readyNow = self?.ready ?? false;
    ready.setAttribute('aria-pressed', readyNow ? 'true' : 'false');

    const isHost = state.host === app.player?.id;
    start.style.display = isHost ? '' : 'none';
    const everyoneReady = state.players.length > 0 && state.players.every((p) => p.ready);
    start.disabled = !everyoneReady;

    inviteClock.update(state.invite_remaining_ms);
    inviteLine.style.display = state.invite_remaining_ms === null ? 'none' : '';

    clear(seats);
    for (const player of state.players) {
      let text = `Seat ${player.seat} · ${player.callsign} · ${player.ready ? 'Ready' : 'Not ready'}`;
      if (player.id === state.host) text += ' · Host';
      if (player.connection === 'disconnected' || player.connection === 'left') text += ' · Disconnected';
      seats.appendChild(el('li', { role: 'listitem' }, text));
    }
  };

  return { root, update, inviteClock };
}

// ---------- Debrief ----------

export function openDebrief(app: App, state: RoomState, onDismiss: () => void): void {
  const root = panelShell('Debrief', 'wide');
  const resultWord =
    state.result === 'victory'
      ? 'Victory'
      : state.result === 'defeat'
        ? 'Defeat'
        : state.result === 'finished'
          ? 'Finished'
          : 'Ended';

  const head = el('h1', {}, resultWord);
  const table = el('table', { 'aria-label': 'Squad results' });
  const body = el('tbody', {});
  table.append(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Callsign'),
        el('th', {}, 'Score'),
        el('th', {}, 'Kills'),
        el('th', {}, 'Credits earned'),
      ),
    ),
    body,
  );
  for (const player of state.players) {
    body.appendChild(
      el(
        'tr',
        {},
        el('td', {}, player.callsign),
        el('td', {}, String(player.score)),
        el('td', {}, String(player.kills)),
        el('td', {}, String(player.credits)),
      ),
    );
  }

  const back = el('button', { class: 'btn-ghost', type: 'button' }, 'Back to title');
  back.setAttribute('aria-label', 'Back to title');
  const history = el('button', { class: 'btn-mint', type: 'button' }, 'View history');
  history.setAttribute('aria-label', 'View history');

  root.append(
    el('div', { class: 'panel-head' }, head, el('span', { class: 'panel-title' }, `Room ${state.code}`)),
    table,
    el('div', { class: 'row end' }, back, history),
  );

  back.addEventListener('click', () => {
    app.closePanel();
    onDismiss();
    app.showTitle();
    app.focusStartBar();
  });
  history.addEventListener('click', () => {
    app.closePanel();
    onDismiss();
    app.showTitle();
    openHistory(app);
  });

  app.openPanel(app.mountDialog(root, null));
  back.focus();
}

// ---------- History ----------

export function openHistory(app: App): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = panelShell('History', 'wide');

  const matchesTab = el('button', { type: 'button', role: 'tab', 'aria-selected': 'true', id: 'tab-matches' }, 'Matches');
  matchesTab.setAttribute('aria-label', 'Matches');
  const lapsTab = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', id: 'tab-laps', tabindex: '-1' }, 'Lap board');
  lapsTab.setAttribute('aria-label', 'Lap board');
  const tabs = el('div', { class: 'tablist', role: 'tablist', 'aria-label': 'History' }, matchesTab, lapsTab);

  const matchesPanel = el('div', { role: 'tabpanel', 'aria-labelledby': 'tab-matches', tabindex: '0' });
  const lapsPanel = el('div', { role: 'tabpanel', 'aria-labelledby': 'tab-laps', tabindex: '0' });
  const holder = el('div', { class: 'panel-body' }, matchesPanel);

  root.append(
    el('div', { class: 'panel-head' }, el('h2', {}, 'History'), el('span', { class: 'panel-title' }, 'Records')),
    tabs,
    holder,
  );

  let selected: 'matches' | 'laps' = 'matches';
  const select = (which: 'matches' | 'laps') => {
    selected = which;
    matchesTab.setAttribute('aria-selected', which === 'matches' ? 'true' : 'false');
    lapsTab.setAttribute('aria-selected', which === 'laps' ? 'true' : 'false');
    matchesTab.tabIndex = which === 'matches' ? 0 : -1;
    lapsTab.tabIndex = which === 'laps' ? 0 : -1;
    clear(holder);
    holder.appendChild(which === 'matches' ? matchesPanel : lapsPanel);
  };

  matchesTab.addEventListener('click', () => select('matches'));
  lapsTab.addEventListener('click', () => select('laps'));
  for (const tab of [matchesTab, lapsTab]) {
    tab.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        const which = selected === 'matches' ? 'laps' : 'matches';
        select(which);
        (which === 'matches' ? matchesTab : lapsTab).focus();
      }
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        select(tab === matchesTab ? 'matches' : 'laps');
      }
    });
  }

  const retry = (host: HTMLElement, again: () => void) => {
    const button = el('button', { class: 'btn-ghost', type: 'button' }, 'Try again');
    button.setAttribute('aria-label', 'Try again');
    button.addEventListener('click', again);
    host.appendChild(button);
  };

  const loadMatches = async () => {
    clear(matchesPanel);
    try {
      const { matches } = await api.history();
      matchesPanel.appendChild(renderMatches(app, matches));
    } catch (error) {
      matchesPanel.appendChild(el('div', { class: 'empty' }, app.errorCopy(error)));
      retry(matchesPanel, () => void loadMatches());
    }
  };
  const loadLaps = async () => {
    clear(lapsPanel);
    try {
      const { laps } = await api.laps();
      lapsPanel.appendChild(renderLaps(app, laps));
    } catch (error) {
      lapsPanel.appendChild(el('div', { class: 'empty' }, app.errorCopy(error)));
      retry(lapsPanel, () => void loadLaps());
    }
  };

  app.openPanel(app.mountDialog(root, opener));
  void loadMatches();
  void loadLaps();
  matchesTab.focus();
}

function renderMatches(app: App, matches: Match[]): HTMLElement {
  if (matches.length === 0) return el('div', { class: 'empty' }, 'No matches yet.');
  const phone = window.innerWidth <= 560;
  const table = el('table', { 'aria-label': 'Match history' });
  const headRow = el('tr', {});
  if (!phone) headRow.appendChild(el('th', {}, 'Started'));
  headRow.appendChild(el('th', {}, 'Ended'));
  if (!phone) headRow.appendChild(el('th', {}, 'Room'));
  headRow.append(
    el('th', {}, 'Mode'),
    el('th', {}, 'Result'),
    el('th', {}, 'Waves cleared'),
    el('th', {}, 'Squad'),
  );
  const body = el('tbody', {});
  for (const match of matches) {
    const squad = match.players
      .map((p) => (match.mode === 'convoy' ? `${p.callsign} ${formatLap(p.best_lap_ms)}` : `${p.callsign} ${p.score}`))
      .join(' · ');
    const row = el('tr', {});
    if (!phone) row.appendChild(el('td', {}, stampDayTime(match.started_at, app.studioZone)));
    row.appendChild(el('td', {}, stampDayTime(match.ended_at, app.studioZone)));
    if (!phone) row.appendChild(el('td', {}, match.code));
    row.append(
      el('td', {}, match.mode === 'convoy' ? 'Convoy' : 'Siege'),
      el('td', {}, resultLabel(match.result)),
      el('td', {}, match.mode === 'convoy' ? '—' : String(match.waves_cleared)),
      el('td', {}, squad),
    );
    body.appendChild(row);
  }
  table.append(el('thead', {}, headRow), body);
  return table;
}

function resultLabel(result: string): string {
  switch (result) {
    case 'victory':
      return 'Victory';
    case 'defeat':
      return 'Defeat';
    case 'finished':
      return 'Finished';
    default:
      return 'Ended';
  }
}

function renderLaps(app: App, laps: LapRow[]): HTMLElement {
  if (laps.length === 0) return el('div', { class: 'empty' }, 'No laps yet.');
  const table = el('table', { 'aria-label': 'Lap board' });
  const body = el('tbody', {});
  for (const lap of laps) {
    body.appendChild(
      el(
        'tr',
        {},
        el('td', {}, String(lap.rank)),
        el('td', {}, lap.callsign),
        el('td', {}, formatLap(lap.lap_ms)),
        el('td', {}, dayMonthYear(lap.set_at, app.studioZone)),
      ),
    );
  }
  table.append(
    el('thead', {}, el('tr', {}, el('th', {}, 'Rank'), el('th', {}, 'Callsign'), el('th', {}, 'Best lap'), el('th', {}, 'Set on'))),
    body,
  );
  return table;
}

// ---------- Accordion ----------

interface Section {
  name: string;
  build: () => HTMLElement;
}

/** accordion keeps one section open at a time. A collapsed section's contents
 *  are removed outright, so they are hidden, unfocusable and absent from the
 *  accessibility tree. */
function accordion(sections: Section[], openIndex = 0): HTMLElement {
  const root = el('div', { class: 'accordion' });
  const heads: HTMLButtonElement[] = [];
  const bodies: HTMLElement[] = [];

  const render = (which: number) => {
    heads.forEach((head, index) => head.setAttribute('aria-expanded', index === which ? 'true' : 'false'));
    bodies.forEach((host, index) => {
      clear(host);
      if (index === which) host.appendChild(sections[index].build());
    });
  };

  sections.forEach((section, index) => {
    const head = el('button', { class: 'section-head btn-link', type: 'button', 'aria-expanded': 'false' }, section.name);
    head.setAttribute('aria-label', section.name);
    const body = el('div', { class: 'section-body' });
    head.addEventListener('click', () => render(index));
    heads.push(head);
    bodies.push(body);
    root.appendChild(el('div', { class: 'section' }, head, body));
  });

  render(openIndex);
  return root;
}

// ---------- Settings and the pause menu ----------

function controlsSection(app: App): HTMLElement {
  const host = el('div', { class: 'col' });

  const render = () => {
    clear(host);
    for (const action of actionOrder) {
      const label = actionLabels[action];
      const keyText = el('span', { class: 'key' }, keyLabel(comfort.bindingFor(action)));
      const button = el('button', { class: 'btn-ghost', type: 'button' }, `Remap ${label}`);
      button.setAttribute('aria-label', `Remap ${label}`);

      button.addEventListener('click', () => {
        const original = button.textContent;
        button.textContent = 'Press a key…';
        app.notify(`Press a key for ${label}. Escape cancels.`);

        const capture = (ev: KeyboardEvent) => {
          // Tab leaves the binding unchanged and moves focus, so it is the only
          // key that passes through.
          if (ev.key === 'Tab') return;
          ev.preventDefault();
          ev.stopPropagation();
          window.removeEventListener('keydown', capture, true);

          if (ev.key === 'Escape') {
            button.textContent = original;
            app.clearNotice();
            return;
          }
          const taken = comfort.actionForCode(ev.code);
          if (taken && taken !== action) {
            button.textContent = original;
            app.notify(`${keyLabel(ev.code)} is already bound to ${actionLabels[taken]}.`);
            return;
          }
          const bindings = { ...comfort.current().bindings, [action]: ev.code };
          void comfort.set({ bindings }).then(() => {
            app.notify('Settings saved.');
            render();
          });
        };
        window.addEventListener('keydown', capture, true);
      });

      host.appendChild(el('div', { class: 'binding-row' }, button, keyText));
    }

    const reset = el('button', { class: 'btn-ghost', type: 'button' }, 'Reset to defaults');
    reset.setAttribute('aria-label', 'Reset to defaults');
    reset.addEventListener('click', () => {
      void comfort.resetBindings().then(() => {
        app.notify('Settings saved.');
        render();
      });
    });
    host.appendChild(reset);
  };

  render();
  return host;
}

function audioSection(app: App): HTMLElement {
  const settings = comfort.current();
  const slider = (label: string, value: number, apply: (next: number) => void) => {
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(value),
    }) as HTMLInputElement;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      apply(Number(input.value));
      app.notify('Settings saved.');
    });
    return el('div', { class: 'field' }, el('label', {}, label), input);
  };

  return el(
    'div',
    { class: 'col' },
    slider('Master volume', settings.master_volume, (next) => void comfort.set({ master_volume: next })),
    slider('Effects volume', settings.effects_volume, (next) => void comfort.set({ effects_volume: next })),
  );
}

function comfortSection(app: App): HTMLElement {
  const host = el('div', { class: 'col' });

  const render = () => {
    clear(host);
    const settings = comfort.current();
    const locked = comfort.reduced();

    const toggle = (label: string, checked: boolean, disabled: boolean, apply: (next: boolean) => void) => {
      const button = el(
        'button',
        { class: 'switch', type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false' },
        label,
        el('span', { class: 'state' }, checked ? 'On' : 'Off'),
      ) as HTMLButtonElement;
      button.setAttribute('aria-label', label);
      button.disabled = disabled;
      button.addEventListener('click', () => {
        apply(!checked);
        app.notify('Settings saved.');
        render();
      });
      return button;
    };

    host.append(
      toggle('Reduce effects', settings.reduce_effects, false, (next) => void comfort.set({ reduce_effects: next })),
      toggle('Screen shake', locked ? false : settings.screen_shake, locked, (next) =>
        void comfort.set({ screen_shake: next }),
      ),
      toggle('Camera bob', locked ? false : settings.camera_bob, locked, (next) =>
        void comfort.set({ camera_bob: next }),
      ),
    );
  };

  render();
  return host;
}

export function openSettings(app: App): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = panelShell('Settings');
  root.append(
    el('div', { class: 'panel-head' }, el('h2', {}, 'Settings'), el('span', { class: 'panel-title' }, 'Tuning')),
    accordion([
      { name: 'Controls', build: () => controlsSection(app) },
      { name: 'Audio', build: () => audioSection(app) },
      { name: 'Comfort', build: () => comfortSection(app) },
    ]),
  );
  app.openPanel(app.mountDialog(root, opener));
  const first = root.querySelector('button');
  (first as HTMLElement | null)?.focus();
}

/** openPause shows the pause menu, which does not stop the match: the server
 *  keeps running and the HUD behind keeps updating. */
export function openPause(app: App, handlers: { resume: () => void; leave: () => void }): Panel {
  const opener = document.activeElement as HTMLElement | null;
  const root = panelShell('Paused');

  const gameSection = () => {
    const resume = el('button', { class: 'btn-mint', type: 'button' }, 'Resume');
    resume.setAttribute('aria-label', 'Resume');
    resume.addEventListener('click', () => handlers.resume());
    const leave = el('button', { class: 'btn-ghost', type: 'button' }, 'Leave room');
    leave.setAttribute('aria-label', 'Leave room');
    leave.addEventListener('click', () => handlers.leave());
    return el('div', { class: 'row wrap' }, resume, leave);
  };

  root.append(
    el('div', { class: 'panel-head' }, el('h2', {}, 'Paused'), el('span', { class: 'panel-title' }, 'Menu')),
    accordion([
      { name: 'Game', build: gameSection },
      { name: 'Controls', build: () => controlsSection(app) },
      { name: 'Audio', build: () => audioSection(app) },
      { name: 'Comfort', build: () => comfortSection(app) },
    ]),
  );

  const panel = app.mountDialog(root, opener, handlers.resume, { withScrim: false });
  app.layer(panel.root);
  const first = root.querySelector('button');
  (first as HTMLElement | null)?.focus();
  return panel;
}
