import { Link, Outlet, useLocation, useLoaderData, useMatches, useNavigation, useNavigate, useRevalidator, data, useRouteError } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { StateChip } from '../components/StateChip.jsx';
import { FilterSheet } from '../components/FilterSheet.jsx';
import { DraftRow } from '../components/DraftRow.jsx';
import { ChevronDownIcon, PlusIcon, SearchIcon, FilterIcon } from '../components/icons.jsx';
import { announce } from '../components/LiveRegions.jsx';
import { RouteErrorBoundary } from '../components/ErrorPages.jsx';
import { TYPE_LABELS, canonicalQueueQuery, queueHref } from '../lib/queue-query.jsx';

export const handle = { crumb: 'Regularisation requests' };

export function ErrorBoundary() {
  return <RouteErrorBoundary error={useRouteError()} signedIn />;
}

export async function loader({ request }) {
  const { viewerFromRequest, loadQueue } = await import('../lib/data.server.js');
  const { ApiError } = await import('../../src/domain/errors.js');
  const viewer = await viewerFromRequest(request);
  if (!viewer) throw data(null, { status: 401 });
  let queue;
  try {
    queue = await loadQueue(viewer, new URL(request.url));
  } catch (err) {
    if (err instanceof ApiError) {
      // a bad query value answers the 400 page
      throw data(null, { status: err.status });
    }
    return { viewer, queue: null, failed: true };
  }
  return { viewer, queue, failed: false };
}

