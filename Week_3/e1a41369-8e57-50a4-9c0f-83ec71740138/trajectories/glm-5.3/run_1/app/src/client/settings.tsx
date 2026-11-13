import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStore } from './store.js';

/** Settings: time zone, day-start hour, rest mode, next day start (DP-18). */
export function SettingsPage() {
  const store = useStore();
  const player = store.player!;
  const [timeZone, setTimeZone] = useState(player.timeZone);
  const [dayStartHour, setDayStartHour] = useState(player.dayStartHour);
  const [zones, setZones] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');

  useEffect(() => {
    setTimeZone(player.timeZone);
    setDayStartHour(player.dayStartHour);
  }, [player.timeZone, player.dayStartHour]);

  useEffect(() => {
    // The full IANA list, fetched from the Intl API in the browser.
    const all = Intl.supportedValuesOf('timeZone');
    if (!all.includes(player.timeZone)) all.push(player.timeZone);
    setZones([...all].sort());
  }, [player.timeZone]);

  const save = async () => {
    setErrors({});
    setSaved('');
    try {
      await api.settings({ timeZone, dayStartHour });
      setSaved('Settings saved.');
    } catch (err) {
      const failure = err as { body?: { errors?: Record<string, string> } };
      if (failure.body?.errors) setErrors(failure.body.errors);
    }
  };

  const toggleRest = async (resting: boolean) => {
    try {
      await api.settings({ resting });
      void store.refreshAll();
    } catch {
      // the switch snaps back via the player payload
    }
  };

  return (
    <section className="settings-page">
      <h1 className="page-title">Settings</h1>
      <label htmlFor="tz-select">Time zone</label>
      <select id="tz-select" className="textbox" aria-label="Time zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
        {zones.map((z) => (
          <option key={z} value={z}>{z}</option>
        ))}
      </select>
      {errors.timeZone && <p className="field-error" role="alert">{errors.timeZone}</p>}

      <label htmlFor="hour-input">Day start hour</label>
      <input
        id="hour-input"
        className="textbox"
        type="number"
        min={0}
        max={23}
        step={1}
        role="spinbutton"
        aria-label="Day start hour"
        aria-valuenow={dayStartHour}
        value={dayStartHour}
        onChange={(e) => setDayStartHour(Number(e.target.value))}
      />
      {errors.dayStartHour && <p className="field-error" role="alert">{errors.dayStartHour}</p>}

      <div className="rest-row">
        <label htmlFor="rest-switch">Rest mode</label>
        <button
          id="rest-switch"
          type="button"
          role="switch"
          aria-checked={player.resting}
          className={`switch ${player.resting ? 'switch-on' : ''}`}
          onClick={() => void toggleRest(!player.resting)}
        >
          <span className="switch-knob" aria-hidden="true" />
        </button>
      </div>

      <button className="btn btn-primary" type="button" onClick={() => void save()}>Save settings</button>
      {saved && <p className="status-ok" role="status">{saved}</p>}

      <p className="next-day-start">Next day start: {player.nextDayStart}</p>
    </section>
  );
}
