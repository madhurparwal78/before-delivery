import { newIdempotencyKey, request } from '../api.js';
import { noticeCopy, pendingCopy } from '../copy.js';
import { button, el } from '../dom.js';
import { number } from '../format.js';
import { notice } from '../regions.js';
import { navigate } from '../router.js';
import { state } from '../store.js';
import { IslandView } from '../island/view.js';
import type { Raid, Scout } from '../apitypes.js';
import { run } from '../ui/action.js';
import type { Screen } from './types.js';

export function scoutScreen(villageId: number | null): Screen {
  let match: Scout | null = null;
  let panelHost: HTMLElement | null = null;

  const island = new IslandView('scout', {
    onRendererFallback: () => notice(noticeCopy.flatPlan)
  });

  const panel = el('aside', {
    role: 'complementary',
    'aria-label': 'Scout report',
    class: 'panel'
  });

  const renderIsland = (): void => {
    if (match === null) return;
    island.setBuildings(
      match.buildings.map((building) => ({
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
  };

  const startRaid = (): void => {
    if (match === null) return;
    const key = newIdempotencyKey('raid');
    void run({
      action: 'startRaid',
      pending: pendingCopy.startRaid,
      control: startButton,
      work: () =>
        request<Raid>('POST', '/api/raids', {
          body: { villageId: match?.villageId ?? 0 },
          idempotencyKey: key
        }),
      success: () => noticeCopy.startRaidSuccess
    }).then((raid) => {
      if (raid === null) return;
      navigate(`/raids/${raid.id}`);
    });
  };

  const startButton = button('Start raid', { class: 'primary' });
  startButton.addEventListener('click', startRaid);
  const nextButton = button('Next island');
  nextButton.addEventListener('click', () => void loadNext());

  const renderPanel = (): void => {
    if (match === null) {
      panel.replaceChildren(
        el('h2', { text: 'Scout report' }),
        el('p', { text: noticeCopy.noMatch }),
        nextButton
      );
      return;
    }
    const lootable = el('ul', { role: 'list', 'aria-label': 'Lootable' }, [
      el('li', { text: `${number(match.lootable.brine)} brine` }),
      el('li', { text: `${number(match.lootable.peat)} peat` }),
      el('li', { text: `${number(match.lootable.copper)} copper` })
    ]);
    panel.replaceChildren(
      el('h2', { text: match.displayName }),
      el('p', { text: `Trophies ${number(match.trophies)}` }),
      el('p', { text: `League ${match.league}` }),
      lootable,
      startButton,
      nextButton
    );
  };

  const loadNext = async (): Promise<void> => {
    const result = await run({
      action: 'nextIsland',
      pending: pendingCopy.nextIsland,
      control: nextButton,
      work: () => request<{ match: Scout | null }>('GET', '/api/scout/next'),
      success: (body) => (body.match === null ? noticeCopy.noMatch : null)
    });
    match = result?.match ?? null;
    renderPanel();
    renderIsland();
  };

  const loadSpecific = async (id: number): Promise<void> => {
    const result = await run({
      action: 'nextIsland',
      pending: pendingCopy.nextIsland,
      work: () => request<Scout>('GET', `/api/villages/${id}/scout`),
      success: () => null
    });
    match = result;
    renderPanel();
    renderIsland();
  };

  return {
    mount(stage, host) {
      panelHost = host;
      island.mountedInto(stage);
      state.panel = 'scout';
      panelHost.replaceChildren(panel);
      renderPanel();
      if (villageId === null) void loadNext();
      else void loadSpecific(villageId);
    },
    update() {
      /* the scout report is a snapshot of the matched island */
    },
    dispose() {
      state.panel = null;
      island.dispose();
    }
  };
}
