import { Fragment, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { PHONE_MAX_WIDTH } from "../../../shared/domain.js";

/** A ruled list: a table from 768 px up, stacked article cards below. Never both. */

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  /** An actions column has no label of its own in the cards. */
  actions?: boolean;
}

interface ListProps<T> {
  label: string;
  rows: T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  /** A panel directly under its row (the refund form). */
  detail?: (row: T) => ReactNode;
  /** The sentence shown when there are no rows. */
  empty?: string;
}

const PHONE = `(max-width: ${PHONE_MAX_WIDTH}px)`;

const subscribe = (listener: () => void): (() => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

const onPhone = (): boolean => window.matchMedia(PHONE).matches;

export const rowStyle = (index: number): CSSProperties => ({ "--row-index": Math.min(index, 9) }) as CSSProperties;

export const StaffList = <T,>({ label, rows, rowKey, columns, detail, empty }: ListProps<T>) => {
  const stacked = useSyncExternalStore(subscribe, onPhone);
  if (stacked) {
    const [title, ...rest] = columns;
    return (
      <div className="staff-cards" role="group" aria-label={label}>
        {rows.map((row, index) => (
          <article key={rowKey(row)} className="staff-card" data-motion="row" style={rowStyle(index)}>
            {title ? <div className="staff-card__title">{title.cell(row)}</div> : null}
            <dl>
              {rest.filter((column) => !column.actions).map((column) => (
                <div key={column.header} className="staff-card__pair">
                  <dt>{column.header}</dt>
                  <dd>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {rest.filter((column) => column.actions).map((column) => (
              <div key={column.header} className="staff-card__actions">{column.cell(row)}</div>
            ))}
            {detail?.(row)}
          </article>
        ))}
        {rows.length === 0 && empty ? <p className="muted">{empty}</p> : null}
      </div>
    );
  }
  return (
    <div className="staff-scroll" tabIndex={0} role="group" aria-label={`${label}, scrollable`}>
      <table className="staff-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col">{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const panel = detail?.(row);
            return (
              <Fragment key={rowKey(row)}>
                <tr data-motion="row" style={rowStyle(index)}>
                  {columns.map((column) => <td key={column.header}>{column.cell(row)}</td>)}
                </tr>
                {panel ? <tr className="staff-detail"><td colSpan={columns.length}>{panel}</td></tr> : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && empty ? <p className="muted staff-empty">{empty}</p> : null}
    </div>
  );
};
