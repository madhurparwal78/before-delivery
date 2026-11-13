import type { CapTable, CapTableRow, LedgerEntry, LiveEvent, Pool } from "../../shared/types.js";
import { formatCount, formatInstant } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, applySocketState, replaceAddress, signedInAs, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";
import { scrollCellIntoTrack } from "../ui/motion.js";

type ColumnKey = "holder" | "issued_shares" | "options_outstanding" | "fully_diluted" | "ownership";

const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: "holder", label: "Holder" },
  { key: "issued_shares", label: "Issued shares" },
  { key: "options_outstanding", label: "Options outstanding" },
  { key: "fully_diluted", label: "Fully diluted" },
  { key: "ownership", label: "Ownership" },
];

function cellText(row: CapTableRow, key: ColumnKey): string {
  switch (key) {
    case "holder":
      return row.label;
    case "issued_shares":
      return formatCount(row.issued_shares);
    case "options_outstanding":
      return formatCount(row.options_outstanding);
    case "fully_diluted":
      return formatCount(row.fully_diluted);
    case "ownership":
      return row.ownership;
  }
}

function sortRows(rows: CapTableRow[], key: ColumnKey, direction: "asc" | "desc"): CapTableRow[] {
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((left, right) => {
    let comparison = 0;
    if (key === "holder") comparison = left.row.label.toLowerCase().localeCompare(right.row.label.toLowerCase(), "en");
    else if (key === "ownership") comparison = Number(left.row.ownership) - Number(right.row.ownership);
    else comparison = left.row[key] - right.row[key];
    if (comparison === 0) return left.index - right.index;
    return direction === "asc" ? comparison : -comparison;
  });
  return indexed.map((item) => item.row);
}

