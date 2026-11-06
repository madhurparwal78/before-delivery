import { useEffect, useRef, useState } from 'react';
import { api, isApiFailure, type Schedule, type Scene, type Room } from './types.js';
import { useLive } from './live.js';
import { Sheet } from './sheet.js';
import { longDate } from './time.js';

export function SchedulesPage(): JSX.Element {
  const live = useLive();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tab, setTab] = useState('weekday');
  const [editing, setEditing] = useState<string | null>(null);

  const load = (): void => {
    void api<{ schedules: Schedule[] }>('/api/schedules').then((x) => setSchedules(x.schedules));
    void api<{ scenes: Scene[] }>('/api/scenes').then((x) => setScenes(x.scenes));
    void api<{ rooms: Room[] }>('/api/rooms').then((x) => setRooms(x.rooms));
  };
  useEffect(load, []);
  // Repaint to the winner's slots when a save lands.
  useEffect(() => { if (live.scheduleRevs.size) load(); }, [live.scheduleRevs]);

  const sceneName = (id: string): string => scenes.find((s) => s.id === id)?.name ?? '';
  const roomName = (id: string): string => rooms.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="page">
      <h1>Schedules</h1>
      <div role="tablist" aria-label="Schedules">
        {schedules.map((s) => (
          <button key={s.id} role="tab" aria-selected={tab === s.id} className={tab === s.id ? 'tab tab-on' : 'tab'} onClick={() => setTab(s.id)}>{s.name}</button>
        ))}
      </div>
      {schedules.filter((s) => s.id === tab).map((s) => (
        <div key={s.id} role="tabpanel" aria-label={s.name}>
          {s.versions.map((v) => (
            <div key={v.from} className="version-block">
              <h2>From {longDate(v.from)}</h2>
              <ul className="slot-list">
                {v.slots.map((slot) => (
                  <li key={slot.id}><span className="mono">{slot.time}</span> {sceneName(slot.scene_id)} — {slot.room_ids.map(roomName).join(', ')}</li>
                ))}
              </ul>
            </div>
          ))}
          <button className="btn" onClick={() => setEditing(s.id)}>Edit {s.name} schedule</button>
        </div>
      ))}
      <ScheduleEditor
        scheduleId={editing}
        schedules={schedules}
        scenes={scenes}
        rooms={rooms}
        onClose={() => { setEditing(null); load(); }}
        onSaved={() => load()}
      />
    </div>
  );
}

interface EditSlot { time: string; scene_id: string; room_ids: string[] }

