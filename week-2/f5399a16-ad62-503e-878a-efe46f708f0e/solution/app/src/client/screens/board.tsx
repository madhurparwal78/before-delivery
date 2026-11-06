import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COPY, fill, LABELS } from '../../shared/copy';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { travel, type Rect } from '../motion';
import type { Board, Frame, Job, Removal } from '../types';
import { AsyncButton, BottomBar, EmptyState, focusHeading, Heading, LoadingBars, NotFound, Problems, TextArea, TextField, ThumbMask, classOf, useForm } from '../ui/kit';
import { MenuButton } from '../ui/menu';
import { Overlay, useDialog, type DialogState } from '../ui/overlay';
import { JobNav } from './frame';
import { readJob } from './jobshared';

interface Screen {
  job: Job;
  board: Board;
  removals: Removal[];
}

// Uploads ------------------------------------------------------------------------------------------

interface UploadRow {
  id: number;
  file: File;
  state: 'Sending' | 'Stored' | 'Refused';
  message: string | null;
}

function Uploads({ jobId, onStored, clientFile }: { jobId: string; onStored: () => void; clientFile: React.RefObject<HTMLInputElement | null> }) {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const next = useRef(1);

  const send = useCallback(async (id: number, file: File) => {
    setRows((held) => held.map((row) => (row.id === id ? { ...row, state: 'Sending', message: null } : row)));
    try {
      await api(`/api/jobs/${jobId}/frames`, { method: 'POST', file });
      setRows((held) => held.map((row) => (row.id === id ? { ...row, state: 'Stored' } : row)));
      announce(fill(COPY.stored, { 'file name': file.name }));
      onStored();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : COPY.storeDown;
      setRows((held) => held.map((row) => (row.id === id ? { ...row, state: 'Refused', message } : row)));
      announce(fill(COPY.uploadRefused, { 'file name': file.name, refusal: message }));
    }
  }, [jobId, onStored]);

  const take = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const id = next.current++;
      setRows((held) => [...held, { id, file, state: 'Sending', message: null }]);
      void send(id, file);
    }
  };

  return (
    <div
      className="upload-area"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        take(event.dataTransfer.files);
      }}
    >
      <input
        ref={clientFile}
        className="sr-only"
        type="file"
        multiple
        tabIndex={-1}
        accept="image/png,image/jpeg"
        aria-label="Frame files"
        onChange={(event) => {
          if (event.target.files) take(event.target.files);
          event.target.value = '';
        }}
      />
      {rows.length ? (
        <ul aria-label="Uploads" className="uploads">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="file-name">{row.file.name}</span>
              <span className="file-state">{row.message ?? row.state}</span>
              {row.state === 'Refused' ? (
                <button type="button" className="btn btn-plain" onClick={() => void send(row.id, row.file)}>Try again</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted drop-hint">Drop drawings here, or use Upload frames.</p>}
    </div>
  );
}

// Dialogs ------------------------------------------------------------------------------------------

function EditJob({ job, state, reload }: { job: Job; state: DialogState; reload: () => Promise<void> }) {
  const form = useForm(`editJob:${job.id}`, () => ({ title: job.title, adId: job.adId, dueDate: job.dueDate, targetSeconds: String(job.targetSeconds) }), { focusMessage: true });
  const save = () =>
    form.submit(async () => {
      await api(`/api/jobs/${job.id}`, { method: 'PATCH', body: { ...form.values, targetSeconds: Number(form.values.targetSeconds) } });
      await reload();
      announce(COPY.jobSaved);
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <TextField form={form} name="title" label="Title" />
      <TextField form={form} name="adId" label="Ad-ID" />
      <TextField form={form} name="dueDate" label="Due date" />
      <div className="field">
        <label htmlFor="edit-target">Target length</label>
        <select id="edit-target" value={form.values.targetSeconds} onChange={(event) => form.set('targetSeconds', event.target.value)}>
          {Object.entries(LABELS.target).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </div>
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

function EditFrame({ frame, stamp, jobId, state, apply }: { frame: Frame; stamp: string; jobId: string; state: DialogState; apply: (board: Board) => void }) {
  const form = useForm(`editFrame:${jobId}:${frame.number}`, () => ({ durationFrames: String(frame.durationFrames), actionNote: frame.actionNote }), { focusMessage: true });
  const stampWhenOpened = useRef(stamp);
  const save = () =>
    form.submit(async () => {
      if (!/^\d+$/.test(form.values.durationFrames)) {
        form.refuse('Type a whole number of frames, at least 1.', { durationFrames: 'Type a whole number of frames, at least 1.' });
        return;
      }
      const board = await api<Board>(`/api/jobs/${jobId}/frames/${frame.number}`, {
        method: 'PATCH',
        body: { durationFrames: Number(form.values.durationFrames), actionNote: form.values.actionNote, stamp: stampWhenOpened.current },
      });
      apply(board);
      announce(fill(COPY.frameSaved, { number: frame.number }));
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <TextField form={form} name="durationFrames" label="Duration in frames" inputMode="decimal" numeric />
      <TextArea form={form} name="actionNote" label="Action note" />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

// The board -----------------------------------------------------------------------------------------

export function BoardScreen({ jobId }: { jobId: string }) {
  const live = useLive<Screen>(async () => {
    const [job, board, removals] = await Promise.all([
      readJob(jobId),
      api<Board>(`/api/jobs/${jobId}/board`),
      api<{ removals: Removal[] }>(`/api/jobs/${jobId}/removals`),
    ]);
    return { job, board, removals: removals.removals };
  });
  const [focusedNumber, setFocusedNumber] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const tiles = useRef(new Map<number, HTMLDivElement>());
  const rects = useRef(new Map<number, Rect>());
  const order = useRef('');
  const refocus = useRef<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const editJob = useDialog(`editJob:${jobId}`);
  const editFrame = useDialog('editFrame');
  const fileInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ number: number; x: number; y: number; moved: boolean } | null>(null);

  const board = live.data?.board ?? null;
  const stampNow = useRef('');
  if (board) stampNow.current = board.stamp;
  const frames = useMemo(() => board?.frames ?? [], [board]);
  const current = frames.find((frame) => frame.number === focusedNumber) ?? frames[0] ?? null;
  const signature = frames.map((frame) => frame.number).join(',');

  useLayoutEffect(() => {
    if (order.current && order.current !== signature) {
      for (const [number, element] of tiles.current) {
        const was = rects.current.get(number);
        if (was) travel(element, was);
      }
    }
    order.current = signature;
    rects.current.clear();
    for (const [number, element] of tiles.current) {
      const box = element.getBoundingClientRect();
      rects.current.set(number, { left: box.left, top: box.top });
    }
    if (refocus.current !== null) {
      tiles.current.get(refocus.current)?.focus({ preventScroll: true });
      refocus.current = null;
    }
  });

  const applyBoard = useCallback((next: Board) => {
    stampNow.current = next.stamp;
    live.set((held) => ({ ...held, board: next }));
  }, [live]);

  const refusal = (error: unknown) => {
    if (error instanceof ApiError && error.status !== 401) announce(error.message);
  };

  /** Board writes run one after another, each with the newest stamp. */
  const write = useCallback(<T,>(work: (stamp: string) => Promise<T>): Promise<T | undefined> => {
    const run = queue.current.then(() => work(stampNow.current));
    queue.current = run.catch(() => undefined);
    return run.catch((error: unknown) => {
      refusal(error);
      void live.reload();
      return undefined;
    });
  }, [live]);

  const moveTo = async (frame: Frame, position: number) => {
    const count = frames.length;
    if (position < 1 || position > count) return;
    const next = await write((stamp) => api<Board>(`/api/jobs/${jobId}/frames/${frame.number}/move`, { method: 'POST', body: { position, stamp } }));
    if (next) {
      applyBoard(next);
      announce(fill(COPY.frameMoved, { number: frame.number, position, count }));
    }
  };

  const remove = async (frame: Frame) => {
    await write(async (stamp) => {
      await api(`/api/jobs/${jobId}/removals`, { method: 'POST', body: { frame: frame.number, stamp } });
      await live.reload();
      announce(fill(COPY.frameRemoved, { number: frame.number }));
      setFocusedNumber(null);
      focusHeading();
    });
  };

  const duplicate = async (frame: Frame) => {
    const before = new Set(frames.map((held) => held.number));
    const next = await write((stamp) => api<Board>(`/api/jobs/${jobId}/frames/${frame.number}/duplicate`, { method: 'POST', body: { stamp } }));
    if (next) {
      applyBoard(next);
      const copy = next.frames.find((held) => !before.has(held.number))?.number as number;
      announce(fill(COPY.frameDuplicated, { number: frame.number, copy }));
    }
  };

  const insertAfter = async (frame: Frame) => {
    const before = new Set(frames.map((held) => held.number));
    const next = await write((stamp) => api<Board>(`/api/jobs/${jobId}/frames/${frame.number}/insert-after`, { method: 'POST', body: { stamp } }));
    if (next) {
      applyBoard(next);
      const copy = next.frames.find((held) => !before.has(held.number))?.number as number;
      announce(fill(COPY.frameInserted, { copy, number: frame.number }));
    }
  };

  const undo = async (number: number) => {
    try {
      const next = await api<Board>(`/api/jobs/${jobId}/removals/${number}/undo`, { method: 'POST' });
      applyBoard(next);
      await live.reload();
      refocus.current = number;
      setFocusedNumber(number);
      announce(fill(COPY.frameBack, { number }));
    } catch (error) {
      refusal(error);
      await live.reload();
    }
  };

  const onBoardKey = (event: React.KeyboardEvent) => {
    if (!current) return;
    const index = frames.findIndex((frame) => frame.number === current.number);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(new Set(frames.map((frame) => frame.number)));
      return;
    }
    if (event.key === 'Escape') {
      if (selected.size) {
        event.preventDefault();
        setSelected(new Set());
      }
      return;
    }
    const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    if (event.altKey) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        refocus.current = current.number;
        void moveTo(current, index + 1 + delta);
      }
      return;
    }
    const target = frames[index + delta];
    if (!target) return;
    if (event.shiftKey) {
      const start = anchor.current ?? current.number;
      anchor.current = start;
      const a = frames.findIndex((frame) => frame.number === start);
      const b = index + delta;
      setSelected(new Set(frames.slice(Math.min(a, b), Math.max(a, b) + 1).map((frame) => frame.number)));
    } else {
      anchor.current = target.number;
    }
    setFocusedNumber(target.number);
    tiles.current.get(target.number)?.focus();
  };

  const tilePointerUp = (event: React.PointerEvent) => {
    const held = drag.current;
    drag.current = null;
    if (!held?.moved) return;
    const under = frames.find((frame) => {
      const box = tiles.current.get(frame.number)?.getBoundingClientRect();
      return box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    });
    const moved = frames.find((frame) => frame.number === held.number);
    if (under && moved && under.number !== moved.number) {
      refocus.current = moved.number;
      void moveTo(moved, under.position);
    }
  };

  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data || !board) return <LoadingBars />;
  const { job, removals } = live.data;
  const position = current ? frames.findIndex((frame) => frame.number === current.number) + 1 : 0;

  return (
    <section className="screen">
      <Heading title={job.title} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      <p className="facts">{job.clientName} · {LABELS.jobState[job.state]} · <span className="tabular">{board.frameRate}</span> · <span className="tabular">{board.secondsText}</span> · {board.targetText}</p>
      <div className="tools">
        <button type="button" className="btn btn-plain" onClick={editJob.show}>Edit job</button>
      </div>
      <Overlay state={editJob} title="Edit job"><EditJob job={job} state={editJob} reload={live.reload} /></Overlay>
      <BottomBar>
        <button type="button" className={classOf('primary')} onClick={() => fileInput.current?.click()}>Upload frames</button>
      </BottomBar>
      <Uploads jobId={jobId} onStored={() => void live.reload()} clientFile={fileInput} />
      {removals.length ? (
        <ul className="removals" aria-label="Removed frames">
          {removals.map((removal) => (
            <li key={removal.frame}>
              <span>{fill(COPY.frameRemoved, { number: removal.frame })}</span>
              <UndoButton jobId={jobId} number={removal.frame} onUndo={undo} onGone={() => void live.reload()} />
            </li>
          ))}
        </ul>
      ) : null}
      {frames.length ? (
        <div
          role="listbox"
          aria-label="Board"
          aria-multiselectable="true"
          className="board-grid"
          onKeyDown={onBoardKey}
          onPointerMove={(event) => {
            if (drag.current && (Math.abs(event.clientX - drag.current.x) > 6 || Math.abs(event.clientY - drag.current.y) > 6)) drag.current.moved = true;
          }}
          onPointerUp={tilePointerUp}
        >
          {frames.map((frame) => (
            <div
              key={frame.number}
              ref={(element) => {
                if (element) tiles.current.set(frame.number, element);
                else tiles.current.delete(frame.number);
              }}
              role="option"
              aria-label={`Frame ${frame.number}`}
              aria-description={`${frame.durationFrames} frames. ${frame.actionNote}`}
              aria-selected={selected.has(frame.number)}
              data-part="board-frame"
              data-frame={frame.number}
              data-position={frame.position}
              tabIndex={frame.number === current?.number ? 0 : -1}
              className="board-frame"
              onFocus={() => setFocusedNumber(frame.number)}
              onClick={() => {
                setFocusedNumber(frame.number);
                anchor.current = frame.number;
                setSelected(new Set());
                tiles.current.get(frame.number)?.focus();
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'mouse' && innerWidth >= 768) {
                  drag.current = { number: frame.number, x: event.clientX, y: event.clientY, moved: false };
                  (event.currentTarget.parentElement as HTMLElement).setPointerCapture(event.pointerId);
                }
              }}
            >
              <ThumbMask src={frame.drawingUrl} />
              <p className="frame-caption"><strong>{frame.number}</strong> <span className="tabular" data-text={frame.durationFrames} /></p>
              <p className="frame-note" data-text={frame.actionNote} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>This board has no frames yet.</EmptyState>
      )}
      {current ? (
        <div role="group" aria-label="Frame tools" className="tools frame-tools">
          <AsyncButton kind="plain" label="Move earlier" disabledReason={position <= 1} onPress={() => moveTo(current, position - 1)} />
          <AsyncButton kind="plain" label="Move later" disabledReason={position >= frames.length} onPress={() => moveTo(current, position + 1)} />
          <button type="button" className="btn btn-plain" onClick={editFrame.show}>{`Edit frame ${current.number}`}</button>
          <MenuButton
            label={`Actions for frame ${current.number}`}
            items={[
              { label: 'Duplicate', onSelect: () => void duplicate(current) },
              { label: 'Insert after', onSelect: () => void insertAfter(current) },
              { label: 'Remove', onSelect: () => void remove(current) },
            ]}
          />
          <Overlay state={editFrame} title={`Edit frame ${current.number}`}>
            <EditFrame key={current.number} frame={current} stamp={board.stamp} jobId={jobId} state={editFrame} apply={applyBoard} />
          </Overlay>
        </div>
      ) : null}
    </section>
  );
}

const HOLD_EVERY_MS = 2000;

/** Hovering or focusing Undo holds the window; the server ends it either way. */
function UndoButton({ jobId, number, onUndo, onGone }: { jobId: string; number: number; onUndo: (number: number) => Promise<void>; onGone: () => void }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holding = useRef(0);
  const renew = useCallback(() => {
    api(`/api/jobs/${jobId}/removals/${number}/hold`, { method: 'POST' }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 409) onGone();
    });
  }, [jobId, number, onGone]);
  const start = () => {
    holding.current += 1;
    if (timer.current) return;
    renew();
    timer.current = setInterval(renew, HOLD_EVERY_MS);
  };
  const stop = () => {
    holding.current = Math.max(0, holding.current - 1);
    if (holding.current === 0 && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  useLayoutEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);
  return (
    <span onPointerEnter={start} onPointerLeave={stop} onFocus={start} onBlur={stop}>
      <AsyncButton kind="ink" label="Undo" onPress={() => onUndo(number)} />
    </span>
  );
}
