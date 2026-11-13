import type { ComponentChildren } from "preact";

interface Column {
  head: string;
  /** stacked records label the value with its column name unless this is the lead cell */
  lead?: boolean;
}

/** A table at 768 and wider; stacked records in a list below. Exactly one of the two exists at a time. */
export function DataTable({ label, columns, rows, wide }: { label: string; columns: Column[]; rows: Array<{ key: string; cells: ComponentChildren[] }>; wide: boolean }) {
  if (wide) {
    return (
      <table aria-label={label} class="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.head} scope="col">
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => (
                <td key={i} class={i === 0 ? "lead" : "num"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <ul aria-label={label} class="records" role="list">
      {rows.map((r) => (
        <li key={r.key}>
          {r.cells.map((cell, i) => (
            <span key={i} class={columns[i]?.lead || i === 0 ? "lead" : "field"}>
              {i === 0 ? null : <span class="field-name">{columns[i]?.head} </span>}
              {cell}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}
