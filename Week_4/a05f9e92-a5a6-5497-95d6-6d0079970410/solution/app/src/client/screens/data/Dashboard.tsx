import { useId, useState } from "react";
import { get } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { Link } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { loadingScreen, Page, Rest, useLoad } from "../../lib/ui.js";

interface DataRow {
  key: string | number;
  label: string;
  count: number;
  filter: string;
}

interface Widget {
  id: string;
  title: string;
  kind: "count" | "bar" | "trend";
  table: string;
  data: DataRow[];
  total: number;
}

interface DashboardJson {
  id: string;
  name: string;
  time_zone: string;
  widgets: Widget[];
}

const WIDTH = 320;

function BarChart({ rows, label }: { rows: DataRow[]; label: string }): JSX.Element {
  const rowHeight = 46;
  const longest = Math.max(1, ...rows.map((row) => row.count));
  return (
    <svg className="chart" viewBox={`0 0 ${WIDTH} ${Math.max(rows.length, 1) * rowHeight}`} role="img" aria-label={label}>
      {rows.map((row, index) => {
        const top = index * rowHeight;
        const length = (row.count / longest) * 250;
        return (
          <g key={String(row.key)}>
            <text x={0} y={top + 15} className="chart-label">
              {row.label}
            </text>
            <rect x={0} y={top + 21} width={length} height={20} className="chart-bar" />
            <text x={length + 8} y={top + 37} className="chart-count">
              {row.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function TrendChart({ rows, label }: { rows: DataRow[]; label: string }): JSX.Element {
  const base = 130;
  const room = 104;
  const slot = WIDTH / Math.max(rows.length, 1);
  const longest = Math.max(1, ...rows.map((row) => row.count));
  const first = rows[0];
  const last = rows[rows.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${WIDTH} 156`} role="img" aria-label={label}>
      {rows.map((row, index) => {
        const height = (row.count / longest) * room;
        const x = index * slot + 2;
        return (
          <g key={String(row.key)}>
            <rect x={x} y={base - height} width={slot - 4} height={height} className="chart-bar" />
            <text x={x + (slot - 4) / 2} y={base - height - 5} textAnchor="middle" className="chart-count chart-count-small">
              {row.count}
            </text>
          </g>
        );
      })}
      <rect x={0} y={base} width={WIDTH} height={3} className="chart-bar" />
      {first ? (
        <text x={0} y={152} className="chart-label chart-label-small">
          {first.label}
        </text>
      ) : null}
      {last ? (
        <text x={WIDTH} y={152} textAnchor="end" className="chart-label chart-label-small">
          {last.label}
        </text>
      ) : null}
    </svg>
  );
}

function CountChart({ row, label }: { row: DataRow | undefined; label: string }): JSX.Element {
  return (
    <svg className="chart" viewBox={`0 0 ${WIDTH} 96`} role="img" aria-label={label}>
      <text x={0} y={80} className="chart-figure">
        {row?.count ?? 0}
      </text>
    </svg>
  );
}

function listPath(table: string, filter: string): string {
  return filter === "" ? `/desk/lists/${table}` : `/desk/lists/${table}?filter=${encodeURIComponent(filter)}`;
}

function WidgetCard({ widget }: { widget: Widget }): JSX.Element {
  const heading = useId();
  const tableId = useId();
  const [showTable, setShowTable] = useState(false);
  const label = `${widget.title} chart`;
  const chart =
    widget.kind === "bar" ? <BarChart rows={widget.data} label={label} /> : widget.kind === "trend" ? <TrendChart rows={widget.data} label={label} /> : <CountChart row={widget.data[0]} label={label} />;
  return (
    <section className="widget" aria-labelledby={heading}>
      <h2 id={heading} className="widget-title">
        {widget.title}
      </h2>
      {chart}
      <ul className={widget.kind === "trend" ? "widget-links widget-links-dense" : "widget-links"}>
        {widget.data.map((row) => (
          <li key={String(row.key)}>
            <Link to={listPath(widget.table, row.filter)} className="widget-link">
              {row.label}: <strong>{row.count}</strong>
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-outline" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((open) => !open)}>
        Show data table
      </button>
      {showTable ? (
        <div className="table-scroll" id={tableId}>
          <table className="data-table" aria-label={`${widget.title} data`}>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Label</th>
                <th scope="col" className="num">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {widget.data.map((row) => (
                <tr key={String(row.key)}>
                  <td>{String(row.key)}</td>
                  <td>{row.label}</td>
                  <td className="num">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function Dashboard({ id }: { id: string }): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(async () => (await get<{ dashboard: DashboardJson }>(`/api/dashboards/${encodeURIComponent(id)}`)).dashboard, [id, session.accessVersion]);
  useTopics([`dashboard:${id}`], () => reload());
  const waiting = loadingScreen(state, "dashboard", reload);
  if (waiting || state.status !== "ready") return waiting!;
  const dashboard = state.data;
  return (
    <Page subject={dashboard.name} wide>
      <Rest>
        <p className="muted dash-zone">Times follow your time zone, {dashboard.time_zone}.</p>
        <div className="widgets">
          {dashboard.widgets.map((widget) => (
            <WidgetCard key={widget.id} widget={widget} />
          ))}
        </div>
      </Rest>
    </Page>
  );
}
