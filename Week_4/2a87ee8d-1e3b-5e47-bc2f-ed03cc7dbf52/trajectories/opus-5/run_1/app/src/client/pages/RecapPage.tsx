import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { displayAmount, displayWallClock } from '../lib/format.js';
import type { RecapPage as RecapPayload } from '../../shared/protocol.js';

/** The recap status copy, shared by the drawer and this page. */
export function recapStatusText(
  status: 'queued' | 'complete',
  reason: string | null,
  recipients: number,
): string {
  if (status === 'complete') return `Recap sent to ${recipients} people`;
  switch (reason) {
    case 'storage_unavailable':
      return 'Recap queued — file storage is unavailable. It will finish automatically.';
    case 'billing_unavailable':
      return 'Recap queued — billing is unavailable. Files are saved; the invoice and email will go out automatically.';
    case 'mail_unavailable':
      return 'Recap queued — email is unavailable. Files are saved; the email will go out automatically.';
    default:
      return 'Recap in progress';
  }
}

export function RecapPageView({ token }: { token: string }): JSX.Element {
  const [recap, setRecap] = useState<RecapPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setRecap(await api<RecapPayload>('GET', `/api/recaps/${token}`));
      } catch {
        setMissing(true);
      }
    })();
  }, [token]);

  if (missing) {
    return (
      <main className="column recap">
        <h1>Recap</h1>
        <p role="alert">We couldn&rsquo;t find that recap link.</p>
      </main>
    );
  }
  if (!recap) {
    return (
      <main className="column recap">
        <h1>Recap</h1>
      </main>
    );
  }

  // The recipient count is not published to the public recap, so the completed copy reads
  // from the workshop's own status line.
  const statusText =
    recap.status === 'complete'
      ? 'Recap sent'
      : recapStatusText(recap.status, recap.reason, 0);

  return (
    <main className="column recap">
      <h1>Recap: {recap.workshop.title}</h1>
      <p className="mono muted">
        {displayWallClock(recap.workshop.scheduledStart)} to {displayWallClock(recap.workshop.scheduledEnd)} (
        {recap.workshop.timeZone})
      </p>
      <p className="recap-status">{statusText}</p>

      {recap.invoice && (
        <p className="mono">
          Invoice {recap.invoice.number} — €{displayAmount(recap.invoice.amount)}
        </p>
      )}

      <section className="ruled">
        <h2>Files</h2>
        <ul className="rule-list" aria-label="Recap files">
          {recap.files.map((file) => (
            <li key={file.name}>
              <a href={file.url}>{file.label}</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="ruled">
        <h2>Cluster ranking</h2>
        <ul className="rule-list" aria-label="Cluster ranking">
          {recap.clusters.map((cluster) => (
            <li key={`${cluster.frame}-${cluster.title}`}>
              <p>
                <span className="muted">{cluster.frame}</span> — <strong>{cluster.title}</strong> —{' '}
                <span className="mono">{cluster.dotTotal} dots</span>
              </p>
              <ul className="plain-list">
                {cluster.notes.map((note, index) => (
                  <li key={`${index}-${note}`}>{note}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
