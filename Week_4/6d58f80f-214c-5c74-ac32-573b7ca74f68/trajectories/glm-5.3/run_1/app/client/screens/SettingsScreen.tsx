import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../lib/api.js';
import { announce } from '../components/Announcements.tsx';
import type { Policy } from '../lib/types.js';

export function SettingsScreen(): preact.JSX.Element {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [binDays, setBinDays] = useState(30);
  const [binFrom, setBinFrom] = useState('');
  const [grantDays, setGrantDays] = useState(30);
  const [grantFrom, setGrantFrom] = useState('');
  const [binError, setBinError] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);

  const load = (): void => {
    void api.policies().then(r => setPolicies(r.policies)).catch(() => setPolicies([]));
  };
  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div class="table-wrap">
      <form class="dialog" style="display:inline-block;margin:0 16px 16px;border:1px solid var(--rule);padding:14px;" aria-label="Bin retention" onSubmit={async e => {
        e.preventDefault();
        setBinError(null);
        try {
          const res = await api.schedulePolicy('bin_retention_days', binDays, binFrom);
          announce(`Bin retention changes to ${res.policy.days} days from ${res.policy.effectiveFrom}`);
          load();
        } catch (err) {
          if (err instanceof ApiError) {
            if (err.fields?.days) setBinError(err.fields.days);
            else if (err.fields?.effectiveFrom) setBinError(err.fields.effectiveFrom);
            else if (err.code === 'policy_exists') setBinError(`A change is already scheduled for ${binFrom}.`);
            else setBinError('Something went wrong. Nothing was changed.');
          }
        }
      }}>
        <h2 style="font-size:14px;">Bin retention</h2>
        <div class="field">
          <label for="bin-days">Days</label>
          <input id="bin-days" type="number" min="1" max="90" value={binDays} onInput={e => setBinDays(Number((e.target as HTMLInputElement).value))} />
        </div>
        <div class="field">
          <label for="bin-from">Effective from</label>
          <input id="bin-from" type="date" min={today} value={binFrom} onInput={e => setBinFrom((e.target as HTMLInputElement).value)} />
        </div>
        {binError && <p class="field-error">{binError}</p>}
        <button type="submit" class="btn-primary">Schedule bin retention</button>
      </form>

      <form class="dialog" style="display:inline-block;border:1px solid var(--rule);padding:14px;" aria-label="Partner grant length" onSubmit={async e => {
        e.preventDefault();
        setGrantError(null);
        try {
          const res = await api.schedulePolicy('partner_grant_days', grantDays, grantFrom);
          announce(`Partner grant length changes to ${res.policy.days} days from ${res.policy.effectiveFrom}`);
          load();
        } catch (err) {
          if (err instanceof ApiError) {
            if (err.fields?.days) setGrantError(err.fields.days);
            else if (err.fields?.effectiveFrom) setGrantError(err.fields.effectiveFrom);
            else if (err.code === 'policy_exists') setGrantError(`A change is already scheduled for ${grantFrom}.`);
            else setGrantError('Something went wrong. Nothing was changed.');
          }
        }
      }}>
        <h2 style="font-size:14px;">Partner grant length</h2>
        <div class="field">
          <label for="grant-days">Days</label>
          <input id="grant-days" type="number" min="1" max="365" value={grantDays} onInput={e => setGrantDays(Number((e.target as HTMLInputElement).value))} />
        </div>
        <div class="field">
          <label for="grant-from">Effective from</label>
          <input id="grant-from" type="date" min={today} value={grantFrom} onInput={e => setGrantFrom((e.target as HTMLInputElement).value)} />
        </div>
        {grantError && <p class="field-error">{grantError}</p>}
        <button type="submit" class="btn-primary">Schedule grant length</button>
      </form>

      <h2 style="padding:12px 16px 4px;font-size:15px;">Policy schedule</h2>
      <table class="data-table" aria-label="Policy schedule">
        <thead>
          <tr><th>Kind</th><th>Days</th><th>Effective from</th><th>State</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {policies.map(p => (
            <tr key={p.id}>
              <td>{p.kind === 'bin_retention_days' ? 'bin retention' : 'grant length'}</td>
              <td class="numeric">{p.days}</td>
              <td class="numeric">{p.effectiveFrom}</td>
              <td>{p.state === 'in_force' ? 'In force' : p.state === 'scheduled' ? 'Scheduled' : 'Past'}</td>
              <td class="actions-cell">
                {p.state === 'scheduled' && (
                  <button type="button" class="rowbtn" aria-label={`Withdraw ${p.kind === 'bin_retention_days' ? 'bin retention' : 'grant length'} from ${p.effectiveFrom}`} onClick={async () => {
                    try {
                      await api.withdrawPolicy(p.id);
                      announce(`Withdrew the change from ${p.effectiveFrom}`);
                      load();
                    } catch (err) {
                      if ((err as { code?: string }).code === 'policy_started') announce('This change has already started.');
                      else announce('Something went wrong. Nothing was changed.');
                    }
                  }}>Withdraw</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
