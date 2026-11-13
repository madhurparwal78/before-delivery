import { useEffect, useState } from 'react';
import type { LinkRow } from '../../shared/types.js';
import { failureMessage, get, post } from '../api.js';
import { useLoaded } from '../hooks.js';
import { Link } from '../router.js';
import { EmptyMark, Panel, Pill, Skeleton } from '../ui.js';

interface Entry {
  id: string;
  name: string;
  state: 'requested' | 'expired' | 'linked' | 'declined';
  problem?: string;
}

export function Inbox() {
  const { data, reload } = useLoaded(() => get<{ links: LinkRow[] }>('/api/links').then((body) => body.links), []);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setEntries((current) => {
      const waiting = data.filter((link) => link.status === 'requested' || link.status === 'expired');
      const kept = current.flatMap((entry): Entry[] => {
        if (entry.state === 'linked' || entry.state === 'declined') return [entry];
        const fresh = waiting.find((link) => link.id === entry.id);
        return fresh ? [{ ...entry, state: fresh.status as Entry['state'] }] : [];
      });
      const added = waiting.filter((link) => !current.some((entry) => entry.id === link.id));
      return [...kept, ...added.map((link): Entry => ({ id: link.id, name: link.athlete_name, state: link.status as Entry['state'] }))];
    });
  }, [data]);

  const answer = async (entry: Entry, verb: 'accept' | 'decline'): Promise<void> => {
    setBusy(`${verb}${entry.id}`);
    try {
      await post(`/api/links/${entry.id}/${verb}`);
      setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, state: verb === 'accept' ? 'linked' : 'declined', problem: undefined } : item)));
    } catch (failure) {
      setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, problem: failureMessage(failure) } : item)));
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="wrap page">
      <h1 className="page-title">Inbox</h1>
      {data === null && <Skeleton lines={3} />}
      {data && entries.length === 0 && (
        <div className="empty">
          <EmptyMark kind="list" />
          <p className="empty-line">No requests waiting</p>
          <Link to="/coach" className="pill pill-navy">
            Back to athletes
          </Link>
        </div>
      )}
      <ul aria-label="Link requests" className="request-list">
        {entries.map((entry) => (
          <li key={entry.id} className="request">
            {entry.state === 'requested' && (
              <>
                <span className="request-who"><span className="avatar" aria-hidden="true">{entry.name.charAt(0)}</span><span className="request-text">{`${entry.name} wants to join`}</span></span>
                <span className="request-actions">
                  <Pill tone="navy" aria-label={`Accept ${entry.name}`} pending={busy === `accept${entry.id}`} pendingText="Accepting…" disabled={busy !== null} onClick={() => void answer(entry, 'accept')}>
                    Accept
                  </Pill>
                  <Pill tone="ghost" aria-label={`Decline ${entry.name}`} pending={busy === `decline${entry.id}`} pendingText="Declining…" disabled={busy !== null} onClick={() => void answer(entry, 'decline')}>
                    Decline
                  </Pill>
                </span>
              </>
            )}
            {entry.state === 'expired' && <span className="request-text">{`${entry.name} — Expired`}</span>}
            {entry.state === 'linked' && <span className="request-text">{`${entry.name} is linked.`}</span>}
            {entry.state === 'declined' && <span className="request-text">{`${entry.name} was declined.`}</span>}
            {entry.problem && <Panel>{entry.problem}</Panel>}
          </li>
        ))}
      </ul>
    </section>
  );
}
