import { isMeasurePill, measureCaption } from '../../shared/chart.js';
import type {
  Agg,
  DateLevel,
  FieldType,
  FilterSpec,
  MeasurePill,
  Pill,
  SheetSpec,
  TableCalcSpec,
} from '../../shared/types.js';
import { normalizeDim } from '../../shared/viewplan.js';
import { el } from '../dom.js';
import { openMenu } from '../ui/menu.js';

export type ShelfName = 'rows' | 'columns' | 'color' | 'size' | 'label' | 'detail' | 'filters';

export const SHELF_LABEL: Record<ShelfName, string> = {
  rows: 'Rows',
  columns: 'Columns',
  color: 'Color',
  size: 'Size',
  label: 'Label',
  detail: 'Detail',
  filters: 'Filters',
};

export const AGGS: Agg[] = ['SUM', 'AVG', 'MEDIAN', 'MIN', 'MAX', 'COUNT', 'COUNT_UNIQUE'];
export const DATE_LEVELS: { value: DateLevel; label: string }[] = [
  { value: 'year', label: 'Year' },
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

export function shelfPills(spec: SheetSpec, shelf: ShelfName): Pill[] {
  switch (shelf) {
    case 'rows':
      return spec.rows;
    case 'columns':
      return spec.columns;
    case 'label':
      return spec.label;
    case 'detail':
      return spec.detail;
    case 'color':
      return spec.color === null ? [] : [spec.color];
    case 'size':
      return spec.size === null ? [] : [spec.size];
    default:
      return [];
  }
}

export function setShelfPills(spec: SheetSpec, shelf: ShelfName, pills: Pill[]): void {
  switch (shelf) {
    case 'rows':
      spec.rows = pills;
      break;
    case 'columns':
      spec.columns = pills;
      break;
    case 'label':
      spec.label = pills;
      break;
    case 'detail':
      spec.detail = pills;
      break;
    case 'color':
      spec.color = pills[0] ?? null;
      break;
    case 'size':
      spec.size = pills[0] ?? null;
      break;
    default:
      break;
  }
}

export function pillCaption(pill: Pill): string {
  return isMeasurePill(pill) ? measureCaption(pill) : normalizeDim(pill).field;
}

export function pillField(pill: Pill): string {
  return isMeasurePill(pill) ? pill.field : normalizeDim(pill).field;
}

export function filterCaption(filter: FilterSpec): string {
  if (filter.step === 'measure' || filter.step === 'table_calc') {
    const pill: MeasurePill = { field: filter.field, agg: (filter.agg ?? 'SUM') as Agg, table_calc: filter.table_calc ?? null };
    return measureCaption(pill);
  }
  return filter.field;
}

export interface PillContext {
  spec: () => SheetSpec;
  editable: boolean;
  hierarchy: () => { name: string; fields: string[] } | null;
  fieldType: (name: string) => FieldType | undefined;
  announce: (text: string) => void;
  commit: () => void;
  openFilter: (field: string, isMeasure: boolean, existing: FilterSpec | null, opener: HTMLElement) => void;
  openTableCalc: (pill: MeasurePill, opener: HTMLElement, apply: (spec: TableCalcSpec | null) => void) => void;
  focusFieldList: () => void;
  redrawShelves: () => void;
  focusPill: (shelf: ShelfName, index: number) => void;
}

export function newPillFor(field: string, kind: 'dimension' | 'measure', type: FieldType | undefined, lod: boolean): Pill {
  if (kind === 'measure') return { field, agg: lod ? 'AVG' : 'SUM', table_calc: null };
  if (type === 'date') return { field, level: 'month' };
  return field;
}

function removeAt(spec: SheetSpec, shelf: ShelfName, index: number): void {
  if (shelf === 'filters') {
    spec.filters.splice(index, 1);
    return;
  }
  const pills = [...shelfPills(spec, shelf)];
  pills.splice(index, 1);
  setShelfPills(spec, shelf, pills);
}

/** The next drill level for a hierarchy field, or null when there is none. */
function nextDrillLevel(ctx: PillContext, field: string): string | null {
  const hierarchy = ctx.hierarchy();
  if (hierarchy === null) return null;
  const position = hierarchy.fields.indexOf(field);
  if (position < 0 || position === hierarchy.fields.length - 1) return null;
  return hierarchy.fields[position + 1];
}

export function renderShelf(shelf: ShelfName, ctx: PillContext): HTMLElement {
  const spec = ctx.spec();
  const list = el('ul', { class: 'shelf', 'aria-label': SHELF_LABEL[shelf] });
  list.setAttribute('role', 'list');
  list.dataset.shelf = shelf;

  const items: { caption: string; field: string; pill: Pill | null; filter: FilterSpec | null }[] =
    shelf === 'filters'
      ? spec.filters.map((filter) => ({ caption: filterCaption(filter), field: filter.field, pill: null, filter }))
      : shelfPills(spec, shelf).map((pill) => ({ caption: pillCaption(pill), field: pillField(pill), pill, filter: null }));

  items.forEach((item, index) => {
    const main = el('button', {
      type: 'button',
      class: 'pill',
      text: `${item.caption} on ${SHELF_LABEL[shelf]}`,
    });
    main.dataset.shelf = shelf;
    main.dataset.index = String(index);
    const measure = item.pill !== null && isMeasurePill(item.pill);
    main.classList.add(measure ? 'measure' : 'dimension');

    main.addEventListener('keydown', (event) => {
      if (!ctx.editable && shelf !== 'filters') return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeAt(ctx.spec(), shelf, index);
        ctx.announce(`Removed ${item.field} from ${SHELF_LABEL[shelf]}.`);
        const remaining = shelf === 'filters' ? ctx.spec().filters.length : shelfPills(ctx.spec(), shelf).length;
        ctx.redrawShelves();
        if (remaining > index) ctx.focusPill(shelf, index);
        else if (remaining > 0) ctx.focusPill(shelf, remaining - 1);
        else ctx.focusFieldList();
        ctx.commit();
        return;
      }
      if (event.altKey && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        const current = ctx.spec();
        if (shelf === 'filters') {
          const next = index + delta;
          if (next < 0 || next >= current.filters.length) return;
          const [moved] = current.filters.splice(index, 1);
          current.filters.splice(next, 0, moved);
          ctx.announce(`Moved ${item.field} to position ${next + 1} on ${SHELF_LABEL[shelf]}.`);
          ctx.redrawShelves();
          ctx.focusPill(shelf, next);
          ctx.commit();
          return;
        }
        const pills = [...shelfPills(current, shelf)];
        const next = index + delta;
        if (next < 0 || next >= pills.length) return;
        const [moved] = pills.splice(index, 1);
        pills.splice(next, 0, moved);
        setShelfPills(current, shelf, pills);
        ctx.announce(`Moved ${item.field} to position ${next + 1} on ${SHELF_LABEL[shelf]}.`);
        ctx.redrawShelves();
        ctx.focusPill(shelf, next);
        ctx.commit();
        return;
      }
      if (event.key === 'Enter' && shelf === 'filters' && item.filter !== null) {
        event.preventDefault();
        ctx.openFilter(item.filter.field, item.filter.step === 'measure' || item.filter.step === 'table_calc', item.filter, main);
      }
    });

    main.addEventListener('click', () => {
      if (shelf === 'filters' && item.filter !== null) {
        ctx.openFilter(item.filter.field, item.filter.step === 'measure' || item.filter.step === 'table_calc', item.filter, main);
      }
    });

    const extras: HTMLElement[] = [];
    if (ctx.editable && item.pill !== null && isMeasurePill(item.pill)) {
      const pill = item.pill;
      const aggButton = el('button', { type: 'button', class: 'pill-extra', text: `Aggregation of ${item.caption}` });
      aggButton.addEventListener('click', () => {
        openMenu(
          aggButton,
          `Aggregation of ${item.caption}`,
          AGGS.map((agg) => ({
            label: agg,
            choose: () => {
              pill.agg = agg;
              ctx.redrawShelves();
              ctx.commit();
            },
          })),
        );
      });
      const calcButton = el('button', { type: 'button', class: 'pill-extra', text: `Table calculation of ${item.caption}` });
      calcButton.addEventListener('click', () => {
        ctx.openTableCalc(pill, calcButton, (spec2) => {
          pill.table_calc = spec2;
          ctx.redrawShelves();
          ctx.commit();
        });
      });
      extras.push(aggButton, calcButton);
    }

    if (ctx.editable && item.pill !== null && !isMeasurePill(item.pill)) {
      const field = item.field;
      const sortButton = el('button', { type: 'button', class: 'pill-extra', text: `Sort ${field}` });
      sortButton.addEventListener('click', () => {
        const current = ctx.spec();
        const mode = current.sort[field] ?? 'asc';
        current.sort[field] = mode === 'asc' ? 'desc' : mode === 'desc' ? 'measure' : 'asc';
        ctx.redrawShelves();
        ctx.commit();
      });
      extras.push(sortButton);
      if (ctx.fieldType(field) === 'date') {
        const levelButton = el('button', { type: 'button', class: 'pill-extra', text: `Date level of ${field}` });
        levelButton.addEventListener('click', () => {
          openMenu(
            levelButton,
            `Date level of ${field}`,
            DATE_LEVELS.map((level) => ({
              label: level.label,
              choose: () => {
                const current = ctx.spec();
                const pills = [...shelfPills(current, shelf)];
                pills[index] = { field, level: level.value };
                setShelfPills(current, shelf, pills);
                ctx.redrawShelves();
                ctx.commit();
              },
            })),
          );
        });
        extras.push(levelButton);
      }
      const nextLevel = nextDrillLevel(ctx, field);
      if (nextLevel !== null) {
        const pills = shelfPills(ctx.spec(), shelf);
        const nextPill = pills[index + 1];
        const expanded = nextPill !== undefined && pillField(nextPill) === nextLevel;
        const drillButton = el('button', {
          type: 'button',
          class: 'pill-extra',
          'data-drill': field,
          text: expanded ? `Collapse ${field}` : `Expand ${field}`,
        });
        drillButton.addEventListener('click', () => {
          const current = ctx.spec();
          const list2 = [...shelfPills(current, shelf)];
          const hierarchy = ctx.hierarchy();
          if (hierarchy === null) return;
          const position = hierarchy.fields.indexOf(field);
          if (expanded) {
            const lower = hierarchy.fields.slice(position + 1);
            const kept = list2.filter((p, i) => i <= index || !lower.includes(pillField(p)));
            setShelfPills(current, shelf, kept);
            ctx.announce(`Collapsed ${field}.`);
          } else {
            const nextField = hierarchy.fields[position + 1];
            list2.splice(index + 1, 0, newPillFor(nextField, 'dimension', ctx.fieldType(nextField), false));
            setShelfPills(current, shelf, list2);
            ctx.announce(`Expanded ${field}.`);
          }
          ctx.redrawShelves();
          document.querySelector<HTMLElement>(`[data-drill="${field}"]`)?.focus();
          ctx.commit();
        });
        extras.push(drillButton);
      }
    }

    list.append(el('li', { class: 'shelf-item' }, [main, ...extras]));
  });

  return list;
}
