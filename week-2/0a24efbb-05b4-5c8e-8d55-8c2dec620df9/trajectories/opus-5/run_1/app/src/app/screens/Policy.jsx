import { useEffect, useRef, useState } from 'react';
import { usePage } from '../deskData.jsx';
import { businessStamp } from '../../shared/businessTime.js';
import { CORRECTION_TYPES, CORRECTION_TYPE_LABELS } from '../../shared/constants.js';
import { feedback, ui } from '../../shared/copy.js';
import { call, isEndedSession, refusalWording } from '../api.js';
import { announce } from '../announce.js';
import { Dialog } from '../components/Dialog.jsx';
import { Icon } from '../components/Icon.jsx';

const DASH = '\u2014';

function FieldError({ id, message }) {
  return (
    <p className="field-error" id={id} hidden={!message}>
      {message ?? ''}
    </p>
  );
}

function TrailList({ entries }) {
  return (
    <ul className="trail">
      {entries.map((entry) => (
        <li key={entry.seq}>
          <span className="trail-when figures">{businessStamp(entry.occurred_at)}</span> {entry.actor} ({entry.actor_role}){' '}
          {entry.verb} {entry.subject_type} {entry.subject_id}
          {entry.note ? ` ${DASH} ${entry.note}` : ''}
        </li>
      ))}
    </ul>
  );
}

