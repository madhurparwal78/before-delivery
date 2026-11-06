// The Replay screen: the island as it was locked, scrubbed through the Wake dial with the
// shared battle simulation running in the browser, matching the server at every tick.
import { el, notice, alertMessage, reducedMotion } from '../ui.ts';
import { api, ApiRequestError, type Raid } from '../api.ts';
import { renderShell, setPanelOpener } from '../shell.ts';
import { IslandScene, type SceneBuilding } from '../island/scene.ts';
import { WakeDial } from '../dial.ts';
import { navigate } from '../main.ts';
import { simulate } from '../../sim/battle.ts';
import type { BuildingType, TickState } from '../../domain/types.ts';
import { closePanel } from './panels.ts';

export async function renderReplay(root: HTMLElement, raidId: string): Promise<void> {
  notice('Loading replay…');
  let raid: Raid;
  try {
    raid = await api<Raid>('GET', `/api/raids/${raidId}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.api.code === 'not_found') {
      alertMessage('We couldn’t find that. It may have moved, or it isn’t yours to see.');
      await navigate('/', true);
      return;
    }
    alertMessage('Lost contact with the server. Check your connection and try again.');
    return;
  }
  if (raid.state !== 'resolved') {
    alertMessage('This raid has no replay yet.');
    await navigate('/', true);
    return;
  }

  const shell = await renderShell(root);
  setPanelOpener((name) => void import('./panels.ts').then((p) => p.openPanel(name, shell)));
  const scene = new IslandScene('replay', { onEmptyTap: () => closePanel() });
  shell.islandHolder.replaceChildren(scene.appElement);

  // the shared simulation module: the same rules as the server's resolution
  const sim = simulate({
    seed: raid.seed,
    layout: raid.layout.map((b) => ({ ...b, type: b.type as BuildingType })),
    deploys: raid.deploys,
    lootable: raid.result!.lootable,
  });
  const finalTick = sim.finalTick;
  notice(`Replay ready: ${finalTick} ticks.`);

  const destruction = el('span', { text: '0%' });
  const stars = el('span', { text: '0 stars' });
  const lootBrine = el('span', { text: '0 brine' });
  const lootPeat = el('span', { text: '0 peat' });
  const lootCopper = el('span', { text: '0 copper' });

  const applyTick = (tick: number, settled: boolean): void => {
    const state: TickState = sim.ticks[Math.max(0, Math.min(finalTick, tick))];
    const buildings: SceneBuilding[] = state.buildings.map((b, index) => ({
      id: raid.layout[index].id,
      type: raid.layout[index].type as BuildingType,
      x: raid.layout[index].x,
      y: raid.layout[index].y,
      rotation: raid.layout[index].rotation,
      level: raid.layout[index].level,
      working: false,
      destroyed: b.destroyed,
    }));
    scene.setBuildings(buildings);
    scene.setUnits(state.units);
    scene.setDrawnTick(tick);
    scene.setReplayOverlay({
      tick,
      destruction: state.destruction,
      stars: state.stars,
      loot: state.loot,
      hash: state.hash,
      settled,
    });
    if (settled) {
      destruction.textContent = `${state.destruction}%`;
      stars.textContent = `${state.stars} stars`;
      lootBrine.textContent = `${state.loot.brine} brine`;
      lootPeat.textContent = `${state.loot.peat} peat`;
      lootCopper.textContent = `${state.loot.copper} copper`;
    }
  };

  let currentTick = 0;
  const requested = new URLSearchParams(location.search).get('tick');
  if (requested !== null) {
    const parsed = Number(requested);
    if (Number.isInteger(parsed) && parsed >= 0) currentTick = Math.min(finalTick, parsed);
  }
  applyTick(currentTick, true);

  const dial = new WakeDial(finalTick, {
    onDrawnTick: (tick) => {
      applyTick(tick, false);
      scene.setDrawnTick(tick);
    },
    onSettling: () => {
      dial.pause();
      applyTick(currentTick, false);
    },
    onSettle: (tick) => {
      currentTick = tick;
      applyTick(tick, true);
    },
  });
  dial.jumpTo(currentTick);

  const playButton = el('button', { class: 'replay-toggle', text: 'Play replay', onclick: () => {
    if (dial.isPlaying()) {
      dial.pause();
      playButton.textContent = 'Play replay';
    } else {
      dial.play();
      playButton.textContent = 'Pause replay';
    }
  }});

  const holder = el('div', { class: 'replay-holder' },
    dial.element,
    playButton,
    el('div', { class: 'tick-readout', role: 'group', 'aria-label': 'Tick readout' },
      destruction, stars, lootBrine, lootPeat, lootCopper
    )
  );
  root.append(holder);
  void reducedMotion;
}
