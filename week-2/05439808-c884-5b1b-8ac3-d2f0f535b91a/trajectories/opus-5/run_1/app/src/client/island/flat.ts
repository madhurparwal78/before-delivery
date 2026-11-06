import { BUILDINGS, footprintAt } from '../../shared/catalog.js';
import { el } from '../dom.js';
import {
  GROUND_CELLS,
  type CameraState,
  type IslandRenderer,
  type SceneBuilding,
  type SceneGhost,
  type SceneUnit
} from './types.js';

const CELL_PX = 18;

export function createFlatRenderer(container: HTMLElement): IslandRenderer {
  const plan = el('div', { class: 'flat-plan' });
  const board = el('div', { class: 'flat-board' });
  const cursor = el('div', { class: 'flat-cursor' });
  const ghost = el('div', { class: 'flat-ghost', hidden: true });
  const buildingLayer = el('div', { class: 'flat-layer' });
  const unitLayer = el('div', { class: 'flat-layer' });
  board.append(buildingLayer, unitLayer, cursor, ghost);
  plan.append(board);
  container.append(plan);
  board.style.width = `${GROUND_CELLS * CELL_PX}px`;
  board.style.height = `${GROUND_CELLS * CELL_PX}px`;

  let camera: CameraState = { azimuth: 0, zoom: 1, panX: 20, panY: 20 };
  let width = container.clientWidth || 1;
  let height = container.clientHeight || 1;

  const applyCamera = (): void => {
    const scale = camera.zoom;
    const offsetX = width / 2 - camera.panX * CELL_PX * scale;
    const offsetY = height / 2 - camera.panY * CELL_PX * scale;
    board.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    board.style.transformOrigin = '0 0';
  };

  applyCamera();

  return {
    kind: 'flat',
    setBuildings(buildings) {
      buildingLayer.replaceChildren(
        ...buildings.map((building: SceneBuilding) => {
          const footprint = footprintAt(building.type, building.rotation);
          const node = el('div', {
            class: `flat-building${building.destroyed ? ' destroyed' : ''}${building.working ? ' working' : ''}`,
            'data-building-id': building.id
          });
          node.style.left = `${building.x * CELL_PX}px`;
          node.style.top = `${building.y * CELL_PX}px`;
          node.style.width = `${footprint.width * CELL_PX}px`;
          node.style.height = `${footprint.depth * CELL_PX}px`;
          node.append(
            el('span', { class: 'flat-label', text: BUILDINGS[building.type].name }),
            el('span', { class: 'flat-level', text: String(building.level) })
          );
          return node;
        })
      );
    },
    setUnits(units) {
      unitLayer.replaceChildren(
        ...units
          .filter((unit: SceneUnit) => unit.alive)
          .map((unit) => {
            const node = el('div', { class: 'flat-unit' });
            node.style.left = `${unit.x * CELL_PX}px`;
            node.style.top = `${unit.y * CELL_PX}px`;
            return node;
          })
      );
    },
    setGhost(next: SceneGhost | null) {
      if (next === null) {
        ghost.hidden = true;
        return;
      }
      const footprint = footprintAt(next.type, next.rotation);
      ghost.hidden = false;
      ghost.classList.toggle('invalid', !next.valid);
      ghost.style.left = `${next.x * CELL_PX}px`;
      ghost.style.top = `${next.y * CELL_PX}px`;
      ghost.style.width = `${footprint.width * CELL_PX}px`;
      ghost.style.height = `${footprint.depth * CELL_PX}px`;
    },
    setCursor(x, y) {
      cursor.style.left = `${x * CELL_PX}px`;
      cursor.style.top = `${y * CELL_PX}px`;
      cursor.style.width = `${CELL_PX}px`;
      cursor.style.height = `${CELL_PX}px`;
    },
    setCamera(next) {
      camera = { ...next, azimuth: 0 };
      applyCamera();
    },
    setReducedMotion() {
      /* the flat plan holds still in every motion mode */
    },
    pickCell(clientX, clientY) {
      const bounds = board.getBoundingClientRect();
      const x = Math.floor((clientX - bounds.left) / (CELL_PX * camera.zoom));
      const y = Math.floor((clientY - bounds.top) / (CELL_PX * camera.zoom));
      if (x < 0 || y < 0 || x >= GROUND_CELLS || y >= GROUND_CELLS) return null;
      return { x, y };
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      applyCamera();
    },
    frame() {
      return false;
    },
    dispose() {
      plan.remove();
    }
  };
}
