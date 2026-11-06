import { useId, useRef, useState } from 'react';
import { COPY, fill } from '../../shared/copy';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import type { Cue, Job, Track } from '../types';
import { AsyncButton, BottomBar, EmptyState, focusHeading, Heading, LoadingBars, NARROW, NotFound, Problems, SelectField, TextField, classOf, useForm, useMedia } from '../ui/kit';
import { Overlay, useDialog, type DialogState } from '../ui/overlay';
import { JobNav } from './frame';
import { readJob } from './jobshared';

const PAUSE_MS = 300;
const MARKETS = [['NL', 'NL'], ['US', 'US'], ['CA', 'CA'], ['AE', 'AE']] as const;

function trackLabel(track: Track): string {
  return `${track.title} · ${track.composer} · ${track.seconds} s`;
}

function AddCue({ jobId, state, reload }: { jobId: string; state: DialogState; reload: () => Promise<void> }) {
  const form = useForm('addCue', () => ({ search: '', market: 'NL', from: '', until: '' }), { focusMessage: true });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [chosen, setChosen] = useState<Track | null>(null);
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const words = useRef('');
  const listId = useId();

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.status !== 401) form.refuse(error.message);
  };

  const search = (text: string) => {
    form.set('search', text);
    setChosen(null);
    words.current = text;
    if (timer.current) clearTimeout(timer.current);
    const mine = ++asked.current;
    if (!text.trim()) {
      setListOpen(false);
      setTracks([]);
      return;
    }
    timer.current = setTimeout(() => {
      api<{ tracks: Track[]; nextCursor: string | null }>(`/api/cues/search?q=${encodeURIComponent(text)}`).then((page) => {
        if (mine !== asked.current) return;
        setTracks(page.tracks);
        setNextCursor(page.nextCursor);
        setActive(-1);
        setListOpen(true);
      }, fail);
    }, PAUSE_MS);
  };

  const more = () => {
    if (!nextCursor) return;
    const mine = ++asked.current;
    api<{ tracks: Track[]; nextCursor: string | null }>(`/api/cues/search?q=${encodeURIComponent(words.current)}&cursor=${encodeURIComponent(nextCursor)}`).then((page) => {
      if (mine !== asked.current) return;
      setTracks((held) => [...held, ...page.tracks]);
      setNextCursor(page.nextCursor);
    }, fail);
  };

  const choose = (track: Track) => {
    setChosen(track);
    form.set('search', trackLabel(track));
    setListOpen(false);
    setActive(-1);
  };

  const optionCount = tracks.length + (nextCursor ? 1 : 0);
  const pressActive = () => {
    if (active < tracks.length) {
      const track = tracks[active];
      if (track) choose(track);
    } else {
      more();
    }
  };

  const save = () =>
    form.submit(async () => {
      const added = await api<Cue>(`/api/jobs/${jobId}/cues`, {
        method: 'POST',
        body: { trackId: chosen?.id ?? '', title: chosen?.title ?? '', composer: chosen?.composer ?? '', seconds: chosen?.seconds ?? 0, market: form.values.market, from: form.values.from, until: form.values.until },
      });
      await reload();
      announce(fill(COPY.cueAdded, { title: added.title }));
      state.hide();
    });

  const optionId = (index: number) => `${listId}-${index}`;
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <div className="field">
        <label htmlFor={form.fieldId('trackId')}>Search the library</label>
        <input
          id={form.fieldId('trackId')}
          data-first-field
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
          aria-invalid={form.fields.trackId ? true : undefined}
          aria-describedby={form.fields.trackId ? `${form.fieldId('trackId')}-message` : undefined}
          autoComplete="off"
          value={form.values.search}
          onChange={(event) => search(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && listOpen) {
              event.preventDefault();
              setListOpen(false);
              setActive(-1);
              return;
            }
            if (!listOpen || !optionCount) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((held) => (held + 1) % optionCount);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((held) => (held <= 0 ? optionCount - 1 : held - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (active >= 0) pressActive();
            }
          }}
        />
        {form.fields.trackId ? <p id={`${form.fieldId('trackId')}-message`} className="field-message"><span className="err-bar" aria-hidden="true" />{form.fields.trackId}</p> : null}
        {listOpen ? (
          <ul role="listbox" id={listId} aria-label="Search the library" className="combo-list" onPointerDown={(event) => event.preventDefault()}>
            {tracks.map((track, index) => (
              <li key={`${track.id}-${index}`} id={optionId(index)} role="option" aria-selected={active === index} onClick={() => choose(track)}>{trackLabel(track)}</li>
            ))}
            {nextCursor ? <li id={optionId(tracks.length)} role="option" aria-selected={active === tracks.length} onClick={more}>More results</li> : null}
          </ul>
        ) : null}
      </div>
      <SelectField form={form} name="market" label="Market" options={MARKETS} />
      <TextField form={form} name="from" label="From" />
      <TextField form={form} name="until" label="Until" />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

export function Cues({ jobId }: { jobId: string }) {
  const live = useLive<{ job: Job; cues: Cue[] }>(async () => {
    const [job, cues] = await Promise.all([readJob(jobId), api<{ cues: Cue[] }>(`/api/jobs/${jobId}/cues`)]);
    return { job, cues: cues.cues };
  });
  const add = useDialog('addCue');
  const narrow = useMedia(NARROW);
  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  const { job, cues } = live.data;
  return (
    <section className="screen">
      <Heading title={`Cues for ${job.title}`} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      <BottomBar><button type="button" className={classOf('primary')} onClick={add.show}>Add cue</button></BottomBar>
      <Overlay state={add} title="Add cue" fullHeight={narrow}><AddCue jobId={jobId} state={add} reload={live.reload} /></Overlay>
      {cues.length ? (
        <ul className="cue-list">
          {cues.map((cue) => (
            <li key={cue.id}>
              <p><strong>{cue.title}</strong> · {cue.composer} · <span className="tabular">{cue.seconds} s</span></p>
              <p className="facts"><span className="tabular">{cue.market} · {cue.from} – {cue.until}</span> · {cue.licenceText}</p>
              <AsyncButton
                kind="plain"
                label={`Remove cue ${cue.title}`}
                onPress={async () => {
                  try {
                    await api(`/api/jobs/${jobId}/cues/${cue.id}`, { method: 'DELETE' });
                    await live.reload();
                    announce(fill(COPY.cueRemoved, { title: cue.title }));
                    focusHeading();
                  } catch (error) {
                    if (error instanceof ApiError && error.status !== 401) announce(error.message);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      ) : <EmptyState>No cues on this job yet.</EmptyState>}
    </section>
  );
}
