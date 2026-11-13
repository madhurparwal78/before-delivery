import { useEffect, useState, type ReactElement } from 'react';
import type { LogEntry } from '../shared/types.ts';
import { ApiFailure, call } from './api.ts';
import { NotFound } from './NotFound.tsx';

const show = (value: unknown): string => (value === null || value === undefined ? '—' : Array.isArray(value) ? (value.length === 0 ? 'nobody (shared)' : value.join(', ')) : String(value));
const when = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export function PermissionLog({ workspaceId }: { workspaceId: string }): ReactElement {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'missing'>('loading');

  useEffect(() => {
    call<{ entries: LogEntry[] }>(`/api/workspaces/${workspaceId}/permission-log`)
      .then((reply) => {
        setEntries(reply.entries);
        setState('ready');
      })
      .catch((error: unknown) => setState(error instanceof ApiFailure && error.status === 403 ? 'denied' : 'missing'));
  }, [workspaceId]);

  if (state === 'missing') return <NotFound what="board" />;
  return (
    <main className="log-page">
      <h1 className="page-title">Permission log</h1>
      {state === 'denied' && <p>Only workspace admins can read the permission log.</p>}
      {state === 'ready' && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Permission log entries">
          <table aria-label="Permission log">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Target</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((entry) => (
                <tr key={entry.id}>
                  <td className="when">{when(entry.at)}</td>
                  <td>{entry.actor.displayName}</td>
                  <td>{entry.action}</td>
                  <td>{entry.target.label}</td>
                  <td>{show(entry.before)}</td>
                  <td>{show(entry.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state === 'ready' && (entries ?? []).length === 0 && (
        <section className="log-empty">
          <h2>No permission changes yet</h2>
          <p>Role and access changes will appear here as they are made.</p>
        </section>
      )}
    </main>
  );
}
