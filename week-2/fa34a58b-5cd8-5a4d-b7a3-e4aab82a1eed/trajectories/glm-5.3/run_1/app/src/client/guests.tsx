import { useEffect, useRef, useState } from 'react';
import { api, isApiFailure, type GuestScene, type Room, type Scene } from './types.js';
import { useLive } from './live.js';
import { Sheet } from './sheet.js';
import { hhmm, longDate } from './time.js';

const STATE_LABEL: Record<string, string> = { scheduled: 'Scheduled', active: 'Active', ended: 'Ended', cancelled: 'Cancelled' };

export function GuestsPage(): JSX.Element {
  const live = useLive();
  const [guests, setGuests] = useState<GuestScene[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);

  const load = (): void => {
    void api<{ guest_scenes: GuestScene[] }>('/api/guest-scenes').then((x) => setGuests(x.guest_scenes));
  };
  useEffect(() => {
    load();
    void api<{ rooms: Room[] }>('/api/rooms').then((x) => setRooms(x.rooms));
    void api<{ scenes: Scene[] }>('/api/scenes').then((x) => setScenes(x.scenes));
  }, []);
  useEffect(() => { if (live.guestScenes.size) load(); }, [live.guestScenes]);

  const roomName = (id: string): string => rooms.find((r) => r.id === id)?.name ?? id;
  const sceneName = (id: string): string => scenes.find((s) => s.id === id)?.name ?? id;

  const cancel = async (g: GuestScene): Promise<void> => {
    try {
      await api(`/api/guest-scenes/${g.id}/cancel`, { method: 'POST', body: '{}' });
    } catch (e) {
      if (isApiFailure(e)) { /* state already closed; the list refresh shows it */ }
    }
    load();
  };

  return (
    <div className="page">
      <h1>Guests</h1>
      <button ref={anchor} className="btn" onClick={() => setSheetOpen(true)}>New guest scene</button>
      <ul className="guests-ul" aria-label="Guest scenes">
        {guests.map((g) => (
          <li key={g.id} className="guest-row">
            {roomName(g.room_id)} · {sceneName(g.scene_id)} · {STATE_LABEL[g.state]} · until {hhmm(g.ends_at)} {longDate(g.ends_at.slice(0, 10))}
            {(g.state === 'scheduled' || g.state === 'active') ? (
              <button className="btn-ghost" onClick={() => { void cancel(g); }}>Cancel guest scene for {roomName(g.room_id)}</button>
            ) : null}
          </li>
        ))}
      </ul>
      <GuestSheet
        open={sheetOpen}
        rooms={rooms}
        scenes={scenes}
        onClose={() => { setSheetOpen(false); load(); }}
      />
    </div>
  );
}

function GuestSheet(props: { open: boolean; rooms: Room[]; scenes: Scene[]; onClose: () => void }): JSX.Element | null {
  const { open, rooms, scenes, onClose } = props;
  const [roomId, setRoomId] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [status, setStatus] = useState('');
  const [alert, setAlert] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState<string | null>(null);
  const keyRef = useRef(`guest-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (open) {
      setRoomId(rooms[0]?.id ?? '');
      setSceneId(scenes.find((s) => s.id === 'guest-welcome')?.id ?? scenes[0]?.id ?? '');
      setStarts('');
      setEnds('');
      setStatus('');
      setAlert('');
      setFieldErrors({});
    }
  }, [open]);

  if (!open) return null;

  const start = async (): Promise<void> => {
    setStatus('Starting guest scene…');
    setAlert('');
    setFieldErrors({});
    const body = JSON.stringify({
      room_id: roomId,
      scene_id: sceneId,
      starts_at: starts === '' ? null : starts,
      ends_at: ends,
    });
    try {
      const res = await api<{ guest_scene: GuestScene }>('/api/guest-scenes', { method: 'POST', body, headers: { 'Idempotency-Key': keyRef.current } });
      const g = res.guest_scene;
      setStatus(`Guest scene set for ${rooms.find((r) => r.id === g.room_id)?.name ?? ''} until ${hhmm(g.ends_at)} on ${longDate(g.ends_at.slice(0, 10))}.`);
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.error.fields) {
          setFieldErrors(e.error.fields);
          setStatus('Check the highlighted fields.');
        } else if (e.error.code === 'guest_overlap' || e.error.code === 'guest_scene_closed' || e.error.code === 'idempotency_conflict') {
          setAlert(e.error.message);
          setStatus('');
        } else {
          setStatus(e.error.message);
        }
      } else {
        setStatus("Nightplan can't reach the hub. Your last change was not saved.");
      }
    }
  };

  void cancelling;
  void setCancelling;

  return (
    <Sheet open={open} onClose={onClose} title="New guest scene" id="guest-sheet">
      <h2>New guest scene</h2>
      <label className="sheet-row">
        <span>Room</span>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Room">
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      {fieldErrors['room_id'] ? <span className="field-error" role="alert">{fieldErrors['room_id']}</span> : null}
      <label className="sheet-row">
        <span>Scene</span>
        <select value={sceneId} onChange={(e) => setSceneId(e.target.value)} aria-label="Scene">
          {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {fieldErrors['scene_id'] ? <span className="field-error" role="alert">{fieldErrors['scene_id']}</span> : null}
      <label className="sheet-row">
        <span>Starts</span>
        <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} aria-label="Starts" />
      </label>
      {fieldErrors['starts_at'] ? <span className="field-error" role="alert">{fieldErrors['starts_at']}</span> : null}
      <label className="sheet-row">
        <span>Ends</span>
        <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} aria-label="Ends" />
      </label>
      {fieldErrors['ends_at'] ? <span className="field-error" role="alert">{fieldErrors['ends_at']}</span> : null}
      {alert ? <div className="inline-error" role="alert">{alert}</div> : null}
      <button className="btn" onClick={() => { void start(); }}>Start guest scene</button>
      <button className="btn-ghost" onClick={onClose}>Close</button>
      <div role="status" aria-live="polite" id="guest-status">{status}</div>
    </Sheet>
  );
}
