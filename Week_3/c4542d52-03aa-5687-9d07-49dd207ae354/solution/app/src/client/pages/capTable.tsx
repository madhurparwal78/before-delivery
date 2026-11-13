import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CapTable, CapTableRow, LedgerEntry, Pool } from "../../shared/types.js";
import { displayInstant, groupThousands } from "../../shared/format.js";
import { ApiFailure, api } from "../api.js";
import { announce } from "../announce.js";
import { useResource, useSocketGate } from "../hooks.js";
import { Link, queryOf, replaceAddress, requestFocus } from "../router.js";
import { useSession } from "../session.js";
import { Band, LabelledValue, TextField, ScrollRegion } from "../ui.js";

type Column = { key: "holder" | "issued_shares" | "options_outstanding" | "fully_diluted" | "ownership"; label: string };
const COLUMNS: Column[] = [
  { key: "holder", label: "Holder" },
  { key: "issued_shares", label: "Issued shares" },
  { key: "options_outstanding", label: "Options outstanding" },
  { key: "fully_diluted", label: "Fully diluted" },
  { key: "ownership", label: "Ownership" },
];

type Cell = { row: string; col: number };
const TOTAL = "total";
const HEADER = "header";

function valueOf(row: CapTableRow, column: Column["key"]): number | string {
  switch (column) {
    case "holder":
      return row.label.toLowerCase();
    case "ownership":
      return Number.parseInt(row.ownership.replace(".", ""), 10);
    default:
      return row[column];
  }
}

function sortedRows(rows: CapTableRow[], sort: Column["key"] | null, dir: "asc" | "desc"): CapTableRow[] {
  if (!sort) return rows;
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = valueOf(a, sort);
    const right = valueOf(b, sort);
    return left < right ? -factor : left > right ? factor : 0;
  });
}

const isColumn = (value: string | null): value is Column["key"] => COLUMNS.some((column) => column.key === value);
const selectable = (row: CapTableRow) => row.key !== "pool" && row.key !== "others";

