// A table that keeps its table semantics when it stacks into cards below 1120 px (explicit roles survive the
// display change), and always renders, with its accessible name, even when it is empty.
import type { ComponentChildren } from "preact";
import { Icon } from "./Icon";

interface Column {
  label: string;
  /** Right-aligned figures (amounts, counts). */
  figures?: boolean;
  /** A fixed width from 1120 px; the columns without one share what is left. */
  width?: string;
}

interface Row {
  key: string;
  cells: ComponentChildren[];
  class?: string;
}

export function Table({ label, columns, rows, stack = true }: { label: string; columns: Column[]; rows: Row[]; stack?: boolean }) {
  const fixed = columns.some((c) => c.width);
  return (
    <div class={`table-wrap${stack ? " table-stacks" : ""}`}>
      <table role="table" aria-label={label} class={`table${fixed ? " table-fixed" : ""}`}>
        {fixed && <colgroup>{columns.map((c) => <col key={c.label} style={c.width ? { width: c.width } : undefined} />)}</colgroup>}
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((c) => <th role="columnheader" scope="col" key={c.label} class={c.figures ? "figures" : undefined}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.length === 0 ? (
            <tr role="row" class="row-empty">
              <td role="cell" colSpan={columns.length}><Empty /></td>
            </tr>
          ) : rows.map((r) => (
            <tr role="row" key={r.key} class={r.class}>
              {r.cells.map((cell, i) => (
                <td role="cell" key={columns[i].label} data-label={columns[i].label} class={columns[i].figures ? "figures" : undefined}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ text = "Nothing here yet." }: { text?: string }) {
  return (
    <span class="empty">
      <Icon name="ring" size={18} />
      <span>{text}</span>
    </span>
  );
}

/** An instant in the screen date-time format that breaks after the date's comma when its column is narrow. */
export function When({ text }: { text: string }) {
  const comma = text.indexOf(", ");
  return <span class="fig when"><span>{text.slice(0, comma + 1)}</span> <span>{text.slice(comma + 2)}</span></span>;
}

/** Figures (amounts, LEIs, addresses, instants) in IBM Plex Mono with tabular digits. */
export function Fig({ children }: { children: ComponentChildren }) {
  return <span class="fig">{children}</span>;
}
