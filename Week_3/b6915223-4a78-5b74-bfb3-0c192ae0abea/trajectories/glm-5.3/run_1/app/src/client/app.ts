import { api, ApiError } from './api';
import { announceOnce, pendingButton, reducedMotion, focusTrap } from './dialog';
import { buildPitchModel, createShirtGrid, type PitchHandlers, type PitchFocusState } from './pitch';
import { formatMillions, formatDeadline } from '../shared/format';
import {
  CHIP_NAMES,
  CHIP_DESCRIPTIONS,
  CHIP_CANCEL_MESSAGES,
  type ChipCode,
  type Position,
} from '../shared/domain';
import type { Screen } from './screens';
import { parseScreen, pathOf } from './screens';
import type { ServerMessage } from './live';
import { LiveSocket, type PointsUpdate } from './live';
import { gameweekStatusLine, LOCKED_BANNER, RECEIPT_STORED, RECEIPT_PENDING } from './state';
import { renderLeaguesScreen, renderLeagueScreen, renderMemberHistory, renderHistoryScreen, renderOperatorShell } from './screensRender';
import { renderBuilder, drawTransfers, makeBuilderState } from './transfers';

interface ManagerState {
  me: { id: string; email: string; team_name: string; role: 'manager' | 'operator' } | null;
  squad: Awaited<ReturnType<typeof api.squad>> | null;
  hasSquad: boolean;
  current: { number: number; status: string; deadline_local: string | null } | null;
  unread: number;
}

const root = document.getElementById('root') as HTMLElement;
let socket: LiveSocket | null = null;
let relayRunning = false;

const state: ManagerState = {
  me: null,
  squad: null,
  hasSquad: true,
  current: null,
  unread: 0,
};

async function boot(): Promise<void> {
  try {
    state.me = await api.me();
  } catch {
    state.me = null;
  }
  if (state.me !== null) {
    try {
      await refreshSquad();
    } catch {
      state.hasSquad = false;
    }
    try {
      const current = await api.currentGameweek();
      state.current = { number: current.number, status: current.status, deadline_local: current.deadline_local };
    } catch {
      state.current = null;
    }
    socket = new LiveSocket(handleServerMessage, () => state.me?.role === 'operator');
    socket.connect();
    void pollNotices();
  }
  window.addEventListener('popstate', () => {
    void render();
  });
  await render();
}

async function refreshSquad(): Promise<void> {
  try {
    state.squad = await api.squad();
    state.hasSquad = true;
  } catch {
    state.squad = null;
    state.hasSquad = false;
  }
}

async function pollNotices(): Promise<void> {
  try {
    const inbox = await api.notices();
    state.unread = inbox.unread;
    updateNoticesButton();
  } catch {
    state.unread = state.unread;
  }
}

function handleServerMessage(message: ServerMessage): void {
  if (message.gameweekStatus !== undefined) {
    state.current = {
      number: message.gameweekStatus.number,
      status: message.gameweekStatus.status,
      deadline_local: state.current?.deadline_local ?? null,
    };
    void render();
    return;
  }
  if (message.notice !== undefined) {
    state.unread += 1;
    updateNoticesButton();
    const region = document.querySelector<HTMLElement>('[data-live-region="notices"]');
    if (region !== null) announceOnce(region, message.notice.message);
    return;
  }
  if (message.points !== undefined) {
    applyPointsUpdate(message.points);
    return;
  }
  if (message.receipt !== undefined) {
    void applyReceiptUpdate(message.receipt.gameweek);
    return;
  }
  if (message.squadUpdate !== undefined || message.standings !== undefined || message.price !== undefined || message.history !== undefined) {
    void render();
  }
}

async function applyReceiptUpdate(gameweek: number): Promise<void> {
  const screen = parseScreen(window.location.pathname, new URLSearchParams(window.location.search));
  if (screen.name === 'history' || screen.name === 'memberHistory') {
    await render();
    return;
  }
  const region = document.querySelector<HTMLElement>('[data-live-region="team-updates"]');
  if (region !== null) announceOnce(region, `Gameweek ${gameweek} team locked, receipt stored.`);
}