export function CapTablePage({ search }: { search: string }) {
  const { person } = useSession();
  const admin = person.role === "founder_admin";
  const table = useResource<CapTable>("/api/cap-table", ["registry"]);
  const pool = useResource<Pool>(admin ? "/api/pool" : null, ["registry"]);
  const params = queryOf(search);
  const initialSort = params.get("sort");
  const [sort, setSort] = useState<Column["key"] | null>(isColumn(initialSort) ? initialSort : null);
  const [dir, setDir] = useState<"asc" | "desc">(params.get("dir") === "asc" ? "asc" : "desc");
  const [holder, setHolder] = useState<string | null>(params.get("holder"));
  const [active, setActive] = useState<Cell>({ row: "", col: 0 });
  const gridRef = useRef<HTMLTableElement>(null);
  const hasFocus = useRef(false);

  const rows = sortedRows(table.data?.rows ?? [], sort, dir);
  const activeRow = active.row === "" ? rows[0]?.key ?? TOTAL : active.row;
  const rowKeys = [HEADER, ...rows.map((row) => row.key), TOTAL];

  const address = (nextSort: Column["key"] | null, nextDir: "asc" | "desc", nextHolder: string | null): string => {
    const query = new URLSearchParams();
    if (nextSort) {
      query.set("sort", nextSort);
      query.set("dir", nextDir);
    }
    if (nextHolder) query.set("holder", nextHolder);
    const text = query.toString();
    return text ? `/cap-table?${text}` : "/cap-table";
  };

  const focusCell = (cell: Cell) => {
    setActive(cell);
    const element = gridRef.current?.querySelector<HTMLElement>(`[data-r="${cell.row}"][data-c="${cell.col}"]`);
    element?.focus();
    element?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };

  const applySort = (column: Column["key"]) => {
    const nextDir = sort === column ? (dir === "desc" ? "asc" : "desc") : column === "holder" ? "asc" : "desc";
    setSort(column);
    setDir(nextDir);
    replaceAddress(address(column, nextDir, holder));
  };

  const select = (key: string | null) => {
    setHolder(key);
    replaceAddress(address(sort, dir, key));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!target) return;
    const row = target.dataset.r ?? "";
    const col = Number.parseInt(target.dataset.c ?? "0", 10);
    const at = rowKeys.indexOf(row);
    const lastCol = COLUMNS.length - 1;
    const first = rows[0]?.key ?? TOTAL;
    const go = (cell: Cell) => {
      event.preventDefault();
      focusCell(cell);
    };
    switch (event.key) {
      case "ArrowRight":
        return go({ row, col: Math.min(lastCol, col + 1) });
      case "ArrowLeft":
        return go({ row, col: Math.max(0, col - 1) });
      case "ArrowDown":
        return go({ row: rowKeys[Math.min(rowKeys.length - 1, at + 1)] ?? row, col });
      case "ArrowUp":
        return go({ row: rowKeys[Math.max(0, at - 1)] ?? row, col });
      case "Home":
        return go(event.ctrlKey ? { row: first, col: 0 } : { row, col: 0 });
      case "End":
        return go(event.ctrlKey ? { row: TOTAL, col: lastCol } : { row, col: lastCol });
      case "Escape":
        if (holder) {
          event.preventDefault();
          select(null);
        }
        return;
      case "Enter":
      case " ": {
        event.preventDefault();
        const column = COLUMNS[col];
        if (row === HEADER && column) applySort(column.key);
        else if (admin && col === 0 && event.key === "Enter") {
          const data = rows.find((candidate) => candidate.key === row);
          if (data && selectable(data)) select(holder === data.key ? null : data.key);
        }
        return;
      }
    }
  };

  // A live redraw keeps focus on the same row and column; a vanished row hands it to the same column of the Total row.
  useLayoutEffect(() => {
    if (!hasFocus.current || !table.data) return;
    const grid = gridRef.current;
    if (!grid) return;
    const exists = rowKeys.includes(active.row);
    const target = exists ? active : { row: TOTAL, col: active.col };
    if (!exists) setActive(target);
    const element = grid.querySelector<HTMLElement>(`[data-r="${target.row}"][data-c="${target.col}"]`);
    if (element && document.activeElement !== element) element.focus();
  });

  useLayoutEffect(() => {
    if (holder && table.data && !hasFocus.current && params.get("holder") === holder) {
      setActive({ row: holder, col: 0 });
      requestFocus(`[data-r="${holder}"][data-c="0"]`);
    }
  }, [Boolean(table.data)]);

  if (!table.data) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  const data = table.data;
  const selected = holder ? rows.find((row) => row.key === holder) : undefined;
  const totals = { issued: rows.reduce((sum, row) => sum + row.issued_shares, 0), options: rows.reduce((sum, row) => sum + row.options_outstanding, 0) };

  const cellProps = (rowKey: string, col: number) => ({
    "data-r": rowKey,
    "data-c": col,
    tabIndex: activeRow === rowKey && active.col === col ? 0 : -1,
    onFocus: () => {
      hasFocus.current = true;
      if (active.row !== rowKey || active.col !== col) setActive({ row: rowKey, col });
    },
  });

  return (
    <main className="chapter">
      <section className="sheet">
        <p className="note">{person.name}</p>
        <h1 tabIndex={-1}>Cap table</h1>
        <p className="lede">Ownership always sums to 100.00.</p>
      </section>
      <section className="sheet wide">
        <div className="grid-region">
          <table
            role="grid"
            aria-label="Cap table"
            className="cap-grid"
            ref={gridRef}
            onKeyDown={onKeyDown}
            onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) hasFocus.current = false;
            }}
          >
            <thead>
              <tr role="row">
                {COLUMNS.map((column, col) => (
                  <th
                    key={column.key}
                    scope="col"
                    role="columnheader"
                    aria-sort={sort === column.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                    className={col === 0 ? "" : "num"}
                    onClick={() => applySort(column.key)}
                    {...cellProps(HEADER, col)}
                  >
                    {column.label}
                    <span className="sort-mark" aria-hidden="true">
                      {sort === column.key ? (dir === "asc" ? " ▲" : " ▼") : ""}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} role="row" className={holder === row.key ? "selected" : undefined}>
                  <td role="gridcell" {...cellProps(row.key, 0)}>
                    {row.label}
                  </td>
                  <td role="gridcell" className="num" {...cellProps(row.key, 1)}>
                    {groupThousands(row.issued_shares)}
                  </td>
                  <td role="gridcell" className="num" {...cellProps(row.key, 2)}>
                    {groupThousands(row.options_outstanding)}
                  </td>
                  <td role="gridcell" className="num" {...cellProps(row.key, 3)}>
                    {groupThousands(row.fully_diluted)}
                  </td>
                  <td role="gridcell" className="num" {...cellProps(row.key, 4)}>
                    {row.ownership}
                  </td>
                </tr>
              ))}
              <tr role="row" className="total">
                <td role="gridcell" {...cellProps(TOTAL, 0)}>
                  Total
                </td>
                <td role="gridcell" className="num" {...cellProps(TOTAL, 1)}>
                  {groupThousands(totals.issued)}
                </td>
                <td role="gridcell" className="num" {...cellProps(TOTAL, 2)}>
                  {groupThousands(totals.options)}
                </td>
                <td role="gridcell" className="num" {...cellProps(TOTAL, 3)}>
                  {groupThousands(data.fully_diluted_total)}
                </td>
                <td role="gridcell" className="num total-figure" {...cellProps(TOTAL, 4)}>
                  {data.total_ownership}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      {admin && selected && <HolderDetail row={selected} />}
      {admin && pool.data && <PoolPanel pool={pool.data} />}
    </main>
  );
}

