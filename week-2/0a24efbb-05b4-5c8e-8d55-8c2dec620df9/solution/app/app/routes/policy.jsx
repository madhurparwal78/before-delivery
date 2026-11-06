import { Fragment } from "react";
import { data, useLoaderData } from "react-router";
import { Icon } from "../icons.jsx";
import { Page } from "../page.jsx";
import { Moment } from "../queue.jsx";
import { ROLE_LABELS, TYPE_LABELS, VERB_WORDS, moment } from "../words.js";

const SCREEN = "Correction policy";

export async function loader({ context }) {
  const { caller, desk } = context;
  if (caller.role !== "admin") throw data({ crumb: SCREEN }, { status: 403 });
  const [versions, entries] = await Promise.all([desk.policyHistory(caller), desk.wholeTrail(caller)]);
  return { versions, entries };
}

function Field({ id, label, children, help }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {help}
      <p className="field-error" id={`${id}-error`} hidden />
    </div>
  );
}

export default function PolicyScreen() {
  const { versions, entries } = useLoaderData();
  const policy = versions[0];
  return (
    <Page title={SCREEN} crumb={SCREEN}>
      <div className="screen-head">
        <h1><Icon name="shield" size={28} />{SCREEN}</h1>
      </div>
      <p className="callout info" data-colleague hidden />
      <form className="policy" data-policy data-version={policy.version} noValidate>
        <fieldset className="group-limits">
          <legend>Cap and lookback</legend>
          <div className="field-pair">
            <Field id="policy-cap" label="Corrections allowed per person each month">
              <input id="policy-cap" name="monthly_cap" type="number" min={0} max={10} step={1}
                defaultValue={policy.monthly_cap} aria-describedby="policy-cap-error" />
            </Field>
            <Field id="policy-lookback" label="How many days back a correction may reach">
              <input id="policy-lookback" name="lookback_days" type="number" min={1} max={90} step={1}
                defaultValue={policy.lookback_days} aria-describedby="policy-lookback-error" />
            </Field>
          </div>
        </fieldset>
        <fieldset className="group-types" id="policy-types" aria-describedby="policy-types-error" data-types>
          <legend>Corrections people may raise</legend>
          <div className="checks">
            {Object.entries(TYPE_LABELS).map(([code, label]) => (
              <label key={code} className="check">
                <input type="checkbox" name="enabled_types" value={code} defaultChecked={policy.enabled_types.includes(code)}
                  aria-describedby="policy-types-error" />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="field-error" id="policy-types-error" hidden />
        </fieldset>
        <fieldset className="group-note">
          <legend>Approving</legend>
          <label className="check">
            <input id="policy-note" type="checkbox" name="require_note_on_approve" defaultChecked={policy.require_note_on_approve}
              aria-describedby="policy-note-error" />
            <span>Require a note when approving</span>
          </label>
          <p className="field-error" id="policy-note-error" hidden />
        </fieldset>
        <fieldset className="group-self">
          <legend>Self approval</legend>
          <label className="check switch">
            <input id="policy-self" type="checkbox" role="switch" name="self_approval_allowed" disabled
              aria-checked="false" aria-describedby="policy-self-help policy-self-error" />
            <span>Allow managers to approve their own corrections</span>
          </label>
          <p className="help" id="policy-self-help">Not available. Self approval is refused by this product.</p>
          <p className="field-error" id="policy-self-error" hidden />
        </fieldset>
        <div className="policy-actions">
          <button type="button" className="btn primary" data-save>
            <Icon name="shield" />
            Save new version
          </button>
        </div>
      </form>
      <dialog className="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-body" data-confirm>
        <h2 id="confirm-title">Save this policy?</h2>
        <p id="confirm-body">
          This appends version <span data-next-version>{policy.version + 1}</span>. Requests already waiting stay waiting.
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn" data-keep>Keep editing</button>
          <button type="button" className="btn strong" data-confirm-save>Save</button>
        </div>
      </dialog>
      <section className="history" aria-labelledby="history-title" data-history>
        <h2 id="history-title">Previous versions</h2>
        <div className="table-panel">
          <table className="plain-table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Cap</th>
                <th scope="col">Lookback</th>
                <th scope="col">Note on approval</th>
                <th scope="col">Saved</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <Fragment key={v.version}>
                  <tr className="version-facts">
                    <td className="num">{v.version}</td>
                    <td className="num">{v.monthly_cap}</td>
                    <td className="num">{`${v.lookback_days} ${v.lookback_days === 1 ? "day" : "days"}`}</td>
                    <td>{v.require_note_on_approve ? "Required" : "Not required"}</td>
                    <td>
                      {v.created_by}
                      <time className="num stamp saved-at" dateTime={v.created_at}><Moment instant={v.created_at} /></time>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5}>Corrections: {v.enabled_types.map((type) => TYPE_LABELS[type]).join(", ")}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="whole-trail" aria-labelledby="trail-title" data-whole-trail>
        <div className="trail-head">
          <h2 id="trail-title">Whole trail</h2>
          <a className="btn" href="/api/trail.csv">
            <Icon name="download" />
            Download trail
          </a>
        </div>
        <ol className="trail">
          {entries.map((entry) => (
            <li key={entry.seq}>
              <span className="trail-what">
                {`${VERB_WORDS[entry.verb]} by ${entry.actor}, ${ROLE_LABELS[entry.actor_role]}`}
                {entry.request_id !== null && ` · request ${entry.request_id}`}
              </span>
              <time dateTime={entry.occurred_at}>{moment(entry.occurred_at)}</time>
              {entry.note && <span className="trail-note">{entry.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </Page>
  );
}