function applyPointsUpdate(update: PointsUpdate): void {
  if (state.squad === null) return;
  const totalElement = document.querySelector<HTMLElement>('[data-gameweek-total]');
  const oldTotal = state.squad.gameweek_total;
  let newTotal = update.gameweek_total;

  const perPlayer = new Map(update.perPlayer.map((entry) => [entry.player_id, entry]));
  const changed: { player: NonNullable<typeof state.squad>['players'][number]; delta: number }[] = [];
  for (const player of state.squad.players) {
    const entry = perPlayer.get(player.id);
    if (entry === undefined) continue;
    const delta = entry.team_points - player.team_points;
    if (delta !== 0) changed.push({ player, delta });
    player.team_points = entry.team_points;
  }
  state.squad.gameweek_total = newTotal;
  if (update.playerDelta !== undefined && update.eventPlayerId !== undefined) {
    newTotal = oldTotal + update.playerDelta;
    state.squad.gameweek_total = newTotal;
  }

  if (changed.length === 0) return;

  const liveRegion = document.querySelector<HTMLElement>('[data-live-region="live-points"]');
  if (liveRegion !== null && update.eventPlayerId !== undefined && update.eventLabel !== undefined) {
    const entry = changed.find((item) => item.player.id === update.eventPlayerId);
    if (entry !== undefined) {
      const sign = entry.delta >= 0 ? '+' : '';
      const name = update.playerName ?? entry.player.name;
      const total = state.squad.gameweek_total;
      if (entry.player.slot === 'bench' && state.squad.chip !== 'bench_boost') {
        announceOnce(liveRegion, `${name}: ${update.eventLabel} on your bench, not counted.`);
      } else {
        announceOnce(liveRegion, `${name}: ${update.eventLabel}, ${sign}${entry.delta} for your team. Gameweek total ${total}.`);
      }
    }
  }

  if (reducedMotion()) {
    for (const item of changed) {
      const shirt = document.querySelector<HTMLElement>(`[data-player-id="${item.player.id}"]`);
      if (shirt === null) continue;
      shirt.dataset.points = String(item.player.team_points);
      const figure = shirt.querySelector<HTMLElement>('.shirt-figure');
      if (figure !== null) figure.textContent = String(item.player.team_points);
      const badge = document.createElement('span');
      badge.className = 'delta-badge';
      const captainTag = item.player.captain ? ' x2' : '';
      badge.textContent = `${item.delta >= 0 ? '+' : ''}${item.delta}${captainTag}`;
      shirt.appendChild(badge);
      window.setTimeout(() => badge.remove(), 4000);
    }
    if (totalElement !== null) totalElement.textContent = String(newTotal);
    totalElement?.setAttribute('data-points', String(newTotal));
    void refreshLeagueRow();
    return;
  }

  if (relayRunning) {
    finishRelayImmediately();
  }
  void runRelay(changed, oldTotal, newTotal, totalElement);
}

let runningRelay: { finish: () => void } | null = null;

function finishRelayImmediately(): void {
  runningRelay?.finish();
  runningRelay = null;
  relayRunning = false;
}

