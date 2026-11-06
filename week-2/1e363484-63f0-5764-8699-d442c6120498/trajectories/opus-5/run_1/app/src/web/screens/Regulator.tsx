import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, api, type MovedReading, type PublicFigure } from '../api';
import { MovedReadingsTable } from '../components/Tables';
import { COPY } from '../copy';
import { checkedDisplay, expiresDisplay, intervalDisplay, signedTonnes } from '../format';

type Ended = 'expired' | 'revoked' | 'unknown';

function endedFrom(error: unknown): Ended | null {
  if (!(error instanceof ApiFailure)) return null;
  if (error.status === 410 && error.code === 'link_expired') return 'expired';
  if (error.status === 410 && error.code === 'link_revoked') return 'revoked';
  if (error.status === 404) return 'unknown';
  return null;
}

function EndedPage({ kind }: { kind: Ended }): React.ReactElement {
  const copy =
    kind === 'expired' ? COPY.expiredLink : kind === 'revoked' ? COPY.revokedLink : COPY.unknownLink;
  return (
    <div className="regulator-page">
      <h1>{copy.heading}</h1>
      <p>{copy.line}</p>
    </div>
  );
}

function statusLine(data: PublicFigure): string {
  if (data.figure.status === 'broken') return 'Status: Broken';
  if (data.figure.status === 'superseded') {
    return `Status: Superseded by ${data.figure.superseded_by ?? ''}`;
  }
  return 'Status: Intact';
}

function verdictWord(status: PublicFigure['figure']['status']): string {
  return status === 'sealed' ? 'Intact' : status === 'broken' ? 'Broken' : 'Superseded';
}

