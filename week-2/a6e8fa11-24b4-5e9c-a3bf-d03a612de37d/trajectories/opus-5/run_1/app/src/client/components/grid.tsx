import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LIMITS } from '../../shared/limits';
import { cellKey, columnLetter, formatCellRef, qualifiedRef } from '../../shared/refs';
import { NumberFormat, displayValue } from '../../shared/values';
import { FurrowEntry, WorkbookStore, reducedMotion } from '../lib/store';

export interface CellAddress {
  col: number;
  row: number;
}

export interface GridSelection {
  anchor: CellAddress;
  focus: CellAddress;
}

export interface GridProps {
  store: WorkbookStore;
  sheetId: string;
  sheetName: string;
  selection: GridSelection;
  onSelect: (selection: GridSelection) => void;
  editing: string | null;
  editValue: string;
  onEditValue: (value: string) => void;
  onStartEdit: (ref: string, value: string) => void;
  onCommit: (ref: string, input: string, move: 'down' | 'right' | 'left' | 'none') => void;
  onCancelEdit: () => void;
  onClear: (ref: string) => void;
  onToggleBold: () => void;
  onSwitchSheet: (delta: number) => void;
  onReadOnlyAttempt: () => void;
  canEdit: boolean;
  gridRef: React.RefObject<HTMLDivElement>;
}

const ROW_HEIGHT = 26;
const COUNT_MS = 180;

function clampCol(col: number): number {
  return Math.min(LIMITS.maxColumns, Math.max(1, col));
}

function clampRow(row: number): number {
  return Math.min(LIMITS.maxRows, Math.max(1, row));
}

function useCountUp(entry: FurrowEntry | undefined, finalDisplay: string, numberFormat: NumberFormat): string {
  const [text, setText] = useState(finalDisplay);
  const started = useRef<number | null>(null);
  const countable =
    entry !== undefined && entry.fromValue !== null && entry.toValue !== null && !reducedMotion();

  useEffect(() => {
    if (!countable || !entry) {
      setText(finalDisplay);
      started.current = null;
      return;
    }
    started.current = performance.now();
    let frame = 0;
    const from = entry.fromValue as number;
    const to = entry.toValue as number;
    const step = () => {
      const elapsed = performance.now() - (started.current as number);
      const share = Math.min(1, elapsed / COUNT_MS);
      const eased = 1 - Math.pow(1 - share, 3);
      setText(displayValue(from + (to - from) * eased, numberFormat));
      if (share < 1) frame = requestAnimationFrame(step);
      else setText(finalDisplay);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [countable, entry, finalDisplay, numberFormat]);

  return countable ? text : finalDisplay;
}

interface CellProps {
  store: WorkbookStore;
  sheetId: string;
  sheetName: string;
  ref_: string;
  address: CellAddress;
  active: boolean;
  selected: boolean;
  editing: boolean;
  editValue: string;
  onEditValue: (value: string) => void;
  onSelect: (address: CellAddress, extend: boolean) => void;
  onOpenEditor: () => void;
}

function Cell(props: CellProps): JSX.Element {
  const { store, sheetId, ref_, address, active, selected, editing } = props;
  const evaluated = store.evaluation?.cell(sheetId, ref_);
  const pending = store.pendingCells().has(cellKey(sheetId, ref_));
  const outlined = store.isOutlined(sheetId, ref_);
  const rolledBack = store.rollbackCells.has(cellKey(sheetId, ref_));
  const entry = store.furrowEntry(sheetId, ref_);
  const display = evaluated?.display ?? '';
  const text = useCountUp(entry, display, evaluated?.numberFormat ?? 'general');
  const node = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (active && !editing && document.activeElement !== node.current) {
      const grid = node.current?.closest('[role="grid"]');
      if (grid && grid.contains(document.activeElement)) node.current?.focus({ preventScroll: true });
    }
  }, [active, editing]);

  const describedBy: string[] = [];
  if (pending) describedBy.push('cell-pending-description');
  if (outlined) describedBy.push('cell-recalculated-description');

  const classes = ['grid-cell'];
  if (evaluated?.bold) classes.push('bold');
  if (typeof evaluated?.value === 'number') classes.push('numeric');
  if (selected) classes.push('selected');
  if (active) classes.push('active');
  if (outlined) classes.push(store.furrowFading ? 'recalc-fade' : 'recalc');
  if (pending) classes.push('pending');
  if (rolledBack) classes.push('rolled-back');

  return (
    <div
      role="gridcell"
      aria-colindex={address.col}
      aria-selected={active ? true : undefined}
      aria-describedby={describedBy.length > 0 ? describedBy.join(' ') : undefined}
      className={classes.join(' ')}
      tabIndex={active ? 0 : -1}
      ref={node}
      onMouseDown={(event) => props.onSelect(address, event.shiftKey)}
      onMouseEnter={(event) => {
        if (event.buttons === 1) props.onSelect(address, true);
      }}
      onDoubleClick={props.onOpenEditor}
    >
      {editing ? (
        <input
          className="cell-editor"
          aria-label={`Edit ${qualifiedRef(props.sheetName, ref_)}`}
          autoFocus
          value={props.editValue}
          onChange={(event) => props.onEditValue(event.target.value)}
        />
      ) : (
        <span className="cell-text">{text}</span>
      )}
    </div>
  );
}