async function runRelay(
  changed: { player: NonNullable<typeof state.squad>['players'][number]; delta: number }[],
  oldTotal: number,
  newTotal: number,
  totalElement: HTMLElement | null,
): Promise<void> {
  relayRunning = true;
  const reduced = reducedMotion();
  let finished = false;
  const finish = (): void => {
    finished = true;
  };
  runningRelay = { finish };

  const first = changed[0];
  const shirt = document.querySelector<HTMLElement>(`[data-player-id="${first.player.id}"]`);
  if (shirt !== null) {
    shirt.dataset.points = String(first.player.team_points);
    const figure = shirt.querySelector<HTMLElement>('.shirt-figure');
    if (figure !== null) figure.textContent = String(first.player.team_points);
    shirt.classList.add('is-pulsing');
    const chip = document.createElement('span');
    chip.className = 'relay-chip';
    chip.dataset.relayChip = '';
    const tag = first.player.captain ? ' x2' : '';
    chip.textContent = `${first.delta >= 0 ? '+' : ''}${first.delta}${tag}`;
    shirt.appendChild(chip);

    if (!reduced) {
      const total = totalElement ?? document.body;
      const from = shirt.getBoundingClientRect();
      const to = total.getBoundingClientRect();
      const flight = document.createElement('span');
      flight.className = 'relay-chip relay-flight';
      flight.dataset.relayChip = '';
      flight.textContent = chip.textContent;
      document.body.appendChild(flight);
      flight.style.position = 'fixed';
      flight.style.left = `${from.left + from.width / 2}px`;
      flight.style.top = `${from.top + from.height / 2}px`;
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      flight.animate(
        [
          { transform: 'translate(0, 0) scale(1)', opacity: '1' },
          { transform: `translate(${dx}px, ${dy}px) scale(0.4)`, opacity: '0.9' },
        ],
        { duration: 380, easing: 'ease-in-out' },
      ).addEventListener('finish', () => flight.remove());
    }
    window.setTimeout(() => {
      shirt.classList.remove('is-pulsing');
      chip.remove();
    }, 1800);
  }

  if (!reduced) {
    await wait(380);
  }
  if (finished) { void finalValues(); return; }

  if (totalElement !== null) {
    totalElement.dataset.points = String(newTotal);
    const start = oldTotal;
    const end = newTotal;
    const duration = 600;
    const startTime = performance.now();
    const step = (now: number): void => {
      if (finished) { totalElement.textContent = String(end); return; }
      const t = Math.min(1, (now - startTime) / duration);
      totalElement.textContent = String(Math.round(start + (end - start) * t));
      if (t < 1) requestAnimationFrame(step);
      else totalElement.textContent = String(end);
    };
    requestAnimationFrame(step);
  }
  if (!reduced) {
    await wait(600);
  }
  if (finished) { void finalValues(); return; }

  await refreshLeagueRow();
  relayRunning = false;
  runningRelay = null;

  function finalValues(): void {
    if (totalElement !== null) {
      totalElement.textContent = String(newTotal);
      totalElement.dataset.points = String(newTotal);
    }
    relayRunning = false;
    runningRelay = null;
    void refreshLeagueRow();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function refreshLeagueRow(): Promise<void> {
  const screen = parseScreen(window.location.pathname, new URLSearchParams(window.location.search));
  if (screen.name !== 'team') return;
  const leagueId = screen.leagueId;
  let id = leagueId;
  if (id === null) {
    const leagues = await api.leagues();
    id = leagues.leagues[0]?.id ?? null;
  }
  if (id === null) return;
  try {
    const league = await api.league(id);
    const table = document.querySelector<HTMLTableElement>('[data-league-table]');
    if (table === null) return;
    renderStandingsTable(table, league.standings, state.me?.id ?? '');
  } catch {
    // league may have become unavailable
  }
}

function updateNoticesButton(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-notices-button]');
  if (button === null) return;
  const label = state.unread > 0 ? `Notices, ${state.unread} unread` : 'Notices';
  button.setAttribute('aria-label', label);
  const count = button.querySelector<HTMLElement>('.notice-count');
  if (count !== null) count.textContent = state.unread > 0 ? String(state.unread) : '';
}

async function navigate(screen: Screen, replace = false): Promise<void> {
  const path = pathOf(screen);
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  await render();
}

async function render(): Promise<void> {
  const screen = parseScreen(window.location.pathname, new URLSearchParams(window.location.search));
  root.innerHTML = '';

  if (state.me === null) {
    if (screen.name !== 'signin') {
      window.history.replaceState({}, '', '/signin');
    }
    renderSignIn();
    return;
  }

  if (state.me.role === 'operator') {
    renderOperatorShell(screen);
    return;
  }

  renderHeader(screen);

  if ((screen.name === 'team' || screen.name === 'transfers') && !state.hasSquad) {
    window.history.replaceState({}, '', '/transfers');
    await renderBuilder();
    return;
  }

  switch (screen.name) {
    case 'signin':
      await navigate({ name: 'team', view: 'pitch', leagueId: null }, true);
      return;
    case 'team':
      await renderTeamScreen(screen.view, screen.leagueId);
      return;
    case 'transfers':
      await drawTransfers(screen, makeBuilderState(), false);
      return;
    case 'leagues':
      await renderLeaguesScreen();
      return;
    case 'league':
      await renderLeagueScreen(screen.leagueId);
      return;
    case 'memberHistory':
      await renderMemberHistory(screen.leagueId, screen.managerId);
      return;
    case 'history':
      await renderHistoryScreen();
      return;
    case 'operator':
      await navigate({ name: 'team', view: 'pitch', leagueId: null }, true);
      return;
  }
}

function renderHeader(screen: Screen): void {
  const header = document.createElement('header');
  header.className = 'site-header';

  const brand = document.createElement('span');
  brand.className = 'wordmark';
  brand.textContent = 'Elevens';

  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  const links: { label: string; screen: Screen }[] = [
    { label: 'Pick Team', screen: { name: 'team', view: 'pitch', leagueId: null } },
    { label: 'Transfers', screen: { name: 'transfers', view: 'pitch', position: 'All', club: 'All', maxPrice: 'Any', sort: 'price_desc' } },
    { label: 'Leagues', screen: { name: 'leagues' } },
    { label: 'History', screen: { name: 'history' } },
  ];
  for (const link of links) {
    const anchor = document.createElement('a');
    anchor.href = pathOf(link.screen);
    anchor.textContent = link.label;
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(link.screen);
    });
    nav.appendChild(anchor);
  }

  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Gameweek status');
  status.textContent = gameweekStatusLine(state.current);

  const noticesButton = document.createElement('button');
  noticesButton.type = 'button';
  noticesButton.dataset.noticesButton = '';
  noticesButton.setAttribute('aria-label', state.unread > 0 ? `Notices, ${state.unread} unread` : 'Notices');
  const bell = document.createElement('span');
  bell.textContent = '🔔';
  const count = document.createElement('span');
  count.className = 'notice-count';
  count.textContent = state.unread > 0 ? String(state.unread) : '';
  noticesButton.append(bell, count);
  noticesButton.addEventListener('click', () => openNoticesDialog(noticesButton));

  header.append(brand, nav, status, noticesButton);
  root.appendChild(header);
  void screen;
}

