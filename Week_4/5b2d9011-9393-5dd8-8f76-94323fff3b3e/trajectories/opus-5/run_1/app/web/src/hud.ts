// The combat and convoy HUDs, the Timers list and the ammo station drawer. Every
// readout is the server's.

import { RoomState, ShopItem } from './api';
import { App } from './app';
import { FuseGroup } from './fuseclock';
import { clear, el, formatLap } from './core';

/** readout builds one HUD group with its label and value. */
function readout(name: string, labelText: string): { root: HTMLElement; value: HTMLElement } {
  const value = el('span', { class: 'v' });
  const root = el(
    'div',
    { class: 'readout', role: 'group', 'aria-label': name },
    el('span', { class: 'k' }, labelText),
    value,
  );
  return { root, value };
}

export interface SiegeHud {
  root: HTMLElement;
  update: (state: RoomState) => void;
  pushFeed: (line: string) => void;
  timersButton: HTMLButtonElement;
  shopButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  focusRegion: () => void;
}

/** buildSiegeHud lays the four corners over the stage. */
export function buildSiegeHud(app: App, clocks: FuseGroup): SiegeHud {
  const waveGroup = readout('Wave', 'Wave');
  const phaseTimerHost = el('div', { class: 'readout' });

  const credits = readout('Credits', 'Credits');
  const score = readout('Score', 'Score');

  const healthFill = el('div', { class: 'fill' });
  const healthMeter = el(
    'div',
    { class: 'health-meter', role: 'meter', 'aria-label': 'Health', 'aria-valuemin': '0', 'aria-valuemax': '100' },
    healthFill,
  );
  const healthValue = el('span', { class: 'v' });
  const healthRow = el('div', { class: 'readout' }, el('span', { class: 'k' }, 'Health'), healthMeter, healthValue);
  const status = readout('Status', 'Status');

  const ammo = readout('Ammo', 'Ammo');
  const grenades = readout('Grenades', 'Grenades');
  const reloadHost = el('div', { class: 'readout' });

  const shopButton = el('button', { class: 'btn-ghost', type: 'button' }, 'Shop') as HTMLButtonElement;
  shopButton.setAttribute('aria-label', 'Shop');
  const timersButton = el('button', { class: 'btn-ghost', type: 'button', 'aria-expanded': 'false' }, 'Timers') as HTMLButtonElement;
  timersButton.setAttribute('aria-label', 'Timers');
  const pauseButton = el('button', { class: 'btn-ghost', type: 'button' }, 'Pause') as HTMLButtonElement;
  pauseButton.setAttribute('aria-label', 'Pause');

  const feed = el('div', { class: 'feed', role: 'status', 'aria-label': 'Match feed' });
  // Every other live timer — grenade fuses, revive windows, the reconnect grace
  // — shows its own numeral here, so each one is on screen and named.
  const auxHost = el('div', { class: 'col' });
  const degradedBanner = el('div', { class: 'room-banner' });
  degradedBanner.style.display = 'none';

  const root = el(
    'div',
    { class: 'hud', role: 'region', 'aria-label': 'HUD', tabindex: '-1' },
    degradedBanner,
    el('div', { class: 'hud-corner tl' }, waveGroup.root, phaseTimerHost, auxHost),
    el('div', { class: 'hud-corner tr' }, credits.root, score.root),
    el('div', { class: 'hud-corner bl' }, healthRow, status.root),
    el('div', { class: 'hud-corner br' }, ammo.root, grenades.root, reloadHost),
    el('div', { class: 'hud-corner tc' }, shopButton, timersButton, pauseButton),
    feed,
  );
  let auxShown = '';

  const lines: string[] = [];
  const pushFeed = (line: string) => {
    lines.push(line);
    while (lines.length > 6) lines.shift();
    clear(feed);
    for (const entry of lines) feed.appendChild(el('div', { class: 'line' }, entry));
  };

  const update = (state: RoomState) => {
    const self = state.players.find((player) => player.id === app.player?.id) ?? state.players[0];

    waveGroup.value.textContent = waveLabel(state);
    credits.value.textContent = `${self?.credits ?? 0} cr`;
    score.value.textContent = String(self?.score ?? 0);

    const hp = self?.hp ?? 0;
    healthFill.style.width = `${hp}%`;
    healthMeter.setAttribute('aria-valuenow', String(hp));
    healthMeter.classList.toggle('hurt', hp <= 60 && hp > 25);
    healthMeter.classList.toggle('critical', hp <= 25);
    healthValue.textContent = String(hp);
    status.value.textContent = statusLabel(self?.status ?? 'up');

    ammo.value.textContent = `${self?.mag ?? 0} / ${self?.reserve ?? 0}`;
    grenades.value.textContent = String(self?.grenades ?? 0);

    shopButton.disabled = !state.shop.open;

    // Phase timer: the countdown or the intermission, whichever is running.
    clear(phaseTimerHost);
    if (state.phase === 'countdown' || state.phase === 'intermission') {
      const name = state.phase === 'countdown' ? 'Countdown' : 'Intermission';
      const clock = clocks.get('phase', name);
      clock.update(state.phase_remaining_ms);
      phaseTimerHost.append(el('span', { class: 'k' }, name), clock.root);
    } else {
      clocks.drop('phase');
    }

    clear(reloadHost);
    if (self && self.reload_remaining_ms !== null) {
      const clock = clocks.get('reload', 'Reload');
      clock.update(self.reload_remaining_ms);
      reloadHost.append(el('span', { class: 'k' }, 'Reload'), clock.root);
    } else {
      clocks.drop('reload');
    }

    // Grenade fuses, revive windows and the reconnect grace all read the server.
    const live: { key: string; name: string; ms: number }[] = [];
    for (const grenade of state.grenades) {
      live.push({ key: `fuse:${grenade.id}`, name: 'Grenade fuse', ms: grenade.fuse_remaining_ms });
    }
    for (const player of state.players) {
      if (player.revive_remaining_ms !== null) {
        live.push({
          key: `revive:${player.id}`,
          name: `Revive window ${player.callsign}`,
          ms: player.revive_remaining_ms,
        });
      }
      if (player.id === app.player?.id && player.grace_remaining_ms !== null) {
        live.push({ key: 'grace', name: 'Reconnect grace', ms: player.grace_remaining_ms });
      }
    }
    for (const entry of live) clocks.get(entry.key, entry.name).update(entry.ms);

    const open = new Set(live.map((entry) => entry.key));
    for (const key of clocks.keys()) {
      if ((key.startsWith('fuse:') || key.startsWith('revive:') || key === 'grace') && !open.has(key)) {
        clocks.drop(key);
      }
    }

    const signature = live.map((entry) => `${entry.key}|${entry.name}`).join(',');
    if (signature !== auxShown) {
      auxShown = signature;
      clear(auxHost);
      for (const entry of live) {
        auxHost.appendChild(
          el(
            'div',
            { class: 'readout' },
            el('span', { class: 'k' }, entry.name),
            clocks.get(entry.key, entry.name).root,
          ),
        );
      }
    }

    if (state.degraded) {
      degradedBanner.style.display = '';
      degradedBanner.textContent =
        'Room paused — the room registry dropped. Timers are frozen and resume when it\u2019s back.';
    } else {
      degradedBanner.style.display = 'none';
    }
  };

  return {
    root,
    update,
    pushFeed,
    timersButton,
    shopButton,
    pauseButton,
    focusRegion: () => root.focus(),
  };
}

