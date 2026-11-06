import { useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import { formatDay, formatTime } from "../../shared/format";
import type { Base } from "../../shared/zones";
import { api, sharedCopy } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { bad, Button, NoteLine, ok, useAction } from "../ui/Controls";
import { Dialog, useDialog } from "../ui/Dialog";
import { DataTable, NotFoundPage, type Member } from "../ui/Shell";
import { Loader } from "../ui/Visuals";

interface Day {
  date: string;
  startChargePct: number;
  endChargePct: number;
  lowestChargePct: number;
  solarKwh: number;
}

interface Log {
  id: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  dayCount: number;
}

const DAY_W = 56;
const CHART_H = 220;
const PAD = 28;

const pct = (value: number) => `${Math.floor(value)}%`;
const kwh = (value: number) => `${(Math.round(value * 10) / 10).toFixed(1)} kWh`;

/** Solar yield per day as amber bars with the day's closing charge as a line over them. */
function EnergyChart({ days }: { days: Day[] }) {
  const slot = Math.max(DAY_W, (640 - PAD * 2) / Math.max(1, days.length));
  const width = days.length * slot + PAD * 2 || 640;
  const maxSolar = Math.max(1, ...days.map((d) => d.solarKwh));
  const plotH = CHART_H - PAD * 2;
  const y = (fraction: number) => PAD + (1 - fraction) * plotH;
  const x = (i: number) => PAD + i * slot + slot / 2;
  const line = days.map((d, i) => `${i ? "L" : "M"} ${x(i)} ${y(d.endChargePct / 100)}`).join(" ");
  return (
    <div class="chart-frame" tabIndex={0} role="img" aria-label="Charge and solar by day">
      <svg class="energy-chart" aria-hidden="true" viewBox={`0 0 ${width} ${CHART_H}`} width={width} height={CHART_H}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD} x2={width - PAD} y1={y(f)} y2={y(f)} class="energy-chart__grid" />
            <text x={4} y={y(f) + 4} class="energy-chart__axis">{Math.round(f * 100)}%</text>
          </g>
        ))}
        {days.map((d, i) => {
          const h = (d.solarKwh / maxSolar) * plotH * 0.85;
          return <rect key={d.date} x={x(i) - DAY_W * 0.3} y={PAD + plotH - h} width={DAY_W * 0.6} height={h} rx="3" class="energy-chart__bar" />;
        })}
        {days.length ? <path d={line} class="energy-chart__line" /> : null}
        {days.map((d, i) => (
          <circle key={`c-${d.date}`} cx={x(i)} cy={y(d.endChargePct / 100)} r="3.5" class="energy-chart__point" />
        ))}
        {days.map((d, i) => (
          <text key={`t-${d.date}`} x={x(i)} y={CHART_H - 8} class="energy-chart__axis" text-anchor="middle">
            {d.date.slice(8)}/{d.date.slice(5, 7)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function Energy({ member, slug }: { member: Member; slug: string }) {
  const ws = member.workspaceSlug;
  const yacht = useLoad<{ yacht: { name: string; base: Base } }>(`/api/w/${ws}/yachts/${slug}`);
  const days = useLoad<{ base: Base; days: Day[] }>(`/api/w/${ws}/yachts/${slug}/energy-days`);
  const logs = useLoad<{ logs: Log[] }>(`/api/w/${ws}/yachts/${slug}/energy-logs`);
  const upload = useDialog();
  const action = useAction();
  const page = useAction();
  const file = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  if (yacht.result && !yacht.result.ok && yacht.result.status !== 401) return <NotFoundPage />;
  if (days.result && !days.result.ok && days.result.status === 404) return <NotFoundPage />;
  const base = days.data?.base ?? yacht.data?.yacht.base ?? "split";

  const submit = (event: Event) => {
    event.preventDefault();
    void action.run("Uploading log", async () => {
      const chosen = file.current?.files?.[0];
      const form = new FormData();
      if (chosen) form.append("log", chosen, chosen.name);
      const result = await api<{ log: Log }>("POST", `/api/w/${ws}/yachts/${slug}/energy-logs`, undefined, form);
      if (result.ok) {
        setFileError(null);
        upload.hide();
        await Promise.all([days.reload(), logs.reload()]);
        page.setNote(ok(COPY.logUploaded(result.data.log.dayCount)));
        return null;
      }
      action.focusLater(() => (result.status === 422 ? file.current : uploadButton.current)?.focus());
      if (result.status === 413) return bad(COPY.logTooLarge);
      if (result.status === 422) {
        setFileError(result.body.errors?.log ?? null);
        return null;
      }
      return bad(sharedCopy(result));
    });
  };

  return (
    <section>
      <Loader active={!yacht.data || days.loading || logs.loading} />
      {/* The page shows with its first data so nothing below the loader moves when it lands. */}
      {!yacht.data || days.loading || logs.loading ? null : <>
      <h1 class="rise">{yacht.data.yacht.name} energy</h1>
      <p class="lede">Daily battery logs, kept exactly as uploaded. Days are {base === "lavrio" ? "Lavrio" : "Split"} local dates.</p>
      <div class="toolbar">
        <Button onClick={(e) => { setFileError(null); action.setNote(null); upload.show(e); }} aria-haspopup="dialog">Upload daily log</Button>
      </div>
      <NoteLine note={page.note} />
      <div class="two-col energy">
        <div class="card">
          <h2>Charge and solar</h2>
          <EnergyChart days={days.data?.days ?? []} />
          <p class="legend"><span class="legend__bar" aria-hidden="true" /> solar yield <span class="legend__line" aria-hidden="true" /> end-of-day charge</p>
          <DataTable
            name="Energy by day"
            rows={days.data?.days ?? []}
            rowKey={(d) => d.date}
            empty="No days charted yet."
            columns={[
              { label: "Date", cell: (d) => <span class="fig">{formatDay(d.date)}</span> },
              { label: "Start charge", numeric: true, cell: (d) => <span class="fig">{pct(d.startChargePct)}</span> },
              { label: "End charge", numeric: true, cell: (d) => <span class="fig">{pct(d.endChargePct)}</span> },
              { label: "Lowest charge", numeric: true, cell: (d) => <span class="fig">{pct(d.lowestChargePct)}</span> },
              { label: "Solar yield", numeric: true, cell: (d) => <span class="fig">{kwh(d.solarKwh)}</span> },
            ]}
          />
        </div>
        <div class="card">
          <DataTable
            name="Uploaded logs"
            rows={logs.data?.logs ?? []}
            rowKey={(l) => l.id}
            empty="No logs yet."
            columns={[
              { label: "File", cell: (l) => <span class="file-name">{l.fileName}</span> },
              { label: "Size", numeric: true, cell: (l) => <span class="fig">{l.sizeBytes.toLocaleString("en-GB")} bytes</span> },
              { label: "Uploaded", cell: (l) => <span class="fig">{formatTime(l.uploadedAt, base)}</span> },
              { label: "By", cell: (l) => l.uploadedBy },
            ]}
          />
        </div>
      </div>
      </>}
      <Dialog handle={upload} title="Upload daily log">
        <form class="form" onSubmit={submit} noValidate>
          <div class={`field${fileError ? " field--error" : ""}`}>
            <label for="log-file">Log file</label>
            <input id="log-file" type="file" accept=".jsonl,.ndjson,.txt,application/x-ndjson" ref={file} data-first=""
              aria-describedby={fileError ? "log-file-error" : "log-file-hint"} aria-invalid={fileError ? "true" : undefined} />
            <p class="field__hint" id="log-file-hint">One JSON object per line, up to 2,000,000 bytes.</p>
            {fileError ? <p class="field__error" id="log-file-error">{fileError}</p> : null}
          </div>
          <NoteLine note={action.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={action.pending} pendingLabel="Uploading log" buttonRef={uploadButton}>Upload log</Button>
            <Button variant="quiet" onClick={upload.hide}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
