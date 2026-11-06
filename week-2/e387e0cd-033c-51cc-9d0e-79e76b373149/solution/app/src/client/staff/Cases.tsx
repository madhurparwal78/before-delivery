// Withdrawals: the case table (polled) and the Create case dialog.
import { useState } from "preact/hooks";
import { api } from "../api";
import { pendingDraft, takeDraft, useDraftSource } from "../drafts";
import { usePoll, useResource } from "../hooks";
import { Heading, Link, navigate } from "../router";
import { say } from "../store";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button, Field, Problems, Refusal, SelectField, submit, useForm } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig, Table, When } from "../ui/Table";
import type { CaseBody, Customer } from "../types";
import { formatCrypto, formatMoney } from "../../shared/format";
import { CASE_STATUS_TEXT } from "./common-text";
import { useDesk } from "./desk";

const ASSETS = ["BTC", "ETH", "USDC", "SOL"];
const SHOW = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
];
const DRAFT = "create-case";

function CreateCaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const desk = useDesk();
  const [customers] = useResource<{ customers: Customer[] }>(`/api/w/${desk.workspace.slug}/customers`);
  const form = useForm(() => ({
    asset: "BTC", amount: "", destinationAddress: "", customerId: "", beneficiaryName: "", ...takeDraft(DRAFT),
  }));
  useDraftSource(DRAFT, () => form.values, open);
  return (
    <Dialog open={open} label="Create case" onClose={onClose}>
      <form class="form" noValidate onSubmit={(e) => {
        e.preventDefault();
        void submit(form, {
          action: DRAFT,
          pending: "Creating case…",
          call: () => api<{ case: CaseBody }>("POST", `/api/w/${desk.workspace.slug}/cases`, { json: form.values }),
          done: ({ case: k }) => {
            say(DRAFT, `Case ${k.reference} created.`, "success");
            navigate(`${desk.base}/cases/${k.id}`, { keepFeedback: true });
          },
        });
      }}>
        <Problems form={form} order={["asset", "amount", "destinationAddress", "customerId", "beneficiaryName"]} />
        <Refusal form={form} />
        <div class="form-row">
          <SelectField form={form} name="asset" label="Asset" options={ASSETS.map((a) => ({ value: a, label: a }))} />
          <Field form={form} name="amount" label="Amount" mono inputMode="decimal" />
        </div>
        <Field form={form} name="destinationAddress" label="Destination address" mono hint="lnl1 followed by 30 lower-case letters or digits." />
        <SelectField form={form} name="customerId" label="Customer" placeholder="Choose a customer"
          options={customers.state === "ready" ? customers.data.customers.map((c) => ({ value: c.id, label: c.name })) : []} />
        <Field form={form} name="beneficiaryName" label="Beneficiary name" />
        <div class="form-actions">
          <Button type="submit" variant="primary" disabled={form.busy}>Create case</Button>
          <Button onClick={onClose}>Cancel</Button>
          <ActionNote action={DRAFT} />
        </div>
      </form>
    </Dialog>
  );
}

export function CasesScreen() {
  const desk = useDesk();
  const [show, setShow] = useState("open");
  const [creating, setCreating] = useState(() => pendingDraft() === DRAFT);
  const [cases, reload] = useResource<{ cases: CaseBody[] }>(`/api/w/${desk.workspace.slug}/cases?show=${show}`);
  usePoll(reload, 5000);
  const canCreate = desk.role === "compliance_officer" || desk.role === "compliance_analyst";

  const rows = cases.state === "ready" ? cases.data.cases.map((k) => ({
    key: k.id,
    class: k.status === "awaiting_answer" ? "row-waiting" : undefined,
    cells: [
      <span class="reference-cell">
        <span class="marker-slot" aria-hidden="true">
          {k.status === "awaiting_answer" && <span class="waiting-marker" title="Waiting for the counterparty's answer" />}
        </span>
        <Link href={`${desk.base}/cases/${k.id}`} class="fig">{k.reference}</Link>
      </span>,
      <When text={desk.when(k.createdAt)} />,
      <Fig>{formatCrypto(k.asset, k.amount)}</Fig>,
      <Fig>{formatMoney(k.currency, k.fiatValueCents)}</Fig>,
      k.counterparty ? k.counterparty.name : "Self-hosted wallet",
      <span class="status-text">{CASE_STATUS_TEXT[k.status]}</span>,
      k.answerDueAt && k.status === "awaiting_answer" ? <When text={desk.when(k.answerDueAt)} /> : <span class="muted">—</span>,
    ],
  })) : [];

  return (
    <div class="screen">
      <div class="work">
        <div class="screen-head">
          <Heading>Withdrawals</Heading>
          {canCreate && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              <span>Create case</span>
            </Button>
          )}
          <p class="lede">Every customer withdrawal with its Travel Rule path, in {desk.workspace.city}.</p>
        </div>
        <div class="toolbar-row">
          <label class="inline-select">
            <span class="field-label">Show</span>
            <span class="select-wrap">
              <select class="input select" value={show} onChange={(e) => setShow(e.currentTarget.value)}>
                {SHOW.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Icon name="chevron" size={18} />
            </span>
          </label>
          <ActionNote action={DRAFT} />
        </div>
        {cases.state === "loading" ? (
          <div class="skeleton" aria-busy="true"><span /><span /><span /></div>
        ) : (
          <Table label="Withdrawal cases" rows={rows} columns={[
            { label: "Reference", width: "128px" }, { label: "Created", width: "168px" },
            { label: "Amount", figures: true, width: "112px" }, { label: "Fiat value", figures: true, width: "128px" },
            { label: "Counterparty" }, { label: "Status", width: "156px" }, { label: "Answer due", width: "168px" },
          ]} />
        )}
      </div>
      {canCreate && <CreateCaseDialog open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}