function renderSignIn(): void {
  const card = document.createElement('div');
  card.className = 'signin-card';

  const heading = document.createElement('h1');
  heading.textContent = 'Elevens';
  card.appendChild(heading);

  let mode: 'signin' | 'signup' = 'signin';

  const form = document.createElement('form');
  const accountRegion = document.createElement('div');
  accountRegion.setAttribute('role', 'status');
  accountRegion.setAttribute('aria-label', 'Account');

  const email = document.createElement('input');
  email.type = 'email';
  email.setAttribute('aria-label', 'Email');
  email.placeholder = 'Email';
  email.name = 'email';
  const emailError = document.createElement('div');
  emailError.className = 'field-error';
  email.id = 'signin-email';
  emailError.id = 'signin-email-error';

  const password = document.createElement('input');
  password.type = 'password';
  password.setAttribute('aria-label', 'Password');
  password.placeholder = 'Password';
  password.name = 'password';

  const teamName = document.createElement('input');
  teamName.type = 'text';
  teamName.setAttribute('aria-label', 'Team name');
  teamName.placeholder = 'Team name';
  teamName.name = 'team_name';
  teamName.hidden = true;

  const signInButton = document.createElement('button');
  signInButton.type = 'submit';
  signInButton.textContent = 'Sign in';

  const createAccountButton = document.createElement('button');
  createAccountButton.type = 'submit';
  createAccountButton.textContent = 'Create account';
  createAccountButton.hidden = true;

  const switchLink = document.createElement('a');
  switchLink.href = '#';
  switchLink.textContent = 'Create an account';
  switchLink.addEventListener('click', (event) => {
    event.preventDefault();
    mode = 'signup';
    teamName.hidden = false;
    createAccountButton.hidden = false;
    signInButton.hidden = true;
    switchLink.textContent = 'I have an account';
    heading.textContent = 'Create account';
    applyMode();
  });

  function applyMode(): void {
    teamName.hidden = mode === 'signin';
    createAccountButton.hidden = mode === 'signin';
    signInButton.hidden = mode === 'signup';
    switchLink.textContent = mode === 'signin' ? 'Create an account' : 'I have an account';
  }

  form.append(email, emailError, password, teamName, signInButton, createAccountButton, switchLink);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = mode === 'signin' ? signInButton : createAccountButton;
    await pendingButton(button, mode === 'signin' ? 'Signing in…' : 'Creating account…', async () => {
      try {
        if (mode === 'signin') {
          const account = await api.signIn({ email: email.value, password: password.value });
          state.me = { id: account.id, email: account.email, team_name: account.team_name, role: (account.role as 'manager' | 'operator') };
          await refreshSquad();
          const current = await api.currentGameweek();
          state.current = { number: current.number, status: current.status, deadline_local: current.deadline_local };
          socket?.close();
          socket = new LiveSocket(handleServerMessage, () => state.me?.role === 'operator');
          socket.connect();
          announceOnce(accountRegion, 'Signed in.');
          if (account.role === 'operator') {
            await navigate({ name: 'operator' }, true);
          } else if (!state.hasSquad) {
            await navigate({ name: 'transfers', view: 'pitch', position: 'All', club: 'All', maxPrice: 'Any', sort: 'price_desc' }, true);
          } else {
            await navigate({ name: 'team', view: 'pitch', leagueId: null }, true);
          }
        } else {
          await api.signUp({ email: email.value, password: password.value, team_name: teamName.value });
          announceOnce(accountRegion, 'Account created.');
          const account = await api.signIn({ email: email.value, password: password.value });
          state.me = { id: account.id, email: account.email, team_name: account.team_name, role: (account.role as 'manager' | 'operator') };
          await refreshSquad();
          const current = await api.currentGameweek();
          state.current = { number: current.number, status: current.status, deadline_local: current.deadline_local };
          socket?.close();
          socket = new LiveSocket(handleServerMessage, () => state.me?.role === 'operator');
          socket.connect();
          await navigate({ name: 'transfers', view: 'pitch', position: 'All', club: 'All', maxPrice: 'Any', sort: 'price_desc' }, true);
        }
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 401) announceOnce(accountRegion, 'Email or password is wrong.');
          else if (error.status === 409) announceOnce(accountRegion, 'An account with this email already exists.');
          else if (error.status === 503) announceOnce(accountRegion, 'Sign-in is unavailable right now. Try again in a minute.');
          else if (error.status === 422 && error.body.fields !== undefined) {
            const parts = Object.entries(error.body.fields).map(([field, message]) => {
              const input = field === 'email' ? email : field === 'password' ? password : teamName;
              input.setAttribute('aria-describedby', `${field}-error`);
              const holder = document.getElementById(`${field}-error`) ?? document.createElement('div');
              holder.id = `${field}-error`;
              holder.className = 'field-error';
              holder.textContent = message;
              input.after(holder);
              return { field, message, input };
            });
            accountRegion.textContent = '';
            parts.forEach((part) => {
              const anchor = document.createElement('a');
              anchor.href = '#';
              anchor.textContent = part.message;
              anchor.addEventListener('click', (e) => {
                e.preventDefault();
                part.input.focus();
              });
              accountRegion.appendChild(anchor);
            });
          } else {
            announceOnce(accountRegion, error.body.message ?? 'Something went wrong.');
          }
        }
      }
    });
  });

  card.append(form, accountRegion);
  root.appendChild(card);
}

