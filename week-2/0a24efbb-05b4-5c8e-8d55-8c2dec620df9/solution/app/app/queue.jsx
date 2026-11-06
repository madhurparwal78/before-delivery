import { data } from "react-router";
import { canonicalQuery, queueHref } from "../src/queue-query.mjs";
import { signOutDay } from "../src/rules.mjs";
import { Icon } from "./icons.jsx";
import { ROLE_LABELS, STATE_GLYPHS, STATE_WORDS, TYPE_LABELS, VERB_WORDS, moment, rowPunch } from "./words.js";

const COLUMNS = ["State", "Person", "Day", "Correction", "Claimed", "Recorded", "Raised", "Action"];
const CHIPS = [["", "All"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["cancelled", "Cancelled"]];
const SORTS = [["", "Waiting first"], ["day", "Day, newest first"], ["raised", "Raised, oldest first"], ["person", "Person, A to Z"]];
const EMPTY = {
  employee: "You have not raised a correction yet.",
  manager: "Nothing is waiting on you. Your reports have no open requests.",
  admin: "No corrections have been raised in this company yet.",
};

/** The queue page data shared by `/requests`, `/requests/<id>` and `/requests/new`. */
export async function loadQueue(request, { caller, desk }, crumb) {
  let values;
  try {
    values = desk.readQueueQuery(new URL(request.url).search);
  } catch {
    throw data({ crumb }, { status: 400 });
  }
  const page = await desk.queue(caller, values);
  const [people, trails] = await Promise.all([
    caller.role === "employee" ? [] : desk.scopePeople(caller),
    desk.trails(page.rows.map((row) => row.id)),
  ]);
  return { ...page, values, query: canonicalQuery(values), people, trails, role: caller.role };
}

export function Chip({ state }) {
  return (
    <span className="chip" data-state={state}>
      <Icon name={STATE_GLYPHS[state]} size={14} />
      <span>{STATE_WORDS[state]}</span>
    </span>
  );
}

export function Absent({ words = "Not recorded" }) {
  return (
    <span className="absent">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{words}</span>
    </span>
  );
}

export function claimedOut(request) {
  if (!request.claimed_out) return null;
  const on = signOutDay(request.correction_type, request.day);
  return on === request.day ? request.claimed_out : `${request.claimed_out} on ${on}`;
}

export function Moment({ instant }) {
  const [day, time] = moment(instant).split(" ");
  return <span><span className="nowrap">{day}</span> <span className="nowrap">{time}</span></span>;
}

function Pair({ first, second }) {
  if (first == null && second == null) return <Absent />;
  return (
    <span className="pair-times">
      <span className="nowrap">{first ?? <Absent />}<span aria-hidden="true">{"\u00a0–"}</span></span>
      {" "}
      <span className="nowrap">{second ?? <Absent />}</span>
    </span>
  );
}

export function Trail({ entries }) {
  if (!entries?.length) return <p className="quiet">No decision has been recorded yet.</p>;
  return (
    <ol className="trail">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="trail-what">
            {`${VERB_WORDS[entry.verb]} by ${entry.actor}, ${ROLE_LABELS[entry.actor_role]}`}
          </span>
          <time dateTime={entry.occurred_at}>{moment(entry.occurred_at)}</time>
          {entry.note && <span className="trail-note">{entry.note}</span>}
        </li>
      ))}
    </ol>
  );
}

