import { useEffect, useRef, useState } from 'react';
import { displayPretty, displayValue } from '../../shared/json';
import { DocObject } from '../../shared/values';
import { JsonBlock } from './JsonBlock';

export type ResultView = 'List' | 'Table' | 'JSON';

/** Columns are `_id` first, then the page's other top-level names in code-unit order. */
export function gridColumns(docs: DocObject[]): string[] {
  const names = new Set<string>();
  let hasId = false;
  for (const doc of docs) {
    for (const key of Object.keys(doc)) {
      if (key === '_id') hasId = true;
      else names.add(key);
    }
  }
  const rest = Array.from(names).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return hasId ? ['_id', ...rest] : rest;
}

export function ViewSwitch({ view, onChange }: { view: ResultView; onChange: (view: ResultView) => void }): JSX.Element {
  const views: ResultView[] = ['List', 'Table', 'JSON'];
  const move = (step: number): void => {
    const next = views[(views.indexOf(view) + step + views.length) % views.length];
    onChange(next);
  };
  return (
    <div className="radio-group" role="radiogroup" aria-label="View">
      {views.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={view === name}
          tabIndex={view === name ? 0 : -1}
          onClick={() => onChange(name)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              move(1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function ResultsView({
  view,
  docs,
  ids,
  onOpen,
}: {
  view: ResultView;
  docs: DocObject[];
  ids: string[];
  onOpen: (docId: string) => void;
}): JSX.Element {
  if (view === 'List') {
    return (
      <ul className="doc-list" aria-label="Documents">
        {docs.map((doc, row) => (
          <li
            key={ids[row] ?? row}
            data-doc-id={ids[row]}
            tabIndex={0}
            onClick={() => onOpen(ids[row])}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onOpen(ids[row]);
            }}
          >
            {Object.keys(doc).map((field) => (
              <span className="line" key={field}>
                {field}: {displayValue(doc[field])}
              </span>
            ))}
          </li>
        ))}
      </ul>
    );
  }
  if (view === 'JSON') {
    return (
      <div role="region" aria-label="JSON results">
        {docs.map((doc, row) => (
          <JsonBlock key={ids[row] ?? row} docId={ids[row]} text={displayPretty(doc)} />
        ))}
      </div>
    );
  }
  return <ResultsGrid docs={docs} ids={ids} onOpen={onOpen} />;
}

function ResultsGrid({
  docs,
  ids,
  onOpen,
}: {
  docs: DocObject[];
  ids: string[];
  onOpen: (docId: string) => void;
}): JSX.Element {
  const columns = gridColumns(docs);
  const [active, setActive] = useState<{ row: number; column: number }>({ row: 0, column: 0 });
  const wrap = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    setActive({ row: 0, column: 0 });
  }, [ids.join(','), columns.join(',')]);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const cell = wrap.current?.querySelector<HTMLElement>(
      `[data-cell="${active.row}-${active.column}"]`,
    );
    cell?.focus();
  }, [active]);

  const step = (rowStep: number, columnStep: number): void => {
    setActive((current) => ({
      row: Math.min(Math.max(current.row + rowStep, 0), Math.max(docs.length - 1, 0)),
      column: Math.min(Math.max(current.column + columnStep, 0), Math.max(columns.length - 1, 0)),
    }));
    moved.current = true;
  };

  const onKeyDown = (event: React.KeyboardEvent, row: number): void => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        step(0, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        step(0, -1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        step(1, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(-1, 0);
        break;
      case 'Home':
        event.preventDefault();
        setActive((current) => ({ ...current, column: 0 }));
        moved.current = true;
        break;
      case 'End':
        event.preventDefault();
        setActive((current) => ({ ...current, column: columns.length - 1 }));
        moved.current = true;
        break;
      case 'Enter':
        event.preventDefault();
        onOpen(ids[row]);
        break;
      default:
        break;
    }
  };

  return (
    <div className="grid-wrap" ref={wrap}>
      <table className="grid" role="grid" aria-label="Documents">
        <thead>
          <tr role="row">
            {columns.map((column) => (
              <th key={column} role="columnheader" scope="col" data-field-path={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map((doc, row) => (
            <tr key={ids[row] ?? row} role="row" data-doc-id={ids[row]}>
              {columns.map((column, columnIndex) => (
                <td
                  key={column}
                  role="gridcell"
                  data-doc-id={ids[row]}
                  data-field-path={column}
                  data-cell={`${row}-${columnIndex}`}
                  tabIndex={active.row === row && active.column === columnIndex ? 0 : -1}
                  onKeyDown={(event) => onKeyDown(event, row)}
                  onFocus={() => setActive({ row, column: columnIndex })}
                  onClick={() => onOpen(ids[row])}
                >
                  {Object.prototype.hasOwnProperty.call(doc, column) ? displayValue(doc[column]) : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}): JSX.Element {
  return (
    <div className="pager">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous page
      </button>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next page
      </button>
      <span className="count">
        Page {page} of {pages}
      </span>
    </div>
  );
}