async function renderTeamScreen(view: 'pitch' | 'list', leagueId: string | null): Promise<void> {
  const squad = state.squad;
  if (squad === null) return;
  const isLive = squad.gameweek_status === 'live' || squad.gameweek_status === 'locked';
  const heading = document.createElement('h1');
  heading.textContent = isLive ? `Gameweek ${squad.gameweek} points` : 'Pick Team';
  root.appendChild(heading);

  const main = document.createElement('div');
  main.className = 'board';

  const left = document.createElement('div');
  left.className = 'board-left';

  const pitchRegion = document.createElement('div');
  pitchRegion.setAttribute('role', 'region');
  pitchRegion.setAttribute('aria-label', 'Pitch');
  pitchRegion.className = 'pitch';

  const updates = document.createElement('div');
  updates.setAttribute('role', 'status');
  updates.setAttribute('aria-label', 'Team updates');
  updates.dataset.liveRegion = 'team-updates';

  const livePoints = document.createElement('div');
  livePoints.setAttribute('role', 'status');
  livePoints.setAttribute('aria-label', 'Live points');
  livePoints.dataset.liveRegion = 'live-points';

  const model = buildPitchModel(squad.players, view);
  const focusState: PitchFocusState = { lastShirtId: null };

  const handlers: PitchHandlers = {
    mode: 'team',
    builderMode: false,
    isEditable: () => squad.editable,
    onUpdate: () => void 0,
    onSwap: async (outId, inId) => savePicksSwap(squad, outId, inId),
    onBenchSwap: async (a, b) => saveBenchSwap(squad, a, b),
    onCaptain: async (playerId) => saveCaptain(squad, playerId, 'captain'),
    onVice: async (playerId) => saveCaptain(squad, playerId, 'vice'),
  };

  createShirtGrid(pitchRegion, model, handlers, updates, squad, focusState, isLive);

  const viewGroup = document.createElement('div');
  viewGroup.setAttribute('role', 'radiogroup');
  viewGroup.setAttribute('aria-label', 'View');
  const pitchRadio = viewRadio('Pitch', view === 'pitch', () => {
    void navigate({ name: 'team', view: 'pitch', leagueId });
  });
  const listRadio = viewRadio('List', view === 'list', () => {
    void navigate({ name: 'team', view: 'list', leagueId });
  });
  viewGroup.append(pitchRadio, listRadio);

  left.append(viewGroup, pitchRegion);

  if (!squad.editable) {
    const banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', 'Locked banner');
    banner.className = 'locked-banner';
    banner.textContent = LOCKED_BANNER(squad.gameweek);
    left.appendChild(banner);
  }

  left.append(updates, livePoints);
  main.appendChild(left);

  const rail = document.createElement('aside');
  rail.className = 'ledger-rail';
  rail.setAttribute('role', 'complementary');
  rail.setAttribute('aria-label', 'Ledger');
  rail.dataset.rail = '';

  appendRailFigures(rail, squad);

  const chipsGroup = document.createElement('div');
  chipsGroup.setAttribute('role', 'group');
  chipsGroup.setAttribute('aria-label', 'Chips');
  renderChips(chipsGroup, squad, updates);
  rail.appendChild(chipsGroup);

  const table = document.createElement('table');
  table.setAttribute('aria-label', 'League table');
  table.dataset.leagueTable = '';
  const placeholderRow = document.createElement('tbody');
  table.appendChild(placeholderRow);
  rail.appendChild(table);

  main.appendChild(rail);
  root.appendChild(main);

  await fillLeagueTable(table, leagueId, state.me?.id ?? '');
}