function waveLabel(state: RoomState): string {
  switch (state.phase) {
    case 'countdown':
      return 'Countdown';
    case 'intermission':
      return 'Intermission';
    case 'boss_wave':
      return 'Boss wave';
    case 'wave':
      return `Wave ${state.wave} of 3`;
    default:
      return state.wave === 4 ? 'Boss wave' : `Wave ${state.wave} of 3`;
  }
}

function statusLabel(status: string): string {
  if (status === 'downed') return 'Downed';
  if (status === 'out') return 'Out';
  return 'Up';
}

export interface ConvoyHud {
  root: HTMLElement;
  update: (state: RoomState) => void;
  pushFeed: (line: string) => void;
  timersButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  focusRegion: () => void;
}

/** buildConvoyHud lays out the lap counter, lap timer and reset timer. */
export function buildConvoyHud(app: App, clocks: FuseGroup): ConvoyHud {
  const lap = readout('Lap', 'Lap');
  const checkpoint = readout('Checkpoint', 'Checkpoint');
  const best = readout('Best lap', 'Best lap');
  const lapTimerHost = el('div', { class: 'readout' });
  const resetHost = el('div', {
    class: 'readout',
    style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
  });
  resetHost.style.display = 'none';

  const timersButton = el('button', { class: 'btn-ghost', type: 'button', 'aria-expanded': 'false' }, 'Timers') as HTMLButtonElement;
  timersButton.setAttribute('aria-label', 'Timers');
  const pauseButton = el('button', { class: 'btn-ghost', type: 'button' }, 'Pause') as HTMLButtonElement;
  pauseButton.setAttribute('aria-label', 'Pause');

  const feed = el('div', { class: 'feed', role: 'status', 'aria-label': 'Match feed' });
  const degradedBanner = el('div', { class: 'room-banner' });
  degradedBanner.style.display = 'none';

  const root = el(
    'div',
    { class: 'hud', role: 'region', 'aria-label': 'HUD', tabindex: '-1' },
    degradedBanner,
    el('div', { class: 'hud-corner tl' }, lap.root, checkpoint.root, best.root, lapTimerHost),
    el('div', { class: 'hud-corner tc' }, timersButton, pauseButton),
    resetHost,
    feed,
  );

  const lines: string[] = [];
  const pushFeed = (line: string) => {
    lines.push(line);
    while (lines.length > 6) lines.shift();
    clear(feed);
    for (const entry of lines) feed.appendChild(el('div', { class: 'line' }, entry));
  };

  const update = (state: RoomState) => {
    const vehicle = state.vehicles.find((entry) => entry.player === app.player?.id) ?? state.vehicles[0];
    const laps = vehicle ? Math.min(vehicle.laps_done + 1, 3) : 1;
    lap.value.textContent = `Lap ${laps} of 3`;
    checkpoint.value.textContent = vehicle
      ? vehicle.next_checkpoint === 0
        ? 'Finish'
        : `Next checkpoint ${vehicle.next_checkpoint} of 4`
      : 'Next checkpoint 1 of 4';
    best.value.textContent = vehicle?.best_lap_ms ? formatLap(vehicle.best_lap_ms) : '—';

    clear(lapTimerHost);
    if (vehicle) {
      const clock = clocks.get('lap', 'Lap', { countUp: true });
      clock.update(vehicle.lap_elapsed_ms);
      lapTimerHost.append(el('span', { class: 'k' }, 'Lap'), clock.root);
    }

    clear(resetHost);
    if (vehicle && vehicle.reset_remaining_ms !== null) {
      const clock = clocks.get('reset', 'Reset');
      clock.update(vehicle.reset_remaining_ms);
      resetHost.style.display = '';
      resetHost.append(el('span', { class: 'k' }, 'Reset'), clock.root);
    } else {
      clocks.drop('reset');
      resetHost.style.display = 'none';
    }

    if (state.phase === 'countdown') {
      const clock = clocks.get('phase', 'Countdown');
      clock.update(state.phase_remaining_ms);
      if (!lapTimerHost.contains(clock.root)) {
        lapTimerHost.append(el('span', { class: 'k' }, 'Countdown'), clock.root);
      }
    } else {
      clocks.drop('phase');
    }

    if (state.degraded) {
      degradedBanner.style.display = '';
      degradedBanner.textContent =
        'Room paused — the room registry dropped. Timers are frozen and resume when it\u2019s back.';
    } else {
      degradedBanner.style.display = 'none';
    }
  };

  return { root, update, pushFeed, timersButton, pauseButton, focusRegion: () => root.focus() };
}

