import { Cur } from '../../shared/types';
import { Arrow, clampCentre, clusterPoints, nearestInDirection, panStep, viewSide } from '../../shared/map';
import { el, roving, svg } from '../dom';
import { amount, decimal1, t } from '../i18n';
import { state } from '../state';

export interface MapPin {
  code: string;
  name: string;
  x: number;
  y: number;
  score: number;
  display_minor: number;
}

export interface MapView {
  zoom: number;
  cx: number;
  cy: number;
}

export interface MapOptions {
  pins: MapPin[];
  view: MapView;
  currency: Cur;
  selected: string | null;
  searchedView: MapView | null;
  centreOnSelected?: boolean;
  onSelect: (code: string) => void;
  onOpen: (code: string) => void;
  onSearchArea: (view: MapView) => void;
}

interface Node {
  code: string;
  x: number;
  y: number;
  kind: 'pin' | 'cluster';
  members: MapPin[];
}

function coastline(): SVGElement {
  const paths = [
    'M0,620 C120,560 220,660 340,600 C460,540 560,660 700,590 C820,530 920,610 1000,560 L1000,1000 L0,1000 Z',
    'M0,220 C90,180 160,250 260,210 C340,178 420,230 520,196 L520,120 L0,120 Z',
    'M700,760 C760,720 830,780 900,740 L1000,780 L1000,1000 L700,1000 Z',
  ];
  return svg(
    'svg',
    { viewBox: '0 0 1000 1000', class: 'map-plane', 'aria-hidden': 'true', preserveAspectRatio: 'none' },
    paths.map((d) => svg('path', { d, fill: '#f1f1ef', stroke: '#0a0a0a', 'stroke-width': 2 })),
  );
}

