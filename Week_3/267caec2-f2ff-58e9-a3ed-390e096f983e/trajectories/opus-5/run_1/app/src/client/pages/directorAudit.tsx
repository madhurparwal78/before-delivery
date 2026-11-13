import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { useShell } from '../shell';
import type { AuditEvent } from '../types';
import { GridLines } from '../ui';

export function DirectorAudit(): JSX.Element {
  useShell('Director actions', null);
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    void api<{ events: AuditEvent[] }>('GET', '/api/audit').then((body) => setEvents(body.events));
  }, []);

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>Director actions</h1>
        <div class="ranked">
          <table aria-label="Director actions">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td class="mono">{event.at.replace('T', ' ').slice(0, 19)} UTC</td>
                  <td>{event.action}</td>
                  <td class="mono">
                    {event.targetType} {event.targetId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
