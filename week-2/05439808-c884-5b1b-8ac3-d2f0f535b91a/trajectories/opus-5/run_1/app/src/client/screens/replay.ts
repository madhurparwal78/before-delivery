import { request } from '../api.js';
import { noticeCopy, pendingCopy } from '../copy.js';
import { el, setText } from '../dom.js';
import { number } from '../format.js';
import { alertNotice, notice } from '../regions.js';
import { simulate, type SimResult } from '../../shared/sim.js';
import { IslandView } from '../island/view.js';
import { WakeDial } from '../dial.js';
import type { Raid } from '../apitypes.js';
import { run } from '../ui/action.js';
import type { Screen } from './types.js';

export function replayScreen(raidId: number, startTick: number): Screen {
  let raid: Raid | null = null;
  let simulated: SimResult | null = null;
  let dial: WakeDial | null = null;
  let stage: HTMLElement | null = null;

  const island = new IslandView('replay', {
    onRendererFallback: () => notice(noticeCopy.flatPlan)
  });

  const destruction = el('span', { class: 'readout' });
  const stars = el('span', { class: 'readout' });
  const brine = el('span', { class: 'readout' });
  const peat = el('span', { class: 'readout' });
  const copper = el('span', { class: 'readout' });
  const readout = el(
    'div',
    { role: 'group', 'aria-label': 'Tick readout', class: 'tick-readout' },
    [destruction, stars, brine, peat, copper]
  );

  const drawTick = (tick: number): void => {
    if (raid === null || simulated === null) return;
    const snapshot = simulated.ticks[Math.min(tick, simulated.ticks.length - 1)];
    if (!snapshot) return;
    island.setBuildings(
      raid.layout.map((building, index) => ({
        id: building.id,
        type: building.type,
        x: building.x,
        y: building.y,
        rotation: building.rotation,
        level: building.level,
        destroyed: (snapshot.buildingHp[index] ?? 0) === 0,
        working: false
      }))
    );
    island.setUnits(
      snapshot.units.map((unit) => ({
        x: unit.x / 1000,
        y: unit.y / 1000,
        alive: unit.alive
      }))
    );
    island.setDrawnTick(snapshot.tick);
  };

  const settleTick = (tick: number): void => {
    if (simulated === null) return;
    const snapshot = simulated.ticks[Math.min(tick, simulated.ticks.length - 1)];
    if (!snapshot) return;
    drawTick(tick);
    island.setReplayAttributes({
      tick: snapshot.tick,
      destruction: snapshot.destruction,
      stars: snapshot.stars,
      loot: snapshot.loot,
      hash: snapshot.hash,
      settled: true
    });
    setText(destruction, `${snapshot.destruction}%`);
    setText(stars, `${snapshot.stars} stars`);
    setText(brine, `${number(snapshot.loot.brine)} brine`);
    setText(peat, `${number(snapshot.loot.peat)} peat`);
    setText(copper, `${number(snapshot.loot.copper)} copper`);
  };

  const load = async (): Promise<void> => {
    const result = await run({
      action: 'replay',
      pending: pendingCopy.replay,
      work: () => request<Raid>('GET', `/api/raids/${raidId}`),
      success: () => null
    });
    if (result === null) return;
    if (result.state !== 'resolved' || result.result === null) {
      alertNotice('This raid has no replay yet.');
      return;
    }
    raid = result;
    simulated = simulate({
      seed: result.seed,
      layout: result.layout,
      deploys: result.deploys,
      lootable: result.result.lootable
    });
    notice(noticeCopy.replayReady(simulated.finalTick));
    dial = new WakeDial(simulated.finalTick, {
      onDraw: (tick) => {
        island.setSettled(false);
        drawTick(tick);
      },
      onSettle: (tick) => settleTick(tick)
    });
    stage?.append(dial.root);
    const clamped = Math.min(simulated.finalTick, Math.max(0, startTick));
    dial.setTick(clamped);
  };

  return {
    mount(host, panelHost) {
      stage = host;
      island.mountedInto(host);
      host.append(readout);
      panelHost.replaceChildren();
      void load();
    },
    update() {
      /* a resolved replay never changes */
    },
    dispose() {
      dial?.destroy();
      island.dispose();
      readout.remove();
    }
  };
}