export function PolicyScreen() {
  const page = usePage();
  const [version, setVersion] = useState(page.policy.version);
  const [form, setForm] = useState({
    monthly_cap: String(page.policy.monthly_cap),
    lookback_days: String(page.policy.lookback_days),
    enabled_types: page.policy.enabled_types,
    require_note_on_approve: page.policy.require_note_on_approve,
  });
  const [history, setHistory] = useState(page.history);
  const [trail, setTrail] = useState(page.trail);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [callout, setCallout] = useState(null);
  const [invalid, setInvalid] = useState(null);
  const saveRef = useRef(null);
  const latest = useRef(form);
  latest.current = form;

  useEffect(() => {
    const line = document.querySelector('[data-footer-line]');
    if (line) line.textContent = ui.footer(version);
  }, [version]);

  const change = (field, value) => {
    latest.current = { ...latest.current, [field]: value };
    setForm(latest.current);
  };

  const toggleType = (code) => {
    const current = latest.current.enabled_types;
    change(
      'enabled_types',
      current.includes(code)
        ? current.filter((entry) => entry !== code)
        : CORRECTION_TYPES.filter((entry) => entry === code || current.includes(entry)),
    );
  };

  const refresh = async () => {
    const [historyAnswer, trailAnswer] = await Promise.all([
      call('GET', '/api/policy/history'),
      call('GET', '/api/audit'),
    ]);
    if (historyAnswer.status === 200) setHistory(historyAnswer.body.versions);
    if (trailAnswer.status === 200) setTrail(trailAnswer.body.entries);
  };

  const save = async () => {
    setConfirming(false);
    setBusy(true);
    setInvalid(null);
    announce.polite(feedback.savingPolicy);
    const typed = latest.current;
    const answer = await call('PUT', '/api/policy', {
      headers: { 'If-Match': `"${version}"` },
      body: {
        monthly_cap: typed.monthly_cap === '' ? null : Number(typed.monthly_cap),
        lookback_days: typed.lookback_days === '' ? null : Number(typed.lookback_days),
        enabled_types: typed.enabled_types,
        require_note_on_approve: typed.require_note_on_approve,
      },
    });
    setBusy(false);

    if (answer.status === 201) {
      setVersion(answer.body.version);
      setCallout(null);
      announce.assertive(feedback.policySaved(answer.body.version));
      await refresh();
      saveRef.current?.focus();
      return;
    }

    const wording = refusalWording(answer);
    announce.assertive(wording);

    if (answer.status === 412) {
      const current = await call('GET', '/api/policy');
      if (current.status === 200) {
        setVersion(current.body.version);
        setCallout(feedback.staleCallout(current.body.version, current.body.created_by));
      }
      await refresh();
      saveRef.current?.focus();
      return;
    }

    if (answer.status === 400 && answer.body?.field) {
      setInvalid({ field: answer.body.field, wording });
      const target =
        answer.body.field === 'enabled_types'
          ? document.getElementById(`policy-type-${CORRECTION_TYPES[0]}`)
          : document.getElementById(`policy-${answer.body.field}`);
      target?.focus();
      return;
    }

    if (isEndedSession(answer)) {
      setInvalid({ field: null, wording, ended: true });
      return;
    }
    setInvalid({ field: null, wording });
    saveRef.current?.focus();
  };

  const describedBy = (field) => (invalid?.field === field ? `policy-${field}-error` : undefined);
  const invalidFlag = (field) => (invalid?.field === field ? 'true' : undefined);

  return (
    <section className="policy-panel">
      <h1>{ui.policyHeading}</h1>
      {callout ? <p className="callout">{callout}</p> : null}

      <form
        className="policy-form"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirming(true);
        }}
      >
        <div className="field">
          <label htmlFor="policy-monthly_cap">{ui.cap}</label>
          <input
            id="policy-monthly_cap"
            type="number"
            value={form.monthly_cap}
            aria-invalid={invalidFlag('monthly_cap')}
            aria-describedby={describedBy('monthly_cap')}
            onChange={(event) => change('monthly_cap', event.target.value)}
          />
          <FieldError id="policy-monthly_cap-error" message={invalid?.field === 'monthly_cap' ? invalid.wording : null} />
        </div>

        <div className="field">
          <label htmlFor="policy-lookback_days">{ui.lookback}</label>
          <input
            id="policy-lookback_days"
            type="number"
            value={form.lookback_days}
            aria-invalid={invalidFlag('lookback_days')}
            aria-describedby={describedBy('lookback_days')}
            onChange={(event) => change('lookback_days', event.target.value)}
          />
          <FieldError id="policy-lookback_days-error" message={invalid?.field === 'lookback_days' ? invalid.wording : null} />
        </div>

        <fieldset
          className="field"
          aria-invalid={invalidFlag('enabled_types')}
          aria-describedby={describedBy('enabled_types')}
        >
          <legend>{ui.enabledTypesGroup}</legend>
          {CORRECTION_TYPES.map((code) => (
            <div className="check" key={code}>
              <input
                id={`policy-type-${code}`}
                type="checkbox"
                checked={form.enabled_types.includes(code)}
                aria-invalid={invalidFlag('enabled_types')}
                aria-describedby={describedBy('enabled_types')}
                onChange={() => toggleType(code)}
              />
              <label htmlFor={`policy-type-${code}`}>{CORRECTION_TYPE_LABELS[code]}</label>
            </div>
          ))}
          <FieldError id="policy-enabled_types-error" message={invalid?.field === 'enabled_types' ? invalid.wording : null} />
        </fieldset>

        <div className="check">
          <input
            id="policy-require_note_on_approve"
            type="checkbox"
            checked={form.require_note_on_approve}
            aria-invalid={invalidFlag('require_note_on_approve')}
            aria-describedby={describedBy('require_note_on_approve')}
            onChange={(event) => change('require_note_on_approve', event.target.checked)}
          />
          <label htmlFor="policy-require_note_on_approve">{ui.noteRule}</label>
        </div>

        <div className="check">
          <button
            type="button"
            id="policy-self_approval_allowed"
            role="switch"
            aria-checked="false"
            disabled
            aria-describedby="policy-self-approval-help"
            className="switch"
          >
            <span className="visually-hidden">{ui.selfApproval}</span>
          </button>
          <label htmlFor="policy-self_approval_allowed">{ui.selfApproval}</label>
          <p className="help" id="policy-self-approval-help">
            {ui.selfApprovalHelp}
          </p>
        </div>

        <button type="submit" className="button primary" ref={saveRef} disabled={busy}>
          <Icon name="shield" />
          {ui.save}
        </button>
        {invalid && invalid.field === null ? <p className="refusal">{invalid.wording}</p> : null}
      </form>

      <section className="history">
        <h2>{ui.historyHeading}</h2>
        <table className="versions">
          <caption>{`${history.length} versions`}</caption>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Cap</th>
              <th scope="col">Lookback</th>
              <th scope="col">Types</th>
              <th scope="col">Note on approve</th>
              <th scope="col">Saved by</th>
              <th scope="col">Saved at</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.version}>
                <td className="figures">{entry.version}</td>
                <td className="figures">{entry.monthly_cap}</td>
                <td className="figures">{entry.lookback_days}</td>
                <td className="figures">{entry.enabled_types.length}</td>
                <td>{entry.require_note_on_approve ? 'Yes' : 'No'}</td>
                <td>{entry.created_by}</td>
                <td className="figures">{businessStamp(entry.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="whole-trail">
        <h2>{ui.wholeTrailHeading}</h2>
        <p>
          <a href="/api/trail.csv">
            <Icon name="download" />
            {ui.downloadTrail}
          </a>
        </p>
        <TrailList entries={trail} />
      </section>

      {confirming ? (
        <Dialog title={ui.confirmTitle} onClose={() => setConfirming(false)}>
          <p>{ui.confirmBody(version + 1)}</p>
          <div className="dialog-actions">
            <button type="button" className="button outline" onClick={save}>
              {ui.confirmSave}
            </button>
            <button type="button" className="button quiet" onClick={() => setConfirming(false)}>
              {ui.keepEditing}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
