import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COPY, fill, LABELS } from '../../shared/copy';
import { clockIn, printDateTime, TOWN_NAMES, TOWN_ZONES, type Town } from '../../shared/time';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { FAST } from '../motion';
import { navigate, useRoute, withParams } from '../router';
import type { Job, Note, Producer } from '../types';
import { AsyncButton, BottomBar, EmptyState, focusHeading, Heading, LoadingBars, NotFound, Select, WIDE, useMedia } from '../ui/kit';
import { Overlay, useDialog } from '../ui/overlay';
import { JobNav } from './frame';
import { readJob } from './jobshared';

interface Screen {
  job: Job;
  notes: Note[];
  producers: Producer[];
}

const STATE_OPTIONS = Object.entries(LABELS.noteState);
const STATE_COPY: Record<Note['state'], string> = { done: COPY.noteDone, wontDo: COPY.noteWontDo, open: COPY.noteReopened };

function Filters({ producers }: { producers: Producer[] }) {
  const route = useRoute();
  return (
    <div className="filters">
      <Select label="Note state" value={route.search.get('state') ?? ''} options={[['', 'All states'], ...STATE_OPTIONS]} onChange={(value) => navigate(withParams(route, { state: value }))} />
      <Select
        label="Producer"
        value={route.search.get('producer') ?? ''}
        options={[['', 'All producers'], ...producers.map((producer) => [producer.id, producer.name] as const)]}
        onChange={(value) => navigate(withParams(route, { producer: value }))}
      />
    </div>
  );
}

function SelectAll({ total, selected, onToggle }: { total: number; selected: number; onToggle: () => void }) {
  const box = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (box.current) box.current.indeterminate = selected > 0 && selected < total;
  });
  return (
    <label className="choice check">
      <input ref={box} type="checkbox" aria-label="Select all notes" checked={total > 0 && selected === total} onChange={onToggle} />
    </label>
  );
}

