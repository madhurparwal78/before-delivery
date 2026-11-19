import { useId, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { formatCell } from '../../../shared/display.ts';
import { isMeasurePill } from '../../../shared/twin.ts';
import type { ChartChoice, Filter, Pill, SheetShape } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Checkbox, Select } from '../../ui/fields.tsx';
import type { DragItem } from './drag.ts';
import { Menu } from './menu.tsx';
import { AGGS, DATE_LEVELS, drillState, filterCaption, pillCaption, pillField, shelfPills } from './model.ts';
import type { PillShelf, Shelf } from './model.ts';

/** What a pill's keys and buttons ask the page to do. */
export type PillAction =
  | { type: 'remove' }
  | { type: 'step'; by: -1 | 1 }
  | { type: 'open-filter' }
  | { type: 'agg'; agg: (typeof AGGS)[number] }
  | { type: 'level'; level: (typeof DATE_LEVELS)[number]['level'] }
  | { type: 'table-calc' }
  | { type: 'sort' }
  | { type: 'drill' };

/** `data-pill` of a pill's main button, and `data-pill-part` of its side buttons, so the page can return focus. */
export function pillSelector(shelf: Shelf, index: number, part?: string): string {
  return part ? `[data-pill-part="${shelf}:${index}:${part}"]` : `[data-pill="${shelf}:${index}"]`;
}

const CHART_TYPES: readonly { value: ChartChoice; label: string }[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'text_table', label: 'Text table' },
  { value: 'heat_map', label: 'Heat map' },
];

function isChartChoice(value: string): value is ChartChoice {
  return CHART_TYPES.some((choice) => choice.value === value);
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" className="icon">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  menu: 'M6 9l6 6 6-6',
  calc: 'M5 19L19 5M7 5v4M5 7h4M15 17h4',
  asc: 'M12 19V5M6 11l6-6 6 6',
  desc: 'M12 5v14M6 13l6 6 6-6',
  measure: 'M5 19h3V9H5zM10.5 19h3V5h-3zM16 19h3v-6h-3z',
  expand: 'M12 5v14M5 12h14',
  collapse: 'M5 12h14',
};

function SideButton({ label, icon, part, onClick, expanded }: {
  label: string;
  icon: string;
  part: string;
  onClick: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className="pill-side"
      aria-label={label}
      aria-haspopup={expanded === undefined ? undefined : 'menu'}
      aria-expanded={expanded}
      data-pill-part={part}
      onClick={onClick}
    >
      <Icon d={icon} />
    </button>
  );
}

interface PillMenu {
  shelf: PillShelf;
  index: number;
  kind: 'agg' | 'level';
}

interface ShelvesPanelProps {
  shape: SheetShape;
  /** the source's drill hierarchy, top level first */
  hierarchy: readonly string[];
  onPill: (shelf: Shelf, index: number, action: PillAction) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, item: DragItem, label: string) => void;
  onChange: (next: SheetShape) => void;
  onAddReferenceLine: () => void;
  onRemoveReferenceLine: (index: number) => void;
  onNewSet: () => void;
  onNewAlert: () => void;
}

const LINE_WORDS = { average: 'Average', median: 'Median', constant: 'Constant' } as const;

/**
 * `region "Shelves"`: the Rows, Columns and Filters shelves (left column) and the Marks card (right column) with Chart
 * type, Color, Size, Label, Detail, Show totals, reference and trend lines, New set and New alert.
 */
