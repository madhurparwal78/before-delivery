// The Village screen: the islander's own island, the Build dialog, ghost placement, building
// details, the Train panel, and the shared context panels.
import { el, notice, alertMessage, clearFieldErrors, showFieldErrors, formatClock, formatAmounts, commaFormat, countdownText, reducedMotion } from '../ui.ts';
import { api, ApiRequestError, type Building, type Catalog, type Village } from '../api.ts';
import { renderShell, setPanelOpener, buildingLabel, type Shell } from '../shell.ts';
import { IslandScene, type SceneBuilding } from '../island/scene.ts';
import { state, setPollJob, serverNow, observeServerTime } from '../state.ts';
import { BUILDING_ORDER, BUILDINGS, UNITS, levelCost, SALTMARK_THRESHOLDS } from '../../domain/catalog.ts';
import type { BuildingType } from '../../domain/types.ts';
import * as panels from './panels.ts';

let scene: IslandScene | null = null;
let shell: Shell | null = null;
let ghostBar: HTMLElement | null = null;
let buildDialog: HTMLDialogElement | null = null;
let catalog: Catalog | null = null;
const knownJobs = new Map<number, { type: string; toLevel: number }>();

export function getScene(): IslandScene | null {
  return scene;
}

export async function renderVillage(root: HTMLElement): Promise<void> {
  catalog = await api<Catalog>('GET', '/api/catalog');
  shell = await renderShell(root);
  scene = new IslandScene('village', {
    onSelectBuilding: (building) => openBuildingDetails(building.id),
    onEmptyTap: () => closePanel(),
    onOpenBuildDialog: () => openBuildDialog(),
    onConfirmGhost: () => confirmGhost(),
    onCancelGhost: () => cancelGhost(),
  });
  shell.islandHolder.replaceChildren(scene.appElement);
  ghostBar = el('div', { class: 'ghost-bar', hidden: 'true' },
    el('button', { text: 'Rotate', onclick: () => scene?.rotateGhost() }),
    el('button', { text: 'Confirm placement', onclick: () => confirmGhost() }),
    el('button', { text: 'Cancel placement', onclick: () => cancelGhost() })
  );
  root.append(ghostBar);

  const buildButton = el('button', { text: 'Build', onclick: () => openBuildDialog() });
  const trainButton = el('button', { text: 'Train', onclick: () => openTrainPanel() });
  const bottom = el('div', { class: 'bottom-left' }, buildButton, trainButton);
  root.append(bottom);

  setPanelOpener((name) => void panels.openPanel(name, shell!));
  const initialPanel = new URLSearchParams(location.search).get('panel');
  if (initialPanel) {
    history.replaceState({}, '', '/');
    void panels.openPanel(initialPanel, shell!);
  }

  setPollJob('village', async () => {
    const village = await api<Village>('GET', '/api/village');
    observeServerTime(village.serverTime);
    state.village = village;
    applyVillage(village);
  });
  const village = await api<Village>('GET', '/api/village');
  observeServerTime(village.serverTime);
  state.village = village;
  applyVillage(village);
}

function applyVillage(village: Village): void {
  shell!.updateTopRule(village);
  shell!.updateQueues(village);

  // announce jobs that finished since the last read
  const running = new Map<number, { type: string; toLevel: number }>();
  for (const building of village.buildings) {
    if (building.upgrade !== null) {
      running.set(building.id, { type: building.type, toLevel: building.upgrade.toLevel });
    }
  }
  for (const [id, job] of knownJobs) {
    if (!running.has(id)) {
      notice(`${buildingLabel(job.type)} reached level ${job.toLevel}.`);
    }
  }
  knownJobs.clear();
  for (const [id, job] of running) knownJobs.set(id, job);

  const sceneBuildings: SceneBuilding[] = village.buildings.map((b) => ({
    id: b.id,
    type: b.type as BuildingType,
    x: b.x,
    y: b.y,
    rotation: b.rotation,
    level: b.level,
    working: b.upgrade !== null,
  }));
  scene?.setBuildings(sceneBuildings);

  const underAttack = el('p', { class: 'under-attack', text: 'Your island is under attack.' });
  if (village.underAttack && document.querySelector('.under-attack') === null) {
    document.querySelector('.island-overlay')?.append(underAttack);
    alertMessage('Your island is under attack.');
  } else if (!village.underAttack) {
    document.querySelector('.under-attack')?.remove();
  }
  panels.villageUpdated(village);
}

