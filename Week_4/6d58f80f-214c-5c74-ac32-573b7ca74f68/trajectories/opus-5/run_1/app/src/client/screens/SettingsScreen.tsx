import { useEffect, useRef, useState } from 'react';
import type { Policy, PolicyKind } from '../../shared/types.js';
import { ApiFailure, api } from '../lib/api.js';
import {
  GENERIC_FAILURE,
  POLICY_ALREADY_STARTED,
  policyExists,
} from '../../shared/copy.js';
import { announce } from '../lib/store.js';
import { onReconnect, onServerEvent } from '../lib/events.js';

const KIND_LABEL: Record<PolicyKind, string> = {
  bin_retention_days: 'bin retention',
  partner_grant_days: 'grant length',
};

const STATE_LABEL = {
  in_force: 'In force',
  scheduled: 'Scheduled',
  past: 'Past',
} as const;

interface FormState {
  days: string;
  effectiveFrom: string;
  errors: { days?: string; effectiveFrom?: string };
}

const emptyForm: FormState = { days: '', effectiveFrom: '', errors: {} };

export const SettingsScreen = (): JSX.Element => {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [bin, setBin] = useState<FormState>(emptyForm);
  const [grant, setGrant] = useState<FormState>(emptyForm);
  const binDays = useRef<HTMLInputElement>(null);
  const binDate = useRef<HTMLInputElement>(null);
  const grantDays = useRef<HTMLInputElement>(null);
  const grantDate = useRef<HTMLInputElement>(null);

  const load = (): void => {
    void api
      .policies()
      .then((result) => setPolicies(result.policies))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    const stopEvents = onServerEvent((event) => {
      if (event.type === 'policies_changed' || event.type === 'clock') load();
    });
    const stopReconnect = onReconnect(load);
    return () => {
      stopEvents();
      stopReconnect();
    };
  }, []);

  const schedule = (kind: PolicyKind): void => {
    const form = kind === 'bin_retention_days' ? bin : grant;
    const setForm = kind === 'bin_retention_days' ? setBin : setGrant;
    setForm({ ...form, errors: {} });
    void api
      .schedulePolicy({
        kind,
        days: Number(form.days),
        effectiveFrom: form.effectiveFrom,
      })
      .then((result) => {
        announce(
          kind === 'bin_retention_days'
            ? `Bin retention changes to ${result.policy.days} days from ${result.policy.effectiveFrom}`
            : `Partner grant length changes to ${result.policy.days} days from ${result.policy.effectiveFrom}`,
        );
        setForm(emptyForm);
        load();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.code === 'policy_exists') {
          const message = policyExists(form.effectiveFrom);
          setForm({ ...form, errors: { effectiveFrom: message } });
          announce(message);
          (kind === 'bin_retention_days' ? binDate : grantDate).current?.focus();
          return;
        }
        if (failure instanceof ApiFailure && failure.status === 422) {
          const errors = {
            days: failure.fields.days,
            effectiveFrom: failure.fields.effectiveFrom,
          };
          setForm({ ...form, errors });
          const first = errors.days !== undefined;
          const target = kind === 'bin_retention_days'
            ? first
              ? binDays
              : binDate
            : first
              ? grantDays
              : grantDate;
          target.current?.focus();
          announce(errors.days ?? errors.effectiveFrom ?? GENERIC_FAILURE);
          return;
        }
        announce(GENERIC_FAILURE);
      });
  };

  const withdraw = (policy: Policy): void => {
    void api
      .withdrawPolicy(policy.id)
      .then(() => {
        announce(`Withdrew the change from ${policy.effectiveFrom}`);
        load();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.code === 'policy_started') {
          announce(POLICY_ALREADY_STARTED);
          load();
          return;
        }
        announce(GENERIC_FAILURE);
      });
  };

  const renderForm = (
    kind: PolicyKind,
    label: string,
    form: FormState,
    setForm: (value: FormState) => void,
    daysRef: React.RefObject<HTMLInputElement>,
    dateRef: React.RefObject<HTMLInputElement>,
  ): JSX.Element => (
    <form
      aria-label={label}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        schedule(kind);
      }}
    >
      <h2>{label}</h2>
      <div className="field">
        <label htmlFor={`${kind}-days`}>Days</label>
        <input
          id={`${kind}-days`}
          ref={daysRef}
          type="number"
          aria-label="Days"
          min={1}
          max={kind === 'bin_retention_days' ? 90 : 365}
          step={1}
          value={form.days}
          onChange={(event) => setForm({ ...form, days: event.target.value })}
        />
        {form.errors.days === undefined ? null : (
          <p className="field-error">{form.errors.days}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${kind}-from`}>Effective from</label>
        <input
          id={`${kind}-from`}
          ref={dateRef}
          type="date"
          aria-label="Effective from"
          value={form.effectiveFrom}
          onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
        />
        {form.errors.effectiveFrom === undefined ? null : (
          <p className="field-error">{form.errors.effectiveFrom}</p>
        )}
      </div>
      <button type="submit" className="primary">
        {kind === 'bin_retention_days' ? 'Schedule bin retention' : 'Schedule grant length'}
      </button>
    </form>
  );

  return (
    <div className="screen-body">
      <h1>Settings</h1>
      {renderForm('bin_retention_days', 'Bin retention', bin, setBin, binDays, binDate)}
      {renderForm(
        'partner_grant_days',
        'Partner grant length',
        grant,
        setGrant,
        grantDays,
        grantDate,
      )}
      <table>
        <caption>Policy schedule</caption>
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Days</th>
            <th scope="col">Effective from</th>
            <th scope="col">State</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy.id}>
              <td>{KIND_LABEL[policy.kind]}</td>
              <td className="num">{policy.days}</td>
              <td className="num">{policy.effectiveFrom}</td>
              <td>{STATE_LABEL[policy.state]}</td>
              <td>
                {policy.state === 'scheduled' ? (
                  <button type="button" onClick={() => withdraw(policy)}>
                    Withdraw {KIND_LABEL[policy.kind]} from {policy.effectiveFrom}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