export function ShelvesPanel(props: ShelvesPanelProps) {
  const { shape, hierarchy, onPill, onDragStart, onChange } = props;
  const headingId = useId();
  const [menu, setMenu] = useState<PillMenu | null>(null);

  const closeMenu = (focus: string) => {
    setMenu(null);
    document.querySelector<HTMLElement>(focus)?.focus();
  };

  const keys = (event: KeyboardEvent<HTMLButtonElement>, shelf: Shelf, index: number) => {
    if (event.key === 'Delete') {
      event.preventDefault();
      onPill(shelf, index, { type: 'remove' });
    } else if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) {
      event.preventDefault();
      onPill(shelf, index, { type: 'step', by: 1 });
    } else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) {
      event.preventDefault();
      onPill(shelf, index, { type: 'step', by: -1 });
    }
  };

  const pillItem = (shelf: PillShelf, pill: Pill, index: number) => {
    const caption = pillCaption(pill);
    const field = pillField(pill);
    const measure = isMeasurePill(pill) ? pill : null;
    const date = typeof pill === 'object' && !isMeasurePill(pill) ? pill : null;
    const drillTo = drillState(shape, shelf, index, hierarchy);
    const sort = shape.sort[field];
    const menuHere = menu && menu.shelf === shelf && menu.index === index ? menu.kind : null;
    const part = (name: string) => `${shelf}:${index}:${name}`;
    return (
      <li key={`${field}#${index}`} data-pill-item className={measure ? 'pill pill-measure' : 'pill pill-dimension'}>
        <button
          type="button"
          className="pill-main"
          aria-label={`${caption} on ${shelf}`}
          data-pill={`${shelf}:${index}`}
          onKeyDown={(event) => keys(event, shelf, index)}
          onPointerDown={(event) => onDragStart(event, { kind: 'pill', shelf, index }, caption)}
        >
          {caption}
        </button>
        {measure ? (
          <>
            <SideButton
              label={`Aggregation of ${caption}`}
              icon={ICONS.menu}
              part={part('agg')}
              expanded={menuHere === 'agg'}
              onClick={() => setMenu({ shelf, index, kind: 'agg' })}
            />
            <SideButton
              label={`Table calculation of ${caption}`}
              icon={ICONS.calc}
              part={part('table-calc')}
              onClick={() => onPill(shelf, index, { type: 'table-calc' })}
            />
          </>
        ) : (
          <SideButton
            label={`Sort ${field}`}
            icon={sort === 'desc' ? ICONS.desc : sort === 'measure' ? ICONS.measure : ICONS.asc}
            part={part('sort')}
            onClick={() => onPill(shelf, index, { type: 'sort' })}
          />
        )}
        {date ? (
          <SideButton
            label={`Date level of ${field}`}
            icon={ICONS.menu}
            part={part('level')}
            expanded={menuHere === 'level'}
            onClick={() => setMenu({ shelf, index, kind: 'level' })}
          />
        ) : null}
        {drillTo ? (
          <SideButton
            label={`${drillTo === 'expand' ? 'Expand' : 'Collapse'} ${field}`}
            icon={drillTo === 'expand' ? ICONS.expand : ICONS.collapse}
            part={part('drill')}
            onClick={() => onPill(shelf, index, { type: 'drill' })}
          />
        ) : null}
        {menuHere === 'agg' && measure ? (
          <div className="menu-anchor menu-under">
            <Menu
              name={`Aggregation of ${caption}`}
              items={AGGS.map((agg) => ({
                label: agg,
                current: measure.agg === agg,
                onChoose: () => {
                  onPill(shelf, index, { type: 'agg', agg });
                  closeMenu(pillSelector(shelf, index, 'agg'));
                },
              }))}
              onClose={() => closeMenu(pillSelector(shelf, index, 'agg'))}
            />
          </div>
        ) : null}
        {menuHere === 'level' && date ? (
          <div className="menu-anchor menu-under">
            <Menu
              name={`Date level of ${field}`}
              items={DATE_LEVELS.map(({ level, label }) => ({
                label,
                current: date.level === level,
                onChoose: () => {
                  onPill(shelf, index, { type: 'level', level });
                  closeMenu(pillSelector(shelf, index, 'level'));
                },
              }))}
              onClose={() => closeMenu(pillSelector(shelf, index, 'level'))}
            />
          </div>
        ) : null}
      </li>
    );
  };

  const filterItem = (filter: Filter, index: number) => {
    const caption = filterCaption(filter);
    return (
      <li key={`${filter.field}#${filter.step}#${index}`} data-pill-item className={`pill pill-filter pill-step-${filter.step}`}>
        <button
          type="button"
          className="pill-main"
          aria-label={`${caption} on Filters`}
          data-pill={`Filters:${index}`}
          onKeyDown={(event) => keys(event, 'Filters', index)}
          onClick={() => onPill('Filters', index, { type: 'open-filter' })}
        >
          {caption}
        </button>
        <span className="pill-note" aria-hidden="true">
          {filterNote(filter)}
        </span>
      </li>
    );
  };

  const shelfList = (shelf: PillShelf, wide = false) => (
    <ShelfRow shelf={shelf} wide={wide}>
      {shelfPills(shape, shelf).map((pill, index) => pillItem(shelf, pill, index))}
    </ShelfRow>
  );

  return (
    <section className="shelves-panel" aria-labelledby={headingId} data-region="Shelves" tabIndex={-1}>
      <div className="sheet-panel shelves-card">
        <h2 id={headingId} className="panel-title">
          Shelves
        </h2>
        {shelfList('Rows', true)}
        {shelfList('Columns', true)}
        <ShelfRow shelf="Filters" wide>
          {shape.filters.map(filterItem)}
        </ShelfRow>
      </div>
      <div className="sheet-panel marks-card">
        <h2 className="panel-title">Marks</h2>
        <Select
          label="Chart type"
          value={shape.chart}
          options={CHART_TYPES}
          onChange={(value) => {
            if (isChartChoice(value)) onChange({ ...shape, chart: value });
          }}
        />
        {shelfList('Color')}
        {shelfList('Size')}
        {shelfList('Label')}
        {shelfList('Detail')}
        <Checkbox label="Show totals" checked={shape.totals} onChange={(totals) => onChange({ ...shape, totals })} />
        <Checkbox label="Trend line" checked={shape.trend} onChange={(trend) => onChange({ ...shape, trend })} />
        {shape.reference_lines.length > 0 ? (
          <ul className="line-list" aria-label="Reference lines">
            {shape.reference_lines.map((line, index) => (
              <li key={`${line.type}#${index}`}>
                <span>
                  {LINE_WORDS[line.type]}
                  {line.type === 'constant' ? ` ${line.parameter ?? formatCell(line.value)}` : ''}
                </span>
                <Button variant="quiet" compact onClick={() => props.onRemoveReferenceLine(index)}>
                  Remove {LINE_WORDS[line.type]} line
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="marks-actions">
          <Button onClick={props.onAddReferenceLine}>Add reference line</Button>
          <Button onClick={props.onNewSet}>New set</Button>
          <Button onClick={props.onNewAlert}>New alert</Button>
        </div>
      </div>
    </section>
  );
}

function ShelfRow({ shelf, wide = false, children }: { shelf: Shelf; wide?: boolean; children: ReactNode[] }) {
  return (
    <div className={wide ? 'shelf shelf-wide' : 'shelf'}>
      <span className="shelf-label" aria-hidden="true">
        {shelf}
      </span>
      <ul aria-label={shelf} data-shelf={shelf} className="shelf-list">
        {children}
      </ul>
    </div>
  );
}

/** The short text beside a filter pill: what it keeps. */
function filterNote(filter: Filter): string {
  if (filter.step === 'top') return `top ${typeof filter.n === 'string' ? `[${filter.n}]` : formatCell(filter.n)}`;
  if (filter.step === 'measure' || filter.step === 'table_calc') {
    if (filter.min !== null && filter.max !== null) return `${formatCell(filter.min)} to ${formatCell(filter.max)}`;
    if (filter.min !== null) return `at least ${formatCell(filter.min)}`;
    if (filter.max !== null) return `at most ${formatCell(filter.max)}`;
    return 'all';
  }
  const kept = `${filter.values.length} kept`;
  return filter.step === 'context' ? `context, ${kept}` : kept;
}
