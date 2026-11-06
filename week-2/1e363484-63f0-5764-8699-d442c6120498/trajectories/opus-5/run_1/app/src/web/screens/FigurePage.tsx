import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiFailure,
  api,
  type Figure,
  type MovedReading,
  type RegulatorLinkRow,
} from '../api';
import { COPY } from '../copy';
import {
  checkedDisplay,
  compactStamp,
  dateOnly,
  expiresDisplay,
  intervalDisplay,
  signedTonnes,
} from '../format';
import { useRefresh } from '../hooks';
import { setNotice } from '../notice';
import { Link, navigate } from '../router';

const STATUS_LABEL: Record<Figure['status'], string> = {
  sealed: 'Sealed',
  broken: 'Broken',
  superseded: 'Superseded',
};

export interface FigurePageProps {
  readonly slug: string;
  readonly figureId: string;
  readonly canSeal: boolean;
}

function workspaceLink(figure: Figure): string {
  const startMs = Date.parse(figure.start);
  const endMs = Date.parse(figure.end);
  return [
    `/projects/${figure.project}?from=${dateOnly(startMs)}`,
    `to=${dateOnly(endMs - 1)}`,
    `start=${compactStamp(startMs)}`,
    `end=${compactStamp(endMs)}`,
    `sensors=${[...figure.sensor_ids].sort().join(',')}`,
  ].join('&');
}

export function FigurePage(props: FigurePageProps): React.ReactElement {
  const [figure, setFigure] = useState<Figure | null>(null);
  const [moved, setMoved] = useState<MovedReading[]>([]);
  const [links, setLinks] = useState<RegulatorLinkRow[]>([]);
  const [issued, setIssued] = useState<RegulatorLinkRow | null>(null);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const copyRef = useRef<HTMLButtonElement | null>(null);
  const previousStatus = useRef<Figure['status'] | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.figure(props.figureId);
      const audit = await api.figureAudit(props.figureId);
      setFigure(next);
      setMoved(audit.moved);
      if (
        previousStatus.current !== null &&
        previousStatus.current !== 'superseded' &&
        next.status === 'superseded' &&
        next.superseded_by !== null
      ) {
        setStatus(COPY.supersededBy(next.superseded_by));
      }
      previousStatus.current = next.status;
      if (props.canSeal) {
        const linkList = await api.links(props.figureId);
        setLinks(linkList.links);
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) {
        setNotice(COPY.lostAccess);
        navigate('/projects');
      } else if (error instanceof ApiFailure && error.status === 401) {
        navigate('/signin');
      }
    }
  }, [props.figureId, props.canSeal]);

  useEffect(() => {
    void load();
  }, [load]);
  useRefresh(() => void load(), false);

  useEffect(() => {
    if (issued !== null) copyRef.current?.focus();
  }, [issued]);

  if (figure === null) {
    return (
      <div className="app-shell">
        <p>Loading figure.</p>
      </div>
    );
  }

  const issueLink = async (): Promise<void> => {
    try {
      const link = await api.issueLink(figure.id);
      setIssued(link);
      setStatus(COPY.linkIssued(expiresDisplay(link.expires_at)));
      await load();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'figure_not_sealed') {
        setStatus(COPY.linkNotIssuable);
      } else setFailure(COPY.linkNotIssuable);
    }
  };

  const revoke = async (linkId: string): Promise<void> => {
    try {
      await api.revokeLink(figure.id, linkId);
      setStatus(COPY.linkRevoked);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'link_expired') {
        setStatus(COPY.linkAlreadyExpired);
      }
    }
    await load();
  };

  return (
    <div className="app-shell reading-column">
      {figure.status === 'broken' ? (
        <div role="alert" className="alert">
          {COPY.brokenBanner(moved.length)}
        </div>
      ) : null}
      <h1>Figure {figure.id}</h1>
      <p>
        <span className={`status-${figure.status}`}>{STATUS_LABEL[figure.status]}</span>
        {figure.status === 'superseded' && figure.superseded_by !== null ? (
          <>
            {' '}
            <Link to={`/projects/${figure.project}/figures/${figure.superseded_by}`}>
              {figure.superseded_by}
            </Link>
          </>
        ) : null}
      </p>
      <div role="status" aria-live="polite" aria-label="Figure status" className="status-line">
        {status}
      </div>
      {failure === null ? null : (
        <div role="alert" className="alert">
          {failure}
        </div>
      )}

      <dl className="figure-panel">
        <dt>Checked at</dt>
        <dd className="num">{checkedDisplay(figure.checked_at)}</dd>
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

      <p>
        <Link to={workspaceLink(figure)}>Open interval in workspace</Link>
      </p>
      <p>
        <Link to={`/projects/${figure.project}/figures/${figure.id}/audit`}>
          Readings audit trail
        </Link>
      </p>

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

      {props.canSeal ? (
        <section>
          <h2>Regulator links</h2>
          <button type="button" onClick={() => void issueLink()}>
            Issue regulator link
          </button>
          {issued !== null ? (
            <div className="link-row" style={{ marginTop: '0.5rem' }}>
              <label htmlFor="issued-link" className="visually-hidden">
                Regulator link
              </label>
              <input id="issued-link" type="text" readOnly value={issued.url} aria-label="Regulator link" />
              <button
                type="button"
                ref={copyRef}
                onClick={() => void navigator.clipboard?.writeText(issued.url)}
              >
                Copy link
              </button>
            </div>
          ) : null}
          <table aria-label="Regulator links" className="stacked">
            <caption>Regulator links</caption>
            <thead>
              <tr>
                <th scope="col">Link</th>
                <th scope="col">Status</th>
                <th scope="col">Issued</th>
                <th scope="col">Expires</th>
                <th scope="col">Revoke</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <td data-label="Link" className="num">
                    {link.token.slice(-6)}
                  </td>
                  <td data-label="Status">
                    {link.status === 'live' ? 'Live' : link.status === 'expired' ? 'Expired' : 'Revoked'}
                  </td>
                  <td data-label="Issued" className="num">
                    {expiresDisplay(link.issued_at)}
                  </td>
                  <td data-label="Expires" className="num">
                    {expiresDisplay(link.expires_at)}
                  </td>
                  <td data-label="Revoke">
                    {link.status === 'live' ? (
                      <button type="button" onClick={() => void revoke(link.id)}>
                        Revoke link ending {link.token.slice(-6)}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