function viewRadio(label: string, checked: boolean, onChange: () => void): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'view-option';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'view';
  input.value = label.toLowerCase();
  input.checked = checked;
  input.addEventListener('change', onChange);
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.append(input, text);
  return wrapper;
}

async function fillLeagueTable(table: HTMLTableElement, leagueId: string | null, myId: string): Promise<void> {
  let id = leagueId;
  if (id === null) {
    const leagues = await api.leagues();
    id = leagues.leagues[0]?.id ?? null;
  }
  if (id === null) {
    table.innerHTML = '';
    const note = document.createElement('tbody');
    const row = note.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.textContent = 'Join or create a mini league to see it move.';
    table.appendChild(note);
    return;
  }
  try {
    const league = await api.league(id);
    renderStandingsTable(table, league.standings, myId);
  } catch {
    // ignore
  }
}

function renderStandingsTable(table: HTMLTableElement, standings: { rank: number; last_rank: number | null; manager_id: string; team_name: string; gameweek_points: number; season_total: number }[], myId: string): void {
  table.innerHTML = '';
  const thead = table.createTHead();
  const headRow = thead.insertRow();
  ['Rank', 'Team', 'GW', 'Total'].forEach((label) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.appendChild(th);
  });
  const tbody = table.createTBody();
  for (const standing of standings) {
    const row = tbody.insertRow();
    row.dataset.managerId = standing.manager_id;
    row.dataset.rank = String(standing.rank);
    row.dataset.points = String(standing.season_total);
    row.className = standing.manager_id === myId ? 'is-me' : '';
    const rankCell = row.insertCell();
    rankCell.textContent = String(standing.rank);
    if (standing.last_rank !== null && standing.last_rank !== standing.rank) {
      const diff = standing.last_rank - standing.rank;
      const arrow = document.createElement('span');
      arrow.className = diff > 0 ? 'rank-arrow up' : 'rank-arrow down';
      arrow.setAttribute('role', 'img');
      arrow.setAttribute('aria-label', diff > 0 ? `Up ${diff}` : `Down ${-diff}`);
      arrow.textContent = diff > 0 ? '▲' : '▼';
      rankCell.appendChild(arrow);
    }
    const teamCell = row.insertCell();
    const link = document.createElement('a');
    link.href = `/leagues/${currentLeagueId()}/members/${standing.manager_id}`;
    link.textContent = standing.team_name;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate({ name: 'memberHistory', leagueId: currentLeagueId(), managerId: standing.manager_id });
    });
    teamCell.appendChild(link);
    const gwCell = row.insertCell();
    gwCell.textContent = String(standing.gameweek_points);
    const totalCell = row.insertCell();
    totalCell.textContent = String(standing.season_total);
  }
  void myId;
}

function currentLeagueId(): string {
  const screen = parseScreen(window.location.pathname, new URLSearchParams(window.location.search));
  if (screen.name === 'team') return screen.leagueId ?? '';
  if (screen.name === 'league' || screen.name === 'memberHistory') return screen.leagueId;
  return '';
}

function appendRailFigures(rail: HTMLElement, squad: NonNullable<typeof state.squad>): void {
  const figures = document.createElement('div');
  figures.className = 'rail-figures';
  const total = document.createElement('span');
  total.className = 'rail-total';
  total.dataset.gameweekTotal = '';
  total.dataset.points = String(squad.gameweek_total);
  total.textContent = String(squad.gameweek_total);
  figures.append(
    railFigure('Bank', `${formatMillions(squad.bank_tenths)}m`),
    railFigure('Squad value', `${formatMillions(squad.squad_value_tenths)}m`),
    railFigure('Free transfers', String(squad.free_transfers)),
    railFigure('Hit cost', squad.hit_points === 0 ? '0' : `-${squad.hit_points}`),
    railFigureWithNode('Gameweek total', total),
  );
  rail.appendChild(figures);
}

