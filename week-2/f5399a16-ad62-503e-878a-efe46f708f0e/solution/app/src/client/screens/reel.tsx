import { useCallback, useEffect, useRef, useState } from 'react';
import { COPY, fill } from '../../shared/copy';
import { secondsText, targetFrames, targetText, FRAME_RATES, type FrameRate } from '../../shared/timecode';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import type { Board, Job } from '../types';
import { BottomBar, EmptyState, Heading, LoadingBars, NotFound, RadioGroup } from '../ui/kit';
import { Overlay, useDialog } from '../ui/overlay';
import { clipUnder, Strip, usePlayback, type StripClip } from '../ui/strip';
import { JobNav } from './frame';
import { readJob } from './jobshared';

function withDuration(board: Board, number: number, durationFrames: number): Board {
  const frames = board.frames.map((frame) => (frame.number === number ? { ...frame, durationFrames } : frame));
  const totalFrames = frames.reduce((sum, frame) => sum + frame.durationFrames, 0);
  return { ...board, frames, totalFrames, secondsText: secondsText(totalFrames, board.frameRate), targetText: targetText(totalFrames, targetFrames(board.frameRate, board.targetSeconds)) };
}

export function Reel({ jobId }: { jobId: string }) {
  const live = useLive<{ job: Job; board: Board }>(async () => {
    const [job, board] = await Promise.all([readJob(jobId), api<Board>(`/api/jobs/${jobId}/board`)]);
    return { job, board };
  });
  const [position, setPosition] = useState(0);
  const [motion, setMotion] = useState<'' | 'trim' | 'rate'>('');
  const [askedRate, setAskedRate] = useState<FrameRate | null>(null);
  const large = useDialog('frameLarge');
  const [largeClip, setLargeClip] = useState<StripClip | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const stamp = useRef<string | null>(null);
  const board = live.data?.board ?? null;
  const pending = useRef(0);

  useEffect(() => {
    if (board && pending.current === 0) stamp.current = board.stamp;
  }, [board]);

  const moveTo = useCallback((next: number) => {
    setMotion('');
    setPosition(next);
  }, []);

  const clips: StripClip[] = (board?.frames ?? []).map((frame) => ({ number: frame.number, durationFrames: frame.durationFrames, drawingUrl: frame.drawingUrl }));
  const total = clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
  const shown = Math.min(position, Math.max(0, total - 1));
  const { playing, toggle } = usePlayback(board?.frameRate ?? '25', total, shown, moveTo);

  /** Writes go one after another, each with the stamp the last one answered. */
  const write = useCallback((work: (stamp: string) => Promise<Board>, done: (next: Board) => void) => {
    pending.current += 1;
    const run = queue.current.then(async () => {
      try {
        const next = await work(stamp.current as string);
        stamp.current = next.stamp;
        done(next);
      } catch (error) {
        if (error instanceof ApiError && error.status !== 401) announce(error.message);
        setAskedRate(null);
        await live.reload();
        const fresh = await api<Board>(`/api/jobs/${jobId}/board`).catch(() => null);
        if (fresh) stamp.current = fresh.stamp;
      } finally {
        pending.current -= 1;
      }
    });
    queue.current = run;
  }, [jobId, live]);

  const trim = useCallback((clip: StripClip, by: number) => {
    if (!board) return;
    const held = live.data?.board.frames.find((frame) => frame.number === clip.number)?.durationFrames ?? clip.durationFrames;
    const next = Math.max(1, held + by);
    if (next === held) return;
    setMotion('trim');
    live.set((data) => ({ ...data, board: withDuration(data.board, clip.number, next) }));
    write(
      (current) => api<Board>(`/api/jobs/${jobId}/frames/${clip.number}`, { method: 'PATCH', body: { durationFrames: next, stamp: current } }),
      () => announce(next === 1 ? fill(COPY.frameLengthOne, { number: clip.number }) : fill(COPY.frameLength, { number: clip.number, count: next })),
    );
  }, [board, jobId, live, write]);

  const changeRate = (rate: FrameRate) => {
    setAskedRate(rate);
    write(
      (current) => api<Board>(`/api/jobs/${jobId}/frame-rate`, { method: 'POST', body: { frameRate: rate, playhead: shown, stamp: current } }),
      (next) => {
        setMotion('rate');
        setAskedRate(null);
        setPosition(next.playhead as number);
        const { playhead: _playhead, ...published } = next;
        live.set((data) => ({ ...data, board: published }));
        announce(fill(COPY.rateChanged, { rate }));
      },
    );
  };

  const step = (by: number) => moveTo(Math.max(0, Math.min(total - 1, shown + by)));

  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data || !board) return <LoadingBars />;
  const title = `Reel for ${live.data.job.title}`;
  const clipNow = clipUnder(clips, shown)?.clip ?? null;
  return (
    <section className="screen">
      <Heading title={title} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      {clips.length ? (
        <Strip
          clips={clips}
          rate={board.frameRate}
          position={shown}
          onPosition={moveTo}
          groupLabel="Slate strip"
          clipLabel={(number) => `Frame ${number}`}
          motion={motion}
          targetLine={board.targetText}
          onTrim={trim}
          onLarge={(clip) => {
            setLargeClip(clip);
            large.show();
          }}
          onTogglePlay={toggle}
        />
      ) : (
        <EmptyState>This reel has no frames yet.</EmptyState>
      )}
      <p className="choices-title" aria-hidden="true">Frame rate</p>
      <RadioGroup
        label="Frame rate"
        name="frame-rate"
        value={askedRate ?? board.frameRate}
        options={FRAME_RATES.map((rate) => [rate, rate] as const)}
        onChange={(value) => changeRate(value as FrameRate)}
      />
      <BottomBar>
        <button type="button" className="btn btn-plain" onClick={() => step(-1)}>Earlier</button>
        <button type="button" className="btn" onClick={toggle}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="btn btn-plain" onClick={() => step(1)}>Later</button>
      </BottomBar>
      <Overlay
        state={large}
        title={largeClip ? `Frame ${largeClip.number}` : ''}
        className="panel-large"
        origin={() => (largeClip ? document.querySelector(`[data-part="clip"][data-frame="${largeClip.number}"]`) : null)}
      >
        <div data-part="frame-large" className="frame-large">
          {clipNow && largeClip?.drawingUrl ? <img src={largeClip.drawingUrl} alt="" /> : <div className="slate-empty" />}
        </div>
      </Overlay>
    </section>
  );
}
