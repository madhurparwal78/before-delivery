import { useEffect, useRef, useState } from 'react';
import { api, type Clip, type Run, type Scene, type Schedule } from './types.js';
import { useLive } from './live.js';
import { Sheet } from './sheet.js';
import { hhmm, hhmmss, longDate, addDays } from './time.js';

export function LogPage(): JSX.Element {
  const live = useLive();
  const [day, setDay] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [clip, setClip] = useState<Clip | null>(null);
  const prevBtn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    void api<{ scenes: Scene[] }>('/api/scenes').then((x) => setScenes(x.scenes));
    void api<{ schedules: Schedule[] }>('/api/schedules').then((x) => setSchedules(x.schedules));
    if (live.status) setDay(live.status.day);
  }, [live.status?.day]);

  useEffect(() => {
    if (!day) return;
    void api<{ runs: Run[] }>(`/api/runs?day=${day}`).then((x) => setRuns(x.runs));
  }, [day]);

  const dayClips = [...live.clips.values()].filter((c) => c.day === day).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const sceneName = (id: string): string => scenes.find((s) => s.id === id)?.name ?? id;
  const schedName = (id: string): string => schedules.find((s) => s.id === id)?.name ?? id;
  const isToday = live.status?.day === day;

  const heading = !day ? '' : isToday ? 'Today' : longDate(day);

  return (
    <div className="page">
      <h1>{heading}</h1>
      <div className="day-controls">
        <button ref={prevBtn} onClick={() => setDay((d) => addDays(d, -1))}>Previous day</button>
        <label>
          <span className="visually-hidden">Log day</span>
          <input type="date" value={day} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} aria-label="Log day" />
        </label>
        <button onClick={() => setDay((d) => addDays(d, 1))}>Next day</button>
      </div>
      <h2>Runs</h2>
      <ul className="runs-ul" aria-label="Runs">
        {runs.map((r) => (
          <li key={r.id} className="run-row">
            <span className="mono">{hhmm(r.ran_at)}</span> {sceneName(r.scene_id)} · {r.room_ids.length} rooms · {schedName(r.schedule_id)}
          </li>
        ))}
        {runs.length === 0 ? <li className="dim">No runs</li> : null}
      </ul>
      <h2>Clips</h2>
      <ul className="clips-ul" aria-label="Clips">
        {dayClips.map((c) => (
          <li key={c.id} className="clip-row">
            <button className="btn-ghost" onClick={() => setClip(c)}>{c.camera_name} {hhmmss(c.recorded_at)}</button>
            <span className="clip-state">{clipStateCopy(c)}</span>
          </li>
        ))}
        {dayClips.length === 0 ? <li className="dim">No clips</li> : null}
      </ul>
      <ClipSheet clipId={clip?.id ?? null} onClose={() => setClip(null)} />
    </div>
  );
}

export function clipStateCopy(c: Clip): string {
  if (c.state === 'stored') return `${c.stored_size} bytes`;
  if (c.state === 'size_mismatch') return 'Clip incomplete. Not saved.';
  return 'Storing clip…';
}

function ClipSheet(props: { clipId: string | null; onClose: () => void }): JSX.Element | null {
  const live = useLive();
  const { clipId, onClose } = props;
  const [mediaErr, setMediaErr] = useState('');
  const anchor = useRef<HTMLButtonElement | null>(null);

  const clip = clipId ? (live.clips.get(clipId) ?? null) : null;

  useEffect(() => {
    if (clipId) {
      void api<{ clip: Clip }>(`/api/clips/${clipId}`).catch(() => {});
    }
  }, [clipId]);

  if (!clip) return null;
  const playable = clip.state === 'stored' && clip.playable;

  return (
    <Sheet open={!!clipId} onClose={onClose} title={`Clip from ${clip.camera_name} at ${hhmmss(clip.recorded_at)}`} id="clip-sheet" anchorRef={anchor}>
      <h2>Clip from {clip.camera_name} at {hhmmss(clip.recorded_at)}</h2>
      <p className="mono">Declared {clip.declared_size} bytes{clip.stored_size !== null ? `, stored ${clip.stored_size} bytes` : ''}</p>
      <p>{clipStateCopy(clip)}</p>
      {mediaErr ? <p className="inline-error" role="alert">{mediaErr}</p> : null}
      <video controls preload="metadata" src={playable ? `/api/clips/${clip.id}/media` : undefined} className="clip-video" />
      <button
        className="btn"
        disabled={!playable}
        onClick={() => {
          const v = document.querySelector<HTMLVideoElement>('.clip-video');
          if (v) { v.play().catch(() => setMediaErr("The clip can't be loaded while clip storage is unreachable.")); }
        }}
      >
        Play
      </button>
      <button className="btn-ghost" onClick={onClose}>Close</button>
    </Sheet>
  );
}
