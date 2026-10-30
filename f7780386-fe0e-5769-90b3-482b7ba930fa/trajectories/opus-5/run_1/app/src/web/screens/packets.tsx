import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import type { Packet } from '../../shared/api.js';
import { api } from '../api.js';
import { useAction, useApp } from '../app-state.js';

const STATUS_WORDS: Record<Packet['status'], string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
};

const STORAGE_DOWN = 'File storage is unreachable. Nothing was saved; try again shortly.';

export function PacketsScreen(): ReactNode {
  const app = useApp();
  const act = useAction();
  const today = app.kitchen?.today ?? '';
  const [packets, setPackets] = useState<Packet[]>([]);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    setPackets((await api<{ packets: Packet[] }>('/api/packets')).packets);
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (from === '' && today !== '') {
      setFrom(today);
      setTo(today);
    }
  }, [today, from]);

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy('create');
    await act(
      'Creating packet…',
      async () => {
        const result = await api<{ packet: Packet }>('/api/packets', {
          method: 'POST',
          body: { from, to, expires_at: expiresAt },
        });
        await refresh();
        const [date, clock] = result.packet.expires_at.split('T');
        return `Packet link created. It expires ${date} ${(clock ?? '').slice(0, 5)}.`;
      },
      (error) => (error.code === 'storage_unavailable' ? STORAGE_DOWN : STORAGE_DOWN),
    );
    setBusy('');
  };

  const revoke = async (packet: Packet): Promise<void> => {
    setBusy(`revoke-${packet.id}`);
    await act(
      'Revoking link…',
      async () => {
        await api(`/api/packets/${packet.id}/revoke`, { method: 'POST', body: {} });
        await refresh();
        return 'Packet link revoked.';
      },
      () => 'This link was already revoked.',
    );
    setBusy('');
  };

  const regenerate = async (packet: Packet): Promise<void> => {
    setBusy(`regen-${packet.id}`);
    await act(
      'Regenerating link…',
      async () => {
        await api(`/api/packets/${packet.id}/regenerate`, { method: 'POST', body: {} });
        await refresh();
        return 'New packet link created. The old link no longer works.';
      },
      (error) =>
        error.code === 'storage_unavailable' ? STORAGE_DOWN : "A revoked link can't be regenerated.",
    );
    setBusy('');
  };

  const copy = async (packet: Packet): Promise<void> => {
    if (packet.url === null) return;
    const full = `${window.location.origin}${packet.url}`;
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      // Clipboard permission is not required for the link to be usable.
    }
    app.succeed('Link copied.');
  };

  return (
    <>
      <h1>Packets</h1>

      <form aria-label="New packet" className="section" onSubmit={(event) => void create(event)}>
        <div className="inline-form">
          <span>
            <label htmlFor="packet-from">From</label>
            <input
              id="packet-from"
              type="text"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </span>
          <span>
            <label htmlFor="packet-to">To</label>
            <input
              id="packet-to"
              type="text"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </span>
          <span>
            <label htmlFor="packet-expires">Link expires at</label>
            <input
              id="packet-expires"
              type="text"
              placeholder="YYYY-MM-DDTHH:MM"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </span>
          <button type="submit" className="primary" disabled={busy === 'create'} aria-busy={busy === 'create'}>
            Create packet link
          </button>
        </div>
        <p className="hint">Times are kitchen time ({app.kitchen?.time_zone ?? ''})</p>
      </form>

      <table>
        <caption>Packet links</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Expires at</th>
            <th scope="col">Status</th>
            <th scope="col">Link</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {packets.map((packet) => (
            <tr key={packet.id}>
              <td data-label="From" className="num">
                {packet.from}
              </td>
              <td data-label="To" className="num">
                {packet.to}
              </td>
              <td data-label="Expires at" className="num">
                {packet.expires_at.slice(0, 16).replace('T', ' ')}
              </td>
              <td data-label="Status">{STATUS_WORDS[packet.status]}</td>
              <td data-label="Link">
                {packet.url === null ? '—' : <a href={packet.url}>{packet.url}</a>}
              </td>
              <td data-label="Actions">
                <button type="button" onClick={() => void copy(packet)}>
                  Copy link
                </button>
                <button
                  type="button"
                  disabled={busy === `revoke-${packet.id}`}
                  aria-busy={busy === `revoke-${packet.id}`}
                  onClick={() => void revoke(packet)}
                >
                  Revoke link
                </button>
                <button
                  type="button"
                  disabled={busy === `regen-${packet.id}`}
                  aria-busy={busy === `regen-${packet.id}`}
                  onClick={() => void regenerate(packet)}
                >
                  Regenerate link
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
