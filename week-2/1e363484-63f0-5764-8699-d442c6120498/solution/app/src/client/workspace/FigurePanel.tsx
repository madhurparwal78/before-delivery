// The figure panel: the server-derived figure for the brush, its coverage gauge and Seal figure.
// Coverage and Net count to each new server value (the visible numeral, hidden from assistive tech);
// a visually hidden copy always holds the final value.

import { ChevronUp, Stamp, Table2 } from "lucide-react";
import { useLayoutEffect, useRef, type MouseEvent, type RefObject } from "react";
import { intervalDisplay, signed } from "../format";
import type { Preview } from "../types";
import { Num } from "../ui/tables";
import { abs, bpPercent, divHalfEven, fromUnits, max, toUnits } from "./exact";
import { tidePermille } from "./tween";

/** The value `permille` thousandths of the way from `from` to `to`, rounded half to even. */
const between = (from: bigint, to: bigint, permille: bigint) => from + divHalfEven((to - from) * permille, 1000n);

function CountingNumeral({ value, decimals, render }: { value: string; decimals: number; render: (text: string) => string }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef<bigint | null>(null);
  useLayoutEffect(() => {
    const target = toUnits(value, decimals);
    const from = shown.current;
    const write = (n: bigint, text: string) => {
      shown.current = n;
      el.current!.textContent = render(text);
    };
    if (from === null || from === target) return write(target, value);
    return tidePermille((k) => {
      const n = between(from, target, k);
      write(n, k >= 1000n ? value : fromUnits(n, decimals));
    });
  }, [value, decimals, render]);
  return <span aria-hidden="true" className="numeral num" ref={el} />;
}

const asPercent = (text: string) => `${text}%`;

function CoverageGauge({ coverage, floor }: { coverage: string; floor: string }) {
  const fill = useRef<HTMLSpanElement>(null);
  const shown = useRef<bigint | null>(null);   // basis points of the track
  useLayoutEffect(() => {
    const target = toUnits(coverage, 2);
    const from = shown.current;
    const set = (bp: bigint) => {
      shown.current = bp;
      fill.current!.style.transform = `scaleX(${bpPercent(bp)})`;
    };
    if (from === null) return set(target);
    return tidePermille((k) => set(between(from, target, k)));
  }, [coverage]);
  const meter = { "aria-valuenow": coverage } as unknown as { "aria-valuenow": number };
  return (
    <div role="meter" aria-label="Coverage" aria-valuemin={0} aria-valuemax={100} {...meter}
      aria-valuetext={`${coverage}%`} className="gauge">
      <span className="gauge-track"><span className="gauge-fill" ref={fill} /></span>
      <span className="gauge-floor" style={{ left: `${floor}%` }}>
        <span className="gauge-floor-label num">Floor {floor}%</span>
      </span>
    </div>
  );
}

/** The withheld buffer as a short bar of sparse hatching, its length the buffer's share of the net. */
function BufferMark({ buffer, net }: { buffer: string; net: string }) {
  // 96 px is the whole net; the bar never draws under 16 px.
  const whole = abs(toUnits(net, 3));
  const px = whole === 0n ? 96n : max(16n, divHalfEven(toUnits(buffer, 3) * 96n, whole));
  return (
    <span className="buffer-mark">
      <span className="buffer-bar" style={{ width: `${px}px` }} />
      <span className="buffer-caption num">buffer {buffer}</span>
    </span>
  );
}

interface PanelProps {
  preview: Preview | null;
  floor: string;
  armed: boolean;
  reason: string | null;
  /** Id of the element explaining why Seal figure is disabled when it is not the reason text. */
  describedBy: string | null;
  failed: string | null;
  expanded: boolean;
  sealButton: RefObject<HTMLButtonElement | null>;
  onSeal: () => void;
  onUnitBreakdown: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggleSheet: () => void;
}

export function FigurePanel({ preview, floor, armed, reason, describedBy, failed, expanded, sealButton, onSeal, onUnitBreakdown, onToggleSheet }: PanelProps) {
  const dash = <span className="num muted-note">—</span>;
  const rows: [string, React.ReactNode][] = preview
    ? [
      ["CO2 tCO2e", <Num>{signed(preview.co2_tco2e)}</Num>],
      ["CH4 tCO2e", <Num>{signed(preview.ch4_tco2e)}</Num>],
      ["Buffer tCO2e", <Num>{preview.buffer_tco2e}</Num>],
      ["Credited tCO2e", <Num className="strong">{signed(preview.credited_tco2e)}</Num>],
      ["Readings", <Num>{preview.readings_count}</Num>],
    ]
    : ["CO2 tCO2e", "CH4 tCO2e", "Buffer tCO2e", "Credited tCO2e", "Readings"].map((label) => [label, dash]);

  return (
    <section role="region" aria-label="Figure" className={`pane figure-panel ${expanded ? "is-expanded" : "is-collapsed"}`}>
      <h2 className="pane-title">Figure</h2>
      {failed && <p role="alert" className="alert">{failed}</p>}
      <dl className="figure-values">
        <div className="fv fv-detail fv-interval">
          <dt>Interval</dt>
          <dd>{preview ? <Num>{intervalDisplay(preview.start, preview.end)}</Num> : dash}</dd>
        </div>
        <div className="fv fv-coverage">
          <dt>Coverage</dt>
          <dd>
            {preview ? (
              <>
                <CountingNumeral value={preview.coverage_pct} decimals={1} render={asPercent} />
                <span className="sr-only">{preview.coverage_pct}%</span>{" "}
                <CoverageGauge coverage={preview.coverage_pct} floor={floor} />
              </>
            ) : dash}
          </dd>
        </div>
        <div className="fv fv-net">
          <dt>Net tCO2e</dt>
          <dd>
            {preview ? (
              <>
                <CountingNumeral value={preview.net_tco2e} decimals={3} render={signed} />
                <span className="sr-only">{signed(preview.net_tco2e)}</span>{" "}
                {preview.buffer_tco2e !== "0.000" && <BufferMark buffer={preview.buffer_tco2e} net={preview.net_tco2e} />}
              </>
            ) : dash}
          </dd>
        </div>
        {rows.map(([label, value]) => (
          <div key={label} className="fv fv-detail">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="figure-controls">
        <button type="button" className="btn unit-wide" disabled={!preview} onClick={onUnitBreakdown}>
          <Table2 size={16} aria-hidden="true" /> Unit breakdown
        </button>
        <div className="seal-group">
          <button type="button" ref={sealButton} className="btn btn-seal" disabled={!armed} onClick={onSeal}
            aria-describedby={reason ? "seal-reason" : describedBy ?? undefined}>
            <Stamp size={16} aria-hidden="true" /> Seal figure
          </button>
          {reason && <p id="seal-reason" className="seal-reason">{reason}</p>}
        </div>
        <button type="button" className="btn unit-sheet" disabled={!preview} onClick={onUnitBreakdown}>
          <Table2 size={16} aria-hidden="true" /> Unit breakdown
        </button>
        <button type="button" className="btn sheet-toggle" aria-expanded={expanded} onClick={onToggleSheet}>
          <ChevronUp size={16} aria-hidden="true" className="sheet-chevron" /> Figure details
        </button>
      </div>
    </section>
  );
}