const STATE_CHIPS = ['all', 'pending', 'approved', 'rejected', 'cancelled'];
const CHIP_LABEL = { all: 'All', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
const SORT_OPTIONS = [
  { value: '', label: 'Waiting first' },
  { value: 'day', label: 'Day, newest first' },
  { value: 'raised', label: 'Raised, oldest first' },
  { value: 'person', label: 'Person, A to Z' },
];

export default function RequestsLayout() {
  const { viewer, queue, failed } = useLoaderData();
  const matches = useMatches();
  const childActive = matches.some((m) => m.id === 'routes/requests.$id' || m.id === 'routes/requests.new');
  const childId = matches.some((m) => m.id === 'routes/requests.$id');
  const showDraft = matches.some((m) => m.id === 'routes/requests.new');
  const navigation = useNavigation();
  const loading = navigation.state !== 'idle';
  const [openRow, setOpenRow] = useState(null);
  const revalidator = useRevalidator();
  const didReRead = useRef(false);

  // once the server-drawn queue is live, re-read the counts with the page's query
  useEffect(() => {
    if (!didReRead.current) {
      didReRead.current = true;
      revalidator.revalidate();
    }
  }, [revalidator]);

  return (
    <div className="requests-page">
      {childId && <Outlet />}
      <div className="queue-side">
        {showDraft && <h1 className="draft-heading">Raise a correction</h1>}
        {childActive ? <h2 id="queue-heading" tabIndex={-1}>Regularisation requests</h2> : <h1 id="queue-heading" tabIndex={-1}>Regularisation requests</h1>}
        <QueueControls viewer={viewer} queue={queue} showDraft={showDraft} />
        {failed ? (
          <div className="panel empty-panel" role="group">
            <p>The queue could not be loaded. Try again.</p>
            <a className="button secondary" href="." role="button">Try again</a>
          </div>
        ) : (
          <QueueTable
            viewer={viewer}
            queue={queue}
            loading={loading}
            openRow={openRow}
            setOpenRow={setOpenRow}
            showDraft={showDraft}
            childActive={childActive}
            draftCancelHref={queueHref({ state: queue?.parsedQuery?.state || 'all', ...(queue?.parsedQuery || {}) , page: 1 })}
          />
        )}
      </div>
      {!childId && <Outlet />}
    </div>
  );
}

function QueueControls({ viewer, queue, showDraft }) {
  const q = queue?.parsedQuery || { state: 'all', page: 1 };
  const navigate = useNavigate();
  const canRaise = viewer.role !== 'admin' && !showDraft;

  function applyQuery(next) {
    navigate(queueHref({ ...q, ...next, page: 1 }), { replace: true });
  }

  return (
    <div className="queue-controls">
      <StateChipGroup value={q.state || 'all'} onApply={(state) => applyQuery({ state })} />
      <SearchReasons value={q.q || ''} onApply={(text) => applyQuery({ q: text || undefined })} />
      <label className="sort-label" htmlFor="sort">Sort</label>
      <select
        id="sort"
        value={q.sort || ''}
        onChange={(e) => applyQuery({ sort: e.target.value || undefined })}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <FilterSheetButton viewer={viewer} queue={queue} />
      {canRaise && (
        <Link className="button primary raise-link" to="/requests/new">
          <PlusIcon /> Raise a correction
        </Link>
      )}
    </div>
  );
}

function FilterSheetButton({ viewer, queue }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  return (
    <>
      <button
        type="button"
        className="button secondary"
        ref={buttonRef}
        onClick={() => setOpen(true)}
      >
        <FilterIcon /> Filters
      </button>
      {open && (
        <FilterSheet
          viewer={viewer}
          queue={queue}
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function StateChipGroup({ value, onApply }) {
  const refs = useRef({});
  const [focused, setFocused] = useState(null);

  function focusChip(name) {
    const el = refs.current[name];
    if (el) {
      el.focus();
      setFocused(name);
    }
  }

  function onKeyDown(e) {
    const idx = STATE_CHIPS.indexOf(focused ?? value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusChip(STATE_CHIPS[(idx + 1) % STATE_CHIPS.length]);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusChip(STATE_CHIPS[(idx - 1 + STATE_CHIPS.length) % STATE_CHIPS.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusChip('all');
    } else if (e.key === 'End') {
      e.preventDefault();
      focusChip('cancelled');
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Request state"
      className="chip-group"
      onKeyDown={onKeyDown}
    >
      {STATE_CHIPS.map((state) => {
        const checked = (value || 'all') === state;
        return (
          <label key={state} className={`chip-radio${checked ? ' checked' : ''}`}>
            <input
              type="radio"
              name="request-state"
              value={state}
              checked={checked}
              ref={(el) => { refs.current[state] = el; }}
              onFocus={() => setFocused(state)}
              onChange={() => onApply(state)}
              tabIndex={checked ? 0 : -1}
            />
            {CHIP_LABEL[state]}
          </label>
        );
      })}
    </div>
  );
}

function SearchReasons({ value, onApply }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return (
    <form
      className="search-form"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(text.trim());
      }}
    >
      <label htmlFor="queue-search" className="visually-hidden">Search reasons</label>
      <SearchIcon className="search-glyph" />
      <input
        id="queue-search"
        type="search"
        placeholder="Search reasons"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}


function QueueTable({ viewer, queue, loading, openRow, setOpenRow, showDraft, childActive, draftCancelHref }) {
  const location = useLocation();
  const selectedId = childActive ? Number(location.pathname.split('/')[2]) : null;
  const rows = queue?.rows || [];
  const matched = queue?.matched ?? 0;
  const total = queue?.total ?? 0;
  const page = queue?.page ?? 1;
  const pages = queue?.pages ?? 1;
  const q = queue?.parsedQuery || { state: 'all', page: 1 };
  const navigate = useNavigate();
  const navigation = useNavigation();

  // restore focus to the originating row when coming back
  useEffect(() => {
    const rowId = location.state?.focusRow;
    if (rowId && !childActive) {
      const el = document.getElementById(`open-request-${rowId}`);
      if (el) {
        el.focus();
      } else {
        document.getElementById('queue-heading')?.focus();
      }
    } else if (location.state?.fromPager) {
      document.getElementById('queue-heading')?.focus();
    }
  }, [location, childActive]);

  useEffect(() => {
    if (navigation.state === 'loading') announce('polite', 'Loading requests');
  }, [navigation.state]);

  if (loading && rows.length === 0) {
    return <p className="empty-line">Loading requests</p>;
  }

  const emptyWording = matched === 0 && total === 0
    ? (viewer.role === 'employee'
        ? 'You have not raised a correction yet.'
        : viewer.role === 'manager'
          ? 'Nothing is waiting on you. Your reports have no open requests.'
          : 'No corrections have been raised in this company yet.')
    : matched === 0
      ? 'filters'
      : null;

  return (
    <div className="table-panel">
      <table className="queue-table">
        <caption className="table-caption">{matched} of {total} requests</caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Person</th>
            <th scope="col">Day</th>
            <th scope="col">Correction</th>
            <th scope="col">Claimed</th>
            <th scope="col">Recorded</th>
            <th scope="col">Raised</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {showDraft && <DraftRow cancelHref={draftCancelHref || '/requests'} />}
          {rows.map((row) => (
            <RequestRow
              key={row.id}
              row={row}
              open={openRow === row.id}
              selected={selectedId === row.id}
              onToggle={() => setOpenRow(openRow === row.id ? null : row.id)}
              q={q}
            />
          ))}
        </tbody>
      </table>
      {emptyWording === 'filters' && (
        <div className="empty-panel">
          <p>No requests match these filters. Clear them to see the full queue.</p>
          <a className="button secondary" href={queueHref({ state: 'all', page: 1 })}>Clear filters</a>
        </div>
      )}
      {emptyWording && emptyWording !== 'filters' && (
        <p className="empty-panel">{emptyWording}</p>
      )}
      <Pager page={page} pages={pages} q={q} />
    </div>
  );
}

function RequestRow({ row, open, onToggle, q, selected }) {
  const cls = `queue-row row-state-${row.state}${selected ? ' row-selected' : ''}`;
  const href = `/requests/${row.id}?${canonicalQueueQuery(q)}`;
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (open && !detail) {
      fetch(`/api/requests/${row.id}`)
        .then((r) => r.json())
        .then((d) => setDetail(d))
        .catch(() => {});
    }
  }, [open, row.id]);

  return (
    <>
      <tr className={`queue-row ${cls}`}>
        <td><StateChip state={row.state} /></td>
        <td className="cell-person">{row.person}</td>
        <td className="cell-day">{row.day}</td>
        <td className="cell-type">{TYPE_LABELS[row.correction_type]}</td>
        <td className="cell-times">{formatClaim(row)}</td>
        <td className="cell-times">{formatRecorded(row)}</td>
        <td className="cell-raised">{row.raised_at.slice(0, 10)}</td>
        <td className="cell-action">
          <Link
            id={`open-request-${row.id}`}
            className="row-open"
            to={href}
            state={{ focusRow: row.id }}
          >
            {row.person}
          </Link>
          <button
            type="button"
            className="row-expand"
            aria-expanded={open}
            aria-controls={`row-detail-${row.id}`}
            onClick={onToggle}
          >
            <span className="visually-hidden">Show details for request {row.id}</span>
            <ChevronDownIcon className={open ? 'chevron-open' : ''} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="row-detail" id={`row-detail-${row.id}`}>
          <td colSpan={8}>
            <p className="row-reason">{row.reason}</p>
            {detail?.audit?.length > 0 && (
              <ul className="row-trail">
                {detail.audit.map((a) => (
                  <li key={a.seq}>
                    {a.actor} {a.verb.replace('_', ' ')} on {a.occurred_at.slice(0, 10)}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function formatClaim(row) {
  const t = [row.claimed_in, row.claimed_out].filter(Boolean).join('–');
  return t || '—';
}

function formatRecorded(row) {
  if (!row.recorded_in && !row.recorded_out) return '—';
  const inPart = row.recorded_in ? londonTime(row.recorded_in) : '—';
  const outPart = row.recorded_out ? londonTime(row.recorded_out) : '—';
  return `${inPart}–${outPart}`;
}

function londonTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function Pager({ page, pages, q }) {
  const navigate = useNavigate();
  if (pages <= 1) return <p className="pager-line">Page {page} of {pages}</p>;
  const prevHref = queueHref({ ...q, page: Math.max(1, page - 1) });
  const nextHref = queueHref({ ...q, page: Math.min(pages, page + 1) });
  const go = (href, targetPage) => {
    navigate(href, { replace: true, state: { fromPager: true } });
    announce('polite', `Page ${targetPage} of ${pages}`);
  };
  return (
    <nav aria-label="Pages" className="pager">
      <a
        href={prevHref}
        aria-label="Previous page"
        onClick={(e) => { e.preventDefault(); go(prevHref, Math.max(1, page - 1)); }}
      >
        Previous page
      </a>
      <span>Page {page} of {pages}</span>
      <a
        href={nextHref}
        aria-label="Next page"
        onClick={(e) => { e.preventDefault(); go(nextHref, Math.min(pages, page + 1)); }}
      >
        Next page
      </a>
    </nav>
  );
}
