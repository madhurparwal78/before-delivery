import { useState } from 'react';
import type { Player } from '../../shared/types.js';
import { ApiFailure, api } from '../api.js';
import { GENERIC_ERROR, refreshPlayer, showAlert } from '../store.js';

function zones(): string[] {
  const supported = Intl.supportedValuesOf('timeZone');
  return supported.includes('UTC') ? supported : ['UTC', ...supported];
}

export function Settings({ player }: { player: Player }): JSX.Element {
  const [timeZone, setTimeZone] = useState(player.timeZone);
  const [hour, setHour] = useState(String(player.dayStartHour));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = (): void => {
    setBusy(true);
    setStatus(null);
    setFieldErrors({});
    showAlert(null);
    void api
      .settings({ timeZone, dayStartHour: Number(hour) })
      .then(async () => {
        setStatus('Settings saved.');
        await refreshPlayer();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.status === 422) setFieldErrors(failure.fieldErrors);
        else showAlert(GENERIC_ERROR);
      })
      .finally(() => setBusy(false));
  };

  const toggleRest = (): void => {
    const next = !player.resting;
    void api
      .settings({ resting: next })
      .then(() => refreshPlayer())
      .catch(() => showAlert(GENERIC_ERROR));
  };

  return (
    <main className="settings">
      <h1 className="page-title">Settings</h1>
      <div className="field">
        <label htmlFor="time-zone">Time zone</label>
        <select id="time-zone" value={timeZone} onChange={(event) => setTimeZone(event.currentTarget.value)}>
          {zones().map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        {fieldErrors.timeZone ? (
          <p className="field-error" role="alert">
            {fieldErrors.timeZone}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="day-start-hour">Day start hour</label>
        <input
          id="day-start-hour"
          type="number"
          min={0}
          max={23}
          step={1}
          value={hour}
          onChange={(event) => setHour(event.currentTarget.value)}
        />
        {fieldErrors.dayStartHour ? (
          <p className="field-error" role="alert">
            {fieldErrors.dayStartHour}
          </p>
        ) : null}
      </div>
      <div className="field">
        <span className="group-label" id="rest-label">
          Rest mode
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={player.resting}
          aria-label="Rest mode"
          className={player.resting ? 'switch switch-on' : 'switch'}
          onClick={toggleRest}
        >
          {player.resting ? 'On' : 'Off'}
        </button>
      </div>
      <button type="button" className="primary" disabled={busy} onClick={save}>
        Save settings
      </button>
      <p className="next-close">{`Next day start: ${player.nextDayStart}`}</p>
      {status ? <p role="status">{status}</p> : null}
    </main>
  );
}