export function Notes({ jobId }: { jobId: string }) {
  const route = useRoute();
  const wide = useMedia(WIDE);
  const filters = useDialog('noteFilters');
  const query = new URLSearchParams();
  const stateFilter = route.search.get('state');
  const producerFilter = route.search.get('producer');
  if (stateFilter) query.set('state', stateFilter);
  if (producerFilter) query.set('producer', producerFilter);
  const address = query.toString();
  const known = useRef<Set<string> | null>(null);
  const live = useLive<Screen>(
    async () => {
      const job = await readJob(jobId);
      const [notes, producers, everyNote] = await Promise.all([
        api<{ notes: Note[] }>(`/api/jobs/${jobId}/notes${address ? `?${address}` : ''}`),
        api<{ producers: Producer[] }>(`/api/clients/${job.clientId}/producers`),
        api<{ notes: Note[] }>(`/api/jobs/${jobId}/notes`),
      ]);
      arrivals(everyNote.notes, producers.producers);
      return { job, notes: notes.notes, producers: producers.producers };
    },
    undefined,
    [address],
  );

  function arrivals(all: Note[], producers: Producer[]) {
    const ids = new Set(all.map((note) => note.id));
    if (known.current) {
      for (const note of all) {
        if (known.current.has(note.id)) continue;
        const town = (producers.find((producer) => producer.id === note.producerId)?.town ?? 'amsterdam') as Town;
        announce(fill(COPY.noteArrived, { name: note.producerName, number: note.frame, time: clockIn(new Date(note.createdAt).getTime(), TOWN_ZONES[town]), town: TOWN_NAMES[town] }));
      }
    }
    known.current = ids;
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const pendingHeading = useRef(false);

  const data = live.data;
  useEffect(() => {
    if (pendingHeading.current) {
      pendingHeading.current = false;
      focusHeading();
    }
  }, [data]);

  if (live.failedStatus === 404) return <NotFound />;
  if (!data) return <LoadingBars />;
  const { job, notes, producers } = data;
  const visibleSelected = notes.filter((note) => selected.has(note.id));
  const townOf = (note: Note): Town => producers.find((producer) => producer.id === note.producerId)?.town ?? 'amsterdam';

  const toggleOne = (note: Note, shift: boolean) => {
    setSelected((held) => {
      const next = new Set(held);
      if (shift && anchor.current) {
        const from = notes.findIndex((row) => row.id === anchor.current);
        const to = notes.findIndex((row) => row.id === note.id);
        for (const row of notes.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(row.id);
      } else if (next.has(note.id)) {
        next.delete(note.id);
      } else {
        next.add(note.id);
      }
      return next;
    });
    if (!shift) anchor.current = note.id;
  };

  const setState = async (note: Note, state: Note['state']) => {
    live.set((held) => ({ ...held, notes: held.notes.map((row) => (row.id === note.id ? { ...row, state } : row)) }));
    try {
      await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { state } });
      announce(STATE_COPY[state]);
      if (stateFilter && stateFilter !== state) {
        focusHeading();
        // The row shows its new state for one feedback beat before the filter takes it away.
        await new Promise((resolve) => setTimeout(resolve, FAST));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) announce(error.message);
    }
    await live.reload();
  };

  const markDone = async () => {
    const ids = visibleSelected.map((note) => note.id);
    try {
      await api(`/api/jobs/${jobId}/notes/mark`, { method: 'POST', body: { noteIds: ids, state: 'done' } });
      setSelected(new Set());
      await live.reload();
      announce(ids.length === 1 ? COPY.notesDoneOne : fill(COPY.notesDone, { count: ids.length }));
      focusHeading();
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) announce(error.message);
    }
  };

  const markLabel = visibleSelected.length === 1 ? 'Mark 1 note done' : `Mark ${visibleSelected.length} notes done`;

  return (
    <section className="screen">
      <Heading title={`Notes for ${job.title}`} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      {wide ? <Filters producers={producers} /> : <button type="button" className="btn btn-plain" onClick={filters.show}>Filters</button>}
      {!wide ? <Overlay state={filters} title="Filters" sheet><Filters producers={producers} /></Overlay> : null}
      {visibleSelected.length ? (
        <BottomBar><AsyncButton key="mark" label={markLabel} onPress={markDone} /></BottomBar>
      ) : null}
      {notes.length ? (
        <section role="region" aria-label="Notes table" className="table-frame" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th><SelectAll total={notes.length} selected={visibleSelected.length} onToggle={() => setSelected(visibleSelected.length === notes.length ? new Set() : new Set(notes.map((note) => note.id)))} /></th>
                <th>Frame</th><th>Timecode</th><th>Pin</th><th>Producer</th><th>State</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((note) => {
                const open = expanded.has(note.id);
                return (
                  <tr key={note.id}>
                    <td>
                      <label className="choice check">
                        <input
                          type="checkbox"
                          aria-label={`Select note on frame ${note.frame}`}
                          checked={selected.has(note.id)}
                          onChange={() => undefined}
                          onClick={(event) => toggleOne(note, event.shiftKey)}
                        />
                      </label>
                    </td>
                    <td>
                      <strong className="tabular">{note.frame}</strong>
                      <br />
                      <span className="note-place">{note.goneText ?? fill(COPY.notePosition, { position: note.position as number })}</span>
                    </td>
                    <td className="tabular"><span dir="ltr">{note.timecode}</span></td>
                    <td className="tabular">{note.x}, {note.y}</td>
                    <td className="name">
                      {note.producerName}
                      <br />
                      <span className="muted tabular">{printDateTime(new Date(note.createdAt).getTime(), townOf(note))}</span>
                    </td>
                    <td>
                      <Select label={`State of note on frame ${note.frame}`} value={note.state} options={STATE_OPTIONS} onChange={(value) => void setState(note, value as Note['state'])} />
                    </td>
                    <td className="note-cell">
                      <button
                        type="button"
                        className="btn btn-plain"
                        aria-label={`Expand note on frame ${note.frame}`}
                        aria-expanded={open}
                        onClick={() => setExpanded((held) => {
                          const next = new Set(held);
                          if (next.has(note.id)) next.delete(note.id);
                          else next.add(note.id);
                          return next;
                        })}
                      >
                        Expand
                      </button>
                      {open ? (
                        <div className="note-text">
                          <p>{note.text}</p>
                          {note.suggestedSeconds ? <p className="tabular">{note.suggestedSeconds} s · {note.suggestedFrames} frames</p> : null}
                          <p className="muted">{note.typedName}</p>
                          {note.attachmentUrl ? <a href={note.attachmentUrl}>Attachment</a> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : <EmptyState>No notes here yet.</EmptyState>}
    </section>
  );
}
