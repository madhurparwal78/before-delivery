import { useEffect, useRef, useState } from 'react';
import { api, isApiFailure, type Scene } from './types.js';
import { useLive } from './live.js';
import { Sheet } from './sheet.js';

const TINTS = ['Amber', 'Honey', 'Ember', 'Rose', 'Dusk', 'Candle'] as const;
const TINT_HEX: Record<string, string> = {
  candle: '#f2dca8', honey: '#e3b34c', amber: '#ffb347', rose: '#e8a87c', dusk: '#a87c4f', ember: '#b5622f',
};

export function ScenesPage(): JSX.Element {
  const live = useLive();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [editing, setEditing] = useState<Scene | 'new' | null>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);

  const load = (): void => {
    void api<{ scenes: Scene[] }>('/api/scenes').then((x) => setScenes(x.scenes));
  };
  useEffect(load, []);
  useEffect(() => { if (live.scenes.size) load(); }, [live.scenes]);

  return (
    <div className="page">
      <h1>Scenes</h1>
      <button ref={anchor} className="btn" onClick={() => setEditing('new')}>New scene</button>
      <ul className="scenes-ul" aria-label="Scenes">
        {scenes.map((s) => (
          <li key={s.id} className="scene-row">
            <span className="legend-swatch" style={{ background: TINT_HEX[s.tint] ?? '#333' }} />
            <span className="scene-name">{s.name}</span>
            <span className="mono">{s.brightness}%</span>
            <span className="mono">{s.setpoint_f !== null ? `${s.setpoint_f}°F` : ''}</span>
            <button className="btn-ghost" onClick={() => setEditing(s)}>Edit {s.name}</button>
          </li>
        ))}
      </ul>
      <SceneSheet editing={editing} onClose={() => { setEditing(null); load(); }} />
    </div>
  );
}

function SceneSheet(props: { editing: Scene | 'new' | null; onClose: () => void }): JSX.Element | null {
  const { editing, onClose } = props;
  const isNew = editing === 'new';
  const [name, setName] = useState('');
  const [tint, setTint] = useState('amber');
  const [brightness, setBrightness] = useState(50);
  const [setpoint, setSetpoint] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editing === null) return;
    if (editing === 'new') {
      setName(''); setTint('amber'); setBrightness(50); setSetpoint(null);
    } else {
      setName(editing.name); setTint(editing.tint); setBrightness(editing.brightness); setSetpoint(editing.setpoint_f);
    }
    setStatus('');
    setFieldErrors({});
  }, [editing]);

  if (editing === null) return null;

  const save = async (): Promise<void> => {
    setStatus(isNew ? 'Creating scene…' : 'Saving scene…');
    setFieldErrors({});
    const body = JSON.stringify({ name, tint, brightness, setpoint_f: setpoint });
    try {
      if (isNew) {
        await api('/api/scenes', { method: 'POST', body });
        setStatus('Scene created. Add it to a schedule slot to give it rooms.');
      } else {
        await api(`/api/scenes/${(editing as Scene).id}`, { method: 'PUT', body });
        setStatus('Scene saved.');
      }
    } catch (e) {
      if (isApiFailure(e) && e.error.fields) {
        setFieldErrors(e.error.fields);
        setStatus('Check the highlighted fields.');
      } else if (isApiFailure(e)) {
        setStatus(e.error.message);
      } else {
        setStatus("Nightplan can't reach the hub. Your last change was not saved.");
      }
    }
  };

  return (
    <Sheet open={editing !== null} onClose={onClose} title={isNew ? 'New scene' : `Edit ${name}`} id="scene-sheet">
      <h2>{isNew ? 'New scene' : `Edit ${name}`}</h2>
      <label className="sheet-row">
        <span>Scene name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Scene name" />
      </label>
      {fieldErrors['name'] ? <span className="field-error" role="alert">{fieldErrors['name']}</span> : null}
      <fieldset className="sheet-row">
        <legend>Tint</legend>
        <div role="radiogroup" aria-label="Tint" className="tint-radios">
          {TINTS.map((t) => (
            <label key={t} className="tint-radio">
              <input type="radio" name="tint" value={t.toLowerCase()} checked={tint === t.toLowerCase()} onChange={() => setTint(t.toLowerCase())} />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      {fieldErrors['tint'] ? <span className="field-error" role="alert">{fieldErrors['tint']}</span> : null}
      <label className="sheet-row">
        <span>Brightness</span>
        <input type="number" min={0} max={100} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} aria-label="Brightness" />
      </label>
      {fieldErrors['brightness'] ? <span className="field-error" role="alert">{fieldErrors['brightness']}</span> : null}
      <label className="sheet-row">
        <span>Setpoint</span>
        <input type="number" min={60} max={80} value={setpoint ?? ''} onChange={(e) => setSetpoint(e.target.value === '' ? null : Number(e.target.value))} aria-label="Setpoint" />
      </label>
      {fieldErrors['setpoint_f'] ? <span className="field-error" role="alert">{fieldErrors['setpoint_f']}</span> : null}
      <button className="btn" onClick={() => { void save(); }}>{isNew ? 'Create scene' : 'Save scene'}</button>
      <button className="btn-ghost" onClick={onClose}>Close</button>
      <div role="status" aria-live="polite" id="scene-save-status">{status}</div>
    </Sheet>
  );
}
