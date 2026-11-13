import { useState } from 'react';
import type { LinkRow } from '../../shared/types.js';
import { del, failureMessage, get } from '../api.js';
import { useLoaded } from '../hooks.js';
import { EmptyMark, Dialog, Panel, Pill, Skeleton } from '../ui.js';

export function Coaches() {
  const { data, reload } = useLoaded(() => get<{ links: LinkRow[] }>('/api/links').then((body) => body.links), []);
  const [removing, setRemoving] = useState<LinkRow | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const coaches = (data ?? []).filter((link) => link.status === 'accepted' || link.status === 'requested');

  const remove = async (link: LinkRow): Promise<void> => {
    setPending(true);
    setProblem(null);
    try {
      await del(`/api/links/${link.id}`);
      setRemoving(null);
      reload();
    } catch (failure) {
      setProblem(failureMessage(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="wrap page">
      <h1 className="page-title">Coaches</h1>
      {data === null && <Skeleton lines={2} />}
      {data && coaches.length === 0 && (
        <div className="empty">
          <EmptyMark kind="list" />
          <p className="empty-line">No coaches yet</p>
          <Pill tone="navy" onClick={() => document.querySelector<HTMLElement>('[data-field="coach_code"]')?.focus()}>
            Enter a coach code
          </Pill>
        </div>
      )}
      <ul aria-label="Your coaches" className="request-list">
        {coaches.map((link) => (
          <li key={link.id} className="request">
            {link.status === 'accepted' ? (
              <>
                <span className="request-who"><span className="avatar" aria-hidden="true">{link.coach_name.charAt(0)}</span><span className="request-text">{link.coach_name}</span></span>
                <Pill tone="ghost" aria-label={`Remove ${link.coach_name}`} onClick={() => setRemoving(link)}>
                  Remove
                </Pill>
              </>
            ) : (
              <span className="request-text">{`${link.coach_name} — Pending`}</span>
            )}
          </li>
        ))}
      </ul>
      {removing && (
        <Dialog
          title="Remove coach?"
          onClose={() => {
            setRemoving(null);
            setProblem(null);
          }}
        >
          <p>{`${removing.coach_name} will lose access to your calendar right away.`}</p>
          {problem && <Panel>{problem}</Panel>}
          <div className="dialog-actions">
            <Pill tone="danger" pending={pending} pendingText="Removing…" onClick={() => void remove(removing)}>
              Remove
            </Pill>
            <Pill tone="ghost" onClick={() => setRemoving(null)}>
              Keep
            </Pill>
          </div>
        </Dialog>
      )}
    </section>
  );
}
