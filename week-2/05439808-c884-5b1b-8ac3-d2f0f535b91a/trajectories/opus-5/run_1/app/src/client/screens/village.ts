import { request } from '../api.js';
import { noticeCopy, pendingCopy } from '../copy.js';
import { button, el } from '../dom.js';
import { amounts, localTime } from '../format.js';
import { notice } from '../regions.js';
import { refreshVillage, state, type PanelName } from '../store.js';
import { BUILDINGS, footprintAt, levelCost } from '../../shared/catalog.js';
import { BUILDING_TYPES, type BuildingType, type Rotation } from '../../shared/types.js';
import { IslandView } from '../island/view.js';
import type { Building } from '../apitypes.js';
import { run } from '../ui/action.js';
import { buildingPanel } from '../ui/panels/building.js';
import { clanPanel } from '../ui/panels/clan.js';
import { leaguePanel } from '../ui/panels/league.js';
import { profilePanel } from '../ui/panels/profile.js';
import { raidLogPanel } from '../ui/panels/raidlog.js';
import { rewardsPanel } from '../ui/panels/rewards.js';
import { trainPanel } from '../ui/panels/train.js';
import type { Screen } from './types.js';

type OpenPanel = { name: PanelName; node: HTMLElement; update: () => void } | null;

export function villageScreen(initialPanel: PanelName | null): Screen {
  let panel: OpenPanel = null;
  let panelHost: HTMLElement | null = null;
  let ghostBar: HTMLElement | null = null;

  const island = new IslandView('village', {
    onSelectBuilding: (id) => openBuildingPanel(id),
    onSelectEmpty: () => closePanel(),
    onCursorMove: (x, y) => announceCursor(x, y),
    onConfirmGhost: () => confirmGhost(),
    onCancelGhost: () => cancelGhost(),
    onInvalidGhost: () => notice(noticeCopy.invalidGhost),
    onOpenBuild: () => openBuildDialog(),
    onRendererFallback: () => notice(noticeCopy.flatPlan)
  });

  const announceCursor = (x: number, y: number): void => {
    const building = island.buildingAt(x, y);
    notice(
      building === null
        ? noticeCopy.cursorEmpty(x, y)
        : noticeCopy.cursorBuilding(x, y, BUILDINGS[building.type].name, building.level)
    );
  };

  const buildButton = button('Build', { class: 'primary stage-button' });
  const trainButton = button('Train', { class: 'primary stage-button' });
  const controls = el('div', { class: 'stage-controls' }, [buildButton, trainButton]);

  const setPanel = (next: OpenPanel): void => {
    if (panelHost === null) return;
    panel = next;
    state.panel = next?.name ?? null;
    panelHost.replaceChildren(...(next === null ? [] : [next.node]));
    island.markAnimating(250);
  };

  const closePanel = (): void => {
    setPanel(null);
    island.root.focus();
  };

  const recentre = (x: number, y: number): void => {
    const narrow = window.innerWidth < 700;
    island.recentreOn(narrow ? x : x - 5, narrow ? y - 5 : y);
  };

  function openBuildingPanel(id: number): void {
    const created = buildingPanel(id, {
      onClose: closePanel,
      onMove: (building) => startMoveGhost(building),
      onChanged: () => {
        void refreshVillage().then(() => {
          renderIsland();
          panel?.update();
        });
      }
    });
    setPanel({ name: 'building', node: created.node, update: created.update });
    const building = state.village?.buildings.find((entry) => entry.id === id);
    if (building) recentre(building.x, building.y);
  }

  const openPanelByName = (name: PanelName): void => {
    if (name === 'train') {
      const created = trainPanel({
        onChanged: () => {
          void refreshVillage().then(() => renderIsland());
        }
      });
      setPanel({ name, node: created.node, update: created.update });
      return;
    }
    if (name === 'raidLog') {
      const created = raidLogPanel();
      notice(pendingCopy.raidLog);
      setPanel({ name, node: created.node, update: created.update });
      return;
    }
    if (name === 'rewards') {
      const created = rewardsPanel({ onChanged: () => renderIsland() });
      setPanel({ name, node: created.node, update: created.update });
      return;
    }
    if (name === 'clan') {
      const created = clanPanel({ onChanged: () => renderIsland() });
      setPanel({ name, node: created.node, update: created.update });
      return;
    }
    if (name === 'league') {
      const created = leaguePanel();
      setPanel({ name, node: created.node, update: created.update });
      return;
    }
    if (name === 'profile') {
      const created = profilePanel({ onChanged: () => renderIsland() });
      setPanel({ name, node: created.node, update: created.update });
    }
  };

  const showGhostBar = (): void => {
    if (ghostBar !== null) return;
    const rotate = button('Rotate');
    rotate.addEventListener('click', () => {
      island.rotateGhost();
      island.root.focus();
    });
    const confirm = button('Confirm placement', { class: 'primary' });
    confirm.addEventListener('click', () => confirmGhost());
    const cancel = button('Cancel placement');
    cancel.addEventListener('click', () => cancelGhost());
    ghostBar = el('div', { class: 'ghost-bar' }, [rotate, confirm, cancel]);
    controls.append(ghostBar);
  };

  const hideGhostBar = (): void => {
    ghostBar?.remove();
    ghostBar = null;
  };

  const startPlaceGhost = (type: BuildingType): void => {
    const cursor = island.cursor;
    island.startGhost({ type, x: cursor.x, y: cursor.y, rotation: 0 as Rotation, buildingId: null });
    showGhostBar();
    island.root.focus();
  };

  const startMoveGhost = (building: Building): void => {
    island.startGhost({
      type: building.type,
      x: building.x,
      y: building.y,
      rotation: building.rotation,
      buildingId: building.id
    });
    showGhostBar();
    island.root.focus();
  };

  const cancelGhost = (): void => {
    island.cancelGhost();
    hideGhostBar();
    island.root.focus();
  };

  function confirmGhost(): void {
    const ghost = island.ghostState;
    if (ghost === null) return;
    if (!island.ghostIsValid()) {
      notice(noticeCopy.invalidGhost);
      return;
    }
    const spec = BUILDINGS[ghost.type];
    const body = { x: ghost.x, y: ghost.y, rotation: ghost.rotation };
    if (ghost.buildingId === null) {
      void run({
        action: 'place',
        pending: pendingCopy.place(spec.name),
        work: () =>
          request<Building>('POST', '/api/village/buildings', {
            body: { type: ghost.type, ...body }
          }),
        success: (result) =>
          noticeCopy.placeSuccess(
            spec.name,
            localTime(result.upgrade?.finishesAt ?? new Date().toISOString())
          )
      }).then(async (result) => {
        if (result === null) return;
        cancelGhost();
        island.markAnimating(600);
        await refreshVillage();
        renderIsland();
      });
      return;
    }
    void run({
      action: 'move',
      pending: pendingCopy.move(spec.name),
      work: () =>
        request<Building>('PATCH', `/api/village/buildings/${ghost.buildingId}`, { body }),
      success: () => noticeCopy.moveSuccess(spec.name)
    }).then(async (result) => {
      if (result === null) return;
      cancelGhost();
      await refreshVillage();
      renderIsland();
    });
  }

  function openBuildDialog(): void {
    const close = button('Close');
    const placeButtons = BUILDING_TYPES.map((type) => {
      const spec = BUILDINGS[type];
      const footprint = footprintAt(type, 0);
      const place = button(`Place ${spec.name}`);
      place.append(
        el('span', {
          class: 'cost',
          text: ` · ${amounts(levelCost(type, 1))} · ${footprint.width}×${footprint.depth}`
        })
      );
      place.addEventListener('click', () => {
        dialog.remove();
        startPlaceGhost(type);
      });
      return place;
    });
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-label': 'Build', 'aria-modal': 'true', class: 'dialog build-dialog' },
      [el('h2', { text: 'Build' }), ...placeButtons, close]
    );
    const dismiss = (): void => {
      dialog.remove();
      buildButton.focus();
    };
    close.addEventListener('click', dismiss);
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...placeButtons, close];
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      const next = event.shiftKey ? index - 1 : index + 1;
      focusable[(next + focusable.length) % focusable.length]?.focus();
    });
    controls.append(dialog);
    placeButtons[0]?.focus();
  }

  buildButton.addEventListener('click', () => openBuildDialog());
  trainButton.addEventListener('click', () => openPanelByName('train'));

  const renderIsland = (): void => {
    const village = state.village;
    if (village === null) return;
    island.setBuildings(
      village.buildings.map((building) => ({
        id: building.id,
        type: building.type,
        x: building.x,
        y: building.y,
        rotation: building.rotation,
        level: building.level,
        destroyed: false,
        working: building.upgrade !== null
      }))
    );
  };

  return {
    mount(stage, host) {
      panelHost = host;
      stage.append(controls);
      island.mountedInto(stage);
      renderIsland();
      if (initialPanel !== null) openPanelByName(initialPanel);
      island.root.focus();
    },
    update() {
      renderIsland();
      panel?.update();
    },
    dispose() {
      state.panel = null;
      island.dispose();
      controls.remove();
    }
  };
}