// --- the Build dialog ---

export function openBuildDialog(): void {
  if (buildDialog !== null) return;
  const dialog = el('dialog') as HTMLDialogElement;
  const placeList = el('div', { class: 'place-list' });
  for (const type of BUILDING_ORDER) {
    const spec = BUILDINGS[type];
    const cost = levelCost(type, 1);
    const costText = [
      cost.brine > 0 ? `${commaFormat(cost.brine)} brine` : '',
      cost.peat > 0 ? `${commaFormat(cost.peat)} peat` : '',
      cost.copper > 0 ? `${commaFormat(cost.copper)} copper` : '',
    ].filter(Boolean).join(' + ');
    placeList.append(el('button', { text: '', onclick: () => choosePlace(type) },
      el('span', { text: `Place ${spec.name}` }),
      el('span', { class: 'cost', text: `${costText} · ${spec.width}×${spec.depth}` })
    ));
  }
  const close = el('button', { text: 'Close', onclick: () => closeBuildDialog() });
  const card = el('div', { class: 'dialog-card' }, el('h2', { text: 'Build' }), placeList, close);
  dialog.append(card);
  dialog.setAttribute('aria-label', 'Build');
  document.body.append(dialog);
  dialog.showModal();
  buildDialog = dialog;
  const firstPlace = placeList.querySelector('button');
  firstPlace?.focus();

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBuildDialog();
    } else if (event.key === 'Tab') {
      const focusables = Array.from(card.querySelectorAll<HTMLElement>('button'));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

function closeBuildDialog(): void {
  const dialog = buildDialog;
  buildDialog = null;
  dialog?.close();
  dialog?.remove();
  document.querySelector('button')?.focus();
  const buildButton = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Build');
  buildButton?.focus();
}

function choosePlace(type: BuildingType): void {
  closeBuildDialog();
  const cursor = scene?.getCursor() ?? { x: 20, y: 20 };
  const { width, depth } = BUILDINGS[type];
  scene?.showGhost(type, Math.min(37 - width, cursor.x), Math.min(37 - depth, cursor.y));
  showGhostBar(true);
  scene?.appElement.focus();
}

function showGhostBar(visible: boolean): void {
  if (ghostBar !== null) ghostBar.hidden = !visible;
}

function cancelGhost(): void {
  scene?.hideGhost();
  showGhostBar(false);
  scene?.appElement.focus();
}

async function confirmGhost(): Promise<void> {
  const ghost = scene?.getGhost() ?? null;
  if (ghost === null) return;
  if (!scene?.ghostValid()) {
    alertMessage('That spot is taken or off the build area.');
    return;
  }
  const name = BUILDINGS[ghost.type].name;
  notice(`Placing ${name}…`);
  try {
    await api<Building>('POST', '/api/village/buildings', {
      type: ghost.type,
      x: ghost.x,
      y: ghost.y,
      rotation: ghost.rotation,
    });
    const zone = state.me?.timeZone ?? 'UTC';
    const village = await api<Village>('GET', '/api/village');
    applyVillage(village);
    const placedBuilding = village.buildings.find((b) => b.type === ghost.type && b.x === ghost.x && b.y === ghost.y);
    const finishesAt = placedBuilding?.upgrade?.finishesAt ?? village.serverTime;
    notice(`${name} placed. Done at ${formatClock(Date.parse(finishesAt), zone)}.`);
    cancelGhost();
  } catch (err) {
    handleActionError(err, `${name} placed.`);
  }
}

export function handleActionError(err: unknown, successCopy: string): void {
  if (err instanceof ApiRequestError) {
    if (err.api.code === 'validation_failed') {
      alertMessage('Check the highlighted fields.');
      return;
    }
    const copy: Record<string, string> = {
      cell_occupied: 'That spot is taken.',
      building_limit_reached: 'Your island already holds the most of these.',
      insufficient_resources: 'Not enough resources for that.',
      no_free_builder: 'All builders are busy.',
      saltmark_too_low: 'Raise your island’s saltmark first — finish more building levels.',
      max_level: 'Already at the highest level.',
      upgrade_in_progress: 'A builder is already on it.',
      job_already_finished: 'That job already finished. Nothing was refunded.',
      not_a_producer: 'Only producers can be collected.',
      housing_full: 'Your camps are full.',
      barracks_required: 'Build a Tide Barracks first.',
      barracks_level_too_low: 'Upgrade your Tide Barracks first.',
      batch_already_finished: 'That training already finished. Nothing was refunded.',
      rate_limited: 'Too many tries. Try again in a moment.',
    };
    alertMessage(copy[err.api.code] ?? err.api.message);
    return;
  }
  void successCopy;
  alertMessage('Lost contact with the server. Check your connection and try again.');
}

// --- context panels ---

export function closePanel(): void {
  panels.closePanel();
}

export function getShell(): Shell | null {
  return shell;
}

export function getVillage(): Village | null {
  return state.village;
}

// --- Building details ---

async function openBuildingDetails(buildingId: number): Promise<void> {
  const village = state.village;
  if (village === null) return;
  const building = village.buildings.find((b) => b.id === buildingId);
  if (building === undefined) return;
  const spec = BUILDINGS[building.type as BuildingType];
  const name = spec.name;

  const host = shell!.panelHost;
  host.className = 'context-panel';
  host.setAttribute('aria-label', 'Building details');
  host.setAttribute('role', 'complementary');
  host.replaceChildren();

  const heading = el('h2', { text: `${name} · level ${building.level}` });
  host.append(heading);

  const now = serverNow();
  const rows = el('div', { class: 'rows' });
  if (spec.producer && building.uncollected !== undefined) {
    rows.append(el('p', { text: `Uncollected ${commaFormat(building.uncollected)}` }));
  }
  if (building.upgrade !== null) {
    rows.append(el('p', { text: `Upgrading to level ${building.upgrade.toLevel} · ${countdownText(Date.parse(building.upgrade.finishesAt) - now)}` }));
  } else if (building.level < 3) {
    const cost = levelCost(building.type as BuildingType, building.level + 1);
    const seconds = catalog?.buildings.find((b) => b.type === building.type)?.levels[building.level]?.buildSeconds ?? spec.levels[building.level].buildSeconds;
    rows.append(el('p', { text: `Upgrade cost ${formatAmounts(cost)} · ${countdownText(seconds * 1000)}` }));
  }
  host.append(rows);

  const actions = el('div', { class: 'actions' });
  if (building.upgrade === null && building.level < 3) {
    actions.append(el('button', { text: `Upgrade to level ${building.level + 1}`, onclick: () => void upgradeBuilding(buildingId) }));
  }
  if (building.upgrade !== null) {
    actions.append(el('button', { text: 'Cancel job', onclick: () => void cancelJob(buildingId) }));
  }
  if (spec.producer) {
    actions.append(el('button', { text: 'Collect', onclick: () => void collectBuilding(buildingId) }));
  }
  actions.append(el('button', { text: 'Move', onclick: () => startMove(building) }));
  actions.append(el('button', { text: 'Close panel', onclick: () => { closePanel(); scene?.appElement.focus(); } }));
  host.append(actions);
  const focusTarget = actions.querySelector('button');
  focusTarget?.focus();
}

function startMove(building: Building): void {
  scene?.showGhost(building.type as BuildingType, building.x, building.y);
  const ghost = scene?.getGhost();
  if (ghost) ghost.rotation = building.rotation;
  showGhostBar(true);
  closePanel();
  scene?.appElement.focus();
}

export async function upgradeBuilding(buildingId: number): Promise<void> {
  notice('Starting upgrade…');
  try {
    await api<Building>('POST', `/api/village/buildings/${buildingId}/upgrade`, {});
    const village = await api<Village>('GET', '/api/village');
    applyVillage(village);
    const building = village.buildings.find((b) => b.id === buildingId);
    if (building?.upgrade) {
      const zone = state.me?.timeZone ?? 'UTC';
      notice(`${BUILDINGS[building.type as BuildingType].name} upgrading to level ${building.upgrade.toLevel}. Done at ${formatClock(Date.parse(building.upgrade.finishesAt), zone)}.`);
    }
    void openBuildingDetails(buildingId);
  } catch (err) {
    handleActionError(err, '');
  }
}

export async function cancelJob(buildingId: number): Promise<void> {
  notice('Cancelling…');
  try {
    const result = await api<{ refunded: { brine: number; peat: number; copper: number }; lost: { brine: number; peat: number; copper: number } }>('POST', `/api/village/buildings/${buildingId}/cancel`, {});
    notice(`Job cancelled. Refunded ${formatAmounts(result.refunded)}.`);
    const village = await api<Village>('GET', '/api/village');
    applyVillage(village);
    closePanel();
  } catch (err) {
    handleActionError(err, '');
  }
}

export async function collectBuilding(buildingId: number): Promise<void> {
  notice('Collecting…');
  try {
    const result = await api<{ collected: { brine: number; peat: number; copper: number }; lost: { brine: number; peat: number; copper: number } }>('POST', `/api/village/buildings/${buildingId}/collect`, {});
    const lostSomething = result.lost.brine + result.lost.peat + result.lost.copper > 0;
    if (result.collected.brine + result.collected.peat + result.collected.copper === 0 && !lostSomething) {
      notice('Nothing to collect yet.');
    } else if (lostSomething) {
      notice(`Collected ${formatAmounts(result.collected)}. Storage full — ${formatAmounts(result.lost)} lost.`);
    } else {
      notice(`Collected ${formatAmounts(result.collected)}.`);
    }
    const village = await api<Village>('GET', '/api/village');
    applyVillage(village);
    void openBuildingDetails(buildingId);
  } catch (err) {
    handleActionError(err, '');
  }
}

// --- Train army panel ---

function openTrainPanel(): void {
  const host = shell!.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Train army');
  host.replaceChildren(el('h2', { text: 'Train army' }));

  const radioSaltjack = el('input', { type: 'radio', name: 'unit', id: 'unit-saltjack', value: 'saltjack', checked: true });
  const radioSlinger = el('input', { type: 'radio', name: 'unit', id: 'unit-peat_slinger', value: 'peat_slinger' });
  const count = el('input', { type: 'number', id: 'train-count', min: '1', max: '20', value: '1' });
  count.setAttribute('aria-label', 'Count');

  const costRow = el('p', { text: '' });
  const updateCost = (): void => {
    const selected = document.querySelector<HTMLInputElement>('input[name="unit"]:checked')?.value ?? 'saltjack';
    const unit = UNITS[selected as 'saltjack' | 'peat_slinger'];
    const n = Math.max(1, Number(count.value) || 1);
    costRow.textContent = `${commaFormat(unit.cost.brine * n)} brine · ${unit.trainSeconds * n}s`;
  };
  radioSaltjack.addEventListener('change', updateCost);
  radioSlinger.addEventListener('change', updateCost);
  count.addEventListener('input', updateCost);

  const trainButton = el('button', { class: 'primary', text: 'Train', onclick: async () => {
    const selected = document.querySelector<HTMLInputElement>('input[name="unit"]:checked')?.value ?? 'saltjack';
    const unit = selected as 'saltjack' | 'peat_slinger';
    const n = Number(count.value) || 0;
    notice('Queuing training…');
    try {
      await api('POST', '/api/army/train', { unit, count: n });
      const village = await api<Village>('GET', '/api/village');
      applyVillage(village);
      const zone = state.me?.timeZone ?? 'UTC';
      const batch = village.army.training[village.army.training.length - 1];
      notice(`Training ${n} ${unit === 'saltjack' ? 'Saltjack' : 'Peat Slinger'}. Ready at ${formatClock(Date.parse(batch.finishesAt), zone)}.`);
    } catch (err) {
      handleActionError(err, '');
    }
  }});

  host.append(
    el('div', { role: 'radiogroup', 'aria-label': 'Units' },
      el('label', { for: 'unit-saltjack' }, radioSaltjack, el('span', { text: 'Saltjack' })),
      el('label', { for: 'unit-peat_slinger' }, radioSlinger, el('span', { text: 'Peat Slinger' }))
    ),
    el('div', { class: 'field' }, el('label', { for: 'train-count', text: 'Count' }), count),
    costRow,
    el('div', { class: 'actions' }, trainButton, el('button', { text: 'Close panel', onclick: () => closePanel() }))
  );
  updateCost();
  radioSaltjack.focus();
}

export { reducedMotion };