export function capTablePage(context: PageContext): Page {
  let sortKey: ColumnKey | null = null;
  let sortDirection: "asc" | "desc" = "desc";
  let selectedHolder: string | null = null;
  let focusedRow = 0;
  let focusedColumn = 0;
  let table: CapTable | null = null;

  const sortParam = context.query.get("sort");
  const dirParam = context.query.get("dir");
  if (sortParam !== null && COLUMNS.some((column) => column.key === sortParam)) {
    sortKey = sortParam as ColumnKey;
    sortDirection = dirParam === "asc" ? "asc" : "desc";
  }
  selectedHolder = context.query.get("holder");

  function writeAddress(): void {
    const parts: string[] = [];
    if (sortKey !== null) parts.push(`sort=${sortKey}`, `dir=${sortDirection}`);
    if (selectedHolder !== null) parts.push(`holder=${selectedHolder}`);
    replaceAddress(parts.length === 0 ? "/cap-table" : `/cap-table?${parts.join("&")}`);
  }

  function orderedRows(): CapTableRow[] {
    if (table === null) return [];
    const data = table.rows.slice();
    return sortKey === null ? data : sortRows(data, sortKey, sortDirection);
  }

  function focusCell(rowIndex: number, columnIndex: number): void {
    const grid = document.querySelector<HTMLElement>(".cap-grid");
    if (grid === null) return;
    const cells = grid.querySelectorAll<HTMLElement>("[data-row]");
    for (const cell of cells) cell.tabIndex = -1;
    const target = grid.querySelector<HTMLElement>(`[data-row="${rowIndex}"][data-column="${columnIndex}"]`);
    if (target === null) return;
    target.tabIndex = 0;
    target.focus();
    focusedRow = rowIndex;
    focusedColumn = columnIndex;
    const region = grid.closest<HTMLElement>(".cap-region");
    if (region !== null) scrollCellIntoTrack(region, target);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const rows = orderedRows();
    const lastRow = rows.length + 1;
    const lastColumn = COLUMNS.length - 1;
    const key = event.key;
    if (key === "ArrowRight") {
      event.preventDefault();
      focusCell(focusedRow, Math.min(lastColumn, focusedColumn + 1));
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      focusCell(focusedRow, Math.max(0, focusedColumn - 1));
    } else if (key === "ArrowDown") {
      event.preventDefault();
      focusCell(Math.min(lastRow, focusedRow + 1), focusedColumn);
    } else if (key === "ArrowUp") {
      event.preventDefault();
      focusCell(Math.max(0, focusedRow - 1), focusedColumn);
    } else if (key === "Home") {
      event.preventDefault();
      if (event.ctrlKey) focusCell(1, 0);
      else focusCell(focusedRow, 0);
    } else if (key === "End") {
      event.preventDefault();
      if (event.ctrlKey) focusCell(lastRow, lastColumn);
      else focusCell(focusedRow, lastColumn);
    } else if ((key === "Enter" || key === " ") && focusedRow === 0) {
      event.preventDefault();
      const column = COLUMNS[focusedColumn];
      if (column === undefined) return;
      if (sortKey === column.key) sortDirection = sortDirection === "desc" ? "asc" : "desc";
      else {
        sortKey = column.key;
        sortDirection = column.key === "holder" ? "asc" : "desc";
      }
      writeAddress();
      void draw().then(() => focusCell(0, focusedColumn));
    } else if (key === "Enter" && focusedRow > 0) {
      event.preventDefault();
      const row = rows[focusedRow - 1];
      if (row === undefined || focusedColumn !== 0) return;
      if (row.key === "pool" || row.key === "others") return;
      selectedHolder = selectedHolder === row.key ? null : row.key;
      writeAddress();
      const rowIndex = focusedRow;
      void draw().then(() => focusCell(rowIndex, 0));
    } else if (key === "Escape" && selectedHolder !== null) {
      event.preventDefault();
      selectedHolder = null;
      writeAddress();
      const rowIndex = focusedRow;
      const columnIndex = focusedColumn;
      void draw().then(() => focusCell(rowIndex, columnIndex));
    }
  }

  async function drawPool(column: HTMLElement): Promise<void> {
    const pool = await api<Pool>("/api/pool");
    const input = el("input", { type: "text", id: "pool-size", value: String(pool.authorized) }) as HTMLInputElement;
    const resize = liveButton("Resize pool", { class: "primary" });
    const error = el("p", { class: "field-error", hidden: true });
    resize.addEventListener("click", () => {
      void (async () => {
        error.hidden = true;
        try {
          await api<Pool>("/api/pool", { method: "PATCH", body: { authorized: Number(input.value) } });
          announce(`Option pool resized to ${input.value} options.`);
          await draw();
        } catch (failure) {
          if (!(failure instanceof ApiFailure)) throw failure;
          error.hidden = false;
          error.textContent = `Error: ${failure.message}`;
          announce(failure.message);
        }
      })();
    });
    column.append(
      el("section", { class: "pool-panel", role: "region", "aria-label": "Option pool" }, [
        el("div", { class: "labelled" }, [
          el("span", { class: "labelled-label" }, ["Authorized"]),
          el("span", { class: "labelled-value" }, [formatCount(pool.authorized)]),
        ]),
        el("div", { class: "labelled" }, [
          el("span", { class: "labelled-label" }, ["Outstanding"]),
          el("span", { class: "labelled-value" }, [formatCount(pool.outstanding)]),
        ]),
        el("div", { class: "labelled" }, [
          el("span", { class: "labelled-label" }, ["Exercised"]),
          el("span", { class: "labelled-value" }, [formatCount(pool.exercised)]),
        ]),
        el("div", { class: "labelled" }, [
          el("span", { class: "labelled-label" }, ["Reserved"]),
          el("span", { class: "labelled-value" }, [formatCount(pool.reserved)]),
        ]),
        el("div", { class: "labelled" }, [
          el("span", { class: "labelled-label" }, ["Available"]),
          el("span", { class: "labelled-value" }, [formatCount(pool.available)]),
        ]),
        el("div", { class: "field" }, [el("label", { for: "pool-size" }, ["Pool size"]), input, error]),
        resize,
      ]),
    );
  }

  async function drawHolderDetail(column: HTMLElement, holderKey: string, label: string): Promise<void> {
    const result = await api<{ entries: LedgerEntry[] }>("/api/ledger");
    const entries = result.entries.filter((entry) => entry.holder_id === holderKey);
    const body = entries.map((entry) =>
      el("tr", {}, [
        el("td", {}, [formatInstant(entry.at)]),
        el("td", {}, [entry.kind]),
        el("td", {}, [entry.class ?? ""]),
        el("td", {}, [formatCount(entry.shares_delta)]),
        el("td", {}, [formatCount(entry.options_delta)]),
      ]),
    );
    column.append(
      el("section", { class: "holder-detail", role: "region", "aria-label": "Holder detail" }, [
        el("h2", {}, [label]),
        el("table", { class: "ledger-table", "aria-label": "Holder ledger" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { scope: "col" }, ["When"]),
              el("th", { scope: "col" }, ["Entry"]),
              el("th", { scope: "col" }, ["Class"]),
              el("th", { scope: "col" }, ["Shares"]),
              el("th", { scope: "col" }, ["Options"]),
            ]),
          ]),
          el("tbody", {}, body),
        ]),
      ]),
    );
  }

  async function draw(): Promise<void> {
    const me = signedInAs();
    const loaded = await api<CapTable>("/api/cap-table");
    table = loaded;
    const rows = orderedRows();
    clear(context.main);

    const headerCells = COLUMNS.map((column, index) =>
      el(
        "th",
        {
          scope: "col",
          role: "columnheader",
          "aria-sort": sortKey === column.key ? (sortDirection === "asc" ? "ascending" : "descending") : "none",
          "data-row": "0",
          "data-column": String(index),
          tabindex: "-1",
        },
        [column.label],
      ),
    );
    const bodyRows = rows.map((row, rowIndex) =>
      el(
        "tr",
        { role: "row", "data-key": row.key, class: rowIndex % 2 === 1 ? "band-row" : "" },
        COLUMNS.map((column, columnIndex) =>
          el(
            columnIndex === 0 ? "th" : "td",
            {
              role: columnIndex === 0 ? "rowheader" : "gridcell",
              scope: columnIndex === 0 ? "row" : null,
              "data-row": String(rowIndex + 1),
              "data-column": String(columnIndex),
              tabindex: "-1",
            },
            [cellText(row, column.key)],
          ),
        ),
      ),
    );
    const totalRow = el(
      "tr",
      { role: "row", class: "total-row", "data-key": "total" },
      COLUMNS.map((column, columnIndex) =>
        el(
          columnIndex === 0 ? "th" : "td",
          {
            role: columnIndex === 0 ? "rowheader" : "gridcell",
            scope: columnIndex === 0 ? "row" : null,
            "data-row": String(rows.length + 1),
            "data-column": String(columnIndex),
            tabindex: "-1",
          },
          [
            column.key === "holder"
              ? "Total"
              : column.key === "fully_diluted"
                ? formatCount(loaded.fully_diluted_total)
                : column.key === "ownership"
                  ? loaded.total_ownership
                  : "",
          ],
        ),
      ),
    );

    const grid = el("table", { class: "cap-grid", role: "grid", "aria-label": "Cap table" }, [
      el("thead", {}, [el("tr", { role: "row" }, headerCells)]),
      el("tbody", {}, [...bodyRows, totalRow]),
    ]);
    grid.addEventListener("keydown", onKeyDown);
    grid.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const cell = target.closest<HTMLElement>("[data-row]");
      if (cell === null) return;
      focusCell(Number(cell.dataset["row"]), Number(cell.dataset["column"]));
    });

    const column = el("div", { class: "column" }, [
      el("h1", { class: "chapter-title" }, ["Cap table"]),
      el("div", { class: "cap-region" }, [grid]),
    ]);
    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, ["Ownership to two decimals, summing to 100.00."]),
        column,
      ]),
    );

    if (me.role === "founder_admin") {
      if (selectedHolder !== null) {
        const row = rows.find((candidate) => candidate.key === selectedHolder);
        if (row !== undefined) await drawHolderDetail(column, row.key, row.label);
      }
      await drawPool(column);
      column.append(el("a", { href: "/admin/ledger", "data-route": "", class: "ledger-link" }, ["Ledger"]));
    }

    const rowIndex = Math.min(focusedRow, rows.length + 1);
    const cells = grid.querySelectorAll<HTMLElement>("[data-row]");
    for (const cell of cells) cell.tabIndex = -1;
    const resume =
      grid.querySelector<HTMLElement>(`[data-row="${rowIndex}"][data-column="${focusedColumn}"]`) ??
      grid.querySelector<HTMLElement>('[data-row="1"][data-column="0"]');
    if (resume !== null) resume.tabIndex = 0;
    applySocketState();
  }

  return {
    async render(): Promise<void> {
      await draw();
      if (selectedHolder !== null) {
        const rows = orderedRows();
        const index = rows.findIndex((row) => row.key === selectedHolder);
        if (index >= 0) focusCell(index + 1, 0);
      }
    },
    onEvent(event: LiveEvent): void {
      if (event.type === "cap_table" || event.type === "grant_changed" || event.type === "order_changed") {
        const active = document.activeElement;
        const wasInGrid = active instanceof HTMLElement && active.closest(".cap-grid") !== null;
        const activeKey = active instanceof HTMLElement ? active.closest("tr")?.dataset["key"] ?? null : null;
        void draw().then(() => {
          if (!wasInGrid) return;
          const grid = document.querySelector<HTMLElement>(".cap-grid");
          if (grid === null) return;
          const row =
            activeKey === null
              ? null
              : grid.querySelector<HTMLElement>(`tr[data-key="${activeKey}"] [data-column="${focusedColumn}"]`);
          if (row !== null) {
            const rowIndex = Number(row.dataset["row"]);
            focusCell(rowIndex, focusedColumn);
            return;
          }
          const rows = orderedRows();
          focusCell(rows.length + 1, focusedColumn);
        });
      }
    },
  };
}
