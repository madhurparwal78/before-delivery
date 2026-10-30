import { useEffect, useState } from 'react';
import { ApiCallError, apiGet } from '../api';
import type { InspectionView } from '../types';

const KIND_LABELS: Record<string, string> = {
  certificate_of_insurance: 'Certificate of insurance',
  food_handler_card: 'Food handler card',
  health_permit: 'Health permit',
};

export function InspectorScreen({ token }: { token: string }): JSX.Element {
  const [view, setView] = useState<InspectionView | null>(null);
  const [dead, setDead] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<InspectionView>(`/api/inspect/${token}`)
      .then((result) => setView(result))
      .catch((error: unknown) => {
        setDead(
          error instanceof ApiCallError &&
            (error.failure.status === 410 || error.failure.status === 404),
        );
      })
      .finally(() => setLoading(false));
  }, [token]);

  const regions = (
    <div className="live-regions">
      <div role="status" aria-label="Activity" aria-live="polite" className="activity">
        {loading ? 'Loading documents…' : ''}
      </div>
      <div role="alert" aria-label="Problem" className="problem" />
    </div>
  );

  if (loading) return <main className="inspector">{regions}</main>;

  if (dead || !view) {
    return (
      <main className="inspector">
        {regions}
        <h1>This inspection link is no longer valid</h1>
      </main>
    );
  }

  return (
    <main className="inspector">
      {regions}
      <h1>{view.business_name}</h1>
      <p>Current documents at {view.kitchen_name}</p>
      <ul aria-label="Current documents">
        {view.documents.map((document) => (
          <li key={document.id}>
            <a href={document.file_url} target="_blank" rel="noreferrer">
              Open {KIND_LABELS[document.kind] ?? document.kind}
              {document.kind === 'food_handler_card' && document.holder_name
                ? `, ${document.holder_name}`
                : ''}
            </a>
            <span className="num"> expires {document.expires_on}</span>
          </li>
        ))}
      </ul>
      <p>
        This link expires {view.expires_at.slice(0, 10)} {view.expires_at.slice(11, 16)} kitchen
        time.
      </p>
    </main>
  );
}
