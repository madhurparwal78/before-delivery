import { data, useLoaderData } from "react-router";
import { queueHref } from "../../src/queue-query.mjs";
import { Icon } from "../icons.jsx";
import { Page } from "../page.jsx";
import { Queue, loadQueue } from "../queue.jsx";
import { TYPE_LABELS } from "../words.js";

const SCREEN = "Raise a correction";

export async function loader({ request, context }) {
  if (context.caller.role === "admin") throw data({ crumb: SCREEN }, { status: 403 });
  return { queue: await loadQueue(request, context, SCREEN), name: context.caller.name };
}

function Cell({ id, label, children, help }) {
  return (
    <div className="draft-field" data-field={id}>
      <span className="label-row">
        <label className="label" htmlFor={`draft-${id}`}>{label}</label>
        <span className="req" id={`draft-${id}-req`}>Required</span>
      </span>
      {children}
      {help}
      <p className="field-error" id={`draft-${id}-error`} hidden />
    </div>
  );
}

const describe = (id, extra = "") => `draft-${id}-req ${extra} draft-${id}-error`.replace(/\s+/g, " ");

/** The draft row: its cells sit under the queue's own column headings, the reason in a full-width cell beneath. */
function DraftRows({ name, discard }) {
  return (
    <>
      <tr className="draft" data-draft>
        <td data-label="State" className="draft-mark">
          <Icon name="plus" />
          <span className="sr-only">New correction</span>
        </td>
        <td data-label="Person">{name}</td>
        <td data-label="Day">
          <Cell id="day" label="Day to correct">
            <input id="draft-day" form="draft" name="day" type="date" required aria-required="true"
              aria-describedby={describe("day")} />
          </Cell>
        </td>
        <td data-label="Correction" className="col-correction">
          <Cell id="correction_type" label="Correction type">
            <select id="draft-correction_type" form="draft" name="correction_type" defaultValue="missed_in" required
              aria-required="true" aria-describedby={describe("correction_type")}>
              {Object.entries(TYPE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </Cell>
        </td>
        <td data-label="Claimed" className="col-claimed draft-times">
          <Cell id="claimed_in" label="Claimed sign in">
            <input id="draft-claimed_in" form="draft" name="claimed_in" type="time" required aria-required="true"
              aria-describedby={describe("claimed_in")} />
          </Cell>
          <Cell id="claimed_out" label="Claimed sign out"
            help={<span className="help" id="draft-night-help" data-night-help hidden>Ends the following day.</span>}>
            <input id="draft-claimed_out" form="draft" name="claimed_out" type="time" required aria-required="true"
              aria-describedby={describe("claimed_out", "draft-night-help")} />
          </Cell>
        </td>
        <td data-label="Recorded" className="col-recorded"><span className="absent" aria-hidden="true">—</span></td>
        <td data-label="Raised" className="col-raised"><span className="absent" aria-hidden="true">—</span></td>
        <td data-label="Action" className="cell-action" />
      </tr>
      <tr className="draft draft-reason">
        <td colSpan={8}>
          <form id="draft" className="draft-form" noValidate data-draft-form>
            <div className="draft-moved" data-draft-moved />
            <Cell id="reason" label="Reason"
              help={
                <span className="help" id="draft-reason-help">
                  Twenty to 280 characters. Each emoji counts as one. Your manager reads this.{" "}
                  <span className="count" data-count aria-hidden="true">0 / 280</span>
                </span>
              }>
              <textarea id="draft-reason" name="reason" rows={2} required aria-required="true"
                aria-describedby={describe("reason", "draft-reason-help")} />
            </Cell>
            <div className="draft-actions">
              <a className="btn" href={discard}>Discard draft</a>
              <button type="submit" className="btn primary" data-send>
                <Icon name="check" />
                Send for approval
              </button>
            </div>
          </form>
        </td>
      </tr>
    </>
  );
}

export default function RaiseScreen() {
  const { queue, name } = useLoaderData();
  const discard = queueHref("/requests", queue.values);
  return (
    <Page title={SCREEN} crumb={SCREEN} deskHref={discard} layout="drafting">
      <div className="screen-head">
        <h1>{SCREEN}</h1>
      </div>
      <Queue queue={queue} path="/requests/new" headingLevel={2} draft={<DraftRows name={name} discard={discard} />} />
    </Page>
  );
}
