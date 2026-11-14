import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Layout, ReplayView } from '../../shared/types.js';
import { clockText } from '../../shared/time.js';
import { api, ApiFailure, apiRaw, saveFile } from '../api.js';
import { useApp } from '../app-context.js';
import { AirfieldMap } from '../components/airfield-map.js';
import { ErrorCell } from '../components/forms.js';
import { Loading, NotFound } from '../components/shell.js';

interface DebriefView {
  score: number;
  passed: boolean;
  breakdown: { simTime: string; rule: string; text: string; penalty: number }[];
  log: { simTime: string; position: string; kind: string; text: string }[];
  scenarioName: string;
  length: number;
  firstTime: number;
  layout: Layout;
}

function ScoreNumeral({ score, reduced }: { score: number; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? score : 0);
  useLayoutEffect(() => {
    if (reduced) {
      setShown(score);
      return undefined;
    }
    const steps = 8;
    const timers = Array.from({ length: steps }, (_, i) =>
      setTimeout(() => setShown(Math.round((score * (i + 1)) / steps)), ((i + 1) * 400) / steps),
    );
    return () => timers.forEach(clearTimeout);
  }, [score, reduced]);
  return (
    <p class="score-numeral" aria-hidden="true">
      {shown}
    </p>
  );
}

function ReplaySlider(props: { value: number; max: number; firstTime: number; onChange(value: number): void }) {
  const track = useRef<HTMLDivElement>(null);
  const set = (value: number) => props.onChange(Math.max(0, Math.min(props.max, value)));
  const fromPointer = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    set(Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * props.max));
  };
  const share = props.max > 0 ? (props.value / props.max) * 100 : 0;
  return (
    <div class="replay-control">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Replay"
        aria-valuemin={0}
        aria-valuemax={props.max}
        aria-valuenow={props.value}
        aria-valuetext={clockText(props.firstTime + props.value)}
        class="slider"
        onKeyDown={(event) => {
          const moves: Record<string, number> = {
            ArrowRight: props.value + 1,
            ArrowUp: props.value + 1,
            ArrowLeft: props.value - 1,
            ArrowDown: props.value - 1,
            PageUp: props.value + 60,
            PageDown: props.value - 60,
            Home: 0,
            End: props.max,
          };
          const next = moves[event.key];
          if (next === undefined) return;
          event.preventDefault();
          set(next);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX);
        }}
      >
        <div class="slider-fill" style={{ width: `${share}%` }} />
        <div class="slider-thumb" style={{ left: `${share}%` }} />
      </div>
      <span class="tabular">{clockText(props.firstTime + props.value)}</span>
    </div>
  );
}

