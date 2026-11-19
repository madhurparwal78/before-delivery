import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { displayCell } from "../../shared/display.js";
import type { JsonObject } from "../../shared/json.js";
import { JsonCode } from "../components/JsonCode.js";

/** The three views of one page of results; every row, item and block carries `data-doc-id` from the answer's ids. */

interface Page {
  documents: JsonObject[];
  ids: string[];
}

type Open = (id: string, opener: HTMLElement) => void;

const activate = (open: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === "Enter" || event.key === " ") {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    open();
  }
};

export function ListView({ page, open }: { page: Page; open: Open }): ReactNode {
  return (
    <ul className="doc-list" role="list" aria-label="Documents">
      {page.documents.map((doc, index) => {
        const id = page.ids[index] as string;
        return (
          <li key={id} className="doc-item" data-doc-id={id} tabIndex={0} onClick={(event) => open(id, event.currentTarget)} onKeyDown={activate(() => open(id, document.activeElement as HTMLElement))}>
            {Object.entries(doc).map(([key, value]) => (
              <div className="doc-line" key={key}>
                {key}: {displayCell(value)}
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

export function JsonView({ page, open }: { page: Page; open: Open }): ReactNode {
  return (
    <div className="json-results code-pane" role="region" aria-label="JSON results" tabIndex={0}>
      {page.documents.map((doc, index) => {
        const id = page.ids[index] as string;
        return (
          <pre key={id} className="json-block" data-doc-id={id} tabIndex={0} onClick={(event) => open(id, event.currentTarget)} onKeyDown={activate(() => open(id, document.activeElement as HTMLElement))}>
            <JsonCode value={doc} />
          </pre>
        );
      })}
    </div>
  );
}

/** Columns: `_id` first (when any document has it), then the other top-level names in code-unit order. */
function columnsOf(documents: JsonObject[]): string[] {
  const others = new Set<string>();
  for (const doc of documents) for (const key of Object.keys(doc)) if (key !== "_id") others.add(key);
  const sorted = [...others].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return documents.some((doc) => "_id" in doc) ? ["_id", ...sorted] : sorted;
}

export function TableView({ page, open }: { page: Page; open: Open }): ReactNode {
  const columns = columnsOf(page.documents);
  const [active, setActive] = useState<{ id: string; field: string } | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const firstId = page.ids[0];
  const firstColumn = columns[0];
  const current =
    active && page.ids.includes(active.id) && columns.includes(active.field) ? active : firstId !== undefined && firstColumn !== undefined ? { id: firstId, field: firstColumn } : null;

  const go = (id: string, field: string): void => {
    setActive({ id, field });
    cells.current.get(`${id}\u0000${field}`)?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLElement>, id: string, field: string): void => {
    const row = page.ids.indexOf(id);
    const col = columns.indexOf(field);
    const target =
      event.key === "ArrowRight" ? [row, col + 1]
      : event.key === "ArrowLeft" ? [row, col - 1]
      : event.key === "ArrowDown" ? [row + 1, col]
      : event.key === "ArrowUp" ? [row - 1, col]
      : event.key === "Home" ? [row, 0]
      : event.key === "End" ? [row, columns.length - 1]
      : null;
    if (event.key === "Enter") {
      event.preventDefault();
      open(id, event.currentTarget);
    } else if (target) {
      event.preventDefault();
      const [nextRow, nextCol] = target as [number, number];
      const nextId = page.ids[nextRow];
      const nextField = columns[nextCol];
      if (nextId !== undefined && nextField !== undefined) go(nextId, nextField);
    }
  };

  return (
    <div className="table-scroll">
      <table className="doc-table" role="grid" aria-label="Documents">
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
          {page.documents.map((doc, index) => {
            const id = page.ids[index] as string;
            return (
              <tr key={id} role="row" data-doc-id={id}>
                {columns.map((column) => (
                  <td
                    key={column}
                    role="gridcell"
                    data-doc-id={id}
                    data-field-path={column}
                    tabIndex={current?.id === id && current.field === column ? 0 : -1}
                    ref={(node) => {
                      const key = `${id}\u0000${column}`;
                      if (node) cells.current.set(key, node);
                      else cells.current.delete(key);
                    }}
                    onFocus={() => setActive({ id, field: column })}
                    onClick={(event) => open(id, event.currentTarget)}
                    onKeyDown={(event) => onKey(event, id, column)}
                  >
                    {displayCell(doc[column])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
