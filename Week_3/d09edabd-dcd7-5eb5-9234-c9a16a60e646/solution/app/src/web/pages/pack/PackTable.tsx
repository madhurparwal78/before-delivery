import { useId, type ReactNode } from 'react';

export interface Column<Row> {
  header: string;
  render: (row: Row) => ReactNode;
  /** Right-aligned figures. */
  numeric?: boolean;
  className?: string;
}

interface Props<Row> {
  title: string;
  columns: Column<Row>[];
  rows: Row[];
}

/** One build-pack table in its own keyboard-reachable region, so a wide table scrolls sideways inside it rather than the page. */
export function PackTable<Row>({ title, columns, rows }: Props<Row>) {
  const heading = useId();
  return (
    <section className="pack-section">
      <h2 id={heading}>{title}</h2>
      <div className="table-region" role="region" aria-label={`${title} table`} tabIndex={0}>
        <table className="pack-table" aria-labelledby={heading}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.header} scope="col" className={column.numeric ? 'numeric' : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="none">
                  None
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.header} className={[column.numeric && 'numeric', column.className].filter(Boolean).join(' ') || undefined}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