/** `region "Map"`: a drawn plane with pins and clusters, never mirrored. */
export function mapRegion(options: MapOptions): HTMLElement {
  let view: MapView = { ...options.view };
  let selected = options.selected;
  let searched = options.searchedView;
  let debounce = 0;

  const plane = el('div', { class: 'map-plane-wrap', dir: 'ltr' });
  const region = el('div', { role: 'region', 'aria-label': t('ui.map'), class: 'map' });
  const searchArea = el(
    'button',
    { type: 'button', class: 'map-search-area', hidden: true, 'data-focus-key': 'map:search-area' },
    [t('ui.search_area')],
  );
  const zoomIn = el('button', { type: 'button', 'data-focus-key': 'map:zoom-in' }, [t('ui.zoom_in')]);
  const zoomOut = el('button', { type: 'button', 'data-focus-key': 'map:zoom-out' }, [t('ui.zoom_out')]);
  const panNorth = el('button', { type: 'button', 'data-focus-key': 'map:pan-north' }, [t('ui.pan_north')]);
  const panSouth = el('button', { type: 'button', 'data-focus-key': 'map:pan-south' }, [t('ui.pan_south')]);
  const panEast = el('button', { type: 'button', 'data-focus-key': 'map:pan-east' }, [t('ui.pan_east')]);
  const panWest = el('button', { type: 'button', 'data-focus-key': 'map:pan-west' }, [t('ui.pan_west')]);
  if (options.centreOnSelected && selected) {
    const pin = options.pins.find((candidate) => candidate.code === selected);
    if (pin) view = { ...view, cx: pin.x, cy: pin.y };
  }

  const sameView = (a: MapView | null, b: MapView): boolean =>
    a !== null && a.zoom === b.zoom && Math.abs(a.cx - b.cx) < 0.05 && Math.abs(a.cy - b.cy) < 0.05;

  const applyViewAttributes = (): void => {
    region.setAttribute('data-zoom', String(view.zoom));
    region.setAttribute('data-cx', view.cx.toFixed(1));
    region.setAttribute('data-cy', view.cy.toFixed(1));
  };

  const scheduleSearchArea = (): void => {
    window.clearTimeout(debounce);
    searchArea.hidden = true;
    debounce = window.setTimeout(() => {
      searchArea.hidden = sameView(searched, view);
    }, state.settings.mapDebounceMs);
  };

  const moveView = (next: Partial<MapView>): void => {
    view = {
      zoom: Math.min(5, Math.max(0, next.zoom ?? view.zoom)),
      cx: clampCentre(next.cx ?? view.cx),
      cy: clampCentre(next.cy ?? view.cy),
    };
    draw();
    scheduleSearchArea();
  };

  const nodes = (): Node[] =>
    clusterPoints(options.pins, view.zoom, view.cx, view.cy).map((group) => ({
      code: group.code,
      x: group.x,
      y: group.y,
      kind: group.kind,
      members: group.members,
    }));

  function draw(): void {
    applyViewAttributes();
    plane.replaceChildren(coastline());
    const side = viewSide(view.zoom);
    const left = view.cx - side / 2;
    const top = view.cy - side / 2;
    const list = nodes();
    const buttons: HTMLElement[] = [];
    const drawn: { x: number; y: number }[] = [];
    for (const node of list) {
      const relX = ((node.x - left) / side) * 100;
      let relY = ((node.y - top) / side) * 100;
      // Keep tap targets apart on screen without moving the logical position.
      while (drawn.some((placed) => Math.abs(placed.x - relX) < 9 && Math.abs(placed.y - relY) < 9)) {
        relY += 9;
      }
      drawn.push({ x: relX, y: relY });
      const isCluster = node.kind === 'cluster';
      const member = node.members[0];
      const label = isCluster
        ? t('ui.cluster', { n: node.members.length, count: node.members.length })
        : t('ui.pin', {
            name: member.name,
            score: decimal1(member.score),
            amount: amount(member.display_minor, options.currency),
          });
      const button = el(
        'button',
        {
          type: 'button',
          class: `map-pin${isCluster ? ' cluster' : ''}${!isCluster && member.code === selected ? ' selected' : ''}`,
          style: `left:${relX}%; top:${relY}%`,
          'data-code': node.code,
          'data-kind': node.kind,
          'data-focus-key': `map:pin:${node.code}`,
          tabindex: '-1',
          'aria-pressed': isCluster ? null : member.code === selected ? 'true' : 'false',
        },
        [label],
      );
      button.addEventListener('click', () => {
        if (isCluster) {
          moveView({ zoom: view.zoom + 1, cx: node.x, cy: node.y });
          return;
        }
        selected = member.code;
        draw();
        options.onSelect(member.code);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (isCluster) moveView({ zoom: view.zoom + 1, cx: node.x, cy: node.y });
          else options.onOpen(member.code);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          zoomIn.focus();
          return;
        }
        const arrows: Record<string, Arrow> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        };
        const arrow = arrows[event.key];
        if (!arrow) return;
        event.preventDefault();
        const current = list.find((candidate) => candidate.code === node.code);
        if (!current) return;
        const target = nearestInDirection(list, current, arrow);
        if (!target) return;
        const index = list.findIndex((candidate) => candidate.code === target.code);
        roving(buttons, index);
        buttons[index].focus();
      });
      buttons.push(button);
      plane.append(button);
    }
    const selectedIndex = list.findIndex((node) => node.members.some((member) => member.code === selected));
    roving(buttons, selectedIndex >= 0 ? selectedIndex : 0);
  }

  zoomIn.addEventListener('click', () => moveView({ zoom: view.zoom + 1 }));
  zoomOut.addEventListener('click', () => moveView({ zoom: view.zoom - 1 }));
  panNorth.addEventListener('click', () => moveView({ cy: view.cy - panStep(view.zoom) }));
  panSouth.addEventListener('click', () => moveView({ cy: view.cy + panStep(view.zoom) }));
  panEast.addEventListener('click', () => moveView({ cx: view.cx + panStep(view.zoom) }));
  panWest.addEventListener('click', () => moveView({ cx: view.cx - panStep(view.zoom) }));
  searchArea.addEventListener('click', () => {
    searched = { ...view };
    searchArea.hidden = true;
    options.onSearchArea({ ...view });
  });

  let dragFrom: { x: number; y: number; cx: number; cy: number } | null = null;
  plane.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragFrom = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy };
  });
  plane.addEventListener('pointermove', (event) => {
    if (!dragFrom) return;
    const rect = plane.getBoundingClientRect();
    const side = viewSide(view.zoom);
    const dx = ((event.clientX - dragFrom.x) / rect.width) * side;
    const dy = ((event.clientY - dragFrom.y) / rect.height) * side;
    moveView({ cx: dragFrom.cx - dx, cy: dragFrom.cy - dy });
  });
  plane.addEventListener('pointerup', () => {
    dragFrom = null;
  });

  region.append(
    plane,
    el('div', { class: 'map-controls' }, [panNorth, panSouth, panEast, panWest, zoomIn, zoomOut, searchArea]),
  );
  draw();
  return region;
}


