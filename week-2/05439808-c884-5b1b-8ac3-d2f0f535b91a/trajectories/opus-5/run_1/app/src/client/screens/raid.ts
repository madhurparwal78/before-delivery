import { ApiRequestError, newIdempotencyKey, request } from '../api.js';
import { errorCopy, noticeCopy, pendingCopy } from '../copy.js';
import { button, el } from '../dom.js';
import { amounts, signed } from '../format.js';
import { alertNotice, notice } from '../regions.js';
import { navigate } from '../router.js';
import { serverNow, state } from '../store.js';
import { LAST_DEPLOY_TICK, UNITS } from '../../shared/catalog.js';
import { UNIT_KEYS, type UnitKey } from '../../shared/types.js';
import { IslandView } from '../island/view.js';
import type { Raid } from '../apitypes.js';
import { run } from '../ui/action.js';
import type { Screen } from './types.js';
import type { Shell } from '../ui/shell.js';

const RAID_SECONDS = 180;

export function raidScreen(raidId: number, shell: Shell): Screen {
  let raid: Raid | null = null;
  let selected: UnitKey = 'saltjack';
  let panelHost: HTMLElement | null = null;
  const remaining: Record<UnitKey, number> = { saltjack: 0, peat_slinger: 0 };

  const island = new IslandView('raid', {
    onDeploy: (x, y) => deploy(x, y),
    onPickUnit: (index) => pickUnit(UNIT_KEYS[index] ?? 'saltjack'),
    onRendererFallback: () => notice(noticeCopy.flatPlan)
  });

  const unitGroup = el('div', { role: 'radiogroup', 'aria-label': 'Units', class: 'unit-picker' });
  const endButton = button('End raid', { class: 'primary stage-button end-raid' });
  const controls = el('div', { class: 'stage-controls raid-controls' }, [unitGroup, endButton]);
  const panel = el('aside', {
    role: 'complementary',
    'aria-label': 'Raid result',
    class: 'panel',
    hidden: true
  });

  const currentTick = (): number => {
    if (raid === null) return 0;
    const elapsed = serverNow() - new Date(raid.lockedAt).getTime();
    return Math.min(LAST_DEPLOY_TICK, Math.max(0, Math.floor(elapsed / 100)));
  };

  const renderUnits = (): void => {
    unitGroup.replaceChildren(
      ...UNIT_KEYS.map((unit) => {
        const label = `${UNITS[unit].name} (${remaining[unit]} left)`;
        const radio = el('button', {
          type: 'button',
          role: 'radio',
          'aria-label': label,
          'aria-checked': unit === selected ? 'true' : 'false',
          class: 'radio',
          text: label
        });
        radio.addEventListener('click', () => pickUnit(unit));
        return radio;
      })
    );
  };

  function pickUnit(unit: UnitKey): void {
    selected = unit;
    renderUnits();
  }

  const renderIsland = (): void => {
    if (raid === null) return;
    island.setBuildings(
      raid.layout.map((building) => ({
        id: building.id,
        type: building.type,
        x: building.x,
        y: building.y,
        rotation: building.rotation,
        level: building.level,
        destroyed: false,
        working: false
      }))
    );
    island.setUnits(raid.deploys.map((deploy) => ({ x: deploy.x, y: deploy.y, alive: true })));
  };

  const applyRaid = (next: Raid): void => {
    raid = next;
    for (const unit of UNIT_KEYS) {
      const deployed = next.deploys.filter((deploy) => deploy.unit === unit).length;
      remaining[unit] = Math.max(0, next.army[unit] - deployed);
    }
    renderUnits();
    renderIsland();
    if (next.state === 'resolved' && next.result !== null) showResult(next);
  };

  function showResult(resolved: Raid): void {
    const result = resolved.result;
    if (result === null) return;
    const open = el('a', {
      href: `/raids/${resolved.id}/replay`,
      'aria-label': 'Open replay',
      text: 'Open replay',
      class: 'auth-link'
    });
    open.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(`/raids/${resolved.id}/replay`);
    });
    panel.hidden = false;
    panel.replaceChildren(
      el('h2', { text: 'Raid result' }),
      el('p', { text: `${result.stars} stars` }),
      el('p', { text: `${result.destruction}% destroyed` }),
      el('p', { text: `Loot ${amounts(result.transferred)}` }),
      el('p', { text: `Trophies ${signed(result.trophies.attacker)}` }),
      open
    );
    shell.setRaidClock(null, null);
  }

  async function deploy(x: number, y: number): Promise<void> {
    if (raid === null || raid.state === 'resolved' || raid.state === 'abandoned') return;
    if (remaining[selected] <= 0) {
      alertNotice('You have no more of that unit in this raid.');
      return;
    }
    const body = { deploys: [{ tick: currentTick(), unit: selected, x, y }] };
    const key = newIdempotencyKey('dep');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const next = await request<Raid>('POST', `/api/raids/${raidId}/deploys`, {
          body,
          idempotencyKey: key
        });
        applyRaid(next);
        return;
      } catch (error) {
        if (!(error instanceof ApiRequestError)) throw error;
        if (error.failure.status >= 500 || error.failure.code === 'network') {
          notice(noticeCopy.deployRetry);
          continue;
        }
        alertNotice(errorCopy('deploy', error.failure));
        return;
      }
    }
  }

  endButton.addEventListener('click', () => {
    void run({
      action: 'endRaid',
      pending: pendingCopy.endRaid,
      control: endButton,
      work: () =>
        request<Raid>('POST', `/api/raids/${raidId}/finalize`, {
          body: {},
          idempotencyKey: newIdempotencyKey('fin')
        }),
      success: (result) =>
        noticeCopy.endRaidSuccess(result.result?.stars ?? 0, result.result?.destruction ?? 0)
    }).then((result) => {
      if (result === null) return;
      applyRaid(result);
    });
  });

  const load = async (): Promise<void> => {
    const result = await run({
      action: 'startRaid',
      pending: pendingCopy.startRaid,
      work: () => request<Raid>('GET', `/api/raids/${raidId}`),
      success: () => null
    });
    if (result === null) return;
    applyRaid(result);
    island.setCursor(20, 1, false);
  };

  return {
    mount(stage, host) {
      panelHost = host;
      stage.append(controls);
      island.mountedInto(stage);
      panelHost.replaceChildren(panel);
      renderUnits();
      void load();
    },
    update() {
      if (raid === null) return;
      if (raid.state === 'resolved' || raid.state === 'abandoned') {
        shell.setRaidClock(null, null);
        return;
      }
      const elapsed = serverNow() - new Date(raid.lockedAt).getTime();
      shell.setRaidClock(
        Math.max(0, RAID_SECONDS * 1000 - elapsed),
        Math.max(0, new Date(raid.finalizeBy).getTime() - serverNow())
      );
    },
    dispose() {
      shell.setRaidClock(null, null);
      state.panel = null;
      island.dispose();
      controls.remove();
    }
  };
}
