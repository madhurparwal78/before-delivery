import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { COLLECTION_NAME, noRecordsMatch, recordNotFound } from '../../shared/copy';
import type { LoanObject } from '../../shared/types';
import {
  formatDimensions,
  formatGrouped,
  formatLux,
  formatMoneyGbp,
  formatWhole,
} from '../../shared/units';
import { api } from '../api';
import { focusIds } from '../state/focus';
import { useApp } from '../state/store';
import { Header, LiveRegions, useLayout } from './common';
import { ObjectFormDialog } from './ObjectFormDialog';

function placementLabel(object: LoanObject): string {
  switch (object.placementStatus) {
    case 'proposed':
      return 'Proposed';
    case 'claimed':
      return 'Claimed';
    case 'hung':
      return 'Hung';
    case 'signed_off':
      return 'Signed off';
    default:
      return 'Not placed';
  }
}

function conditionLabel(object: LoanObject): string {
  const count = object.photos.length;
  if (count === 0) return 'No condition photo';
  if (count === 1) return '1 condition photo';
  return `${count} condition photos`;
}

const columns = [
  'Object number',
  'Title',
  'Lender',
  'Dimensions',
  'Lux limit',
  'Lux-hour budget',
  'Insurance value',
  'Condition',
  'Placement',
] as const;