/** buildTimersList shows the same values as the numerals, without motion. */
export function buildTimersList(clocks: FuseGroup): { root: HTMLElement; refresh: () => void } {
  const list = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Timers' });
  const root = el('div', { class: 'timers-list' }, el('div', { class: 'panel-title' }, 'Timers'), list);
  const refresh = () => {
    clear(list);
    const rows = clocks.entries();
    if (rows.length === 0) {
      list.appendChild(el('li', { role: 'listitem' }, 'No timers running'));
      return;
    }
    for (const row of rows) {
      list.appendChild(el('li', { role: 'listitem' }, `${row.name} ${row.value}`));
    }
  };
  refresh();
  return { root, refresh };
}

export interface ShopDrawer {
  root: HTMLElement;
  update: (items: ShopItem[], credits: number) => void;
  focusFirst: () => void;
}

/** buildShopDrawer lists each item with its current price and a buy button. */
export function buildShopDrawer(
  clocks: FuseGroup,
  handlers: { buy: (item: ShopItem, button: HTMLButtonElement) => void; close: () => void },
): ShopDrawer {
  const body = el('div', { class: 'panel-body' });
  const close = el('button', { class: 'btn-ghost', type: 'button' }, 'Close');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => handlers.close());

  const root = el(
    'div',
    { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ammo station' },
    el(
      'div',
      { class: 'panel-head' },
      el('h2', {}, 'Ammo station'),
      el('span', { class: 'panel-title' }, 'Intermission'),
    ),
    body,
    el('div', { class: 'row end' }, close),
  );

  // Each item's row is built once and then updated in place, so a snapshot never
  // detaches the button a player is using or has focused.
  interface Row {
    button: HTMLButtonElement;
    pending: HTMLElement;
    item: ShopItem;
  }
  const rows = new Map<string, Row>();
  const order: HTMLButtonElement[] = [];
  const balance = el('div', { class: 'note' });

  const update = (items: ShopItem[], credits: number) => {
    for (const item of items) {
      let row = rows.get(item.item);
      if (!row) {
        const button = el('button', { class: 'btn-mint', type: 'button' }) as HTMLButtonElement;
        const pending = el('div', { class: 'note' });
        row = { button, pending, item };
        button.addEventListener('click', () => handlers.buy(row!.item, button));
        rows.set(item.item, row);
        order.push(button);
        body.appendChild(el('div', { class: 'shop-item' }, el('div', { class: 'label' }, item.name), button, pending));
      }
      row.item = item;

      const label = `Buy ${item.name} — ${item.price} cr`;
      if (row.button.textContent !== label) {
        row.button.textContent = label;
        row.button.setAttribute('aria-label', label);
      }

      if (item.next_price !== null && item.next_change_in_ms !== null) {
        const clock = clocks.get(`shop:${item.item}`, `Price change ${item.name}`);
        clock.update(item.next_change_in_ms);
        if (!row.pending.contains(clock.root)) {
          clear(row.pending);
          row.pending.append(`${item.next_price} cr in `, clock.root);
        }
      } else {
        clocks.drop(`shop:${item.item}`);
        clear(row.pending);
      }
    }
    const available = `${credits} cr available`;
    if (balance.textContent !== available) balance.textContent = available;
    if (balance.parentNode !== body) body.appendChild(balance);
  };

  return { root, update, focusFirst: () => order[0]?.focus() };
}