function railFigure(label: string, value: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rail-figure';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.textContent = value;
  wrap.append(labelEl, valueEl);
  return wrap;
}

function railFigureWithNode(label: string, node: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rail-figure';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  wrap.append(labelEl, node);
  return wrap;
}

function renderChips(container: HTMLElement, squad: NonNullable<typeof state.squad>, updates: HTMLElement): void {
  const chips: ChipCode[] = ['wildcard', 'free_hit', 'bench_boost', 'triple_captain'];
  for (const chip of chips) {
    const chipState = squad.chips[chip];
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = CHIP_NAMES[chip];
    button.className = `chip chip-${chipState}`;
    button.setAttribute('aria-pressed', chipState === 'active' ? 'true' : 'false');
    button.disabled = chipState === 'used' || !squad.editable;
    const stateLabel = document.createElement('span');
    stateLabel.textContent = chipState === 'active' ? 'Active' : chipState === 'used' ? 'Used' : '';
    button.appendChild(stateLabel);
    button.addEventListener('click', () => {
      if (chipState === 'active') {
        void pendingButton(button, 'Cancelling…', async () => {
          try {
            await api.cancelChip(squad.gameweek);
            announceOnce(updates, `${CHIP_NAMES[chip]} cancelled.`);
            await refreshSquad();
            await render();
          } catch (error) {
            if (error instanceof ApiError) {
              if (error.body.error === 'chip_locked_in') announceOnce(updates, CHIP_CANCEL_MESSAGES[chip]);
              else announceOnce(updates, error.body.message ?? 'Chip cancelled failed.');
            }
          }
        });
        return;
      }
      openChipDialog(chip, button, squad, updates);
    });
    container.appendChild(button);
  }
}

function openChipDialog(chip: ChipCode, opener: HTMLButtonElement, squad: NonNullable<typeof state.squad>, updates: HTMLElement): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `Play ${CHIP_NAMES[chip]}`);
  const title = document.createElement('h2');
  title.textContent = `Play ${CHIP_NAMES[chip]}`;
  const description = document.createElement('p');
  description.textContent = CHIP_DESCRIPTIONS[chip];
  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.textContent = `Play ${CHIP_NAMES[chip]}`;
  const notNow = document.createElement('button');
  notNow.type = 'button';
  notNow.textContent = 'Not now';
  dialog.append(title, description, notNow, playButton);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const close = (): void => {
    backdrop.remove();
  };
  notNow.addEventListener('click', close);
  playButton.addEventListener('click', () => {
    void pendingButton(playButton, 'Playing…', async () => {
      try {
        await api.playChip(squad.gameweek, chip);
        announceOnce(updates, `${CHIP_NAMES[chip]} played for gameweek ${squad.gameweek}.`);
        await refreshSquad();
        close();
        await render();
      } catch (error) {
        close();
        if (error instanceof ApiError) {
          announceOnce(updates, error.body.message ?? 'The chip could not be played.');
        }
      }
    });
  });
  focusTrap({ dialog, onClose: close, initialFocus: notNow, returnFocus: opener });
}

async function savePicksSwap(squad: NonNullable<typeof state.squad>, outId: string, inId: string): Promise<NonNullable<typeof state.squad> | ApiError> {
  const starting = squad.players.filter((p) => p.slot === 'starting').map((p) => p.id);
  const bench = squad.players.filter((p) => p.slot === 'bench').sort((a, b) => (a.bench_order ?? 0) - (b.bench_order ?? 0)).map((p) => p.id);
  const startIndex = starting.indexOf(outId);
  const benchIndex = bench.indexOf(inId);
  if (startIndex < 0 || benchIndex < 0) return new ApiError(400, { error: 'swap_failed' });
  starting[startIndex] = inId;
  bench[benchIndex] = outId;
  const result = await submitPicks(squad, starting, bench, squad.players.find((p) => p.id === squad.players.find((q) => q.captain)?.id)?.id ?? null);
  if (result instanceof ApiError) return result;
  state.squad = result;
  return result;
}

async function saveBenchSwap(squad: NonNullable<typeof state.squad>, a: string, b: string): Promise<NonNullable<typeof state.squad> | ApiError> {
  const bench = squad.players.filter((p) => p.slot === 'bench').sort((x, y) => (x.bench_order ?? 0) - (y.bench_order ?? 0)).map((p) => p.id);
  const i = bench.indexOf(a);
  const j = bench.indexOf(b);
  if (i < 0 || j < 0) return new ApiError(400, { error: 'swap_failed' });
  const temp = bench[i];
  bench[i] = bench[j];
  bench[j] = temp;
  const starting = squad.players.filter((p) => p.slot === 'starting').map((p) => p.id);
  const result = await submitPicks(squad, starting, bench, null);
  if (result instanceof ApiError) return result;
  state.squad = result;
  return result;
}

