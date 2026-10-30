import { useCallback, useEffect, useRef, useState } from 'react';
import { NoAnswer, RequestFailed, request, type EssayView } from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { displayMoney, essayStamp, essayStateLabel } from '../format.js';
import { displayPercent } from '../../domain/money.js';

const NETWORK_FAILURE = 'Couldn’t reach Saltprint Desk. Nothing was changed; try again.';

function describeFailure(failure: unknown): string {
  if (failure instanceof RequestFailed) {
    return failure.body.fields ? Object.values(failure.body.fields)[0] ?? failure.body.message : failure.body.message;
  }
  if (failure instanceof NoAnswer) return NETWORK_FAILURE;
  return NETWORK_FAILURE;
}

export function ReviewQueue(): React.ReactElement {
  const [queue, setQueue] = useState<EssayView[]>([]);
  const [requests, setRequests] = useState<EssayView[]>([]);
  const [status, setStatus] = useState('');
  const [holding, setHolding] = useState<EssayView | null>(null);
  const [note, setNote] = useState('');
  const opener = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(() => {
    void request<{ essays: EssayView[]; withdrawal_requests: EssayView[] }>('/api/desk/queue')
      .then((result) => {
        setQueue(result.data.essays);
        setRequests(result.data.withdrawal_requests);
      })
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const publish = async (essay: EssayView): Promise<void> => {
    setStatus('Publishing…');
    try {
      await request(`/api/essays/${essay.id}/publish`, { method: 'POST', body: {} });
      setStatus('Published.');
    } catch (failure) {
      setStatus(describeFailure(failure));
    } finally {
      load();
    }
  };

  const hold = async (): Promise<void> => {
    if (!holding) return;
    try {
      await request(`/api/essays/${holding.id}/hold`, { method: 'POST', body: { note } });
      setStatus('Held and returned to the contributor.');
      setHolding(null);
      setNote('');
      opener.current?.focus();
    } catch (failure) {
      setStatus(describeFailure(failure));
    } finally {
      load();
    }
  };

  const carryOut = async (essay: EssayView): Promise<void> => {
    try {
      await request(`/api/essays/${essay.id}/withdraw`, { method: 'POST', body: {} });
      setStatus('Withdrawal carried out.');
    } catch (failure) {
      setStatus(describeFailure(failure));
    } finally {
      load();
    }
  };

  return (
    <main>
      <h1>Review queue</h1>
      <span className="status" role="status" aria-label="Desk status">
        {status}
      </span>
      <ul className="plain" aria-label="Review queue">
        {queue.map((essay) => (
          <li key={essay.id}>
            <span>
              <strong>{essay.title}</strong>
              <br />
              <span className="mono">{essayStamp(essay.state, essay.lift_display)}</span>
              <br />
              <span className="mono">
                {essay.credits
                  .map((credit) => `${credit.name} ${displayPercent(credit.split_bp ?? 0)}%`)
                  .join(' · ')}
              </span>
              <br />
              <span className="mono">
                Exclusive {essay.exclusive_days} days {displayMoney(essay.exclusive_price_minor)} ·
                Standard {essay.standard_days} days {displayMoney(essay.standard_price_minor)}
              </span>
              <span className="thumb-strip">
                {essay.frames.map((frame) => (
                  <img key={frame.id} src={frame.grid_url} alt="" />
                ))}
              </span>
            </span>
            <button type="button" onClick={() => void publish(essay)}>
              {`Publish ${essay.title}`}
            </button>
            <button
              type="button"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setHolding(essay);
              }}
            >
              {`Hold ${essay.title}`}
            </button>
          </li>
        ))}
      </ul>
      <h2>Withdrawal requests</h2>
      <ul className="plain" aria-label="Withdrawal requests">
        {requests.map((essay) => (
          <li key={essay.id}>
            <span>
              <strong>{essay.title}</strong>
              <br />
              <span className="mono">{essayStateLabel(essay.state)}</span>
            </span>
            <button type="button" onClick={() => void carryOut(essay)}>
              {`Carry out withdrawal of ${essay.title}`}
            </button>
          </li>
        ))}
      </ul>
      {holding ? (
        <Dialog
          label="Hold essay"
          onClose={() => {
            setHolding(null);
            opener.current?.focus();
          }}
        >
          <h2>Hold essay</h2>
          <div className="field">
            <label htmlFor="desk-note">Desk note</label>
            <textarea
              id="desk-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="row">
            <button type="button" onClick={() => void hold()}>
              Hold essay
            </button>
            <button
              type="button"
              onClick={() => {
                setHolding(null);
                opener.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}

export function AllEssays(): React.ReactElement {
  const [essays, setEssays] = useState<EssayView[]>([]);
  const [status, setStatus] = useState('');
  const [target, setTarget] = useState<EssayView | null>(null);
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(() => {
    void request<{ essays: EssayView[] }>('/api/desk/essays')
      .then((result) => setEssays(result.data.essays))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const takeDown = async (): Promise<void> => {
    if (!target) return;
    try {
      await request(`/api/essays/${target.id}/takedown`, { method: 'POST', body: { reference } });
      setStatus('Essay taken down. Licensees have been notified.');
      setTarget(null);
      setReference('');
      setConfirmed(false);
      opener.current?.focus();
    } catch (failure) {
      setStatus(describeFailure(failure));
    } finally {
      load();
    }
  };

  return (
    <main>
      <h1>All essays</h1>
      <span className="status" role="status" aria-label="Desk status">
        {status}
      </span>
      <table className="stacked" aria-label="All essays">
        <thead>
          <tr>
            <th>Essay</th>
            <th>State</th>
            <th>Embargo lift</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {essays.map((essay) => (
            <tr key={essay.id}>
              <td data-label="Essay">{essay.title}</td>
              <td data-label="State" className="mono">
                {essayStateLabel(essay.state)}
              </td>
              <td data-label="Embargo lift" className="mono">
                {essay.lift_display}
              </td>
              <td>
                {essay.state === 'embargoed' || essay.state === 'live' || essay.state === 'withdrawn' ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setTarget(essay);
                    }}
                  >
                    {`Legal takedown for ${essay.title}`}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {target ? (
        <Dialog
          label="Legal takedown"
          onClose={() => {
            setTarget(null);
            setConfirmed(false);
            opener.current?.focus();
          }}
        >
          <h2>Legal takedown</h2>
          <div className="field">
            <label htmlFor="legal-reference">Legal reference</label>
            <input
              id="legal-reference"
              type="text"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="legal-confirm">
              <input
                id="legal-confirm"
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{' '}
              I confirm this removes all imagery and revokes every licence
            </label>
          </div>
          <div className="row">
            <button type="button" disabled={!confirmed} onClick={() => void takeDown()}>
              Take down essay
            </button>
            <button
              type="button"
              onClick={() => {
                setTarget(null);
                setConfirmed(false);
                opener.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
