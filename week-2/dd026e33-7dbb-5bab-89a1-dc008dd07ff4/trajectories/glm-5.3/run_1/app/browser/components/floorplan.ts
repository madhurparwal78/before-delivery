/**
 * The floor plan — bays laid out by row and column, drawn to their relative
 * length and width. One Tab stop; arrow keys move by row and column; Enter
 * or Space (or a tap) activates a bay.
 */
import { h } from '../ui.ts';

export interface BayData {
  id: string;
  code: string;
  class: string;
  length_mm: number;
  width_mm: number;
  row: number;
  column: number;
  car: { id: string; name: string } | null;
  eligible?: boolean;
  reason?: 'occupied' | 'too_small' | 'class_change' | null;
}

const CLASS_LABELS: Record<string, string> = {
  standard: 'Standard',
  covered_lift: 'Covered lift',
  sealed_capsule: 'Sealed capsule',
};

export function bayState(bay: BayData, picker: boolean): string {
  if (bay.car) return `occupied by ${bay.car.name}`;
  if (picker && bay.reason === 'too_small') return 'too small';
  if (picker && bay.reason === 'class_change') return 'other class';
  return 'free';
}

export function bayLabel(bay: BayData, picker: boolean): string {
  return `Bay ${bay.code}, ${CLASS_LABELS[bay.class] ?? bay.class}, ${bayState(bay, picker)}`;
}

export interface FloorPlanOptions {
  bays: BayData[];
  picker: boolean;
  onActivate: (bay: BayData) => void;
  selectedId?: string | null;
  focusTarget?: boolean;
}

export function buildFloorPlan(options: FloorPlanOptions): { root: HTMLElement; update: (bays: BayData[], selectedId: string | null) => void } {
  const { bays, picker } = options;
  const rows = Math.max(...bays.map((bay) => bay.row));
  const columns = Math.max(...bays.map((bay) => bay.column));
  const root = h('div', {
    class: 'floorplan',
    role: 'group',
    'aria-label': 'Floor plan',
    style: `grid-template-columns: repeat(${columns}, minmax(44px, 1fr));`,
  });
  let selected: string | null = options.selectedId ?? null;

  const renderBay = (bay: BayData): HTMLElement => {
    const button = h('button', {
      class: `bay ${bay.car ? 'occupied' : ''} ${picker && bay.reason ? 'ineligible' : ''}`,
      'aria-label': bayLabel(bay, picker),
      'data-bay-id': bay.id,
      style: `aspect-ratio: ${bay.length_mm} / ${bay.width_mm};`,
      onclick: () => options.onActivate(bay),
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          options.onActivate(bay);
        }
        if (event.key.startsWith('Arrow')) {
          event.preventDefault();
          move(event.key);
        }
      },
    },
      h('span', { class: 'code', text: bay.code }),
      h('span', { class: 'class', text: CLASS_LABELS[bay.class] ?? bay.class }),
      h('span', { class: 'state', text: bay.car ? bay.car.name : picker && bay.reason === 'too_small' ? 'Too small' : picker && bay.reason === 'class_change' ? 'Other class' : 'Free' }),
      bay.car ? h('span', { class: 'tab', 'aria-hidden': 'true' }) : null,
    );
    return button;
  };

  const order: BayData[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const bay = bays.find((candidate) => candidate.row === row && candidate.column === column);
      if (bay) order.push(bay);
    }
  }
  for (const bay of order) {
    const el = renderBay(bay);
    el.tabIndex = -1;
    root.append(el);
  }
  const focusBay = (id: string): void => {
    const el = root.querySelector<HTMLElement>(`[data-bay-id="${id}"]`);
    if (!el) return;
    root.querySelectorAll('.bay').forEach((bay) => (bay as HTMLElement).tabIndex = -1);
    el.tabIndex = 0;
    el.focus();
    selected = id;
  };
  if (order.length > 0) {
    const initial = options.selectedId && order.some((bay) => bay.id === options.selectedId)
      ? options.selectedId
      : order[0].id;
    const el = root.querySelector<HTMLElement>(`[data-bay-id="${initial}"]`);
    if (el) el.tabIndex = 0;
    selected = initial;
  }

  const move = (key: string): void => {
    const current = order.find((bay) => bay.id === selected) ?? order[0];
    let target: BayData | undefined;
    if (key === 'ArrowRight') target = order.find((bay) => bay.row === current.row && bay.column === current.column + 1);
    else if (key === 'ArrowLeft') target = order.find((bay) => bay.row === current.row && bay.column === current.column - 1);
    else if (key === 'ArrowDown') target = order.find((bay) => bay.row === current.row + 1 && bay.column === current.column);
    else if (key === 'ArrowUp') target = order.find((bay) => bay.row === current.row - 1 && bay.column === current.column);
    if (target) focusBay(target.id);
  };


  const update = (fresh: BayData[], selectedId: string | null): void => {
    for (const bay of fresh) {
      const el = root.querySelector<HTMLElement>(`[data-bay-id="${bay.id}"]`);
      if (!el) continue;
      el.setAttribute('aria-label', bayLabel(bay, picker));
      const state = el.querySelector('.state') as HTMLElement;
      const text = bay.car ? bay.car.name : picker && bay.reason === 'too_small' ? 'Too small' : picker && bay.reason === 'class_change' ? 'Other class' : 'Free';
      if (state.textContent !== text) state.textContent = text;
      el.classList.toggle('occupied', bay.car !== null);
      el.classList.toggle('ineligible', Boolean(picker && bay.reason));
    }
    selected = selectedId ?? selected;
  };

  return { root, update };
}