export function Grid(props: GridProps): JSX.Element {
  const { store, sheetId, sheetName, selection, editing } = props;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || 520);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const visibleCount = Math.max(12, Math.ceil(viewportHeight / ROW_HEIGHT) + 4);
  const firstRow = Math.max(1, Math.floor(scrollTop / ROW_HEIGHT) - 1);
  const lastRow = Math.min(LIMITS.maxRows, firstRow + visibleCount);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const top = (selection.focus.row - 1) * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [selection.focus.row]);

  const select = (address: CellAddress, extend: boolean) => {
    props.onSelect({ anchor: extend ? selection.anchor : address, focus: address });
  };

  const move = (deltaCol: number, deltaRow: number, extend: boolean) => {
    const next = {
      col: clampCol(selection.focus.col + deltaCol),
      row: clampRow(selection.focus.row + deltaRow),
    };
    select(next, extend);
  };

  const activeRef = formatCellRef(selection.focus);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing) {
      if (event.key === 'Enter') {
        event.preventDefault();
        props.onCommit(activeRef, props.editValue, 'down');
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        props.onCommit(activeRef, props.editValue, event.shiftKey ? 'left' : 'right');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onCancelEdit();
      }
      return;
    }

    const extend = event.shiftKey;
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        move(0, -1, extend);
        return;
      case 'ArrowDown':
        event.preventDefault();
        move(0, 1, extend);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        move(-1, 0, extend);
        return;
      case 'ArrowRight':
        event.preventDefault();
        move(1, 0, extend);
        return;
      case 'Home':
        event.preventDefault();
        if (event.ctrlKey) select({ col: 1, row: 1 }, extend);
        else select({ col: 1, row: selection.focus.row }, extend);
        return;
      case 'End':
        event.preventDefault();
        select({ col: LIMITS.maxColumns, row: selection.focus.row }, extend);
        return;
      case 'PageUp':
        event.preventDefault();
        if (event.ctrlKey) props.onSwitchSheet(-1);
        else move(0, -visibleCount + 4, extend);
        return;
      case 'PageDown':
        event.preventDefault();
        if (event.ctrlKey) props.onSwitchSheet(1);
        else move(0, visibleCount - 4, extend);
        return;
      case 'Enter':
      case 'F2': {
        event.preventDefault();
        if (!props.canEdit) {
          props.onReadOnlyAttempt();
          return;
        }
        const current = store.evaluation?.cell(sheetId, activeRef)?.input ?? '';
        props.onStartEdit(activeRef, current);
        return;
      }
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        if (!props.canEdit) {
          props.onReadOnlyAttempt();
          return;
        }
        props.onClear(activeRef);
        return;
      default:
        break;
    }

    if (event.key.toLowerCase() === 'b' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!props.canEdit) {
        props.onReadOnlyAttempt();
        return;
      }
      props.onToggleBold();
      return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!props.canEdit) {
        props.onReadOnlyAttempt();
        return;
      }
      props.onStartEdit(activeRef, event.key);
    }
  };

  const low = {
    col: Math.min(selection.anchor.col, selection.focus.col),
    row: Math.min(selection.anchor.row, selection.focus.row),
  };
  const high = {
    col: Math.max(selection.anchor.col, selection.focus.col),
    row: Math.max(selection.anchor.row, selection.focus.row),
  };

  const rows: JSX.Element[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const cells: JSX.Element[] = [];
    for (let col = 1; col <= LIMITS.maxColumns; col++) {
      const ref = formatCellRef({ col, row });
      const active = selection.focus.col === col && selection.focus.row === row;
      cells.push(
        <Cell
          key={ref}
          store={store}
          sheetId={sheetId}
          sheetName={sheetName}
          ref_={ref}
          address={{ col, row }}
          active={active}
          selected={col >= low.col && col <= high.col && row >= low.row && row <= high.row}
          editing={editing === ref}
          editValue={props.editValue}
          onEditValue={props.onEditValue}
          onSelect={select}
          onOpenEditor={() => {
            if (!props.canEdit) {
              props.onReadOnlyAttempt();
              return;
            }
            props.onStartEdit(ref, store.evaluation?.cell(sheetId, ref)?.input ?? '');
          }}
        />,
      );
    }
    rows.push(
      <div
        key={row}
        role="row"
        aria-rowindex={row}
        className="grid-row"
        style={{ top: (row - 1) * ROW_HEIGHT }}
      >
        <div className="row-number numerals" aria-hidden="true">
          {row}
        </div>
        {cells}
      </div>,
    );
  }

  return (
    <div className="grid-area">
      <span id="cell-pending-description" className="visually-hidden">
        Pending sync
      </span>
      <span id="cell-recalculated-description" className="visually-hidden">
        Recalculated
      </span>
      <div className="column-headings" aria-hidden="true">
        <div className="row-number" />
        {Array.from({ length: LIMITS.maxColumns }, (_unused, index) => (
          <div key={index} className="column-heading numerals">
            {columnLetter(index + 1)}
          </div>
        ))}
      </div>
      <div
        className="grid-scroll"
        ref={scroller}
        onScroll={(event) => setScrollTop((event.target as HTMLDivElement).scrollTop)}
      >
        <div
          role="grid"
          aria-label={`Sheet ${sheetName}`}
          aria-rowcount={LIMITS.maxRows}
          aria-colcount={LIMITS.maxColumns}
          className="grid"
          style={{ height: LIMITS.maxRows * ROW_HEIGHT }}
          onKeyDown={onKeyDown}
          ref={props.gridRef}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}
