import { request } from '../../api.js';
import { noticeCopy, pendingCopy } from '../../copy.js';
import { button, el } from '../../dom.js';
import { amounts, localTime, number } from '../../format.js';
import { state } from '../../store.js';
import { BUILDINGS, levelCost } from '../../../shared/catalog.js';
import type { Building } from '../../apitypes.js';
import { run } from '../action.js';

export type BuildingPanelHandlers = {
  onClose: () => void;
  onMove: (building: Building) => void;
  onChanged: () => void;
};

export function buildingPanel(
  buildingId: number,
  handlers: BuildingPanelHandlers
): { node: HTMLElement; update: () => void } {
  const node = el('aside', {
    role: 'complementary',
    'aria-label': 'Building details',
    class: 'panel'
  });
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    handlers.onClose();
  });

  const update = (): void => {
    const building = state.village?.buildings.find((entry) => entry.id === buildingId);
    if (!building) {
      node.replaceChildren(el('p', { text: 'That building is gone.' }));
      return;
    }
    const spec = BUILDINGS[building.type];
    const children: (Node | string)[] = [
      el('h2', { text: `${spec.name} · level ${building.level}` })
    ];

    if (building.upgrade === null && building.level < 3) {
      const toLevel = building.level + 1;
      const cost = levelCost(building.type, toLevel);
      const seconds =
        state.catalog?.buildings.find((entry) => entry.type === building.type)?.levels[
          toLevel - 1
        ]?.buildSeconds ?? 0;
      const upgrade = button(`Upgrade to level ${toLevel}`, { class: 'primary' });
      upgrade.addEventListener('click', () => {
        void run({
          action: 'upgrade',
          pending: pendingCopy.upgrade,
          control: upgrade,
          work: () =>
            request<Building>('POST', `/api/village/buildings/${building.id}/upgrade`, {
              body: {}
            }),
          success: (result) =>
            noticeCopy.upgradeSuccess(
              spec.name,
              result.upgrade?.toLevel ?? toLevel,
              localTime(result.upgrade?.finishesAt ?? new Date().toISOString())
            )
        }).then(handlers.onChanged);
      });
      children.push(
        el('p', { class: 'cost', text: `Upgrade cost ${amounts(cost)} · ${number(seconds)} s` }),
        upgrade
      );
    }

    if (building.upgrade !== null) {
      const cancel = button('Cancel job');
      cancel.addEventListener('click', () => {
        void run({
          action: 'cancelJob',
          pending: pendingCopy.cancelJob,
          control: cancel,
          work: () =>
            request<{ refunded: Record<string, number> }>(
              'POST',
              `/api/village/buildings/${building.id}/cancel`,
              { body: {} }
            ),
          success: (result) => noticeCopy.cancelJobSuccess(spec.name, amounts(result.refunded))
        }).then(handlers.onChanged);
      });
      children.push(
        el('p', { text: `Done at ${localTime(building.upgrade.finishesAt)}` }),
        cancel
      );
    }

    const move = button('Move');
    move.addEventListener('click', () => handlers.onMove(building));
    children.push(move);

    if (spec.producer) {
      children.push(el('p', { text: `Uncollected ${number(building.uncollected ?? 0)}` }));
      const collect = button('Collect', { class: 'primary' });
      collect.addEventListener('click', () => {
        void run({
          action: 'collect',
          pending: pendingCopy.collect,
          control: collect,
          work: () =>
            request<{
              collected: Record<string, number>;
              lost: Record<string, number>;
            }>('POST', `/api/village/buildings/${building.id}/collect`, { body: {} }),
          success: (result) => {
            const collected = amounts(result.collected);
            const lost = amounts(result.lost);
            if (collected === 'nothing' && lost === 'nothing') return noticeCopy.collectNothing;
            if (lost !== 'nothing') return noticeCopy.collectWithLoss(collected, lost);
            return noticeCopy.collectSuccess(collected);
          }
        }).then(handlers.onChanged);
      });
      children.push(collect);
    }

    const close = button('Close panel');
    close.addEventListener('click', handlers.onClose);
    children.push(close);
    node.replaceChildren(...children);
  };

  update();
  return { node, update };
}
