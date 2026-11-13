import { api, ApiError, type PlayerRow, type SquadPlayer, type DraftView } from './api';
import { announceOnce, pendingButton, focusTrap } from './dialog';
import { buildPitchModel, createShirtGrid, type PitchHandlers, type PitchFocusState } from './pitch';
import { formatMillions } from '../shared/format';
import { POSITION_LABELS, type Position } from '../shared/domain';
import type { Screen } from './screens';
import { pathOf } from './screens';
import { LOCKED_BANNER } from './state';

type SquadView = NonNullable<BuilderState['squad']>;

interface BuilderState {
  squad: Awaited<ReturnType<typeof api.squad>> | null;
  builderSquad: string[];
  players: PlayerRow[];
  outs: Set<string>;
  ins: string[];
  draft: DraftView | null;
}

export function makeBuilderState(): BuilderState {
  return { squad: null, builderSquad: [], players: [], outs: new Set(), ins: [], draft: null };
}

export async function renderBuilder(): Promise<void> {
  const builder = makeBuilderState();
  await drawTransfers(
    {
      name: 'transfers',
      view: 'pitch',
      position: 'All',
      club: 'All',
      maxPrice: 'Any',
      sort: 'price_desc',
    },
    builder,
    true,
  );
}

export async function renderTransfers(screen: Screen, outerState: unknown): Promise<void> {
  void outerState;
  const builder = makeBuilderState();
  await drawTransfers(screen, builder, false);
}

export async function drawTransfers(screen: Screen, builder: BuilderState, builderMode: boolean): Promise<void> {
  if (screen.name !== 'transfers') return;
  const app = (await import('./app')) as { appendHeader(screen: Screen): void; stateOf(): { squad: SquadView | null; hasSquad: boolean } };
  const outer = app.stateOf();
  builder.squad = outer.squad;

  const heading = document.createElement('h1');
  heading.textContent = builderMode ? 'Build your squad' : 'Transfers';
  document.querySelector('#root')?.appendChild(heading);

  if (builderMode) {
    await renderSquadBuilder(builder);
    return;
  }
  if (outer.squad === null) return;
  await renderTransfersBoard(screen, builder, outer.squad);
}

