import { useState } from "react";
import type { StakingMe, Validator } from "../../shared/api.ts";
import { TRANSACTION_SENT } from "../../shared/copy.ts";
import { formatFernUnit, formatTime, formatDateTime } from "../../shared/units.ts";
import { Page } from "../components/Page.tsx";
import { ButtonPill } from "../components/Pill.tsx";
import { Field, FormAlert, SubmitButton, useFormModel, useRoleGate, useStatusSink, type FormModel, type Gate } from "../components/forms.tsx";
import { Empty, Loading } from "../components/StrandCanvas.tsx";
import { api } from "../lib/api.ts";
import { display } from "../lib/config.ts";
import { commissionText } from "../lib/format.ts";
import { useJson } from "../lib/resource.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { FormPanel } from "../components/FormPanel.tsx";

function ValidatorSelect({ name, props, validators, value, onChange, disabled }: {
  name: string;
  props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean };
  validators: Validator[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <select {...props} name={name} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a validator</option>
      {validators.map((validator) => <option key={validator.id} value={validator.id}>{validator.name}</option>)}
    </select>
  );
}

interface StakingFormProps {
  title: string;
  action: "delegate" | "undelegate" | "redelegate";
  validators: Validator[];
  fee: number;
  gate: Gate;
  model: FormModel;
  onDone: () => void;
}

function StakingForm({ title, action, validators, fee, gate, model, onDone }: StakingFormProps) {
  const { id } = useWorkspace();
  const [validator, setValidator] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const redelegating = action === "redelegate";

  return (
    <FormPanel title={title}>
      <form aria-label={title} noValidate className="stack" onSubmit={(event) => {
        event.preventDefault();
        void model.run(event.currentTarget, async () => {
          await api("POST", `/api/w/${id}/staking/${action}`, redelegating ? { from, to, amount } : { validator, amount });
          setAmount("");
          onDone();
          return TRANSACTION_SENT;
        });
      }}>
        {redelegating ? (
          <>
            <Field name="from" label="From validator" error={model.errors.from} extraDescription={gate.describedBy}>
              {(props) => <ValidatorSelect name="from" props={props} validators={validators} value={from} onChange={setFrom} disabled={gate.disabled} />}
            </Field>
            <Field name="to" label="To validator" error={model.errors.to} extraDescription={gate.describedBy}>
              {(props) => <ValidatorSelect name="to" props={props} validators={validators} value={to} onChange={setTo} disabled={gate.disabled} />}
            </Field>
          </>
        ) : (
          <Field name="validator" label="Validator" error={model.errors.validator} extraDescription={gate.describedBy}>
            {(props) => <ValidatorSelect name="validator" props={props} validators={validators} value={validator} onChange={setValidator} disabled={gate.disabled} />}
          </Field>
        )}
        <Field name="amount" label="Amount (FERN)" error={model.errors.amount} extraDescription={gate.describedBy}>
          {(props) => <input {...props} type="text" inputMode="decimal" value={amount} disabled={gate.disabled} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <p className="muted">Fee {formatFernUnit(fee)}</p>
        <FormAlert model={model} />
        <SubmitButton model={model} gate={gate}>{title}</SubmitButton>
      </form>
    </FormPanel>
  );
}

export function StakePage() {
  const { id } = useWorkspace();
  const me = useJson<StakingMe>(`/api/w/${id}/staking/me`);
  const validators = useJson<Validator[]>(`/api/w/${id}/validators`);
  const fee = useJson<{ gas: number; feeUfern: number }>(`/api/w/${id}/staking/fee`);
  const gate = useRoleGate("write");
  const sink = useStatusSink();
  const delegate = useFormModel(sink);
  const undelegate = useFormModel(sink);
  const redelegate = useFormModel(sink);
  const claim = useFormModel(sink);
  const done = me.reload;

  if (!me.data || !validators.data || !fee.data) return <Page title="Stake"><Loading label="Stake loading" page /></Page>;

  return (
    <Page title="Stake">
      <div className="readouts">
        <p className="readout">Balance {formatFernUnit(me.data.balanceUfern)}</p>
        <p className="readout">Available {formatFernUnit(me.data.availableUfern)}</p>
      </div>
      <section className="panel" tabIndex={0}>
        <h2 className="section-title">Validators</h2>
        <table aria-label="Validators">
            <thead><tr><th scope="col">Name</th><th scope="col" className="num">Stake</th><th scope="col" className="num">Commission</th><th scope="col" className="num">Share of bonded</th></tr></thead>
            <tbody>
              {validators.data.map((validator) => (
                <tr key={validator.id}>
                  <td>{validator.name}</td>
                  <td className="num">{formatFernUnit(validator.stakeUfern)}</td>
                  <td className="num">{commissionText(validator.commission)}</td>
                  <td className="num">{validator.shareOfBonded}%</td>
                </tr>
              ))}
            </tbody>
        </table>
      </section>
      {gate.note}
      <StakingForm title="Delegate" action="delegate" validators={validators.data} fee={fee.data.feeUfern} gate={gate} model={delegate} onDone={done} />
      <StakingForm title="Undelegate" action="undelegate" validators={validators.data} fee={fee.data.feeUfern} gate={gate} model={undelegate} onDone={done} />
      <StakingForm title="Redelegate" action="redelegate" validators={validators.data} fee={fee.data.feeUfern} gate={gate} model={redelegate} onDone={done} />
      <section className="panel form-panel">
        <h2 className="form-title">Claim rewards</h2>
        <p role="alert" className="form-alert">{claim.alert}</p>
        <button type="button" className="pill pill--solid" disabled={gate.disabled || claim.pending} aria-busy={claim.pending || undefined}
          aria-describedby={gate.describedBy} onClick={() => void claim.run(null, async () => {
            await api("POST", `/api/w/${id}/staking/claim`, {});
            done();
            return TRANSACTION_SENT;
          })}>Claim rewards</button>
      </section>
      <p role="status" aria-label="Stake status" className="form-status">{sink.status}</p>
      <section className="panel" tabIndex={0}>
        <h2 className="section-title">Your delegations</h2>
        <table aria-label="Your delegations">
          <thead><tr><th scope="col">Validator</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Pending rewards</th></tr></thead>
          <tbody>
            {me.data.delegations.map((delegation) => (
              <tr key={delegation.validator}>
                <td>{delegation.validatorName}</td>
                <td className="num">{formatFernUnit(delegation.amountUfern)}</td>
                <td className="num">{formatFernUnit(delegation.pendingRewardsUfern)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {me.data.delegations.length === 0 && (
          <Empty sentence="No delegations yet.">
            <ButtonPill variant="outline" onClick={() => document.querySelector<HTMLElement>('form[aria-label="Delegate"] select')?.focus()}>Choose a validator</ButtonPill>
          </Empty>
        )}
      </section>
      <section className="panel" tabIndex={0}>
        <h2 className="section-title">Unbondings</h2>
        <table aria-label="Unbondings">
          <thead><tr><th scope="col">Validator</th><th scope="col" className="num">Amount</th><th scope="col">Completes</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {me.data.unbondings.map((unbonding, index) => (
              <tr key={index}>
                <td>{unbonding.validatorName}</td>
                <td className="num">{formatFernUnit(unbonding.amountUfern)}</td>
                <td>{formatDateTime(unbonding.completesAt, display.timeZone)}</td>
                <td>{unbonding.status === "released" ? "Released" : `Unbonding until ${formatTime(unbonding.completesAt, display.timeZone)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {me.data.unbondings.length === 0 && <Empty sentence="No unbondings in progress." />}
      </section>
    </Page>
  );
}
