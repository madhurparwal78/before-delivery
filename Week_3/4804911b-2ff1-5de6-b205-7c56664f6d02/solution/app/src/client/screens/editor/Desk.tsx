import { memo } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import { rupees } from "../../../shared/copy";
import type { Catalogue, Sheet, SheetRow } from "../../../shared/types";
import { Slide } from "../../lib/Slide";

export type RowKey = `${string}-${number}`;
export const isOpen = (r: SheetRow): boolean => r.status === "ambiguous" || r.status === "unmatched";
const keyOf = (sheet: Sheet, row: SheetRow): RowKey => `${sheet.id}-${row.rowNumber}`;

/** The next open row after the one last focused: sheets in import order, rows in row order, wrapping. */
export function nextOpenAfter(sheets: Sheet[], last: RowKey | null): RowKey | null {
  const all = sheets.flatMap((s) => (s.rows ?? []).filter(isOpen).map((r) => keyOf(s, r)));
  if (all.length === 0) return null;
  if (!last) return all[0]!;
  const everyRow = sheets.flatMap((s) => (s.rows ?? []).map((r) => keyOf(s, r)));
  const from = everyRow.indexOf(last);
  const open = new Set(all);
  for (let i = 1; i <= everyRow.length; i++) {
    const candidate = everyRow[(from + i) % everyRow.length]!;
    if (open.has(candidate)) return candidate;
  }
  return all[0]!;
}

interface Option { value: string; label: string }

const REASON: Record<string, string> = {
  no_pack_size: "No pack size in the description.",
  several_sizes: "Several pack sizes in the description.",
  case_pack: "A case pack; the price may be per case.",
  no_drink: "No drink fits the description.",
  no_pack: "That drink has no such pack.",
  unreadable_values: "The price or rates can't be read. This row can only be ignored.",
  conflicting_prices: "Rows for this pack disagree on the price.",
};

const OpenRow = memo(function OpenRow({ sheetId, filename, row, choice, options, optionsKey, onChoice, onSettle, onIgnore }: {
  sheetId: string; filename: string; row: SheetRow; choice: string; options: Option[]; optionsKey: string;
  onChoice: (key: string, value: string) => void; onSettle: (row: SheetRow, sku: string) => void; onIgnore: (row: SheetRow) => void;
}) {
  const n = row.rowNumber;
  const key = `${sheetId}-${n}`;
  return (
    <li class="desk-row" data-row={key} data-options={optionsKey}>
      <p class="desk-desc">{row.raw.description || row.raw.code}</p>
      <p class="desk-meta">
        {filename} · row {n} · {row.newMrpPaise === null ? row.raw.newMrp : `Rs ${rupees(row.newMrpPaise)}`}
        {row.candidates.length > 0 && !row.reason ? ` · could be ${row.candidates.join(", ")}` : ""}
      </p>
      {row.reason && <p class="desk-meta">{REASON[row.reason]}</p>}
      <div class="desk-controls">
        <select aria-label={`Settle row ${n} to`} data-keep={`combo-${key}`} value={choice} onChange={(e) => onChoice(key, (e.currentTarget as HTMLSelectElement).value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" class="rect-button small" aria-label={`Settle row ${n}`} data-keep={`settle-${key}`} onClick={() => onSettle(row, choice)}>
          <span aria-hidden="true">Settle</span>
        </button>
        <button type="button" class="rect-button small" aria-label={`Ignore row ${n}`} data-keep={`ignore-${key}`} onClick={() => onIgnore(row)}>
          <span aria-hidden="true">Ignore</span>
        </button>
      </div>
    </li>
  );
}, (a, b) => a.row.status === b.row.status && a.row.reason === b.row.reason && a.choice === b.choice && a.optionsKey === b.optionsKey && a.filename === b.filename);

const SETTLED_LINE = (r: SheetRow): string => (r.ignored ? "Ignored" : r.status === "settled" ? `Settled to ${r.skuCode}` : r.mergedIntoRow ? `Merged into row ${r.mergedIntoRow}` : `Matched to ${r.skuCode}`);

export function Desk({ sheets, catalogue, status, onImport, onSettle }: {
  sheets: Sheet[] | null; catalogue: Catalogue | null; status: string; onImport: (file: File | null) => void;
  onSettle: (sheet: Sheet, row: SheetRow, body: { skuCode: string } | { ignore: true }) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const options: Option[] = (catalogue?.drinks ?? []).flatMap((d) => d.skus.map((s) => ({ value: s.code, label: `${s.code} ${s.name}` })));
  const optionsKey = options.map((o) => o.label).join("|");
  const list = sheets ?? [];
  const onChoice = (key: string, value: string) => setChoices((c) => ({ ...c, [key]: value }));
  const section = (name: "Ambiguous" | "Unmatched", want: SheetRow["status"]) => {
    const rows = list.flatMap((s) => (s.rows ?? []).filter((r) => r.status === want).map((r) => ({ sheet: s, row: r })));
    return (
      <section role="region" aria-label={name} class="desk-section">
        <h3>{name}</h3>
        <ul role="list" class="desk-rows">
          {rows.map(({ sheet, row }) => {
            const key = keyOf(sheet, row);
            const choice = choices[key] ?? row.candidates[0] ?? options[0]?.value ?? "";
            return <OpenRow key={key} sheetId={sheet.id} filename={sheet.filename} row={row} choice={choice} options={options} optionsKey={optionsKey} onChoice={onChoice} onSettle={(r, sku) => onSettle(sheet, r, { skuCode: sku })} onIgnore={(r) => onSettle(sheet, r, { ignore: true })} />;
          })}
        </ul>
      </section>
    );
  };
  return (
    <section class="import-desk" aria-label="Import desk">
      <h2>Import desk</h2>
      <form
        class="block"
        onSubmit={(e) => {
          e.preventDefault();
          onImport(file.current?.files?.[0] ?? null);
        }}
      >
        <label for="price-sheet-file">Price sheet file</label>
        <input id="price-sheet-file" ref={file} type="file" />
        <button type="submit" class="rect-button">
          Import sheet
        </button>
        <div role="status" aria-label="Import status" class="status">
          {status}
        </div>
      </form>
      {sheets && sheets.length === 0 && <Slide line="CALL SHEET EMPTY" sentence="Import the plant's price sheet to begin." tone="charcoal" />}
      <section role="region" aria-label="Matched" class="desk-section">
        <h3>Matched</h3>
        {list.map((s) => {
          const done = (s.rows ?? []).filter((r) => !isOpen(r));
          return (
            <details key={s.id} class="matched-sheet">
              <summary>
                {s.filename}: {done.length} of {s.rowCount} rows
              </summary>
              <ul role="list" class="matched-rows">
                {done.map((r) => (
                  <li key={r.rowNumber}>
                    Row {r.rowNumber}: {r.raw.description || r.raw.code}. {SETTLED_LINE(r)}.
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </section>
      {section("Ambiguous", "ambiguous")}
      {section("Unmatched", "unmatched")}
    </section>
  );
}