async function saveCaptain(squad: NonNullable<typeof state.squad>, playerId: string, role: 'captain' | 'vice'): Promise<NonNullable<typeof state.squad> | ApiError> {
  const starting = squad.players.filter((p) => p.slot === 'starting').map((p) => p.id);
  const bench = squad.players.filter((p) => p.slot === 'bench').sort((a, b) => (a.bench_order ?? 0) - (b.bench_order ?? 0)).map((p) => p.id);
  let captain = squad.players.find((p) => p.captain)?.id ?? null;
  let vice = squad.players.find((p) => p.vice_captain)?.id ?? null;
  if (role === 'captain') {
    if (captain === playerId && vice !== null) {
      const newCaptain = playerId;
      const newVice = captain;
      captain = newCaptain;
      vice = newVice;
    } else {
      if (captain === playerId) return squad;
      const oldVice = vice;
      vice = captain;
      captain = playerId;
      if (oldVice === playerId) vice = oldVice;
    }
  } else {
    if (vice === playerId) return squad;
    if (captain === playerId) {
      vice = captain;
      captain = playerId;
    } else {
      vice = playerId;
    }
  }
  const result = await submitPicks(squad, starting, bench, null, captain, vice);
  if (result instanceof ApiError) return result;
  state.squad = result;
  return result;
}

async function submitPicks(
  squad: NonNullable<typeof state.squad>,
  starting: string[],
  bench: string[],
  _unused: string | null,
  captainOverride?: string | null,
  viceOverride?: string | null,
): Promise<NonNullable<typeof state.squad> | ApiError> {
  const captain = captainOverride !== undefined ? captainOverride : squad.players.find((p) => p.captain)?.id ?? null;
  const vice = viceOverride !== undefined ? viceOverride : squad.players.find((p) => p.vice_captain)?.id ?? null;
  try {
    const result = await api.savePicks({ gameweek: squad.gameweek, starting, bench, captain, vice_captain: vice });
    state.squad = result;
    return result;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
}

function openNoticesDialog(opener: HTMLButtonElement): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Notices');
  const list = document.createElement('ul');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Notices');
  const markAll = document.createElement('button');
  markAll.type = 'button';
  markAll.textContent = 'Mark all read';
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Notices');
  dialog.append(markAll, list, status);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const close = (): void => {
    backdrop.remove();
  };

  void api.notices().then((inbox) => {
    list.innerHTML = '';
    if (inbox.notices.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'No notices yet.';
      list.appendChild(item);
    }
    for (const notice of inbox.notices) {
      const item = document.createElement('li');
      const stamp = document.createElement('span');
      stamp.textContent = formatStamp(notice.created);
      const message = document.createElement('span');
      message.textContent = notice.message;
      item.append(stamp, message);
      list.appendChild(item);
    }
  }).catch(() => {
    list.innerHTML = '';
    const item = document.createElement('li');
    item.textContent = 'Notices are delayed. They will appear here when the inbox is back.';
    list.appendChild(item);
  });

  markAll.addEventListener('click', () => {
    void pendingButton(markAll, 'Marking…', async () => {
      try {
        await api.markAllRead();
        state.unread = 0;
        updateNoticesButton();
        close();
      } catch {
        announceOnce(status, 'Notices are delayed. They will appear here when the inbox is back.');
      }
    });
  });

  focusTrap({ dialog, onClose: close, initialFocus: markAll, returnFocus: opener });
}

function formatStamp(iso: string): string {
  const date = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return iso;
  const dublin = new Date(date.getTime() + 60 * 60000);
  return formatDeadline(dublin);
}


export function appendHeader(screen: Screen): void {
  renderHeader(screen);
}

export async function navigateScreen(next: Screen): Promise<void> {
  await navigate(next);
}

export async function rerender(): Promise<void> {
  await render();
}

export async function refreshSquadState(): Promise<void> {
  await refreshSquad();
}

export async function gotoTeam(): Promise<void> {
  await navigate({ name: 'team', view: 'pitch', leagueId: null }, true);
}

export function stateOf(): { squad: typeof state.squad | null; hasSquad: boolean } {
  return { squad: state.squad, hasSquad: state.hasSquad };
}

export function appendHeaderFor(screen: Screen): void {
  renderHeader(screen);
}

void boot();

