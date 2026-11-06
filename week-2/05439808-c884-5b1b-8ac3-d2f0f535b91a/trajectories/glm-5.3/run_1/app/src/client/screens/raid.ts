// The Scout and Raid screens: the matched island read-only, the raid with its clock, the unit
// picker and the deploy ring, and the Raid result panel after resolution.
import { el, notice, alertMessage, countdownText, formatAmounts, idempotencyKey } from '../ui.ts';
import { api, ApiRequestError, type Raid, type Scout, type Village } from '../api.ts';
import { renderShell, setPanelOpener, type Shell } from '../shell.ts';
import { IslandScene, type SceneBuilding } from '../island/scene.ts';
import { navigate, onScreenCleanup } from '../main.ts';
import { setPollJob, state, serverNow } from '../state.ts';
import { closePanel } from './panels.ts';
import type { BuildingType } from '../../domain/types.ts';

const CONFLICT_COPY: Record<string, string> = {
  cannot_raid_self: 'That’s your own island.',
  village_shielded: 'That island is shielded.',
  already_under_attack: 'Another raider got there first.',
  target_cooldown: 'You raided this island recently.',
  raid_in_progress: 'Finish your current raid first.',
  no_army: 'Train some units first.',
  units_unavailable: 'You have no more of that unit in this raid.',
  raid_abandoned: 'The finalize window closed. The raid was abandoned and nothing moved.',
  nothing_deployed: 'Deploy at least one unit first.',
  raid_not_active: 'This raid is already over.',
};

function sceneBuildingsOf(scout: Scout): SceneBuilding[] {
  return scout.buildings.map((b) => ({
    id: b.id,
    type: b.type as BuildingType,
    x: b.x,
    y: b.y,
    rotation: b.rotation,
    level: b.level,
    working: false,
  }));
}

function raidLayoutBuildings(raid: Raid): SceneBuilding[] {
  return raid.layout.map((b) => ({
    id: b.id,
    type: b.type as BuildingType,
    x: b.x,
    y: b.y,
    rotation: b.rotation,
    level: b.level,
    working: false,
  }));
}

export async function renderScout(root: HTMLElement, villageId: string | null): Promise<void> {
  const shell = await renderShell(root);
  setPanelOpener((name) => void import('./panels.ts').then((p) => p.openPanel(name, shell)));
  const scene = new IslandScene('scout', { onEmptyTap: () => closePanel() });
  shell.islandHolder.replaceChildren(scene.appElement);
  const host = shell.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Scout report');
  host.replaceChildren(el('h2', { text: 'Scout report' }), el('p', { text: 'Searching the tide for an island…' }));

  const load = async (): Promise<void> => {
    notice('Searching the tide for an island…');
    let scout: Scout | null = null;
    try {
      if (villageId !== null) {
        scout = await api<Scout>('GET', `/api/villages/${villageId}/scout`);
      } else {
        const match = await api<{ match: Scout | null }>('GET', '/api/scout/next');
        scout = match.match;
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        alertMessage(CONFLICT_COPY[err.api.code] ?? err.api.message);
      } else {
        alertMessage('Lost contact with the server. Check your connection and try again.');
      }
      return;
    }
    if (scout === null) {
      alertMessage('No island is in reach right now. Try again in a minute.');
      host.replaceChildren(el('h2', { text: 'Scout report' }), el('p', { text: 'No island is in reach right now. Try again in a minute.' }));
      return;
    }
    scene.setBuildings(sceneBuildingsOf(scout));
    host.replaceChildren(
      el('h2', { text: scout.displayName }),
      el('p', { text: `Trophies ${scout.trophies}` }),
      el('p', { text: `League ${scout.league}` }),
      el('ul', { 'aria-label': 'Lootable' },
        el('li', { text: `${formatAmounts({ brine: scout.lootable.brine, peat: 0, copper: 0 }) === 'nothing' ? '' : `${scout.lootable.brine} brine`}` }),
        el('li', { text: `${scout.lootable.peat} peat` }),
        el('li', { text: `${scout.lootable.copper} copper` })
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', text: 'Start raid', onclick: async () => {
          notice('Locking the island…');
          try {
            const raid = await api<Raid>('POST', '/api/raids', { villageId: scout!.villageId }, { idempotencyKey: idempotencyKey() });
            notice('Island locked. Deploy before the finalize countdown runs out.');
            await navigate(`/raids/${raid.id}`, true);
          } catch (err) {
            if (err instanceof ApiRequestError) alertMessage(CONFLICT_COPY[err.api.code] ?? err.api.message);
            else alertMessage('Lost contact with the server. Check your connection and try again.');
          }
        }}),
        el('button', { text: 'Next island', onclick: () => void load() })
      )
    );
  };
  await load();
}

