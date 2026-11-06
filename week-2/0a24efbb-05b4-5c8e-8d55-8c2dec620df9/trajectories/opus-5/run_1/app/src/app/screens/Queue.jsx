import { Fragment, useEffect, useRef, useState } from 'react';
import { usePage } from '../deskData.jsx';
import { businessDay, businessTimeOfDay } from '../../shared/businessTime.js';
import {
  CORRECTION_TYPES,
  CORRECTION_TYPE_LABELS,
  REASON_MIN,
  SORT_OPTIONS,
  STATE_CHIP_FILTERS,
} from '../../shared/constants.js';
import { feedback, ui } from '../../shared/copy.js';
import { canonicalQueueQuery, queueHref, withQueueChange } from '../../shared/queueQuery.js';
import { graphemeLength } from '../../shared/text.js';
import { call, isEndedSession, refusalWording } from '../api.js';
import { announce } from '../announce.js';
import { Dialog } from '../components/Dialog.jsx';
import { Icon } from '../components/Icon.jsx';
import { StateChip } from '../components/StateChip.jsx';

const RETURN_FOCUS_KEY = 'rostara.returnFocus';
const DASH = '\u2014';

function clock(instant) {
  return instant ? businessTimeOfDay(instant) : null;
}

function stamp(instant) {
  return `${businessDay(instant)} ${businessTimeOfDay(instant)}`;
}

function goReplace(href) {
  window.location.replace(href);
}

function FieldError({ id, message }) {
  return (
    <p className="field-error" id={id} hidden={!message}>
      {message ?? ''}
    </p>
  );
}

function Refusal({ refusal }) {
  if (!refusal) return null;
  if (!refusal.ended) return <p className="refusal">{refusal.wording}</p>;
  return (
    <p className="refusal">
      {refusal.wording}{' '}
      <a href={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}>
        {ui.signInAgain}
      </a>
    </p>
  );
}

