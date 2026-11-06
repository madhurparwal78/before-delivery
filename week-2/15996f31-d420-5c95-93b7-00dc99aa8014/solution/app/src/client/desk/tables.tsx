// Tables that turn into labelled cards at phone width; explicit roles keep their semantics when restyled.

import type { ReactNode } from "react";

export interface Column<T> {
  label: string;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
}

export function DataTable<T>({ label, columns, rows, rowKey }: { label: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T, index: number) => string }) {
  return (
    <table className="data-table" aria-label={label} role="table">
      <thead role="rowgroup">
        <tr role="row">
          {columns.map((column) => (
            <th key={column.label} scope="col" role="columnheader" className={column.numeric ? "num" : undefined}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row, index) => (
          <tr key={rowKey(row, index)} role="row">
            {columns.map((column) => (
              <td key={column.label} role="cell" data-label={column.label} className={column.numeric ? "num" : undefined}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="empty">
      {icon}
      <span>{children}</span>
    </p>
  );
}