async function renderSquadBuilder(builder: BuilderState): Promise<void> {
  builder.players = (await api.players('?sort=price_desc')).players;
  const needed: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  const countBy = (position: Position): number =>
    builder.builderSquad.filter((id) => builder.players.find((p) => p.id === id)?.position === position).length;

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

  const draftPreview = document.createElement('div');
  draftPreview.setAttribute('role', 'status');
  draftPreview.setAttribute('aria-label', 'Draft preview');
  draftPreview.dataset.draftPreview = '';

  const rows = (['GK', 'DEF', 'MID', 'FWD'] as Position[]).map((position) => ({
    position,
    players: Array.from({ length: needed[position] }, (_, index) => {
      const filled = builder.builderSquad.filter((id) => builder.players.find((p) => p.id === id)?.position === position);
      const id = filled[index];
      const row = builder.players.find((p) => p.id === id);
      if (row === undefined) {
        return emptyShirt(position);
      }
      return filledShirt(row);
    }),
  }));

  const grid = document.createElement('div');
  grid.className = 'pitch-rows';
  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'pitch-row';
    rowEl.dataset.position = row.position;
    for (const shirt of row.players) {
      rowEl.appendChild(shirt);
      if (shirt.dataset.playerId !== undefined) {
        shirt.addEventListener('click', () => {
          const id = shirt.dataset.playerId ?? '';
          removeSlot(builder, id, draftPreview, updates);
          void redraw();
        });
      }
    }
    grid.appendChild(rowEl);
  }
  pitchRegion.appendChild(grid);

  const playersList = document.createElement('div');
  playersList.setAttribute('role', 'listbox');
  playersList.setAttribute('aria-label', 'Players');
  playersList.className = 'players-list';
  playersList.tabIndex = 0;
  builder.players
    .filter((player) => !builder.builderSquad.includes(player.id))
    .forEach((player, index) => {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.dataset.active = index === 0 ? 'true' : 'false';
      option.dataset.playerId = player.id;
      option.tabIndex = -1;
      const name = document.createElement('span');
      name.textContent = `${player.name}, ${player.club}, ${POSITION_LABELS[player.position]}, ${formatMillions(player.price_tenths)}m`;
      option.appendChild(name);
      option.addEventListener('click', () => fillSlot(builder, player.id, draftPreview, updates));
      playersList.appendChild(option);
    });

  playersList.addEventListener('keydown', (event) => {
    const options = Array.from(playersList.querySelectorAll<HTMLElement>('[role="option"]'));
    const active = options.findIndex((option) => option.dataset.active === 'true');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      let next = active;
      if (event.key === 'ArrowDown') next = Math.min(options.length - 1, active + 1);
      if (event.key === 'ArrowUp') next = Math.max(0, active - 1);
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = options.length - 1;
      if (next >= 0 && options[next] !== undefined) {
        options.forEach((option, i) => (option.dataset.active = i === next ? 'true' : 'false'));
        options[next].focus();
      }
      return;
    }
    if (event.key === 'Enter') {
      const option = options[active];
      const id = option?.dataset.playerId;
      if (id !== undefined) {
        fillSlot(builder, id, draftPreview, updates);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      pitchRegion.focus();
    }
  });

  left.append(pitchRegion, draftPreview, playersList, updates);
  main.appendChild(left);

  const rail = document.createElement('aside');
  rail.className = 'ledger-rail';
  rail.setAttribute('role', 'complementary');
  rail.setAttribute('aria-label', 'Ledger');
  const spend = builder.builderSquad.reduce((sum, id) => sum + (builder.players.find((p) => p.id === id)?.price_tenths ?? 0), 0);
  const remaining = document.createElement('div');
  remaining.className = 'rail-figures';
  const bankValue = document.createElement('span');
  bankValue.textContent = `${formatMillions(1000 - spend)}m`;
  const bankFigure = document.createElement('div');
  bankFigure.className = 'rail-figure';
  const bankLabel = document.createElement('span');
  bankLabel.textContent = 'Money remaining';
  bankFigure.append(bankLabel, bankValue);
  remaining.appendChild(bankFigure);
  rail.appendChild(remaining);

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = 'Confirm squad';
  confirm.addEventListener('click', () => {
    void pendingButton(confirm, 'Confirming…', async () => {
      try {
        await api.createSquad(builder.builderSquad);
        announceOnce(updates, `Squad confirmed. Bank ${formatMillions(1000 - spend)}m.`);
        const app = (await import('./app')) as { refreshSquadState(): Promise<void>; gotoTeam(): Promise<void> };
        await app.refreshSquadState();
        await app.gotoTeam();
      } catch (error) {
        if (error instanceof ApiError) {
          const messages = (error.body.rules ?? []).map((rule) => rule.message).join('; ');
          if (messages !== '') announceOnce(updates, `Squad refused: ${messages}.`);
          else announceOnce(updates, error.body.message ?? 'Squad refused.');
        }
      }
    });
  });
  rail.appendChild(confirm);

  main.appendChild(rail);
  document.querySelector('#root')?.appendChild(main);

  async function redraw(): Promise<void> {
    const root = document.querySelector('#root');
    if (root === null) return;
    const scroll = window.scrollY;
    root.innerHTML = '';
    await renderBuilder();
    window.scrollTo(0, scroll);
  }
  void redraw;
}

function emptyShirt(position: Position): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shirt is-empty';
  button.setAttribute('aria-label', `Empty ${POSITION_LABELS[position]} slot`);
  button.dataset.emptySlot = position;
  const label = document.createElement('span');
  label.className = 'shirt-name';
  label.textContent = POSITION_LABELS[position];
  button.appendChild(label);
  return button;
}

function filledShirt(player: PlayerRow): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shirt';
  button.dataset.playerId = player.id;
  button.dataset.points = '0';
  button.setAttribute('aria-label', `${player.name}, ${POSITION_LABELS[player.position]}, 0 points`);
  const badge = document.createElement('span');
  badge.className = 'shirt-badge';
  badge.textContent = player.club;
  const name = document.createElement('span');
  name.className = 'shirt-name';
  name.textContent = player.name.split(' ').slice(1).join(' ') || player.name;
  const figure = document.createElement('span');
  figure.className = 'shirt-figure';
  figure.textContent = formatMillions(player.price_tenths);
  button.append(badge, name, figure);
  return button;
}

