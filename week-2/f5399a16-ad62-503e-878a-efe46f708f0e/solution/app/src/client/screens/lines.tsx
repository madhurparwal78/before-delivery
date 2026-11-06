import { useEffect, useRef, useState } from 'react';
import { COPY } from '../../shared/copy';
import { roundToTenth } from '../../shared/timecode';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { navigate, useRoute, withParams } from '../router';
import type { Board, Job, Line } from '../types';
import { AsyncButton, BottomBar, focusHeading, Heading, LoadingBars, NotFound, Problems, RadioGroup, Select, TextField, useForm } from '../ui/kit';
import { JobNav } from './frame';
import { readJob } from './jobshared';

interface Draft {
  id: string | null;
  frame: number;
  text: string;
  x: string;
  y: string;
  width: string;
  height: string;
  clips: string;
}

const MARKETS = ['en', 'nl', 'fr', 'ar'] as const;
type Market = (typeof MARKETS)[number];

function draftOf(line: Line): Draft {
  return { id: line.id, frame: line.frame, text: line.text, x: String(line.x), y: String(line.y), width: String(line.width), height: String(line.height), clips: String(line.clips) };
}

function clampPercent(value: number): number {
  return roundToTenth(Math.max(0, Math.min(100, value)));
}

export function Lines({ jobId }: { jobId: string }) {
  const route = useRoute();
  const market = (MARKETS as readonly string[]).includes(route.search.get('market') ?? '') ? (route.search.get('market') as Market) : 'en';
  const live = useLive<{ job: Job; board: Board; lines: Line[] }>(async () => {
    const [job, board, lines] = await Promise.all([readJob(jobId), api<Board>(`/api/jobs/${jobId}/board`), api<{ lines: Line[] }>(`/api/jobs/${jobId}/lines`)]);
    return { job, board, lines: lines.lines };
  });
  const [drafts, setDrafts] = useState<Partial<Record<Market, Draft>>>({});
  const [frameNumber, setFrameNumber] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const form = useForm(null, () => ({ text: '', x: '', y: '', width: '', height: '', clips: '' }));
  const draft = drafts[market];

  useEffect(() => {
    if (draft) form.setAll({ text: draft.text, x: draft.x, y: draft.y, width: draft.width, height: draft.height, clips: draft.clips });
    // The form mirrors the draft of the market being shown.
  }, [market, draft]);

  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { job, board, lines } = live.data;
  const frames = board.frames;
  const shownFrame = frameNumber ?? draft?.frame ?? frames[0]?.number ?? 0;
  const frame = frames.find((held) => held.number === shownFrame) ?? frames[0];

  const setDraft = (next: Draft | undefined) => setDrafts((held) => ({ ...held, [market]: next }));
  const patch = (changes: Partial<Draft>) => {
    if (draft) setDraft({ ...draft, ...changes });
  };
  const inMarket = lines.filter((line) => line.market === market && line.frame === shownFrame && line.id !== draft?.id);
  const edit = (line: Line) => setDraft(draftOf(line));

  const moveLine = (line: Line | null, dx: number, dy: number) => {
    const current = line ? draftOf(line) : (draft as Draft);
    setDraft({ ...current, x: String(clampPercent(Number(current.x) + dx)), y: String(clampPercent(Number(current.y) + dy)) });
  };

  const onLineKey = (line: Line | null) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const by = delta[event.key];
    if (!by) return;
    event.preventDefault();
    moveLine(line, by[0], by[1]);
  };

  const lineProps = (line: Line | null, values: Draft) => ({
    'data-part': 'line',
    'data-x': values.x,
    'data-y': values.y,
    dir: market === 'ar' ? ('rtl' as const) : undefined,
    tabIndex: 0,
    role: 'button',
    className: `line ${line === null ? 'line-active' : ''}`,
    'aria-label': `Line: ${values.text}`,
    style: { left: `${values.x}%`, top: `${values.y}%`, width: `${values.width}%` },
    onKeyDown: onLineKey(line),
    onClick: () => { if (line) edit(line); },
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') return;
      if (line) edit(line);
      drag.current = { startX: event.clientX, startY: event.clientY, x: Number(values.x), y: Number(values.y) };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const held = drag.current;
      const box = stage.current?.getBoundingClientRect();
      if (!held || !box || !box.width) return;
      const x = clampPercent(held.x + ((event.clientX - held.startX) / box.width) * 100);
      const y = clampPercent(held.y + ((event.clientY - held.startY) / box.height) * 100);
      setDrafts((all) => {
        const current = all[market];
        return current ? { ...all, [market]: { ...current, x: String(x), y: String(y) } } : all;
      });
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
  });

  const save = () =>
    form.submit(async () => {
      const held = draft ?? { id: null, frame: shownFrame, text: '', x: '10', y: '70', width: '60', height: '10', clips: '1' };
      const body = {
        frame: held.frame,
        market,
        text: form.values.text,
        x: Number(form.values.x || held.x),
        y: Number(form.values.y || held.y),
        width: Number(form.values.width || held.width),
        height: Number(form.values.height || held.height),
        clips: Number(form.values.clips || held.clips),
      };
      await api(held.id ? `/api/lines/${held.id}` : `/api/jobs/${jobId}/lines`, { method: held.id ? 'PATCH' : 'POST', body });
      await live.reload();
      setDraft(undefined);
      form.setAll({ text: '', x: '', y: '', width: '', height: '', clips: '' });
      announce(COPY.lineSaved);
    });

  const removeLine = async () => {
    if (!draft) return;
    if (!draft.id) {
      setDraft(undefined);
      announce(COPY.lineRemoved);
      focusHeading();
      return;
    }
    try {
      await api(`/api/lines/${draft.id}`, { method: 'DELETE' });
      setDraft(undefined);
      await live.reload();
      announce(COPY.lineRemoved);
      focusHeading();
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) announce(error.message);
    }
  };

  const change = (name: keyof typeof form.values, value: string) => {
    form.set(name, value);
    patch({ [name]: value });
  };
  const bound = { ...form, set: (name: string, value: unknown) => change(name as keyof typeof form.values, value as string) };

  return (
    <section className="screen">
      <Heading title={`Lines for ${job.title}`} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      <Problems form={form} labels={{ x: 'X' }} />
      <div className="lines-layout">
        <div>
          <Select
            label="Frame"
            value={String(shownFrame)}
            options={frames.map((held) => [String(held.number), `Frame ${held.number}`] as const)}
            onChange={(value) => {
              setFrameNumber(Number(value));
              patch({ frame: Number(value) });
            }}
          />
          <RadioGroup
            label="Market"
            name="market"
            value={market}
            options={MARKETS.map((value) => [value, value] as const)}
            onChange={(value) => navigate(withParams(route, { market: value }))}
          />
          <div ref={stage} className="line-stage" style={{ aspectRatio: job.aspect.replace(':', ' / ') }}>
            {frame?.drawingUrl ? <img src={frame.drawingUrl} alt="" draggable={false} /> : <div className="slate-empty" />}
            <div className="safe-area" aria-hidden="true" />
            {inMarket.map((line) => <div key={line.id} {...lineProps(line, draftOf(line))}>{line.text}</div>)}
            {draft && draft.frame === shownFrame ? <div {...lineProps(null, draft)}>{draft.text}</div> : null}
          </div>
        </div>
        <div className="line-form">
          <div className="tools">
            <button
              type="button"
              className="btn btn-plain"
              onClick={() => {
                const created: Draft = { id: null, frame: shownFrame, text: '', x: '10', y: '70', width: '60', height: '10', clips: '1' };
                setDraft(created);
                form.clear();
              }}
            >
              Add line
            </button>
            {draft ? <AsyncButton kind="plain" label="Remove line" onPress={removeLine} /> : null}
          </div>
          {draft ? (
            <>
              <TextField form={bound} name="text" label="Line text" />
              <div className="number-row">
                <TextField form={bound} name="x" label="X" inputMode="decimal" numeric />
                <TextField form={bound} name="y" label="Y" inputMode="decimal" numeric />
                <TextField form={bound} name="width" label="Width" inputMode="decimal" numeric />
                <TextField form={bound} name="height" label="Height" inputMode="decimal" numeric />
                <TextField form={bound} name="clips" label="Clips" inputMode="decimal" numeric />
              </div>
            </>
          ) : null}
        </div>
      </div>
      <BottomBar><AsyncButton label="Save" onPress={save} /></BottomBar>
    </section>
  );
}
