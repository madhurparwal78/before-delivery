import { useEffect, useRef, useState, type ReactNode } from "react";
import { promiseText, rupees } from "../../../shared/format";
import { Reel } from "../../components/Reel";
import { useReducedMotion, useTitle } from "../../lib/hooks";
import { Failure, Loading, StaffGate, useResource } from "./staff";

interface SettlementLine {
  settlement_line_id: string;
  shipment_id: string;
  line_id: string;
  title: string;
  kind: "sale" | "return";
  posted_on: string;
  gross_paise: number;
  commission_percent: number;
  commission_paise: number;
  commission_gst_paise: number;
  tcs_paise: number;
  tds_paise: number;
  emi_subvention_paise: number;
  net_paise: number;
  status: "payment_pending" | "payment_confirmed";
}

type Figure = "gross_paise" | "commission_paise" | "commission_gst_paise" | "tcs_paise" | "tds_paise" | "emi_subvention_paise" | "net_paise";

interface Statement {
  lines: SettlementLine[];
  totals: Record<Figure, number>;
}

const FIGURES: { key: Figure; label: string }[] = [
  { key: "gross_paise", label: "Gross" },
  { key: "commission_paise", label: "Commission" },
  { key: "commission_gst_paise", label: "GST on commission" },
  { key: "tcs_paise", label: "Tax collected at source" },
  { key: "tds_paise", label: "Tax deducted at source" },
  { key: "emi_subvention_paise", label: "EMI subvention" },
  { key: "net_paise", label: "Net" },
];

/** The reel runs through the first 900 px of scrolling; each line rolls while it crosses the middle of the screen. */
const ROLL_PX = 900;
const BAND_PX = 120;
const STEPS = 24;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** How far each line has rolled, 0 to 1 in whole steps, from the scroll position and the line's place on screen. */
function useRollDown(count: number, settled: boolean): { progress: number[]; line: (index: number) => (element: HTMLElement | null) => void } {
  const [progress, setProgress] = useState<number[]>(() => new Array<number>(count).fill(settled ? 1 : 0));
  const lines = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (settled) {
      setProgress(new Array<number>(count).fill(1));
      return undefined;
    }
    const measure = (): void => {
      const height = window.innerHeight;
      const top = window.scrollY;
      const end = top >= ROLL_PX || top >= document.documentElement.scrollHeight - height - 1;
      const next = Array.from({ length: count }, (_, index) => {
        const element = lines.current[index];
        if (end || !element) return 1;
        const box = element.getBoundingClientRect();
        const centre = box.top + box.height / 2;
        return Math.round(clamp((height / 2 + BAND_PX - centre) / (2 * BAND_PX)) * STEPS) / STEPS;
      });
      setProgress((current) => (current.length === next.length && current.every((value, index) => value === next[index]) ? current : next));
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [count, settled]);

  return {
    progress,
    line: (index) => (element) => {
      lines.current[index] = element;
    },
  };
}

function Rolled({ statement }: { statement: Statement }): ReactNode {
  const reduced = useReducedMotion();
  const shown = FIGURES.filter((figure) => figure.key !== "emi_subvention_paise" || statement.totals.emi_subvention_paise !== 0);
  const { progress, line } = useRollDown(shown.length, reduced);
  const value = (index: number): number => Math.round(statement.totals[(shown[index] as { key: Figure }).key] * (progress[index] ?? 0));
  const net = value(shown.length - 1);
  const hasEmi = statement.lines.some((row) => row.emi_subvention_paise !== 0);
  const columns = FIGURES.filter((figure) => figure.key !== "emi_subvention_paise" || hasEmi);

  return (
    <div className="statement-grid">
      <section className="panel panel--black statement-main">
        <ul className="roll" aria-label="Statement totals">
          {shown.map((figure, index) => (
            <li key={figure.key} className="roll__line" ref={line(index)}>
              <span className="roll__label">{figure.label}</span>
              <Reel paise={value(index)} label={`${figure.label} total`} className="roll__figure" />
            </li>
          ))}
        </ul>
        <h2>settlement lines</h2>
        {statement.lines.length === 0 ? (
          <p>No settlement lines yet.</p>
        ) : (
          <table role="table" className="rtable rtable--bill" aria-label="Settlement statement">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Item</th>
                {columns.map((figure) => (
                  <th role="columnheader" key={figure.key} scope="col">
                    {figure.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {statement.lines.map((row) => (
                <tr role="row" key={row.settlement_line_id}>
                  <td role="cell" data-label="Item" className="rtable__item">
                    <span className="rtable__name">{row.title}</span>
                    <span className="chips">
                      <span className={`chip ${row.kind === "sale" ? "chip--accent" : "chip--pink"}`}>{row.kind}</span>
                      <span className={`chip ${row.status === "payment_confirmed" ? "" : "chip--yellow"}`}>{row.status === "payment_confirmed" ? "settled" : "payment pending"}</span>
                    </span>
                    <span className="muted">
                      {row.shipment_id}, posted {promiseText(row.posted_on)}
                    </span>
                  </td>
                  {columns.map((figure) => (
                    <td role="cell" key={figure.key} data-label={figure.key === "commission_paise" ? `Commission (${row.commission_percent}%)` : figure.label} className="rtable__bill">
                      <span className="amount">{rupees(row[figure.key])}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <aside className="panel panel--pink statement-reel">
        <div className="statement-reel__sticky">
          <h2>net payout</h2>
          <Reel paise={net} label="Net payout" className="statement-reel__figure" />
        </div>
      </aside>
    </div>
  );
}

function StatementPage(): ReactNode {
  useTitle("statement");
  const { resource } = useResource<Statement>("/api/seller/settlements");
  if (resource.phase === "failed") return <Failure status={resource.status} message={resource.message} />;

  return (
    <>
      <section className="panel panel--ground staff-head">
        <h1>statement</h1>
      </section>
      {resource.phase === "loading" && <Loading />}
      {resource.phase === "ready" && <Rolled statement={resource.data} />}
    </>
  );
}

export default function Statement(): ReactNode {
  return (
    <StaffGate role="seller">
      <StatementPage />
    </StaffGate>
  );
}