export function LoanRegister(): ReactElement {
  const app = useApp();
  const layout = useLayout();
  const params = useMemo(() => new URLSearchParams(app.search), [app.search]);
  const q = params.get('q') ?? '';
  const lender = params.get('lender') ?? '';
  const sort = params.get('sort') ?? 'number';
  const dir = params.get('dir') ?? 'asc';
  const [queryText, setQueryText] = useState(q);
  const [records, setRecords] = useState<LoanObject[]>([]);
  const [adding, setAdding] = useState(false);
  const requestId = useRef(0);
  const previousQuery = useRef(q);

  useEffect(() => {
    setQueryText(q);
  }, [q]);

  useEffect(() => {
    const id = requestId.current + 1;
    requestId.current = id;
    const search = new URLSearchParams();
    if (q !== '') search.set('q', q);
    if (lender !== '') search.set('lender', lender);
    if (sort !== 'number') search.set('sort', sort);
    if (dir !== 'asc') search.set('dir', dir);
    const query = search.toString();
    const delay = previousQuery.current === q ? 0 : 250;
    previousQuery.current = q;
    const timer = window.setTimeout(() => {
      void api
        .objects(query === '' ? '' : `?${query}`)
        .then((result) => {
          if (requestId.current !== id) return;
          setRecords(result.objects);
        })
        .catch(() => undefined);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [q, lender, sort, dir, app.staffId, app.objects]);

  const setParam = (name: string, value: string, replace: boolean): void => {
    const next = new URLSearchParams(window.location.search);
    if (value === '') next.delete(name);
    else next.set(name, value);
    const query = next.toString();
    app.navigate(`/records${query === '' ? '' : `?${query}`}`, { replace });
  };

  const lenders = app.exhibition?.lenders ?? [];

  return (
    <>
      <Header showViewGroup={false} />
      <LiveRegions />
      <main id="main" tabIndex={-1} className={`register register-${layout}`}>
        <h1 id={focusIds.mainHeading} tabIndex={-1} className="display-title">
          Loan register
        </h1>
        <div className="register-controls">
          <div className="field">
            <label htmlFor="register-search">Search records</label>
            <input
              id="register-search"
              type="search"
              value={queryText}
              onChange={(event) => {
                setQueryText(event.target.value);
                setParam('q', event.target.value, true);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="register-lender">Lender filter</label>
            <select
              id="register-lender"
              value={lender}
              onChange={(event) => setParam('lender', event.target.value, false)}
            >
              <option value="">All lenders</option>
              <option value="collection">{COLLECTION_NAME}</option>
              {lenders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="register-sort">Sort by</label>
            <select
              id="register-sort"
              value={sort}
              onChange={(event) => setParam('sort', event.target.value, false)}
            >
              <option value="number">Object number</option>
              <option value="title">Title</option>
              <option value="lender">Lender</option>
              <option value="lux">Lux limit</option>
            </select>
          </div>
          <div className="units-toggle" role="radiogroup" aria-label="Order">
            {(['asc', 'desc'] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="order"
                  value={value}
                  checked={dir === value}
                  onChange={() => setParam('dir', value, false)}
                />
                <span>{value === 'asc' ? 'Ascending' : 'Descending'}</span>
              </label>
            ))}
          </div>
          {app.staff?.role === 'registrar' ? (
            <button type="button" id="add-object" onClick={() => setAdding(true)}>
              Add object
            </button>
          ) : null}
        </div>
        <p className="records-count" role="status" aria-label="Records count">
          {records.length === 1 ? '1 record' : `${records.length} records`}
        </p>
        {records.length === 0 ? <p>{noRecordsMatch}</p> : null}
        {layout === 'desk' ? (
          <table aria-label="Loan register" className="register-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((object) => (
                <tr key={object.id}>
                  <td>{object.objectNumber}</td>
                  <td>
                    <a
                      href={`/records/${object.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        app.navigate(`/records/${object.id}`);
                      }}
                    >
                      {object.title}
                    </a>
                  </td>
                  <td>{object.lenderName ?? COLLECTION_NAME}</td>
                  <td className="figure">
                    {formatDimensions(object.widthMm, object.heightMm, app.unit)}
                  </td>
                  <td className="figure">{formatLux(object.luxLimit)}</td>
                  <td className="figure">{formatGrouped(object.luxHourBudget)}</td>
                  <td className="figure">{formatMoneyGbp(object.insuranceValueGbp)}</td>
                  <td>{conditionLabel(object)}</td>
                  <td>{placementLabel(object)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul aria-label="Loan register" className="register-cards">
            {records.map((object) => (
              <li key={object.id} className="register-card">
                <h2>
                  <a
                    href={`/records/${object.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      app.navigate(`/records/${object.id}`);
                    }}
                  >
                    {object.title}
                  </a>
                </h2>
                <p>
                  <span className="label">Object number</span>
                  <span>{object.objectNumber}</span>
                </p>
                <p>
                  <span className="label">Lender</span>
                  <span>{object.lenderName ?? COLLECTION_NAME}</span>
                </p>
                <p>
                  <span className="label">Dimensions</span>
                  <span className="figure">
                    {formatDimensions(object.widthMm, object.heightMm, app.unit)}
                  </span>
                </p>
                <p>
                  <span className="label">Lux limit</span>
                  <span className="figure">{formatLux(object.luxLimit)}</span>
                </p>
                <p>
                  <span className="label">Lux-hour budget</span>
                  <span className="figure">{formatGrouped(object.luxHourBudget)}</span>
                </p>
                <p>
                  <span className="label">Insurance value</span>
                  <span className="figure">{formatMoneyGbp(object.insuranceValueGbp)}</span>
                </p>
                <p>
                  <span className="label">Condition</span>
                  <span>{conditionLabel(object)}</span>
                </p>
                <p>
                  <span className="label">Placement</span>
                  <span>{placementLabel(object)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
      {adding ? (
        <ObjectFormDialog
          mode="add"
          lenders={lenders}
          onClose={() => {
            setAdding(false);
            app.requestFocus('add-object');
          }}
          onSaved={(objectId) => {
            setAdding(false);
            app.navigate(`/records/${objectId}`);
            app.focusAfter({ after: 'object-saved' });
          }}
        />
      ) : null}
    </>
  );
}

export function RecordPage({ objectId }: { objectId: string }): ReactElement {
  const app = useApp();
  const layout = useLayout();
  const [object, setObject] = useState<LoanObject | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .object(objectId)
      .then((result) => {
        if (!active) return;
        setObject(result.object);
        setMissing(false);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
    };
  }, [objectId, app.objects]);

  return (
    <>
      <Header showViewGroup={false} />
      <LiveRegions />
      <main id="main" tabIndex={-1} className={`record record-${layout}`}>
        {missing || !object ? (
          <h1 id={focusIds.mainHeading} tabIndex={-1}>
            {missing ? recordNotFound : ''}
          </h1>
        ) : (
          <>
            <h1 id={focusIds.mainHeading} tabIndex={-1} className="display-title">
              {object.title}
            </h1>
            <dl className="record-lines">
              <div>
                <dt>Object number</dt>
                <dd>{object.objectNumber}</dd>
              </div>
              <div>
                <dt>Lender</dt>
                <dd>{object.lenderName ?? COLLECTION_NAME}</dd>
              </div>
              <div>
                <dt>Medium</dt>
                <dd>{object.medium}</dd>
              </div>
              <div>
                <dt>Dimensions</dt>
                <dd className="figure">
                  {formatDimensions(object.widthMm, object.heightMm, app.unit)}
                </dd>
              </div>
              <div>
                <dt>Lux limit</dt>
                <dd className="figure">{formatLux(object.luxLimit)}</dd>
              </div>
              <div>
                <dt>Lux-hour budget</dt>
                <dd className="figure">{formatGrouped(object.luxHourBudget)}</dd>
              </div>
              <div>
                <dt>Insurance value</dt>
                <dd className="figure">{formatMoneyGbp(object.insuranceValueGbp)}</dd>
              </div>
              <div>
                <dt>Registrar note</dt>
                <dd>{object.registrarNote}</dd>
              </div>
              <div>
                <dt>Condition photos</dt>
                <dd className="figure">{formatWhole(object.photos.length)}</dd>
              </div>
              <div>
                <dt>Placement status</dt>
                <dd>{placementLabel(object)}</dd>
              </div>
            </dl>
            {app.staff?.role === 'registrar' ? (
              <button type="button" id="edit-record" onClick={() => setEditing(true)}>
                Edit record
              </button>
            ) : null}
            <a
              href="/records"
              onClick={(event) => {
                event.preventDefault();
                app.navigate('/records');
              }}
            >
              Back to the Loan register
            </a>
          </>
        )}
      </main>
      {editing && object ? (
        <ObjectFormDialog
          mode="edit"
          object={object}
          lenders={app.exhibition?.lenders ?? []}
          onClose={() => {
            setEditing(false);
            app.requestFocus('edit-record');
          }}
          onSaved={() => {
            setEditing(false);
            app.focusAfter({ after: 'object-saved' });
          }}
        />
      ) : null}
    </>
  );
}