export function DebriefPage({ id }: { id: string }) {
  const { reducedMotion } = useApp();
  const [debrief, setDebrief] = useState<DebriefView | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'running' | 'ready'>('loading');
  const [second, setSecond] = useState(0);
  const [replay, setReplay] = useState<ReplayView | null>(null);
  const [exportStatus, setExportStatus] = useState('');
  const [exportError, setExportError] = useState('');
  const latestReplay = useRef(0);

  useLayoutEffect(() => {
    api<DebriefView>('GET', `/api/sessions/${encodeURIComponent(id)}/debrief`)
      .then((view) => {
        setDebrief(view);
        setState('ready');
      })
      .catch((error: unknown) => setState(error instanceof ApiFailure && error.status === 409 ? 'running' : 'missing'));
  }, [id]);

  useLayoutEffect(() => {
    if (state !== 'ready') return;
    const request = ++latestReplay.current;
    void api<ReplayView>('GET', `/api/sessions/${encodeURIComponent(id)}/replay?t=${second}`).then((view) => {
      if (request === latestReplay.current) setReplay(view);
    });
  }, [id, second, state]);

  if (state === 'missing') return <NotFound />;
  if (state === 'running') {
    return (
      <section class="cell single">
        <p>Debrief is ready when the exercise ends.</p>
      </section>
    );
  }
  if (!debrief) return <Loading />;

  const currentTime = clockText(debrief.firstTime + second);
  let currentRow = -1;
  debrief.log.forEach((row, index) => {
    if (row.simTime <= currentTime) currentRow = index;
  });

  const exportReport = async (kind: 'csv' | 'pdf') => {
    setExportStatus('Preparing report...');
    setExportError('');
    try {
      const response = await apiRaw('GET', `/api/sessions/${encodeURIComponent(id)}/report.${kind}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setExportStatus('');
        setExportError(body.message ?? 'The report could not be prepared.');
        return;
      }
      const notice = response.headers.get('X-Report-Notice');
      saveFile(await response.blob(), `report.${kind}`);
      setExportStatus(notice === 'repeat' ? 'Report saved.' : notice === 'sent' ? 'Report saved. Notice sent.' : 'Report saved. Notice not sent.');
    } catch {
      setExportStatus('');
      setExportError('Runup Bay cannot be reached. Try again shortly.');
    }
  };

  return (
    <div class="grid-page debrief">
      <section class="cell span-all">
        <h1>Debrief: {debrief.scenarioName}</h1>
        <div class="score-block">
          <ScoreNumeral score={debrief.score} reduced={reducedMotion} />
          <div>
            <p role="status" aria-label="Score" class="tabular">
              Score {debrief.score} of 100
            </p>
            <p role="status" aria-label="Result">
              {debrief.passed ? 'Passed' : 'Not passed'}
            </p>
          </div>
        </div>
        <div class="row-buttons">
          <button type="button" onClick={() => void exportReport('csv')}>
            Export CSV
          </button>
          <button type="button" onClick={() => void exportReport('pdf')}>
            Export PDF
          </button>
        </div>
        <p role="status" aria-label="Export status">
          {exportStatus}
        </p>
        <ErrorCell label="Export error" text={exportError} />
      </section>
      <section class="cell span-all">
        <h2>Score breakdown</h2>
        <table aria-label="Score breakdown" class="data-table reflow" role="table">
          <thead role="rowgroup">
            <tr role="row">
              {['Sim time', 'Rule', 'Detail', 'Points'].map((heading) => (
                <th key={heading} scope="col" role="columnheader">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {debrief.breakdown.map((row, index) => (
              <tr key={index} role="row">
                <td role="cell" data-label="Sim time" class="tabular">{row.simTime}</td>
                <td role="cell" data-label="Rule">{row.rule}</td>
                <td role="cell" data-label="Detail">{row.text}</td>
                <td role="cell" data-label="Points" class="tabular">{`-${row.penalty}`}</td>
              </tr>
            ))}
            <tr role="row" class="total-row">
              <td role="cell" data-label="Sim time">Total</td>
              <td role="cell" data-label="Rule" />
              <td role="cell" data-label="Detail" />
              <td role="cell" data-label="Points" class="tabular">{debrief.score}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="cell span-all replay-cell">
        <h2>Replay</h2>
        <ReplaySlider value={second} max={debrief.length} firstTime={debrief.firstTime} onChange={setSecond} />
        <AirfieldMap layout={debrief.layout} aircraft={replay?.aircraft ?? []} label="Replay map" glideMs={0} />
      </section>
      <section class="cell span-all">
        <h2>Timeline</h2>
        <table aria-label="Timeline" class="data-table reflow" role="table">
          <thead role="rowgroup">
            <tr role="row">
              {['Sim time', 'Position', 'Kind', 'Text'].map((heading) => (
                <th key={heading} scope="col" role="columnheader">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {debrief.log.map((row, index) => (
              <tr key={index} role="row" aria-current={index === currentRow ? 'true' : undefined}>
                <td role="cell" data-label="Sim time" class="tabular">{row.simTime}</td>
                <td role="cell" data-label="Position">{row.position}</td>
                <td role="cell" data-label="Kind">{row.kind}</td>
                <td role="cell" data-label="Text" class={row.kind === 'command' || row.kind === 'readback' ? 'mono' : ''}>
                  {row.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