function fillSlot(builder: BuilderState, playerId: string, preview: HTMLElement, updates: HTMLElement): void {
  const player = builder.players.find((p) => p.id === playerId);
  if (player === undefined) return;
  builder.builderSquad.push(playerId);
  void redrawBuilder(builder, preview, updates);
}

function removeSlot(builder: BuilderState, playerId: string, preview: HTMLElement, updates: HTMLElement): void {
  builder.builderSquad = builder.builderSquad.filter((id) => id !== playerId);
  void redrawBuilder(builder, preview, updates);
}

async function redrawBuilder(builder: BuilderState, preview: HTMLElement, updates: HTMLElement): Promise<void> {
  void preview;
  void updates;
  const root = document.querySelector('#root');
  if (root === null) return;
  const scroll = window.scrollY;
  root.innerHTML = '';
  await renderBuilder();
  window.scrollTo(0, scroll);
}

type TransfersScreen = Extract<Screen, { name: 'transfers' }>;

async function renderTransfersBoard(broadScreen: Screen, builder: BuilderState, squad: SquadView): Promise<void> {
  if (broadScreen.name !== 'transfers') return;
  const screen: TransfersScreen = broadScreen;
  const narrow: TransfersScreen = screen;
  void builder;
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

  const draftPreview = document.createElement('div');
  draftPreview.setAttribute('role', 'status');
  draftPreview.setAttribute('aria-label', 'Draft preview');
  draftPreview.dataset.draftPreview = '';

  const draft = await api.draft();
  const outsMarked = new Set(draft.out);
  const insChosen = [...draft.in];

  const focusState: PitchFocusState = { lastShirtId: null };
  const handlers: PitchHandlers = {
    mode: 'transfers',
    builderMode: false,
    isEditable: () => squad.editable,
    onUpdate: () => void 0,
    outsMarked,
    onToggleOut: (playerId) => {
      void toggleOut(playerId);
    },
    onSwap: async () => new ApiError(400, { error: 'unsupported' }),
    onBenchSwap: async () => new ApiError(400, { error: 'unsupported' }),
    onCaptain: async () => new ApiError(400, { error: 'unsupported' }),
    onVice: async () => new ApiError(400, { error: 'unsupported' }),
  };

  const model = buildPitchModel(squad.players, narrow.view);
  createShirtGrid(pitchRegion, model, handlers, updates, squad, focusState, false);

  const viewGroup = document.createElement('div');
  viewGroup.setAttribute('role', 'radiogroup');
  viewGroup.setAttribute('aria-label', 'View');
  const pitchRadio = transferViewRadio('Pitch', narrow.view === 'pitch', () => {
    void changeView('pitch');
  });
  const listRadio = transferViewRadio('List', narrow.view === 'list', () => {
    void changeView('list');
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
  left.append(draftPreview, updates);

  const filters = document.createElement('div');
  filters.className = 'filters';

  const positionSelect = filterSelect('Position', ['All', 'Goalkeepers', 'Defenders', 'Midfielders', 'Forwards'], positionValue(screen.position), (value) => {
    void changeFilter('position', positionKey(value));
  });
  const clubs = await api.clubs();
  const clubSelect = filterSelect('Club', ['All clubs', ...clubs.clubs.map((club) => club.name)], clubValue(screen.club, clubs.clubs), (value) => {
    void changeFilter('club', clubKey(value, clubs.clubs));
  });
  const priceOptions = ['Any'];
  for (let price = 4.0; price <= 11.0 + 0.001; price += 0.5) priceOptions.push(price.toFixed(1));
  const priceSelect = filterSelect('Max price', priceOptions, screen.maxPrice === 'Any' ? 'Any' : screen.maxPrice, (value) => {
    void changeFilter('max_price', value === 'Any' ? 'Any' : value);
  });
  const sortSelect = filterSelect('Sort', ['Highest price', 'Lowest price', 'Most points', 'Name'], sortValue(screen.sort), (value) => {
    void changeFilter('sort', sortKey(value));
  });
  filters.append(positionSelect, clubSelect, priceSelect, sortSelect);
  left.appendChild(filters);

  const playersQuery = transferQuery(narrow);
  const players = (await api.players(playersQuery)).players;
  const playersList = document.createElement('div');
  playersList.setAttribute('role', 'listbox');
  playersList.setAttribute('aria-label', 'Players');
  playersList.className = 'players-list';
  playersList.tabIndex = 0;
  players.forEach((player, index) => {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.dataset.active = index === 0 ? 'true' : 'false';
    option.dataset.playerId = player.id;
    option.tabIndex = -1;
    option.setAttribute('aria-label', `${player.name}, ${player.club}, ${POSITION_LABELS[player.position]}, ${formatMillions(player.price_tenths)}m`);
    const name = document.createElement('span');
    name.textContent = player.name;
    const meta = document.createElement('span');
    meta.textContent = `${player.club} · ${formatMillions(player.price_tenths)}m`;
    option.append(name, meta);
    option.addEventListener('click', () => bringIn(player.id, player.position));
    playersList.appendChild(option);
  });

  playersList.addEventListener('keydown', (event) => {
    const options = Array.from(playersList.querySelectorAll<HTMLElement>('[role="option"]'));
    const active = options.findIndex((option) => option.dataset.active === 'true');
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      let next = active;
      if (event.key === 'ArrowDown') next = Math.min(options.length - 1, active + 1);
      if (event.key === 'ArrowUp') next = Math.max(0, active - 1);
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = options.length - 1;
      if (next >= 0 && options[next] !== undefined) {
        options.forEach((option, i) => (option.dataset.active = i === next ? 'true' : 'false'));
        options[next].focus();
      }
      return;
    }
    if (event.key === 'Enter') {
      const option = options[active];
      const id = option?.dataset.playerId;
      const player = players.find((p) => p.id === id);
      if (player !== undefined) bringIn(player.id, player.position);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      pitchRegion.focus();
    }
  });
  left.appendChild(playersList);

  main.appendChild(left);

  const rail = document.createElement('aside');
  rail.className = 'ledger-rail';
  rail.setAttribute('role', 'complementary');
  rail.setAttribute('aria-label', 'Ledger');
  const figures = document.createElement('div');
  figures.className = 'rail-figures';
  figures.append(
    railFigure('Bank', `${formatMillions(squad.bank_tenths)}m`),
    railFigure('Squad value', `${formatMillions(squad.squad_value_tenths)}m`),
    railFigure('Free transfers', String(squad.free_transfers)),
    railFigure('Hit cost', squad.hit_points === 0 ? '0' : `-${squad.hit_points}`),
  );
  rail.appendChild(figures);

  const draftBar = document.createElement('div');
  draftBar.className = 'draft-bar';

  const reviewButton = document.createElement('button');
  reviewButton.type = 'button';
  reviewButton.textContent = 'Review transfers';
  reviewButton.disabled = !squad.editable || draft.state === 'clean';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset draft';
  resetButton.disabled = !squad.editable;

  reviewButton.addEventListener('click', () => openConfirmDialog(reviewButton, draft, squad, updates));
  resetButton.addEventListener('click', () => {
    void pendingButton(resetButton, 'Resetting…', async () => {
      await api.clearDraft();
      await redrawTransfers();
    });
  });

  draftBar.append(reviewButton, resetButton);
  rail.appendChild(draftBar);
  main.appendChild(rail);

  document.querySelector('#root')?.appendChild(main);

  updateDraftPreview(draftPreview, draft);

  async function toggleOut(playerId: string): Promise<void> {
    if (outsMarked.has(playerId)) {
      outsMarked.delete(playerId);
      const index = insChosen.findIndex((id, i) => i === outsToArray().indexOf(outsMarkedValues().at(-1) ?? ''));
      void index;
      const nextIns = insChosen.slice(0, Math.max(0, outsMarked.size));
      await saveDraftNext(outsMarked, nextIns);
      return;
    }
    outsMarked.add(playerId);
    const nextIns = insChosen.slice(0, outsMarked.size);
    await saveDraftNext(outsMarked, nextIns);
  }

  function outsMarkedValues(): string[] {
    return Array.from(outsMarked);
  }

  function outsToArray(): string[] {
    return Array.from(outsMarked);
  }

  async function saveDraftNext(outs: Set<string>, ins: string[]): Promise<void> {
    const nextDraft = await api.saveDraft({ gameweek: squad.gameweek, out: Array.from(outs), in: ins });
    updateDraftPreview(draftPreview, nextDraft);
    insChosen.length = 0;
    insChosen.push(...nextDraft.in);
    reviewButton.disabled = !squad.editable || nextDraft.state === 'clean';
    void redrawShirtStates();
  }

  function redrawShirtStates(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-player-id]').forEach((button) => {
      const id = button.dataset.playerId ?? '';
      const marked = outsMarked.has(id);
      button.classList.toggle('is-out', marked);
      const tag = button.querySelector<HTMLElement>('.shirt-tag');
      if (tag !== null) tag.textContent = marked ? 'Out' : '';
    });
  }

  async function bringIn(playerId: string, position: Position): Promise<void> {
    const outs = Array.from(outsMarked);
    const playerOut = outs.map((id) => squad.players.find((p) => p.id === id)).find((p) => p !== undefined && p.position === position && !insChosen[outs.indexOf(p.id)]);
    if (playerOut === undefined) {
      announceOnce(updates, `Mark a ${POSITION_LABELS[position]} to sell first.`);
      return;
    }
    const outIndex = outs.indexOf(playerOut.id);
    const nextIns = [...insChosen];
    while (nextIns.length < outIndex) nextIns.push('');
    nextIns[outIndex] = playerId;
    const cleaned = nextIns.filter((id) => id !== '');
    await saveDraftNext(outsMarked, cleaned);
  }

  async function changeView(view: 'pitch' | 'list'): Promise<void> {
    await navigateScreen({ ...narrow, view });
  }

  async function changeFilter(key: 'position' | 'club' | 'max_price' | 'sort', value: string): Promise<void> {
    const next: Screen = { ...screen };
    if (key === 'position') next.position = value;
    if (key === 'club') next.club = value;
    if (key === 'max_price') next.maxPrice = value;
    if (key === 'sort') next.sort = value;
    await navigateScreen(next);
  }

  async function navigateScreen(next: Screen): Promise<void> {
    const app = (await import('./app')) as { navigateScreen(screen: Screen): Promise<void> };
    await app.navigateScreen(next);
  }

  async function redrawTransfers(): Promise<void> {
    const root = document.querySelector('#root');
    if (root === null) return;
    const scroll = window.scrollY;
    root.innerHTML = '';
    const app = (await import('./app')) as { appendHeaderFor(screen: Screen): void; stateOf(): { squad: SquadView | null } };
    app.appendHeaderFor(nextScreen());
    const outer = app.stateOf();
    if (outer.squad === null) return;
    await drawTransfers(nextScreen(), makeBuilderState(), false);
    window.scrollTo(0, scroll);
    function nextScreen(): Screen {
      return { ...narrow };
    }
  }
}

