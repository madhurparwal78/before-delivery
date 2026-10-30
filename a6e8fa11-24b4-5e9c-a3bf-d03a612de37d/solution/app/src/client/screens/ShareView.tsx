// The sponsor's read-only view of a shared workbook: values, formats and charts, no editing controls.
import { useEffect, useState } from "react";
import { type ChartType } from "../../shared/engine.js";
import { LIMITS } from "../../shared/limits.js";
import { cellName, columnLetter, parseCell } from "../../shared/refs.js";
import { type CellFormat } from "../../shared/values.js";
import { api } from "../api.js";
import { COPY, localTime } from "../copy.js";
import { Mark } from "../ui/Icon.js";
import { ChartFigure } from "../workbook/ChartFigure.js";
import { TabList } from "../workbook/Tabs.js";

interface SharedCell {
  value: number | string | boolean | null;
  display: string;
  format: CellFormat;
  error?: string;
}

interface Shared {
  name: string;
  stationName: string;
  expiresAt: string;
  timeZone: string;
  sheets: Array<{ name: string; position: number; cells: Record<string, SharedCell> }>;
  charts: Array<{ sheetName: string; type: ChartType; title: string; categories: string[]; series: Array<{ name: string; values: Array<number | null> }> }>;
}

const COLS = Array.from({ length: LIMITS.maxColumns }, (_v, i) => i + 1);

function ReadOnlyGrid({ name, cells }: { name: string; cells: Record<string, SharedCell> }): JSX.Element {
  const lastRow = Math.max(12, ...Object.keys(cells).map((c) => parseCell(c)?.row ?? 1)) + 4;
  const rows = Array.from({ length: Math.min(LIMITS.maxRows, lastRow) }, (_v, i) => i + 1);
  return (
    <div className="grid grid-readonly">
      <div className="grid-scroll" tabIndex={0} role="grid" aria-label={`Sheet ${name}`} aria-readonly="true" aria-rowcount={LIMITS.maxRows} aria-colcount={LIMITS.maxColumns}>
        <div className="grid-sheet graph-ground">
          <div role="row" className="grid-head">
            <div className="corner" aria-hidden="true" />
            {COLS.map((c) => (
              <div role="columnheader" className="colhead" key={c}>
                {columnLetter(c)}
              </div>
            ))}
          </div>
          {rows.map((row) => (
            <div role="row" aria-rowindex={row} className="grid-row" key={row}>
              <div role="rowheader" className="rowhead">
                {row}
              </div>
              {COLS.map((col) => {
                const cell = cells[cellName(row, col)];
                const classes = ["cell"];
                if (typeof cell?.value === "number") classes.push("num");
                if (cell?.error) classes.push("err");
                if (cell?.format.bold) classes.push("bold");
                return (
                  <div role="gridcell" aria-colindex={col} className={classes.join(" ")} key={col}>
                    {cell?.display ?? ""}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ShareView({ token }: { token: string }): JSX.Element {
  const [shared, setShared] = useState<Shared | null | undefined>(undefined);
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    api
      .get<{ workbook: Shared }>(`/api/share/${encodeURIComponent(token)}`)
      .then((r) => setShared(r.workbook))
      .catch(() => setShared(null));
  }, [token]);

  if (shared === undefined) return <main className="page share-page" aria-busy="true" />;
  if (shared === null) {
    return (
      <main className="page page-center graph-ground">
        <section className="card card-narrow">
          <h1>{COPY.shareGone}</h1>
        </section>
      </main>
    );
  }
  const sheets = [...shared.sheets].sort((a, b) => a.position - b.position);
  const current = sheets[sheet] ?? sheets[0];
  return (
    <main className="share-page">
      <p className="share-strip">
        Read-only results from {shared.stationName}. This link expires <time dateTime={shared.expiresAt}>{localTime(shared.expiresAt, shared.timeZone)}</time>.
      </p>
      <div className="share-body">
        <div className="share-title">
          <Mark size={24} />
          <h1>{shared.name}</h1>
        </div>
        <div className="share-grid">
          <ReadOnlyGrid key={current.name} name={current.name} cells={current.cells} />
          <TabList
            label="Sheets"
            className="sheet-tabs"
            idPrefix="shared"
            items={sheets.map((s, i) => ({ id: String(i), label: s.name }))}
            selected={String(sheets.indexOf(current))}
            onSelect={(i) => setSheet(Number(i))}
          />
        </div>
        <section className="share-charts" aria-label="Charts">
          {shared.charts
            .filter((c) => c.sheetName === current.name)
            .map((c) => (
              <ChartFigure key={c.title} title={c.title} type={c.type} data={{ categories: c.categories, series: c.series }} />
            ))}
        </section>
      </div>
    </main>
  );
}
