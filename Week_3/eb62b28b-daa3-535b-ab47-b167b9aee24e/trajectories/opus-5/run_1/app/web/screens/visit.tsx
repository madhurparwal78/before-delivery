import { useEffect, useRef, useState } from 'react';
import { api } from '../app/api';
import { useAnnounce, useLive } from '../app/shell';
import { BottomBar, Card } from '../components/pieces';
import { VisitView, copy, displayDate, displayTimeOfInstant, zoneLabel } from '../app/types';

export function VisitScreen({ token }: { token: string }): JSX.Element {
  const { announce } = useAnnounce();
  const [state, setState] = useState<'loading' | 'live' | 'ended' | 'unknown'>('loading');
  const [kitCode, setKitCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);

  const { data: visit, reload } = useLive<VisitView>(async () => {
    const result = await api<VisitView>(`/api/visits/${token}`);
    if (result.status === 410) {
      setState('ended');
      return null;
    }
    if (result.status === 404) {
      setState('unknown');
      return null;
    }
    if (result.data) setState('live');
    return result.data;
  }, [token]);

  const addKitCode = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api<{ kitCodes: string[] }>(`/api/visits/${token}/kit-codes`, {
      method: 'POST',
      json: { kitCode },
    });
    setBusy(false);
    if (result.error) {
      const message = result.error.fields?.kitCode ?? result.error.message;
      setProblem(message);
      announce(message);
      return;
    }
    setProblem(null);
    const added = result.data?.kitCodes.slice(-1)[0] ?? kitCode;
    announce(copy.kitCodeAdded(added));
    setKitCode('');
    reload();
    field.current?.focus();
  };

  const collect = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api<{ collectedAt: string }>(`/api/visits/${token}/collect`, {
      method: 'POST',
      json: {},
    });
    setBusy(false);
    if (result.error) {
      setProblem(result.error.message);
      announce(result.error.message);
      return;
    }
    setProblem(null);
    if (result.data && visit) {
      announce(
        copy.markedCollected(
          displayTimeOfInstant(result.data.collectedAt, visit.timeZone),
          visit.timeZone,
        ),
      );
    }
    reload();
  };

  useEffect(() => {
    if (state === 'ended') announce(copy.visitPageEnded);
  }, [state, announce]);

  if (state === 'ended') return <h1 tabIndex={-1}>{copy.visitPageEnded}</h1>;
  if (state === 'unknown') return <h1 tabIndex={-1}>{copy.notFound}</h1>;
  if (!visit) return <h1 tabIndex={-1}>Visit</h1>;

  return (
    <>
      <h1 tabIndex={-1}>Visit for {visit.memberName}</h1>
      <Card>
        <p>
          {displayDate(visit.localDate)}, {visit.localTime} {zoneLabel(visit.timeZone)}
        </p>
      </Card>
      <Card>
        <div role="region" aria-label="Address">
          <h2>Address</h2>
          {visit.address ? (
            <>
              <p>
                {visit.address.line1}
                {visit.address.line2 === '' ? '' : `, ${visit.address.line2}`}
              </p>
              <p>
                {visit.address.city}, {visit.address.state.toUpperCase()} {visit.address.postalCode}
              </p>
              {visit.gateNotes ? <p>{visit.gateNotes}</p> : null}
            </>
          ) : (
            <p>{copy.addressLater}</p>
          )}
        </div>
      </Card>
      <Card>
        <div className="field">
          <label htmlFor="field-kitCode">Kit code</label>
          <input
            id="field-kitCode"
            type="text"
            aria-label="Kit code"
            ref={field}
            value={kitCode}
            onChange={(event) => setKitCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void addKitCode();
              }
            }}
          />
          {problem ? <p className="field-error">{problem}</p> : null}
        </div>
        <button type="button" className="quiet" disabled={busy} onClick={() => void addKitCode()}>
          Add kit code
        </button>
        <ul className="kit-list" aria-label="Kit codes">
          {visit.kitCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </Card>
      <BottomBar always>
        <button type="button" disabled={busy} onClick={() => void collect()}>
          Mark collected
        </button>
      </BottomBar>
    </>
  );
}