function StateChipGroup({ query, path }) {
  const checkedIndex = Math.max(
    0,
    STATE_CHIP_FILTERS.findIndex((chip) => chip.value === query.state),
  );
  const [focusIndex, setFocusIndex] = useState(checkedIndex);
  const refs = useRef([]);

  const moveTo = (index) => {
    const wrapped = (index + STATE_CHIP_FILTERS.length) % STATE_CHIP_FILTERS.length;
    setFocusIndex(wrapped);
    refs.current[wrapped]?.focus();
  };

  const apply = (value) => goReplace(queueHref(path, withQueueChange(query, { state: value })));

  return (
    <div role="radiogroup" aria-label={ui.stateGroup} className="chip-group">
      {STATE_CHIP_FILTERS.map((chip, index) => (
        <button
          key={chip.label}
          type="button"
          role="radio"
          aria-checked={index === checkedIndex}
          tabIndex={index === focusIndex ? 0 : -1}
          ref={(node) => {
            refs.current[index] = node;
          }}
          className={`filter-chip${index === checkedIndex ? ' is-checked' : ''}`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              moveTo(index + 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveTo(index - 1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              moveTo(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              moveTo(STATE_CHIP_FILTERS.length - 1);
            } else if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              apply(chip.value);
            }
          }}
          onClick={() => apply(chip.value)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

function FilterSheet({ query, path, people, onClose }) {
  const [type, setType] = useState(query.type);
  const [person, setPerson] = useState(query.person);
  const [month, setMonth] = useState(query.month);

  return (
    <Dialog title={ui.filterSheet} onClose={onClose} className="sheet">
      <div className="field">
        <label htmlFor="filter-type">{ui.correctionFilter}</label>
        <select id="filter-type" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">{ui.anyCorrection}</option>
          {CORRECTION_TYPES.map((code) => (
            <option key={code} value={code}>
              {CORRECTION_TYPE_LABELS[code]}
            </option>
          ))}
        </select>
      </div>
      {people ? (
        <div className="field">
          <label htmlFor="filter-person">{ui.personFilter}</label>
          <select id="filter-person" value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="">{ui.anyoneInScope}</option>
            {people.map((candidate) => (
              <option key={candidate.work_address} value={candidate.work_address}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="filter-month">{ui.monthFilter}</label>
        <input
          id="filter-month"
          type="text"
          value={month}
          aria-describedby="filter-month-help"
          onChange={(event) => setMonth(event.target.value)}
        />
        <p id="filter-month-help" className="help">
          {ui.monthHelp}
        </p>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button outline"
          onClick={() => goReplace(queueHref(path, withQueueChange(query, { type, person, month })))}
        >
          {ui.applyFilters}
        </button>
        <button
          type="button"
          className="button quiet"
          onClick={() =>
            goReplace(
              queueHref(path, withQueueChange(query, { state: '', type: '', person: '', month: '', q: '', sort: '' })),
            )
          }
        >
          {ui.clearFilters}
        </button>
        <button type="button" className="button quiet" onClick={onClose}>
          {ui.close}
        </button>
      </div>
    </Dialog>
  );
}

function RowTrail({ id }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    let live = true;
    call('GET', `/api/requests/${id}`).then((answer) => {
      if (live && answer.status === 200) setDetail(answer.body);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <div className="row-expansion">
      <p className="prose">{detail?.request.reason}</p>
      <ul className="trail">
        {(detail?.audit ?? []).map((entry) => (
          <li key={entry.seq}>
            <span className="trail-when figures">{stamp(entry.occurred_at)}</span> {entry.actor} {entry.verb}
            {entry.note ? ` ${DASH} ${entry.note}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueHead() {
  return (
    <thead>
      <tr>
        {ui.columns.map((column) => (
          <th key={column} scope="col">
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function QueueTable({ rows, matched, total, query, openId }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <table className="queue">
      <caption>{ui.queueCaption(matched, total)}</caption>
      <QueueHead />
      <tbody>
        {rows.map((row) => (
          <Fragment key={row.id}>
            <tr
              className={`row row-${row.state}${String(row.id) === String(openId) ? ' is-selected' : ''}`}
              data-request-row={row.id}
            >
              <td data-label="State">
                <StateChip state={row.state} />
              </td>
              <td data-label="Person">
                <a
                  href={`/requests/${row.id}${canonicalQueueQuery(query)}`}
                  data-request-link={row.id}
                  onClick={() => window.sessionStorage.setItem(RETURN_FOCUS_KEY, String(row.id))}
                >
                  <span className="visually-hidden">{ui.openRequest(row.id)}, </span>
                  {row.person}
                </a>
              </td>
              <td data-label="Day" className="figures">
                {row.day}
              </td>
              <td data-label="Correction">{CORRECTION_TYPE_LABELS[row.correction_type]}</td>
              <td data-label="Claimed" className="figures">
                {row.claimed_in ?? DASH} to {row.claimed_out ?? DASH}
              </td>
              <td data-label="Recorded" className="figures">
                {clock(row.recorded_in) ?? DASH} to {clock(row.recorded_out) ?? DASH}
              </td>
              <td data-label="Raised" className="figures third">
                {stamp(row.raised_at)}
              </td>
              <td data-label="Action">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={ui.showDetails(row.id)}
                  aria-expanded={expanded === row.id}
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                >
                  <Icon name="chevron-down" className={expanded === row.id ? 'turned' : undefined} />
                </button>
              </td>
            </tr>
            {expanded === row.id ? (
              <tr className={`row row-${row.state} expansion-row`}>
                <td colSpan={ui.columns.length}>
                  <RowTrail id={row.id} />
                </td>
              </tr>
            ) : null}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function Pager({ page, pages, query, path }) {
  return (
    <nav aria-label={ui.pages} className="pager">
      {page > 1 ? (
        <a href={queueHref(path, { ...query, page: page - 1 })}>{ui.previousPage}</a>
      ) : (
        <span className="pager-off">{ui.previousPage}</span>
      )}
      <span className="figures">{ui.pageOf(page, pages)}</span>
      {page < pages ? (
        <a href={queueHref(path, { ...query, page: page + 1 })}>{ui.nextPage}</a>
      ) : (
        <span className="pager-off">{ui.nextPage}</span>
      )}
    </nav>
  );
}

function PunchPair({ signIn, signOut, inValue, outValue }) {
  return (
    <dl className="punches">
      <dt>{signIn}</dt>
      <dd className="figures">{inValue}</dd>
      <dt>{signOut}</dt>
      <dd className="figures">{outValue}</dd>
    </dl>
  );
}

function DetailPane({ page, detail, onSettled, headingRef }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);

  const request = detail.request;
  const nightShift = request.correction_type === 'night_shift';

  const send = async (path, body, pending, success) => {
    setBusy(true);
    setRefusal(null);
    announce.polite(pending);
    const answer = await call('POST', path, { body });
    setBusy(false);
    if (answer.status === 200) {
      await onSettled(answer.body);
      announce.assertive(success(answer.body));
      headingRef.current?.focus();
      return;
    }
    const wording = refusalWording(answer);
    setRefusal({ wording, ended: isEndedSession(answer) });
    if (answer.status === 409) await onSettled(null);
    announce.assertive(wording);
    if (answer.status === 409) headingRef.current?.focus();
  };

  const decide = (outcome) =>
    send(
      `/api/requests/${request.id}/decision`,
      { outcome, note: note === '' ? null : note },
      feedback.savingDecision,
      (body) => (body.state === 'approved' ? feedback.approved(body.day) : feedback.rejected),
    );

  const withdraw = () =>
    send(`/api/requests/${request.id}/cancel`, {}, feedback.withdrawing, () => feedback.withdrawn);

  const mayDecide = page.canDecide && request.state === 'pending';
  const mayWithdraw = page.canWithdraw && request.state === 'pending';

  return (
    <div className="pane-body">
      <div className="pane-head">
        <StateChip state={request.state} />
        <h1 tabIndex={-1} ref={headingRef}>
          {ui.detailHeading(request.day)}
        </h1>
      </div>
      <p className="quiet-line">{ui.raisedBy(request.person, request.manager)}</p>

      {detail.contact ? (
        <section className="contact">
          <h2>{ui.contactHeading}</h2>
          <p>{ui.phone(detail.contact.phone)}</p>
          <p>{detail.contact.private_note}</p>
        </section>
      ) : null}

      <section className="evidence">
        <h2>{ui.recordedHeading}</h2>
        <PunchPair
          signIn="Sign in"
          signOut="Sign out"
          inValue={clock(detail.evidence.recorded_in) ?? ui.notRecorded}
          outValue={clock(detail.evidence.recorded_out) ?? ui.notRecorded}
        />
      </section>

      <section className="evidence">
        <h2>{ui.claimedHeading}</h2>
        <PunchPair
          signIn={ui.claimedIn}
          signOut={ui.claimedOut}
          inValue={request.claimed_in ?? ui.notRecorded}
          outValue={
            request.claimed_out === null
              ? ui.notRecorded
              : nightShift
                ? `${request.claimed_out} on ${page.nextDay}`
                : request.claimed_out
          }
        />
        {page.differences.length > 0 ? (
          <ul className="differences">
            {page.differences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="evidence">
        <h2>{ui.leaveHeading}</h2>
        <p>{page.leaveLabel ?? ui.noLeave}</p>
      </section>

      <section className="reason">
        <h2>{ui.reasonHeading}</h2>
        <p className="prose keeps-breaks">{request.reason}</p>
      </section>

      {mayDecide ? (
        <div className="decide">
          <div className="field">
            <label htmlFor="decision-note">{ui.note}</label>
            <textarea
              id="decision-note"
              value={note}
              aria-describedby="decision-note-help"
              onChange={(event) => setNote(event.target.value)}
            />
            <p id="decision-note-help" className="help">
              {ui.noteHelp}
            </p>
          </div>
          <div className="decide-actions">
            <button type="button" className="button primary" disabled={busy} onClick={() => decide('approve')}>
              {ui.approve}
            </button>
            <button type="button" className="button outline" disabled={busy} onClick={() => decide('reject')}>
              {ui.reject}
            </button>
          </div>
        </div>
      ) : null}

      {mayWithdraw ? (
        <div className="decide">
          <button type="button" className="button outline" disabled={busy} onClick={withdraw}>
            {ui.withdraw}
          </button>
        </div>
      ) : null}

      <Refusal refusal={refusal} />

      <section className="trail-block">
        <h2>{ui.trailHeading}</h2>
        <ul className="trail">
          {detail.audit.map((entry) => (
            <li key={entry.seq}>
              <span className="trail-when figures">{stamp(entry.occurred_at)}</span> {entry.actor} {entry.verb}
              {entry.note ? ` ${DASH} ${entry.note}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const NEEDS_IN = ['missed_in', 'offsite', 'whole_day', 'night_shift'];
const NEEDS_OUT = ['missed_out', 'offsite', 'whole_day', 'night_shift'];

function DraftRow({ page, onSent }) {
  const [values, setValues] = useState({
    day: '',
    correction_type: 'missed_in',
    claimed_in: '',
    claimed_out: '',
    reason: '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const key = useRef(null);
  if (key.current === null) {
    key.current = `rostara-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }

  const needsIn = NEEDS_IN.includes(values.correction_type);
  const needsOut = NEEDS_OUT.includes(values.correction_type);

  // Leaving a cell is checked in the same task as the change that caused it, so the
  // checks read the latest typed values rather than the ones this render was drawn with.
  const latest = useRef(values);
  latest.current = values;
  const set = (field) => (event) => {
    const value = event.target.value;
    latest.current = { ...latest.current, [field]: value };
    setValues(latest.current);
  };

  const problems = () => {
    const typed = latest.current;
    const found = {};
    if (typed.day === '') found.day = feedback.fieldRequired;
    if (NEEDS_IN.includes(typed.correction_type) && typed.claimed_in === '') found.claimed_in = feedback.fieldRequired;
    if (NEEDS_OUT.includes(typed.correction_type) && typed.claimed_out === '') found.claimed_out = feedback.fieldRequired;
    if (typed.reason.trim() === '') found.reason = feedback.fieldRequired;
    else if (graphemeLength(typed.reason) < REASON_MIN) found.reason = feedback.reasonTooShort(REASON_MIN);
    return found;
  };

  /**
   * Leaving a cell for a control is followed at once by the whole-row check, so
   * checking the cell here would only move the row under the pointer.
   */
  const checkCell = (field) => (event) => {
    if (event.relatedTarget && event.relatedTarget.closest('button, a')) return;
    const found = problems();
    setErrors((current) => {
      if ((current[field] ?? null) === (found[field] ?? null)) return current;
      const next = { ...current };
      if (found[field]) next[field] = found[field];
      else delete next[field];
      return next;
    });
  };

  const send = async () => {
    const typed = latest.current;
    const found = problems();
    setErrors(found);
    const names = Object.keys(found);
    if (names.length > 0) {
      announce.assertive(feedback.validationSummary(names.length));
      document.getElementById(`draft-${names[0]}`)?.focus();
      return;
    }

    setBusy(true);
    setRefusal(null);
    announce.polite(feedback.sendingForApproval);
    const answer = await call('POST', '/api/requests', {
      headers: { 'Idempotency-Key': key.current },
      body: {
        day: typed.day,
        correction_type: typed.correction_type,
        claimed_in: typed.claimed_in === '' ? null : typed.claimed_in,
        claimed_out: typed.claimed_out === '' ? null : typed.claimed_out,
        reason: typed.reason,
      },
    });
    setBusy(false);
    if (answer.status === 201 || answer.status === 200) {
      announce.assertive(feedback.raised(answer.body.day));
      onSent(answer.body);
      return;
    }
    const wording = refusalWording(answer);
    announce.assertive(wording);
    setRefusal({ wording, ended: isEndedSession(answer) });
    if (answer.body?.field) {
      setErrors({ [answer.body.field]: wording });
      document.getElementById(`draft-${answer.body.field}`)?.focus();
    }
  };

  return (
    <>
      <tr className="row draft-row">
        <td data-label="State">
          <span className="chip chip-draft">
            <Icon name="plus" size={14} />
            Draft
          </span>
        </td>
        <td data-label="Person">{page.caller.name}</td>
        <td data-label="Day">
          <div className="field">
            <label htmlFor="draft-day">{ui.day}</label>
            <input
              id="draft-day"
              type="date"
              value={values.day}
              required
              aria-invalid={errors.day ? 'true' : undefined}
              aria-describedby={errors.day ? 'draft-day-error' : undefined}
              onChange={set('day')}
              onBlur={checkCell('day')}
            />
            <FieldError id="draft-day-error" message={errors.day} />
          </div>
        </td>
        <td data-label="Correction">
          <div className="field">
            <label htmlFor="draft-correction_type">{ui.correctionType}</label>
            <select id="draft-correction_type" value={values.correction_type} onChange={set('correction_type')}>
              {CORRECTION_TYPES.map((code) => (
                <option key={code} value={code}>
                  {CORRECTION_TYPE_LABELS[code]}
                </option>
              ))}
            </select>
          </div>
        </td>
        <td data-label="Claimed">
          {needsIn ? (
            <div className="field">
              <label htmlFor="draft-claimed_in">{ui.claimedIn}</label>
              <input
                id="draft-claimed_in"
                type="time"
                value={values.claimed_in}
                required
                aria-invalid={errors.claimed_in ? 'true' : undefined}
                aria-describedby={errors.claimed_in ? 'draft-claimed_in-error' : undefined}
                onChange={set('claimed_in')}
                onBlur={checkCell('claimed_in')}
              />
              <FieldError id="draft-claimed_in-error" message={errors.claimed_in} />
            </div>
          ) : null}
          {needsOut ? (
            <div className="field">
              <label htmlFor="draft-claimed_out">{ui.claimedOut}</label>
              <input
                id="draft-claimed_out"
                type="time"
                value={values.claimed_out}
                required
                aria-invalid={errors.claimed_out ? 'true' : undefined}
                aria-describedby={
                  [
                    errors.claimed_out ? 'draft-claimed_out-error' : null,
                    values.correction_type === 'night_shift' ? 'draft-night-help' : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onChange={set('claimed_out')}
                onBlur={checkCell('claimed_out')}
              />
              {values.correction_type === 'night_shift' ? (
                <p className="help" id="draft-night-help">
                  {ui.nightShiftHelp}
                </p>
              ) : null}
              <FieldError id="draft-claimed_out-error" message={errors.claimed_out} />
            </div>
          ) : null}
        </td>
        <td data-label="Recorded" className="third">
          {DASH}
        </td>
        <td data-label="Raised" className="third">
          {DASH}
        </td>
        <td data-label="Action">
          <a href="/requests">{ui.discard}</a>
        </td>
      </tr>
      <tr className="row draft-row">
        <td colSpan={ui.columns.length}>
          <div className="field">
            <label htmlFor="draft-reason">{ui.reason}</label>
            <textarea
              id="draft-reason"
              value={values.reason}
              required
              aria-invalid={errors.reason ? 'true' : undefined}
              aria-describedby={errors.reason ? 'draft-reason-help draft-reason-error' : 'draft-reason-help'}
              onChange={set('reason')}
              onBlur={checkCell('reason')}
            />
            <p className="help" id="draft-reason-help">
              {ui.reasonHelp}
            </p>
            <FieldError id="draft-reason-error" message={errors.reason} />
          </div>
          <div className="draft-actions">
            <button type="button" className="button primary" disabled={busy} onClick={send}>
              {ui.send}
            </button>
            <a href="/requests">{ui.discard}</a>
          </div>
          <Refusal refusal={refusal} />
        </td>
      </tr>
    </>
  );
}

export function QueueScreen() {
  const page = usePage();
  const [queue, setQueue] = useState(page.queue);
  const [detail, setDetail] = useState(page.detail);
  const [failed, setFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const headingRef = useRef(null);
  const queueHeadingRef = useRef(null);

  const { path, query, mode } = page;

  const reread = async (readAloud) => {
    const answer = await call('GET', `/api/requests${canonicalQueueQuery(query)}`);
    if (answer.status !== 200) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setQueue(answer.body);
    if (readAloud) announce.polite(ui.queueCaption(answer.body.matched, answer.body.total));
  };

  useEffect(() => {
    reread(false);
  }, []);

  useEffect(() => {
    if (mode === 'detail') {
      headingRef.current?.focus();
      return;
    }
    const stored = window.sessionStorage.getItem(RETURN_FOCUS_KEY);
    if (!stored) return;
    window.sessionStorage.removeItem(RETURN_FOCUS_KEY);
    const link = document.querySelector(`[data-request-link="${stored}"]`);
    if (link) link.focus();
    else queueHeadingRef.current?.focus();
  }, [mode]);

  const settle = async (updated) => {
    if (updated) setDetail((current) => ({ ...current, request: updated }));
    else {
      const answer = await call('GET', `/api/requests/${page.detail.request.id}`);
      if (answer.status === 200) setDetail(answer.body);
    }
    await reread(true);
  };

  const QueueHeading = mode === 'queue' ? 'h1' : 'h2';
  const empty = queue.rows.length === 0 && mode !== 'draft';

  return (
    <>
      <section className="queue-panel">
        <QueueHeading tabIndex={-1} ref={queueHeadingRef}>
          {ui.queueHeading}
        </QueueHeading>
        <div className="queue-controls">
          <StateChipGroup query={query} path={path} />
          <form
            className="field inline search"
            onSubmit={(event) => {
              event.preventDefault();
              goReplace(queueHref(path, withQueueChange(query, { q: event.target.elements.q.value })));
            }}
          >
            <label htmlFor="queue-search">{ui.search}</label>
            <span className="search-box">
              <Icon name="search" />
              <input id="queue-search" name="q" type="search" defaultValue={query.q} />
            </span>
          </form>
          <div className="field inline">
            <label htmlFor="queue-sort">{ui.sort}</label>
            <select
              id="queue-sort"
              value={query.sort}
              onChange={(event) => goReplace(queueHref(path, withQueueChange(query, { sort: event.target.value })))}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="button outline" onClick={() => setSheetOpen(true)}>
            <Icon name="filter" />
            {ui.filters}
          </button>
          {page.canRaise ? (
            <a className={mode === 'queue' ? 'button primary' : 'button outline'} href="/requests/new">
              <Icon name="plus" />
              {ui.raise}
            </a>
          ) : null}
        </div>

        {failed ? (
          <div className="empty">
            <Icon name="clock" size={44} className="empty-glyph" />
            <p>{feedback.queueReadFailed}</p>
            <button type="button" className="button outline" onClick={() => window.location.reload()}>
              {feedback.tryAgain}
            </button>
          </div>
        ) : mode === 'draft' ? (
          <table className="queue">
            <caption>{ui.queueCaption(queue.matched, queue.total)}</caption>
            <QueueHead />
            <tbody>
              <DraftRow
                page={page}
                onSent={(created) => window.location.assign(`/requests/${created.id}`)}
              />
            </tbody>
          </table>
        ) : empty ? (
          <div className="empty">
            <Icon name={page.filtersApplied ? 'filter' : 'bell'} size={44} className="empty-glyph" />
            <p>{page.emptyWording}</p>
            {page.filtersApplied ? <a href="/requests">{ui.clearFilters}</a> : null}
          </div>
        ) : (
          <QueueTable
            rows={queue.rows}
            matched={queue.matched}
            total={queue.total}
            query={query}
            openId={page.detail?.request.id}
          />
        )}
        {!failed && !empty ? <Pager page={queue.page} pages={queue.pages} query={query} path={path} /> : null}
      </section>

      <aside className="pane" aria-label="Request detail">
        {mode === 'detail' && detail ? (
          <DetailPane page={page} detail={detail} onSettled={settle} headingRef={headingRef} />
        ) : mode === 'draft' ? (
          <div className="pane-body">
            <h1 tabIndex={-1} ref={headingRef}>
              {ui.draftHeading}
            </h1>
            <p className="quiet-line prose">
              Fill the draft row at the head of the queue, then send it for approval.
            </p>
          </div>
        ) : (
          <div className="pane-body pane-empty">
            <Icon name="user" size={44} className="empty-glyph" />
            <p>Select a request from the queue to read it in full.</p>
          </div>
        )}
      </aside>

      {sheetOpen ? (
        <FilterSheet query={query} path={path} people={page.scopePeople} onClose={() => setSheetOpen(false)} />
      ) : null}
    </>
  );
}
