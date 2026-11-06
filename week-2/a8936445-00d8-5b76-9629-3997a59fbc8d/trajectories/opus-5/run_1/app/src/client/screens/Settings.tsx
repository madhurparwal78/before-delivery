import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../api';
import { useFeedback } from '../feedback';
import type { Policy } from '../types';

export function SettingsScreen(): JSX.Element {
  const { perform, background, fieldErrors } = useFeedback();
  const [history, setHistory] = useState<Policy[]>([]);
  const [freeWindow, setFreeWindow] = useState('48');
  const [latePercent, setLatePercent] = useState('50');
  const [basedOn, setBasedOn] = useState(1);

  const load = useCallback(
    async (announce: boolean): Promise<void> => {
      const run = (): Promise<{ current: Policy; history: Policy[] }> =>
        apiGet<{ current: Policy; history: Policy[] }>('/api/cancellation-policy');
      const result = announce
        ? await perform({ pending: 'Loading…', success: () => '', run })
        : await background({ run });
      if (result) {
        setHistory(result.history);
        setFreeWindow(String(result.current.free_window_hours));
        setLatePercent(String(result.current.late_fee_percent));
        setBasedOn(result.current.version);
      }
    },
    [perform, background],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    await perform({
      pending: 'Saving policy…',
      success: (policy: Policy) =>
        `Policy version ${policy.version} applies to bookings confirmed from now on. Existing bookings keep their terms.`,
      errors: (failure) =>
        failure.code === 'stale_version'
          ? `The policy changed since you opened it. Reload to see version ${String(failure.details['current_version'])}.`
          : null,
      run: () =>
        apiSend<Policy>('PUT', '/api/cancellation-policy', {
          free_window_hours: Number.parseInt(freeWindow, 10),
          late_fee_percent: Number.parseInt(latePercent, 10),
          based_on_version: basedOn,
        }),
    });
    void load(false);
  };

  return (
    <div>
      <h1>Settings</h1>
      <form className="panel" aria-label="Cancellation policy" onSubmit={(event) => void save(event)}>
        <h2>Cancellation policy</h2>
        <div className="field">
          <label htmlFor="free-window">Free cancellation window (hours)</label>
          <input
            id="free-window"
            type="number"
            min={0}
            max={168}
            step={1}
            value={freeWindow}
            aria-describedby={fieldErrors['free_window_hours'] ? 'free-window-error' : undefined}
            onChange={(event) => setFreeWindow(event.target.value)}
          />
          {fieldErrors['free_window_hours'] ? (
            <p className="field-error" id="free-window-error">
              {fieldErrors['free_window_hours']}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="late-percent">Late cancellation charge (%)</label>
          <input
            id="late-percent"
            type="number"
            min={0}
            max={100}
            step={1}
            value={latePercent}
            aria-describedby={fieldErrors['late_fee_percent'] ? 'late-percent-error' : undefined}
            onChange={(event) => setLatePercent(event.target.value)}
          />
          {fieldErrors['late_fee_percent'] ? (
            <p className="field-error" id="late-percent-error">
              {fieldErrors['late_fee_percent']}
            </p>
          ) : null}
        </div>
        <button type="submit" className="primary">
          Save policy
        </button>
      </form>

      <div className="table-wrap">
        <table role="table" aria-label="Policy history">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Version</th>
              <th role="columnheader">Free window</th>
              <th role="columnheader">Late charge</th>
              <th role="columnheader">Effective</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {history.map((policy) => (
              <tr role="row" key={policy.version}>
                <td role="cell" data-label="Version" className="num">
                  v{policy.version}
                </td>
                <td role="cell" data-label="Free window" className="num">
                  {policy.free_window_hours} h
                </td>
                <td role="cell" data-label="Late charge" className="num">
                  {policy.late_fee_percent}%
                </td>
                <td role="cell" data-label="Effective" className="num">
                  {policy.effective_at.slice(0, 16).replace('T', ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