function Row({ row, href, selected, trail, level }) {
  const Sub = `h${level}`;
  return (
    <>
      <tr data-request={row.id} data-state={row.state} className={selected ? "is-selected" : undefined}
        aria-current={selected ? "true" : undefined}>
        <td data-label="State"><Chip state={row.state} /></td>
        <td data-label="Person" className="cell-person">
          <a href={href} aria-label={`Open request ${row.id}`} data-open={row.id}>{row.person}</a>
        </td>
        <td data-label="Day" className="num"><span className="nowrap">{row.day}</span></td>
        <td data-label="Correction" className="col-correction">{TYPE_LABELS[row.correction_type]}</td>
        <td data-label="Claimed" className="col-claimed num"><Pair first={row.claimed_in} second={row.claimed_out} /></td>
        <td data-label="Recorded" className="col-recorded num">
          <Pair first={rowPunch(row.recorded_in)} second={rowPunch(row.recorded_out)} />
        </td>
        <td data-label="Raised" className="col-raised num"><Moment instant={row.raised_at} /></td>
        <td data-label="Action" className="cell-action">
          <button type="button" className="icon-btn expand" aria-label={`Show details for request ${row.id}`}
            aria-expanded="false" aria-controls={`more-${row.id}`} data-expand={row.id}>
            <Icon name="chevron-right" />
          </button>
        </td>
      </tr>
      <tr className="more" id={`more-${row.id}`} data-more={row.id} hidden>
        <td colSpan={COLUMNS.length}>
          <div className="more-inner">
            <div>
              <Sub>Reason given</Sub>
              <p className="prose">{row.reason}</p>
            </div>
            <div>
              <Sub>What happened</Sub>
              <Trail entries={trail} />
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

function EmptyRow({ queue, path }) {
  const filtered = queue.total > 0;
  return (
    <tr className="empty-row">
      <td colSpan={COLUMNS.length}>
        <div className="empty">
          <Icon name={filtered ? "filter" : "clock"} size={48} />
          <p>{filtered ? "No requests match these filters. Clear them to see the full queue." : EMPTY[queue.role]}</p>
          {filtered && <a className="btn" href={queueHref(path, { sort: queue.values.sort })}>Clear filters</a>}
        </div>
      </td>
    </tr>
  );
}

function FilterSheet({ queue }) {
  const { values } = queue;
  return (
    <dialog className="sheet" aria-labelledby="sheet-title" data-sheet>
      <form method="get" data-sheet-form>
        <div className="sheet-head">
          <h2 id="sheet-title">Narrow the queue</h2>
        </div>
        <label className="field">
          <span className="label">Correction</span>
          <select name="type" defaultValue={values.type ?? ""}>
            <option value="">Any correction</option>
            {Object.entries(TYPE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        {queue.role !== "employee" && (
          <label className="field">
            <span className="label">Person</span>
            <select name="person" defaultValue={queue.people.find((p) => p.work_address.toLowerCase() === values.person?.toLowerCase())?.work_address ?? ""}>
              <option value="">Anyone in scope</option>
              {queue.people.map((p) => <option key={p.work_address} value={p.work_address}>{p.name}</option>)}
            </select>
          </label>
        )}
        <div className="field">
          <label className="label" htmlFor="sheet-month">Month</label>
          <input id="sheet-month" name="month" type="text" inputMode="numeric" autoComplete="off"
            defaultValue={values.month ?? ""} aria-describedby="sheet-month-help" />
          <span className="help" id="sheet-month-help">Year and month, for example 2026-10</span>
        </div>
        <div className="sheet-actions">
          <button type="submit" className="btn strong">Apply filters</button>
          <button type="button" className="btn" data-sheet-clear>Clear filters</button>
          <button type="button" className="btn" data-sheet-close>Close</button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * The queue: tools strip, the table (with an optional draft at its head) and the pager.
 * `path` is the route the queue's own links stay on; `selected` marks the open request.
 */
export function Queue({ queue, path, headingLevel, selected, draft, canRaise }) {
  const Heading = `h${headingLevel}`;
  const rowHref = (id) => queueHref(`/requests/${id}`, queue.values);
  const pageHref = (page) => queueHref(path, { ...queue.values, page: String(page) });
  return (
    <section className="queue" aria-labelledby="queue-title" data-queue={canonicalQuery({ ...queue.values, page: String(queue.page) })}>
      <div className="queue-head">
        <Heading id="queue-title" tabIndex={-1}>Regularisation requests</Heading>
        {canRaise && (
          <a className={canRaise === "primary" ? "btn primary" : "btn"} href="/requests/new">
            <Icon name="plus" />
            Raise a correction
          </a>
        )}
      </div>
      <div className="tools">
        <div className="states" role="radiogroup" aria-label="Request state" data-states>
          {CHIPS.map(([value, label]) => {
            const checked = (queue.values.state ?? "") === value;
            return (
              <button key={label} type="button" role="radio" className="state-chip" aria-checked={checked}
                tabIndex={checked ? 0 : -1} data-href={queueHref(path, { ...queue.values, state: value, page: undefined })}>
                {label}
              </button>
            );
          })}
        </div>
        <form className="search" role="search" method="get" data-search>
          <label htmlFor="queue-q" className="label">Search reasons</label>
          <span className="search-box">
            <Icon name="search" />
            <input id="queue-q" type="search" name="q" defaultValue={queue.values.q ?? ""} maxLength={100} />
          </span>
        </form>
        <div className="field sort">
          <label htmlFor="queue-sort" className="label">Sort</label>
          <select id="queue-sort" defaultValue={queue.values.sort ?? ""} data-sort>
            {SORTS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="button" className="btn" aria-haspopup="dialog" data-filters>
          <Icon name="filter" />
          Filters
        </button>
      </div>
      <p className="busy-line" data-busy hidden>
        <span className="arc" aria-hidden="true" />
        Loading requests
      </p>
      <div className="table-panel" data-table-panel>
        <table className="grid-table">
          <caption data-caption>{`${queue.matched} of ${queue.total} requests`}</caption>
          <thead>
            <tr>
              {COLUMNS.map((name) => (
                <th key={name} scope="col" className={`col-${name.toLowerCase()}`}>{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft}
            {queue.rows.length === 0 && <EmptyRow queue={queue} path={path} />}
            {queue.rows.map((row) => (
              <Row key={row.id} row={row} href={rowHref(row.id)} selected={row.id === selected} trail={queue.trails[row.id]}
                level={headingLevel + 1} />
            ))}
          </tbody>
        </table>
      </div>
      <nav className="pager" aria-label="Pages" data-pager>
        {queue.page > 1 && <a href={pageHref(queue.page - 1)} data-page-link>Previous page</a>}
        <span data-pager-text>{`Page ${queue.page} of ${queue.pages}`}</span>
        {queue.page < queue.pages && <a href={pageHref(queue.page + 1)} data-page-link>Next page</a>}
      </nav>
      <FilterSheet queue={queue} />
    </section>
  );
}

