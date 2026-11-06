import type { ReactNode } from 'react';

export interface Column<T> {
  label: string;
  num?: boolean;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  onSelect,
  selectedKey,
  empty,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onSelect?: (row: T) => void;
  selectedKey?: string | null;
  empty?: string;
}): ReactNode {
  if (rows.length === 0) {
    return (
      <>
        <div className="table-wrap">
          <table className="stacked" aria-label={label}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.label} className={column.num ? 'num' : undefined} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody />
          </table>
        </div>
        <p className="empty">{empty ?? 'Nothing here yet.'}</p>
      </>
    );
  }
  return (
    <div className="table-wrap">
      <table className="stacked" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} className={column.num ? 'num' : undefined} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                aria-selected={selectedKey === undefined ? undefined : selectedKey === key}
                onClick={onSelect ? () => onSelect(row) : undefined}
                style={onSelect ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.label}
                    data-label={column.label}
                    className={column.num ? 'num' : undefined}
                  >
                    {column.render(row)}
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
