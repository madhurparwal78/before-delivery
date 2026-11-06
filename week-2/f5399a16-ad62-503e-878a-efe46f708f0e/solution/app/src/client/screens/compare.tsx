import { useEffect, useRef, useState } from 'react';
import { COPY } from '../../shared/copy';
import { api } from '../api';
import { useLive } from '../live';
import { navigate, useRoute, withParams } from '../router';
import type { Cut, Frame, Job } from '../types';
import { BottomBar, Heading, LoadingBars, NotFound, Select } from '../ui/kit';
import { JobNav } from './frame';
import { readJob } from './jobshared';

interface Screen {
  job: Job;
  cuts: Cut[];
  differences: string[];
  a: Cut;
  b: Cut;
}

function CompareClip({ frame, top }: { frame: Frame; top: boolean }) {
  return (
    <div className={`compare-clip ${top ? 'compare-top' : ''}`} data-part="compare-clip" data-frame={frame.number}>
      {frame.drawingUrl ? <img src={frame.drawingUrl} alt="" draggable={false} /> : <div className="slate-empty" />}
    </div>
  );
}

export function Compare({ jobId }: { jobId: string }) {
  const route = useRoute();
  const [slot, setSlot] = useState(0);
  const askedA = route.search.get('a');
  const askedB = route.search.get('b');
  const wipe = Math.max(0, Math.min(100, Number(route.search.get('wipe') ?? 50) || 0));
  const [dragging, setDragging] = useState<number | null>(null);
  const live = useLive<Screen>(
    async () => {
      const [job, cuts] = await Promise.all([readJob(jobId), api<{ cuts: Cut[] }>(`/api/jobs/${jobId}/cuts`)]);
      const last = cuts.cuts[cuts.cuts.length - 1]?.number ?? 1;
      const a = askedA ?? String(cuts.cuts[0]?.number ?? 1);
      const b = askedB ?? String(last);
      const compared = await api<{ differences: string[]; a: Cut; b: Cut }>(`/api/jobs/${jobId}/compare?a=${a}&b=${b}`);
      return { job, cuts: cuts.cuts, ...compared };
    },
    undefined,
    [askedA, askedB],
  );
  const slider = useRef<HTMLInputElement>(null);

  const commit = (value: number) => {
    setDragging(null);
    navigate(withParams(route, { wipe: String(Math.max(0, Math.min(100, value))) }));
  };

  useEffect(() => {
    const element = slider.current;
    if (!element) return;
    const onChange = () => commit(Number(element.value));
    element.addEventListener('change', onChange);
    return () => element.removeEventListener('change', onChange);
  });

  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { job, cuts, differences, a, b } = live.data;
  const shown = dragging ?? wipe;

  const numbers = [...new Set([...(a.frames ?? []), ...(b.frames ?? [])].sort((x, y) => x.position - y.position).map((frame) => frame.number))];
  const framesOf = (cut: Cut, number: number) => cut.frames?.find((frame) => frame.number === number);
  const at = Math.max(0, Math.min(numbers.length - 1, slot));
  const options = cuts.map((cut) => [String(cut.number), `Cut ${cut.number}`] as const);

  return (
    <section className="screen">
      <Heading title={`Compare cuts for ${job.title}`} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      <div className="filters compare-picks">
        <Select label="First cut" value={String(a.number)} options={options} onChange={(value) => navigate(withParams(route, { a: value }))} />
        <Select label="Second cut" value={String(b.number)} options={options} onChange={(value) => navigate(withParams(route, { b: value }))} />
      </div>
      <div className="compare-stage" style={{ '--wipe': `${shown}%` } as React.CSSProperties}>
        {numbers.map((number, index) => {
          const first = framesOf(a, number);
          const second = framesOf(b, number);
          return (
            <figure key={number} className={`compare-slot ${index === at ? 'compare-current' : ''}`} style={{ aspectRatio: job.aspect.replace(':', ' / ') }}>
              {first ? <CompareClip frame={first} top={false} /> : null}
              {second ? <CompareClip frame={second} top /> : null}
              <figcaption className="tabular">{number}</figcaption>
            </figure>
          );
        })}
      </div>
      {differences.length ? (
        <ul aria-label="Differences" className="plain-list differences">
          {differences.map((text) => <li key={text}>{text}</li>)}
        </ul>
      ) : (
        <p className="same-cuts">{COPY.cutsSame}</p>
      )}
      <BottomBar>
        <button type="button" className="btn btn-plain compare-step" onClick={() => setSlot(Math.max(0, at - 1))}>Earlier frame</button>
        <div className="wipe-field">
          <label htmlFor="wipe">Wipe</label>
          <input
            ref={slider}
            id="wipe"
            type="range"
            min={0}
            max={100}
            step={1}
            value={shown}
            aria-valuetext={`${shown}%`}
            onChange={(event) => setDragging(Number(event.target.value))}
            onKeyDown={(event) => {
              const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
              if (by === undefined) return;
              event.preventDefault();
              commit(shown + by * (event.shiftKey ? 10 : 1));
            }}
          />
        </div>
        <button type="button" className="btn btn-plain compare-step" onClick={() => setSlot(Math.min(numbers.length - 1, at + 1))}>Later frame</button>
      </BottomBar>
    </section>
  );
}