function transferQuery(screen: TransfersScreen): string {
  const params = new URLSearchParams();
  if (screen.position !== 'All') params.set('position', screen.position);
  if (screen.club !== 'All') params.set('club', screen.club);
  if (screen.maxPrice !== 'Any') params.set('max_price', screen.maxPrice);
  params.set('sort', screen.sort);
  return `?${params.toString()}`;
}

function filterSelect(label: string, options: string[], value: string, onChange: (value: string) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'filter';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  for (const option of options) {
    const optionEl = document.createElement('option');
    optionEl.value = option;
    optionEl.textContent = option;
    if (option === value) optionEl.selected = true;
    select.appendChild(optionEl);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrap.append(labelEl, select);
  return wrap;
}

function positionValue(position: string): string {
  const map: Record<string, string> = { All: 'All', GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
  return map[position] ?? 'All';
}

function positionKey(value: string): string {
  const map: Record<string, string> = { All: 'All', Goalkeepers: 'GK', Defenders: 'DEF', Midfielders: 'MID', Forwards: 'FWD' };
  return map[value] ?? 'All';
}

function clubValue(club: string, clubs: { code: string; name: string }[]): string {
  if (club === 'All') return 'All clubs';
  return clubs.find((entry) => entry.code === club)?.name ?? 'All clubs';
}

function clubKey(value: string, clubs: { code: string; name: string }[]): string {
  if (value === 'All clubs') return 'All';
  return clubs.find((entry) => entry.name === value)?.code ?? 'All';
}

function sortValue(sort: string): string {
  const map: Record<string, string> = { price_desc: 'Highest price', price_asc: 'Lowest price', points_desc: 'Most points', name_asc: 'Name' };
  return map[sort] ?? 'Highest price';
}

function sortKey(value: string): string {
  const map: Record<string, string> = { 'Highest price': 'price_desc', 'Lowest price': 'price_asc', 'Most points': 'points_desc', Name: 'name_asc' };
  return map[value] ?? 'price_desc';
}

function transferViewRadio(label: string, checked: boolean, onChange: () => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'view-option';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'view';
  input.value = label.toLowerCase();
  input.checked = checked;
  input.addEventListener('change', onChange);
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(input, text);
  return wrap;
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

function updateDraftPreview(target: HTMLElement, draft: DraftView): void {
  if (draft.preview === null) {
    target.textContent = 'Transfers 0 · Free used 0 · Hit -0 pts · Bank 0.0m';
    return;
  }
  target.textContent = `Transfers ${draft.preview.count} · Free used ${draft.preview.free_transfers_used} · Hit -${draft.preview.hit_points} pts · Bank ${formatMillions(draft.preview.bank_after_tenths)}m`;
}

function openConfirmDialog(opener: HTMLButtonElement, draft: DraftView, squad: SquadView, updates: HTMLElement): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Confirm transfers');

  const list = document.createElement('ul');
  for (let i = 0; i < draft.out.length; i += 1) {
    const outId = draft.out[i];
    const inId = draft.in[i];
    const outPlayer = squad.players.find((p) => p.id === outId);
    const inPlayer = inId !== undefined ? squad.players.find((p) => p.id === inId) : undefined;
    const item = document.createElement('li');
    item.textContent = `${outPlayer?.name ?? outId} → ${inPlayer?.name ?? '…'}`;
    list.appendChild(item);
  }
  const hitText = document.createElement('p');
  const hit = draft.preview?.hit_points ?? 0;
  hitText.textContent = `Hit ${hit} points`;
  const bankText = document.createElement('p');
  bankText.textContent = `Bank ${formatMillions(draft.preview?.bank_after_tenths ?? squad.bank_tenths)}m afterwards`;

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.textContent = 'Confirm transfers';
  const keepEditing = document.createElement('button');
  keepEditing.type = 'button';
  keepEditing.textContent = 'Keep editing';

  dialog.append(list, hitText, bankText, keepEditing, confirmButton);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const close = (): void => {
    backdrop.remove();
  };

  keepEditing.addEventListener('click', close);

  confirmButton.addEventListener('click', () => {
    void pendingButton(confirmButton, 'Confirming…', async () => {
      try {
        const key = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await api.confirmTransfers(
          { gameweek: squad.gameweek, out: draft.out, in: draft.in, hit_points: hit },
          key,
        );
        announceOnce(updates, `Transfers confirmed: ${result.transfers.length} made, hit ${result.hit_points} points, bank ${formatMillions(result.bank_tenths)}m.`);
        close();
        const app = (await import('./app')) as { refreshSquadState(): Promise<void>; rerender(): Promise<void> };
        await app.refreshSquadState();
        await app.rerender();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 409 && error.body.error === 'hit_changed') {
            announceOnce(updates, `The hit is now ${error.body.hit_points ?? 0} points. Check it and confirm again.`);
          } else if (error.status === 409 && error.body.error === 'gameweek_locked') {
            announceOnce(updates, error.body.message ?? 'The deadline has passed.');
          } else if (error.body.rules !== undefined) {
            const messages = error.body.rules.map((rule) => rule.message).join('; ');
            announceOnce(updates, `Transfers refused: ${messages}.`);
          } else {
            announceOnce(updates, error.body.message ?? 'Transfers refused.');
          }
          close();
        }
      }
    });
  });

  focusTrap({ dialog, onClose: close, initialFocus: keepEditing, returnFocus: opener });
}

export function appendHeaderStub(): void {
  // replaced by app module
}
