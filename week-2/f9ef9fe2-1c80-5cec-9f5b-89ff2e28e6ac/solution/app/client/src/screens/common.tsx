import type { ReactNode } from "react";

// Shared pieces of the secondary screens: the page frame, the form status region and the
// editorial table (rows turn into stacked cards below 768 px through their data-label cells).

export function Page({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>{title}</h1>
        {actions}
      </header>
      {children}
    </div>
  );
}

export interface FormState {
  text: string;
  tone: "info" | "success" | "error";
}

export function FormStatus({ state }: { state: FormState | null }) {
  return (
    <p role="status" aria-label="Form status" className={`form-status ${state?.tone ?? ""}`}>
      {state?.text ?? ""}
    </p>
  );
}

interface Column<T> {
  label: string;
  numeric?: boolean;
  cell: (row: T) => ReactNode;
}

export function Table<T>({
  label,
  columns,
  rows,
  rowKey,
  empty,
  loading,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
  loading?: boolean;
}) {
  return (
    <table aria-label={label} className="table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.label} scope="col" className={c.numeric ? "num" : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((c) => (
              <td key={c.label} data-label={c.label} className={c.numeric ? "num" : undefined}>
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr className="empty-row">
            <td colSpan={columns.length}>{loading ? "Loading…" : empty}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function StateBadge({ state }: { state: string }) {
  return <span className={`badge s-${state}`}>{state.replace(/_/g, " ")}</span>;
}