export async function renderRaid(root: HTMLElement, raidId: string): Promise<void> {
  const shell = await renderShell(root);
  setPanelOpener((name) => void import('./panels.ts').then((p) => p.openPanel(name, shell)));

  let raid: Raid;
  try {
    raid = await api<Raid>('GET', `/api/raids/${raidId}`);
  } catch {
    await navigate('/', true);
    return;
  }

  const scene = new IslandScene('raid', {
    onEmptyTap: () => closePanel(),
    onDeployCell: (x, y) => void deployAt(x, y),
    onSelectUnit: (index) => void selectUnit(index),
  });
  shell.islandHolder.replaceChildren(scene.appElement);
  scene.setBuildings(raidLayoutBuildings(raid));

  const isAttacker = raid.attacker.villageId === state.me?.villageId;
  if (!isAttacker) {
    await showDefenderView(shell, raid);
    return;
  }

  const clock = el('span', { class: 'raid-clock', role: 'timer', 'aria-label': 'Raid clock', text: '3:00' });
  const finalizeText = el('span', { class: 'raid-clock', text: 'Finalize by 5:00' });
  const holder = document.querySelector('.toprule .spacer');
  holder?.before(clock, finalizeText);

  let selectedUnit: 'saltjack' | 'peat_slinger' = 'saltjack';
  const radios: Record<string, HTMLInputElement> = {};
  const radioSaltjack = el('input', { type: 'radio', name: 'raid-unit', id: 'raid-saltjack', value: 'saltjack', checked: true });
  const radioSlinger = el('input', { type: 'radio', name: 'raid-unit', id: 'raid-slinger', value: 'peat_slinger' });
  radios.saltjack = radioSaltjack;
  radios.peat_slinger = radioSlinger;
  radioSaltjack.addEventListener('change', () => (selectedUnit = 'saltjack'));
  radioSlinger.addEventListener('change', () => (selectedUnit = 'peat_slinger'));

  const picker = el('div', { class: 'unit-picker bottom-left', role: 'radiogroup', 'aria-label': 'Units' },
    el('label', { for: 'raid-saltjack' }, radioSaltjack, el('span', { text: 'Saltjack (0 left)' })),
    el('label', { for: 'raid-slinger' }, radioSlinger, el('span', { text: 'Peat Slinger (0 left)' }))
  );
  const hint = el('p', { class: 'deploy-hint', text: 'Tap cells on the tidal ring to deploy. Space or Enter deploys the selected unit at the cursor.' });
  const endButton = el('button', { class: 'primary bottom-right', text: 'End raid', onclick: () => void endRaid() });
  root.append(picker, hint, endButton);

  const deployedCounts = (): { saltjack: number; peat_slinger: number } => {
    const counts = { saltjack: 0, peat_slinger: 0 };
    for (const deploy of raid.deploys) counts[deploy.unit] += 1;
    return counts;
  };

  const currentTick = (): number => Math.min(1799, Math.floor((serverNow() - Date.parse(raid.lockedAt)) / 100));

  const updatePicker = (): void => {
    const deployed = deployedCounts();
    (picker.querySelector('#raid-saltjack + span, label[for="raid-saltjack"] span') as HTMLElement | null)?.textContent !== undefined;
    const labels = picker.querySelectorAll('label span');
    if (labels.length >= 2) {
      labels[0].textContent = `Saltjack (${raid.army.saltjack - deployed.saltjack} left)`;
      labels[1].textContent = `Peat Slinger (${raid.army.peat_slinger - deployed.peat_slinger} left)`;
    }
  };
  updatePicker();

  function selectUnit(index: number): void {
    const value = index === 0 ? 'saltjack' : 'peat_slinger';
    (radios[value] as HTMLInputElement).checked = true;
    selectedUnit = value;
  }

  async function deployAt(x: number, y: number): Promise<void> {
    if (!(x <= 1 || x >= 38 || y <= 1 || y >= 38)) return;
    const tick = currentTick();
    try {
      raid = await api<Raid>('POST', `/api/raids/${raidId}/deploys`, {
        deploys: [{ tick, unit: selectedUnit, x, y }],
      }, { idempotencyKey: idempotencyKey() });
      updatePicker();
      scene.setUnits(raid.deploys.map((deploy, index) => ({
        index,
        unit: deploy.unit,
        x: deploy.x * 1000 + 500,
        y: deploy.y * 1000 + 500,
        hp: 100,
        alive: true,
      })));
    } catch (err) {
      if (err instanceof ApiRequestError) alertMessage(CONFLICT_COPY[err.api.code] ?? err.api.message);
      else alertMessage('Deploys didn’t reach the tide. Retrying…');
    }
  }

  async function endRaid(): Promise<void> {
    notice('Resolving the raid on the server…');
    try {
      raid = await api<Raid>('POST', `/api/raids/${raidId}/finalize`, {}, { idempotencyKey: idempotencyKey() });
      notice(`Raid resolved: ${raid.result!.stars} stars, ${raid.result!.destruction}% destroyed.`);
      clock.remove();
      finalizeText.remove();
      picker.remove();
      hint.remove();
      endButton.remove();
      showResultPanel(shell, raid);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        alertMessage(CONFLICT_COPY[err.api.code] ?? err.api.message);
        if (err.api.code === 'raid_abandoned' || err.api.code === 'raid_not_active') {
          clock.remove();
          finalizeText.remove();
          picker.remove();
          hint.remove();
          endButton.remove();
        }
      } else {
        alertMessage('Lost contact with the server. Check your connection and try again.');
      }
    }
  }

  if (raid.state === 'resolved') {
    clock.remove();
    finalizeText.remove();
    picker.remove();
    hint.remove();
    endButton.remove();
    showResultPanel(shell, raid);
    return;
  }
  if (raid.state === 'abandoned') {
    alertMessage(CONFLICT_COPY.raid_abandoned);
    clock.remove();
    finalizeText.remove();
    picker.remove();
    hint.remove();
    endButton.remove();
    return;
  }

  const clockTimer = window.setInterval(() => {
    const remainingMs = (1800 - currentTick()) * 100;
    clock.textContent = countdownText(Math.max(0, remainingMs));
    finalizeText.textContent = `Finalize by ${countdownText(Date.parse(raid.finalizeBy) - serverNow())}`;
  }, 200);
  onScreenCleanup(() => window.clearInterval(clockTimer));

  setPollJob('raid', async () => {
    try {
      const updated = await api<Raid>('GET', `/api/raids/${raidId}`);
      if (updated.state !== raid.state) {
        raid = updated;
        if (raid.state === 'resolved') {
          window.clearInterval(clockTimer);
          notice(`Raid resolved: ${raid.result!.stars} stars, ${raid.result!.destruction}% destroyed.`);
          clock.remove();
          finalizeText.remove();
          picker.remove();
          hint.remove();
          endButton.remove();
          showResultPanel(shell, raid);
        } else if (raid.state === 'abandoned') {
          window.clearInterval(clockTimer);
          alertMessage('The finalize window closed. The raid was abandoned and nothing moved.');
          clock.remove();
          finalizeText.remove();
          picker.remove();
          hint.remove();
          endButton.remove();
        }
      }
    } catch {
      // retried on the next tick
    }
  });
  void scene;
  void api<Village>;
}

function signedChange(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function showResultPanel(shell: Shell, raid: Raid): void {
  const host = shell.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Raid result');
  const result = raid.result;
  host.replaceChildren(
    el('h2', { text: 'Raid result' }),
    el('p', { text: `${result!.stars} stars` }),
    el('p', { text: `${result!.destruction}% destroyed` }),
    el('p', { text: `Loot ${formatAmounts(result!.transferred)}` }),
    el('p', { text: `Trophies ${signedChange(result!.trophies.attacker)}` }),
    el('div', { class: 'actions' },
      el('a', { href: `/raids/${raid.id}/replay`, text: 'Open replay', onclick: (event: MouseEvent) => { event.preventDefault(); void navigate(`/raids/${raid.id}/replay`); } })
    )
  );
}

async function showDefenderView(shell: Shell, raid: Raid): Promise<void> {
  const host = shell.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Raid result');
  if (raid.state === 'resolved') {
    showResultPanel(shell, raid);
    return;
  }
  host.replaceChildren(el('h2', { text: 'Raid' }), el('p', { text: raid.state === 'abandoned' ? 'The raid was abandoned.' : 'The raid is under way.' }));
}