function ScheduleEditor(props: {
  scheduleId: string | null;
  schedules: Schedule[];
  scenes: Scene[];
  rooms: Room[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element | null {
  const { scheduleId, schedules, scenes, rooms, onClose, onSaved } = props;
  const live = useLive();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [slots, setSlots] = useState<EditSlot[]>([]);
  const [from, setFrom] = useState('');
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!scheduleId || !live.status) return;
    const s = schedules.find((x) => x.id === scheduleId);
    if (!s) return;
    // Load the version in force on the hub's today.
    let chosen = s.versions[0]!;
    for (const v of s.versions) { if (v.from <= live.status.day) chosen = v; }
    setSlots(chosen.slots.map((sl) => ({ time: sl.time, scene_id: sl.scene_id, room_ids: [...sl.room_ids] })));
    setFrom(live.status.day);
    setRevision(s.revision);
    setStatus('');
    setConflict(false);
    setFieldErrors({});
  }, [scheduleId]);

  if (!scheduleId) return null;
  const sched = schedules.find((x) => x.id === scheduleId);

  const save = async (): Promise<void> => {
    setStatus('Saving schedule…');
    setFieldErrors({});
    try {
      await api(`/api/schedules/${scheduleId}`, { method: 'PUT', body: JSON.stringify({ revision, from, slots }) });
      setStatus(`Saved. ${sched?.name ?? ''} slots change from ${longDate(from)}.`);
      setConflict(false);
      const fresh = await api<{ schedule: Schedule }>(`/api/schedules/${scheduleId}`);
      setRevision(fresh.schedule.revision);
      onSaved();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.error.code === 'schedule_changed') {
          setConflict(true);
          setStatus('');
        } else if (e.error.fields) {
          setFieldErrors(e.error.fields);
          setStatus('Check the highlighted fields.');
        } else {
          setStatus(e.error.message);
        }
      } else {
        setStatus("Nightplan can't reach the hub. Your last change was not saved.");
      }
    }
  };

  const reload = async (): Promise<void> => {
    const fresh = await api<{ schedule: Schedule }>(`/api/schedules/${scheduleId}`);
    let chosen = fresh.schedule.versions[0]!;
    for (const v of fresh.schedule.versions) { if (v.from <= from) chosen = v; }
    setSlots(chosen.slots.map((sl) => ({ time: sl.time, scene_id: sl.scene_id, room_ids: [...sl.room_ids] })));
    setRevision(fresh.schedule.revision);
    setConflict(false);
    setStatus('');
  };

  return (
    <Sheet open={!!scheduleId} onClose={onClose} title={`Edit ${sched?.name ?? ''} schedule`} id="schedule-editor" anchorRef={anchor}>
      <h2>Edit {sched?.name} schedule</h2>
      <label className="sheet-row">
        <span>From</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
      </label>
      {fieldErrors['from'] ? <span className="field-error" role="alert">{fieldErrors['from']}</span> : null}
      {fieldErrors['slots'] ? <span className="field-error" role="alert">{fieldErrors['slots']}</span> : null}
      <div className="slots-editor">
        {slots.map((slot, i) => (
          <fieldset key={i} className="slot-group">
            <legend>Slot {i + 1}</legend>
            <label className="sheet-row">
              <span>Time</span>
              <input type="time" value={slot.time} aria-label="Time" onChange={(e) => { const next = [...slots]; next[i] = { ...slot, time: e.target.value }; setSlots(next); }} />
            </label>
            {fieldErrors[`slots.${i}.time`] ? <span className="field-error" role="alert">{fieldErrors[`slots.${i}.time`]}</span> : null}
            <label className="sheet-row">
              <span>Scene</span>
              <select value={slot.scene_id} aria-label="Scene" onChange={(e) => { const next = [...slots]; next[i] = { ...slot, scene_id: e.target.value }; setSlots(next); }}>
                {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {fieldErrors[`slots.${i}.scene_id`] ? <span className="field-error" role="alert">{fieldErrors[`slots.${i}.scene_id`]}</span> : null}
            <div className="room-checks">
              {rooms.map((r) => (
                <label key={r.id} className="room-check">
                  <input
                    type="checkbox"
                    aria-label={r.name}
                    checked={slot.room_ids.includes(r.id)}
                    onChange={(e) => {
                      const next = [...slots];
                      next[i] = { ...slot, room_ids: e.target.checked ? [...slot.room_ids, r.id] : slot.room_ids.filter((x) => x !== r.id) };
                      setSlots(next);
                    }}
                  />
                  {r.name}
                </label>
              ))}
            </div>
            {fieldErrors[`slots.${i}.room_ids`] ? <span className="field-error" role="alert">{fieldErrors[`slots.${i}.room_ids`]}</span> : null}
            <button className="btn-ghost" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>Remove slot {i + 1}</button>
          </fieldset>
        ))}
      </div>
      <button className="btn-ghost" onClick={() => setSlots([...slots, { time: '00:00', scene_id: scenes[0]?.id ?? '', room_ids: [] }])}>Add slot</button>
      <button className="btn" onClick={() => { void save(); }}>Save schedule</button>
      {conflict ? (
        <>
          <div className="inline-error" role="alert">Someone else changed this schedule. Reload it to see their change.</div>
          <button className="btn" onClick={() => { void reload(); }}>Reload schedule</button>
        </>
      ) : null}
      <button className="btn-ghost" onClick={onClose}>Close</button>
      <div role="status" aria-live="polite" id="schedule-save-status">{status}</div>
    </Sheet>
  );
}
