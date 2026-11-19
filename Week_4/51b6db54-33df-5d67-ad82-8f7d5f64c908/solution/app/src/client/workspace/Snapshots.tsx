import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { clearAlerts, EmptyState, notify, raise } from '../ui';
import { formatDate } from '../../shared/format';
import type { Model } from './model';
import { useModel } from './use-model';

interface Change {
  frame: number;
  changed: number;
}

export function Snapshots({ m }: { m: Model }): JSX.Element {
  useModel(m);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isOwner = m.role === 'owner';

  useEffect(() => {
    if (from === '' || to === '') return setChanges(null);
    void api<{ frames: Change[] }>('GET', `/api/sprites/${m.spriteId}/snapshots/compare?from=${from}&to=${to}`).then((result) => setChanges(result.ok ? result.body.frames : null));
  }, [from, to, m.snapshots.length]);

  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!m.online) return raise('You are offline');
    clearAlerts();
    notify('Saving snapshot…');
    const result = await api<{ name: string }>('POST', `/api/sprites/${m.spriteId}/snapshots`, { name });
    if (!result.ok) {
      notify('');
      const { message, fields } = refusal(result);
      setErrors(fields);
      return raise(message);
    }
    setErrors({});
    setName('');
    notify(`Snapshot ${result.body.name} saved`);
  };

  const restore = async (id: number): Promise<void> => {
    if (!m.online) return raise('You are offline');
    clearAlerts();
    notify('Restoring…');
    const result = await api('POST', `/api/snapshots/${id}/restore`);
    if (!result.ok) {
      notify('');
      raise(refusal(result).message);
    }
  };

  return (
    <section class="panel card-panel" aria-label="Snapshots">
      <h2 class="panel-title plain">Snapshots</h2>
      <div class="panel-body">
        {isOwner && (
          <form class="stack" onSubmit={(event) => void save(event)} noValidate>
            <label class="field-label">
              Snapshot name
              <input class="input" type="text" value={name} onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)} aria-invalid={errors.name ? 'true' : undefined} />
            </label>
            {errors.name && <p class="field-error">{errors.name}</p>}
            <button type="submit" class="pill">
              Save snapshot
            </button>
          </form>
        )}
        {m.snapshots.length === 0 ? (
          <EmptyState text="No snapshots yet" />
        ) : (
          <ul aria-label="Snapshots" class="snapshot-list">
            {m.snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <span>
                  {snapshot.name}
                  <span class="muted block small">{formatDate(snapshot.at, m.locale)}</span>
                </span>
                {isOwner && (
                  <button type="button" class="pill small" onClick={() => void restore(snapshot.id)}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {m.snapshots.length > 1 && (
          <div class="stack">
            <div class="row">
              <label class="field-label compact">
                From
                <select class="input" value={from} onChange={(event) => setFrom((event.currentTarget as HTMLSelectElement).value)}>
                  <option value="">Choose</option>
                  {m.snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field-label compact">
                To
                <select class="input" value={to} onChange={(event) => setTo((event.currentTarget as HTMLSelectElement).value)}>
                  <option value="">Choose</option>
                  {m.snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ul aria-label="Snapshot changes" class="change-list">
              {changes?.length === 0 && <li>No pixels changed</li>}
              {changes?.map((change) => (
                <li key={change.frame}>
                  {m.plural(change.changed, 'pixel')} changed in frame {change.frame}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
