import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { entityLabel } from '../../../shared/geometry/index.ts';
import type { Scene } from '../../../shared/geometry/index.ts';
import { useMediaLayout } from '../../ui/index.ts';
import '../../styles/drawing/entities.css';

/** Rows kept above and below the visible ones, so a quick scroll never shows an empty gap. */
const OVERSCAN_ROWS = 12;
/** Used until the grid has been measured. */
const FALLBACK_HEIGHT_PX = 400;

interface EntityGridProps {
  scene: Scene;
  selected: ReadonlySet<string>;
  onSelectOnly: (id: string) => void;
  onToggle: (id: string) => void;
  /** pans to the entity by the Find rule */
  onReveal: (id: string) => void;
  /** ref callback of the F6 stop: the grid itself */
  stopRef: (element: HTMLElement | null) => void;
}

/** A row is as high as a control (`--control`: 44 px on touch layouts), so rows are tap targets. */
function controlHeight(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control'));
}

/**
 * `grid "Entities"`: one row per entity of the whole drawing. Only the rows near the scroll position exist in the page;
 * `aria-rowcount` is the whole count and each row's `aria-rowindex` its place in the whole list.
 * Focus stays on the grid itself and `aria-activedescendant` names the current row.
 */
export function EntityGrid({ scene, selected, onSelectOnly, onToggle, onReveal, stopRef }: EntityGridProps) {
  const layout = useMediaLayout();
  const rowHeight = useMemo(controlHeight, [layout]);
  const idPrefix = useId();
  const grid = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState({ top: 0, height: FALLBACK_HEIGHT_PX });
  const [activeId, setActiveId] = useState<string | null>(null);
  const rows = scene.entities;

  // the scene updates in place: `version` tells when the list changed
  const indexById = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows, scene.version]);

  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return undefined;
    const measure = (): void => setScroll({ top: element.scrollTop, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const activeIndex = activeId === null ? -1 : (indexById.get(activeId) ?? -1);
  const first = Math.max(0, Math.floor(scroll.top / rowHeight) - OVERSCAN_ROWS);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / rowHeight) + OVERSCAN_ROWS);
  const indices: number[] = [];
  for (let index = first; index < last; index += 1) indices.push(index);
  if (activeIndex >= 0 && (activeIndex < first || activeIndex >= last)) indices.push(activeIndex);

  function revealRow(index: number): void {
    const element = grid.current;
    if (!element) return;
    const top = index * rowHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = top + rowHeight - element.clientHeight;
    setScroll({ top: element.scrollTop, height: element.clientHeight });
  }

  function currentIndex(): number {
    if (activeIndex >= 0) return activeIndex;
    const onlySelected = selected.size === 1 ? [...selected][0] : undefined;
    return onlySelected === undefined ? -1 : (indexById.get(onlySelected) ?? -1);
  }

  function moveTo(index: number): void {
    setActiveId(rows[index].id);
    revealRow(index);
    onSelectOnly(rows[index].id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (rows.length === 0) return;
    const index = currentIndex();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(Math.min(rows.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(Math.max(0, index - 1));
    } else if ((event.key === ' ' || event.key === 'Enter') && index >= 0) {
      event.preventDefault();
      if (event.key === ' ') onToggle(rows[index].id);
      else onReveal(rows[index].id);
    }
  }

  function onRowClick(event: MouseEvent<HTMLDivElement>, id: string): void {
    grid.current?.focus();
    setActiveId(id);
    if (event.ctrlKey || event.metaKey) onToggle(id);
    else onSelectOnly(id);
  }

  return (
    <div
      ref={(element) => {
        grid.current = element;
        stopRef(element);
      }}
      className="entity-grid"
      role="grid"
      aria-label="Entities"
      aria-rowcount={rows.length}
      aria-activedescendant={activeIndex >= 0 ? `${idPrefix}-${activeIndex}` : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}
    >
      <div className="entity-grid__extent" style={{ height: rows.length * rowHeight }}>
        {indices.map((index) => {
          const row = rows[index];
          const label = entityLabel(scene, row);
          return (
            <div
              key={row.id}
              id={`${idPrefix}-${index}`}
              className="entity-row"
              role="row"
              aria-rowindex={index + 1}
              aria-label={label}
              aria-selected={selected.has(row.id)}
              data-current={index === activeIndex ? '' : undefined}
              style={{ top: index * rowHeight, height: rowHeight }}
              onClick={(event) => onRowClick(event, row.id)}
            >
              <div role="gridcell" className="entity-row__label">{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