function HolderDetail({ row }: { row: CapTableRow }) {
  const ledger = useResource<{ entries: LedgerEntry[] }>("/api/ledger", ["registry"]);
  const entries = ledger.data?.entries.filter((entry) => entry.holder_id === row.key) ?? [];
  return (
    <section className="sheet" aria-label="Holder detail">
      <p className="note">Every change to this holder's shares and options.</p>
      <h2>{row.label}</h2>
      <ScrollRegion label="Holder ledger scroll area">
        <table aria-label="Holder ledger" className="plain-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Entry</th>
              <th scope="col">Class</th>
              <th scope="col" className="num">
                Shares
              </th>
              <th scope="col" className="num">
                Options
              </th>
              <th scope="col">Reference</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{displayInstant(entry.at)}</td>
                <td>{entry.kind.replace(/_/g, " ")}</td>
                <td>{entry.class ?? "—"}</td>
                <td className="num">{groupThousands(entry.shares_delta)}</td>
                <td className="num">{groupThousands(entry.options_delta)}</td>
                <td>{entry.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </section>
  );
}

function PoolPanel({ pool }: { pool: Pool }) {
  const gate = useSocketGate();
  const [size, setSize] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const resize = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const digits = size.replace(/,/g, "");
      const next = await api<Pool>("PATCH", "/api/pool", { authorized: /^\d+$/.test(digits) ? Number.parseInt(digits, 10) : size });
      announce(`Option pool resized to ${groupThousands(next.authorized)} options.`);
      setSize("");
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setError(failure.fields.authorized ?? failure.body.error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sheet" aria-label="Option pool">
      <p className="note">
        The pool is the options the company can still grant.
        <br />
        <Link href="/admin/ledger">Securities ledger</Link>
      </p>
      <div className="figures">
        <LabelledValue label="Authorized">{groupThousands(pool.authorized)}</LabelledValue>
        <LabelledValue label="Outstanding">{groupThousands(pool.outstanding)}</LabelledValue>
        <LabelledValue label="Exercised">{groupThousands(pool.exercised)}</LabelledValue>
        <LabelledValue label="Reserved">{groupThousands(pool.reserved)}</LabelledValue>
        <LabelledValue label="Available">{groupThousands(pool.available)}</LabelledValue>
      </div>
      <form
        className="form-column"
        onSubmit={(event) => {
          event.preventDefault();
          void resize();
        }}
      >
        <TextField label="Pool size" value={size} inputMode="numeric" error={error} onValue={setSize} />
        <button type="submit" className="button button-secondary" disabled={gate || busy}>
          Resize pool
        </button>
      </form>
    </section>
  );
}