export function RegulatorFigure({ token }: { token: string }): React.ReactElement {
  const [data, setData] = useState<PublicFigure | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    void api
      .publicFigure(token)
      .then(setData)
      .catch((error: unknown) => setEnded(endedFrom(error) ?? 'unknown'));
  }, [token]);

  const rederive = async (): Promise<void> => {
    setStatus(COPY.rederivePending);
    setFailure(null);
    try {
      const next = await api.rederive(token);
      setData(next);
      setStatus(
        COPY.rederiveDone(checkedDisplay(next.figure.checked_at), verdictWord(next.figure.status)),
      );
    } catch (error) {
      const kind = endedFrom(error);
      if (kind !== null) {
        setEnded(kind);
        return;
      }
      setStatus(COPY.rederiveFailed);
    }
  };

  const download = async (): Promise<void> => {
    setFailure(null);
    try {
      const response = await fetch(`/api/public/links/${token}/evidence`);
      if (response.status === 410) {
        const body = (await response.json()) as { error?: string };
        setEnded(body.error === 'link_revoked' ? 'revoked' : 'expired');
        return;
      }
      if (response.status === 503) {
        setFailure(COPY.evidenceUnavailable);
        return;
      }
      if (response.status === 409) {
        setFailure(COPY.evidenceMismatch);
        return;
      }
      if (!response.ok) {
        setFailure(COPY.evidenceUnavailable);
        return;
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = match?.[1] ?? 'readings.csv';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setFailure(COPY.evidenceUnavailable);
    }
  };

  if (ended !== null) return <EndedPage kind={ended} />;
  if (data === null) {
    return (
      <div className="regulator-page">
        <p>Loading sealed figure.</p>
      </div>
    );
  }

  const figure = data.figure;
  return (
    <div className="regulator-page">
      <h1>Sealed figure {figure.id}</h1>
      <p>{statusLine(data)}</p>
      <p>Checked at {checkedDisplay(figure.checked_at)}</p>
      <p>Link expires {expiresDisplay(data.link.expires_at)}</p>
      <div
        role="status"
        aria-live="polite"
        aria-label="Re-derivation status"
        className="status-line"
      >
        {status}
      </div>
      {failure === null ? null : (
        <div role="alert" className="alert">
          {failure}
        </div>
      )}

      <div className="dialog-actions">
        <button type="button" onClick={() => void rederive()}>
          Re-derive
        </button>
        <a href={`/r/${token}/audit`}>Readings audit trail</a>
        <button type="button" onClick={() => void download()}>
          Download readings file
        </button>
      </div>

      <dl className="figure-panel">
        <dt>Project</dt>
        <dd>
          {data.project.name} ({data.project.kind})
        </dd>
        <dt>Interval</dt>
        <dd className="num">
          {intervalDisplay(Date.parse(figure.start))} to {intervalDisplay(Date.parse(figure.end))}
        </dd>
        <dt>Sensors</dt>
        <dd className="num">{figure.sensor_ids.join(', ')}</dd>
        <dt>Coverage</dt>
        <dd className="num">{figure.coverage_pct}%</dd>
        <dt>Net tCO2e</dt>
        <dd className="num">{signedTonnes(figure.net_tco2e)}</dd>
        <dt>CO2 tCO2e</dt>
        <dd className="num">{signedTonnes(figure.co2_tco2e)}</dd>
        <dt>CH4 tCO2e</dt>
        <dd className="num">{signedTonnes(figure.ch4_tco2e)}</dd>
        <dt>Buffer tCO2e</dt>
        <dd className="num">{figure.buffer_tco2e}</dd>
        <dt>Credited tCO2e</dt>
        <dd className="num">{signedTonnes(figure.credited_tco2e)}</dd>
        <dt>Readings</dt>
        <dd className="num">{figure.readings_count}</dd>
        <dt>Fingerprint</dt>
        <dd className="fingerprint">{figure.fingerprint}</dd>
      </dl>

      <table aria-label="Unit breakdown" className="stacked">
        <caption>Unit breakdown</caption>
        <thead>
          <tr>
            <th scope="col">Sensor</th>
            <th scope="col">Kind</th>
            <th scope="col">Area m²</th>
            <th scope="col">Qualifying half-hours</th>
            <th scope="col">CO2 tCO2e</th>
            <th scope="col">CH4 tCO2e</th>
            <th scope="col">Net tCO2e</th>
          </tr>
        </thead>
        <tbody>
          {figure.contributions.map((contribution) => (
            <tr key={contribution.sensor_id}>
              <td data-label="Sensor" className="num">
                {contribution.sensor_id}
              </td>
              <td data-label="Kind">
                {contribution.kind === 'tower' ? 'Tower' : 'Satellite cell'}
              </td>
              <td data-label="Area m²" className="num">
                {contribution.area_m2}
              </td>
              <td data-label="Qualifying half-hours" className="num">
                {contribution.qualifying_half_hours}
              </td>
              <td data-label="CO2 tCO2e" className="num">
                {signedTonnes(contribution.co2_tco2e)}
              </td>
              <td data-label="CH4 tCO2e" className="num">
                {signedTonnes(contribution.ch4_tco2e)}
              </td>
              <td data-label="Net tCO2e" className="num">
                {signedTonnes(contribution.net_tco2e)}
              </td>
            </tr>
          ))}
          <tr>
            <td data-label="Sensor">Total</td>
            <td data-label="Kind" />
            <td data-label="Area m²" className="num">
              {figure.contributions.reduce((sum, item) => sum + item.area_m2, 0)}
            </td>
            <td data-label="Qualifying half-hours" />
            <td data-label="CO2 tCO2e" className="num">
              {signedTonnes(figure.co2_tco2e)}
            </td>
            <td data-label="CH4 tCO2e" className="num">
              {signedTonnes(figure.ch4_tco2e)}
            </td>
            <td data-label="Net tCO2e" className="num">
              {signedTonnes(figure.net_tco2e)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function RegulatorAudit({ token }: { token: string }): React.ReactElement {
  const [moved, setMoved] = useState<MovedReading[] | null>(null);
  const [figureId, setFigureId] = useState('');
  const [ended, setEnded] = useState<Ended | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.publicAudit(token);
      setFigureId(result.figure_id);
      setMoved(result.moved);
    } catch (error) {
      setEnded(endedFrom(error) ?? 'unknown');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (ended !== null) return <EndedPage kind={ended} />;
  return (
    <div className="regulator-page">
      <h1>Readings audit trail for {figureId}</h1>
      {moved !== null && moved.length === 0 ? <p>{COPY.auditEmpty}</p> : null}
      {moved !== null && moved.length > 0 ? <MovedReadingsTable moved={moved} /> : null}
    </div>
  );
}
