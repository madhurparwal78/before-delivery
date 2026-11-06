// Tables shared by several screens. Explicit table roles keep their semantics when narrow layouts
// restyle rows as stacked label-and-value cards.

import type { ReactNode } from "react";
import { area, KIND_WORD, minuteDisplay, secondDisplay, SENSOR_KIND_WORD, signed, STATUS_WORD } from "../format";
import { Link } from "../router";
import type { Contribution, Figure, FigureStatus, LedgerEntry, MovedReading, Summary } from "../types";

export function Num({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`num ${className}`}>{children}</span>;
}

export function StatusWord({ status }: { status: FigureStatus }) {
  return <span className={`status status-${status}`}>{STATUS_WORD[status]}</span>;
}

interface Column {
  label: string;
  numeric?: boolean;
}

/** A table with a caption-less accessible name and labelled cells for the stacked card layout. */
export function DataTable({ name, columns, children, footer, className = "" }: {
  name: string; columns: Column[]; children: ReactNode; footer?: ReactNode; className?: string;
}) {
  return (
    <div className={`table-frame ${className}`}>
      <table role="table" aria-label={name} className="data-table">
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((c) => (
              <th role="columnheader" scope="col" key={c.label} className={c.numeric ? "numeric" : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">{children}</tbody>
        {footer && <tfoot role="rowgroup">{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Cell({ label, numeric, children, className = "" }: { label: string; numeric?: boolean; children: ReactNode; className?: string }) {
  return (
    <td role="cell" data-label={label} className={`${numeric ? "numeric" : ""} ${className}`}>
      <span className="cell-value">{children}</span>
    </td>
  );
}

const FIGURE_COLUMNS: Column[] = [
  { label: "Figure" }, { label: "Interval" }, { label: "Net tCO2e", numeric: true }, { label: "Buffer tCO2e", numeric: true },
  { label: "Credited tCO2e", numeric: true }, { label: "Coverage", numeric: true }, { label: "Status" }, { label: "Checked at" },
];

export function FiguresTable({ slug, figures }: { slug: string; figures: Figure[] }) {
  return (
    <div className="records-section">
      <h2>Figures</h2>
      <DataTable name="Figures" columns={FIGURE_COLUMNS}>
        {figures.length === 0 && (
          <tr role="row" className="empty-row"><td role="cell" colSpan={FIGURE_COLUMNS.length}>No figures sealed yet.</td></tr>
        )}
        {figures.map((f) => (
          <tr role="row" key={f.id}>
            <Cell label="Figure"><Link href={`/projects/${slug}/figures/${f.id}`} className="num figure-link" data-figure-link={f.id}>{f.id}</Link></Cell>
            <Cell label="Interval" className="mono-cell"><Num><span className="nowrap">{minuteDisplay(f.start)}</span> to <span className="nowrap">{minuteDisplay(f.end)}</span></Num></Cell>
            <Cell label="Net tCO2e" numeric><Num>{signed(f.net_tco2e)}</Num></Cell>
            <Cell label="Buffer tCO2e" numeric><Num>{f.buffer_tco2e}</Num></Cell>
            <Cell label="Credited tCO2e" numeric><Num>{signed(f.credited_tco2e)}</Num></Cell>
            <Cell label="Coverage" numeric><Num>{f.coverage_pct}%</Num></Cell>
            <Cell label="Status"><StatusWord status={f.status} /></Cell>
            <Cell label="Checked at" className="mono-cell"><Num>{secondDisplay(f.checked_at)}</Num></Cell>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

const LEDGER_COLUMNS: Column[] = [
  { label: "Entry" }, { label: "Figure" }, { label: "Kind" }, { label: "tCO2e", numeric: true }, { label: "Recorded at" },
];

export function LedgerTable({ slug, entries, balance }: { slug: string; entries: LedgerEntry[]; balance: string }) {
  return (
    <div className="records-section">
      <h2>Sealed-tonnes ledger</h2>
      <DataTable
        name="Sealed-tonnes ledger"
        columns={LEDGER_COLUMNS}
        footer={
          <tr role="row" className="balance-row">
            <th role="rowheader" scope="row" colSpan={3} data-label="Balance">Balance</th>
            <Cell label="Balance tCO2e" numeric><Num className="strong">{signed(balance)}</Num></Cell>
            <td role="cell" className="spacer-cell" />
          </tr>
        }
      >
        {entries.map((e) => (
          <tr role="row" key={e.id}>
            <Cell label="Entry" className="mono-cell"><Num>#{e.id}</Num></Cell>
            <Cell label="Figure"><Link href={`/projects/${slug}/figures/${e.figure_id}`} className="num">{e.figure_id}</Link></Cell>
            <Cell label="Kind">
              {KIND_WORD[e.kind]}
              {e.reverses && <span className="muted-note"> <Num>#{e.reverses}</Num></span>}
            </Cell>
            <Cell label="tCO2e" numeric><Num>{signed(e.tco2e)}</Num></Cell>
            <Cell label="Recorded at" className="mono-cell"><Num>{secondDisplay(e.recorded_at)}</Num></Cell>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

export function BalanceStrip({ summary }: { summary: Summary }) {
  const items: [string, ReactNode][] = [
    ["Sealed net tCO2e", signed(summary.sealed_net_tco2e)],
    ["Buffer tCO2e", summary.buffer_tco2e],
    ["Intact figures", summary.intact_count],
    ["Broken figures", summary.broken_count],
    ["Superseded figures", summary.superseded_count],
  ];
  return (
    <section role="region" aria-label="Project balance" className="balance-strip">
      <dl>
        {items.map(([label, value]) => (
          <div key={label} className={`balance-item ${label === "Broken figures" && summary.broken_count > 0 ? "has-broken" : ""}`}>
            <dt>{label}</dt>
            <dd><Num>{value}</Num></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const CONTRIBUTION_COLUMNS: Column[] = [
  { label: "Sensor" }, { label: "Kind" }, { label: "Area m²", numeric: true }, { label: "Qualifying half-hours", numeric: true },
  { label: "CO2 tCO2e", numeric: true }, { label: "CH4 tCO2e", numeric: true }, { label: "Net tCO2e", numeric: true },
];

/** The allocated contributions and their totals, exactly as the server returned them. */
export function ContributionsTable({ name, contributions, totals }: {
  name: string; contributions: Contribution[]; totals: { co2: string; ch4: string; net: string };
}) {
  return (
    <DataTable
      name={name}
      columns={CONTRIBUTION_COLUMNS}
      className="contributions"
      footer={
        <tr role="row" className="total-row">
          <th role="rowheader" scope="row" colSpan={4} data-label="Total">Total</th>
          <Cell label="CO2 tCO2e" numeric><Num>{signed(totals.co2)}</Num></Cell>
          <Cell label="CH4 tCO2e" numeric><Num>{signed(totals.ch4)}</Num></Cell>
          <Cell label="Net tCO2e" numeric><Num>{signed(totals.net)}</Num></Cell>
        </tr>
      }
    >
      {contributions.map((c) => (
        <tr role="row" key={c.sensor_id}>
          <Cell label="Sensor"><Num>{c.sensor_id}</Num></Cell>
          <Cell label="Kind">{SENSOR_KIND_WORD[c.kind]}</Cell>
          <Cell label="Area m²" numeric><Num>{area(c.area_m2)}</Num></Cell>
          <Cell label="Qualifying half-hours" numeric><Num>{c.qualifying_half_hours}</Num><span className="muted-note"> / </span><Num>{c.half_hours}</Num></Cell>
          <Cell label="CO2 tCO2e" numeric><Num>{signed(c.co2_tco2e)}</Num></Cell>
          <Cell label="CH4 tCO2e" numeric><Num>{signed(c.ch4_tco2e)}</Num></Cell>
          <Cell label="Net tCO2e" numeric><Num>{signed(c.net_tco2e)}</Num></Cell>
        </tr>
      ))}
    </DataTable>
  );
}

const MOVED_COLUMNS: Column[] = [
  { label: "Sensor" }, { label: "Interval start" }, { label: "Old FC", numeric: true }, { label: "New FC", numeric: true },
  { label: "Old FCH4", numeric: true }, { label: "New FCH4", numeric: true }, { label: "Old QC", numeric: true },
  { label: "New QC", numeric: true }, { label: "Revised at" },
];

export function MovedReadingsTable({ moved }: { moved: MovedReading[] }) {
  const none = <span className="muted-note">—</span>;
  return (
    <DataTable name="Moved readings" columns={MOVED_COLUMNS}>
      {moved.map((m) => (
        <tr role="row" key={`${m.sensor_id}-${m.interval_start}-${m.batch_id}`}>
          <Cell label="Sensor"><Num>{m.sensor_id}</Num></Cell>
          <Cell label="Interval start" className="mono-cell"><Num>{minuteDisplay(m.interval_start)}</Num></Cell>
          <Cell label="Old FC" numeric>{m.old ? <Num>{m.old.fc}</Num> : none}</Cell>
          <Cell label="New FC" numeric><Num>{m.new.fc}</Num></Cell>
          <Cell label="Old FCH4" numeric>{m.old ? <Num>{m.old.fch4}</Num> : none}</Cell>
          <Cell label="New FCH4" numeric><Num>{m.new.fch4}</Num></Cell>
          <Cell label="Old QC" numeric>{m.old ? <Num>{m.old.qc}</Num> : none}</Cell>
          <Cell label="New QC" numeric><Num>{m.new.qc}</Num></Cell>
          <Cell label="Revised at" className="mono-cell"><Num>{secondDisplay(m.revised_at)}</Num></Cell>
        </tr>
      ))}
    </DataTable>
  );
}
