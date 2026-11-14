import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, apiBlob, ApiFailure } from "../api.ts";
import type { Layout } from "../../shared/layout.ts";
import type { AircraftPosition } from "../../shared/wire.ts";
import { AirfieldMap } from "../components/map.tsx";
import { Loading, NotFound } from "./shared.tsx";

interface DebriefBody {
  score: number;
  passed: boolean;
  breakdown: { simTime: string; rule: string; text: string; penalty: number }[];
  log: { simTime: string; position: string; kind: string; text: string }[];
  scenario: string;
  aerodrome: string;
  layout: Layout;
  length: number;
  /** The sim time of each replay second, from 0 to the session length. */
  clocks: string[];
  students: { GND: string | null; TWR: string | null };
}

interface ReplayBody {
  simTime: string;
  aircraft: AircraftPosition[];
}

const WAITING = "Debrief is ready when the exercise ends.";

/** A slider that moves a sim second at a time; the replay snaps and never animates. */
function ReplaySlider({ max, value, text, onChange }: { max: number; value: number; text: string; onChange: (value: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const clamp = (n: number): number => Math.max(0, Math.min(max, n));
  const onKeyDown = (event: KeyboardEvent): void => {
    const step: Record<string, number> = { ArrowRight: value + 1, ArrowUp: value + 1, ArrowLeft: value - 1, ArrowDown: value - 1, PageUp: value + 60, PageDown: value - 60, Home: 0, End: max };
    const next = step[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(clamp(next));
  };
  const fromPointer = (event: PointerEvent): void => {
    const box = track.current?.getBoundingClientRect();
    if (box && box.width > 0) onChange(clamp(Math.round(((event.clientX - box.left) / box.width) * max)));
  };
  return (
    <div class="slider-cell">
      <div
        ref={track}
        class="slider"
        role="slider"
        aria-label="Replay"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => event.buttons === 1 && fromPointer(event)}
      >
        <span class="slider-fill" style={{ width: `${max === 0 ? 0 : (value / max) * 100}%` }} />
      </div>
      <span class="tabular slider-text">{text}</span>
    </div>
  );
}

export function DebriefPage({ id }: { id: string }) {
  const [body, setBody] = useState<DebriefBody | "loading" | "waiting" | "missing">("loading");
  const [at, setAt] = useState(0);
  const [replay, setReplay] = useState<ReplayBody | null>(null);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const latest = useRef(0);

  useLayoutEffect(() => {
    api<DebriefBody>("GET", `/api/sessions/${id}/debrief`)
      .then(setBody)
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setBody(error.error === "running" ? "waiting" : "missing");
      });
  }, [id]);

  useLayoutEffect(() => {
    if (typeof body === "string") return;
    const mine = ++latest.current;
    api<ReplayBody>("GET", `/api/sessions/${id}/replay?t=${at}`).then((reply) => {
      if (mine === latest.current) setReplay(reply);
    });
  }, [id, at, body]);

  if (body === "loading") return <Loading />;
  if (body === "missing") return <NotFound />;
  if (body === "waiting") {
    return (
      <div class="cell page-cell">
        <h1>Debrief</h1>
        <p>{WAITING}</p>
      </div>
    );
  }

  const exportReport = async (kind: "csv" | "pdf"): Promise<void> => {
    setStatus("Preparing report...");
    setFailure("");
    try {
      const { blob, headers } = await apiBlob(`/api/sessions/${id}/report.${kind}`);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `report.${kind}`;
      link.click();
      URL.revokeObjectURL(link.href);
      const notice = headers.get("X-Report-Notice");
      setStatus(notice === "sent" ? "Report saved. Notice sent." : notice === "not-sent" ? "Report saved. Notice not sent." : "Report saved.");
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setStatus("");
      setFailure(error.message);
    }
  };

  const clock = body.clocks[at] ?? "";
  const current = body.log.reduce((found, row, index) => (row.simTime <= clock ? index : found), -1);
  const total = body.breakdown.length;
  return (
    <div class="page debrief">
      <h1>Debrief: {body.scenario}</h1>
      <section class="cell score-cell">
        <p role="status" aria-label="Score" class="score-text">{`Score ${body.score} of 100`}</p>
        <p class="numeral" aria-hidden="true" style={{ "--score": body.score }} />
        <p role="status" aria-label="Result" class="result">
          {body.passed ? "Passed" : "Not passed"}
        </p>
        <p class="muted">
          {body.aerodrome}: {body.students.GND ?? "none"} (GND), {body.students.TWR ?? "none"} (TWR)
        </p>
      </section>
      <section class="cell">
        <h2>Score breakdown</h2>
        <table aria-label="Score breakdown" role="table" class="table reflow">
          <thead role="rowgroup">
            <tr role="row">
              {["Sim time", "Rule", "Detail", "Points"].map((head) => (
                <th role="columnheader" key={head}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {body.breakdown.map((row, index) => (
              <tr role="row" key={index}>
                <td role="cell" data-label="Sim time" class="tabular">{row.simTime}</td>
                <td role="cell" data-label="Rule">{row.rule}</td>
                <td role="cell" data-label="Detail">{row.text}</td>
                <td role="cell" data-label="Points" class="tabular">{`-${row.penalty}`}</td>
              </tr>
            ))}
            <tr role="row" key={`total-${total}`} class="total">
              <td role="cell" data-label="Sim time">Total</td>
              <td role="cell" data-label="Rule" />
              <td role="cell" data-label="Detail" />
              <td role="cell" data-label="Points" class="tabular">{body.score}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="cell replay">
        <h2>Replay</h2>
        <ReplaySlider max={body.length} value={at} text={clock} onChange={setAt} />
        <AirfieldMap
          name="Replay map"
          layout={body.layout}
          aircraft={replay?.aircraft ?? []}
          closed={false}
          litPreview={[]}
          litAccepted={[]}
          conflicts={[]}
          stopBars={[]}
          selected={null}
          emergency={null}
          glideMs={0}
        />
      </section>
      <section class="cell">
        <h2>Timeline</h2>
        <table aria-label="Timeline" role="table" class="table reflow">
          <thead role="rowgroup">
            <tr role="row">
              {["Sim time", "Position", "Kind", "Text"].map((head) => (
                <th role="columnheader" key={head}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {body.log.map((row, index) => (
              <tr role="row" key={index} aria-current={index === current ? "true" : undefined}>
                <td role="cell" data-label="Sim time" class="tabular">{row.simTime}</td>
                <td role="cell" data-label="Position">{row.position}</td>
                <td role="cell" data-label="Kind">{row.kind}</td>
                <td role="cell" data-label="Text" class={row.kind === "command" ? "mono" : undefined}>{row.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section class="cell">
        <h2>Reports</h2>
        <div class="actions">
          <button type="button" onClick={() => void exportReport("csv")}>
            Export CSV
          </button>
          <button type="button" onClick={() => void exportReport("pdf")}>
            Export PDF
          </button>
        </div>
        <p role="status" aria-label="Export status" class="form-status">
          {status}
        </p>
        <div role="alert" aria-label="Export error" class={failure ? "cell-error" : "cell-quiet"}>
          {failure}
        </div>
      </section>
    </div>
  );
}
