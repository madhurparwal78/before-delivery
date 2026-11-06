// Rules: the workspace's rule book, the Announce change dialog, and one jurisdiction's rule history.
import { useState } from "preact/hooks";
import { api } from "../api";
import { takeDraft, useDraftSource } from "../drafts";
import { useResource } from "../hooks";
import { Heading, Link, navigate } from "../router";
import { say } from "../store";
import type { RuleBookEntry, RuleChange } from "../types";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button, Field, Problems, Refusal, SelectField, submit, useForm } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig, Table } from "../ui/Table";
import { formatDate, formatMoney } from "../../shared/format";
import { useDesk } from "./desk";

type Values = Record<string, string>;

const ANNOUNCE = "announce-change";

/** Typed money (`1000.00`) as integer cents by string arithmetic; anything else goes to the server as typed. */
function thresholdCents(text: string): bigint | string {
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(text.trim());
  return match ? BigInt(`${match[1]}${(match[2] ?? "").padEnd(2, "0")}`) : text;
}

const nextChange = (j: RuleBookEntry): RuleChange | undefined => j.changes.find((c) => c.state === "scheduled");

function Skeleton() {
  return <div class="skeleton" aria-busy="true"><span /><span /><span /></div>;
}

function AnnounceChange({ open, onClose, jurisdictions, initial }: {
  open: boolean; onClose: () => void; jurisdictions: RuleBookEntry[]; initial: Values;
}) {
  const desk = useDesk();
  const form = useForm<Values>(initial);
  useDraftSource(ANNOUNCE, () => form.values, open);
  const currency = jurisdictions.find((j) => j.code === form.values.jurisdictionCode)?.currency;
  const announce = (event: Event) => {
    event.preventDefault();
    const v = form.values;
    void submit<{ change: RuleChange }>(form, {
      action: ANNOUNCE,
      pending: "Announcing…",
      call: () => api("POST", `/api${desk.base}/rules/changes`, {
        json: { jurisdictionCode: v.jurisdictionCode, thresholdCents: thresholdCents(v.thresholdCents), takesEffectOn: v.takesEffectOn },
      }),
      done: ({ change }) => {
        const name = jurisdictions.find((j) => j.code === v.jurisdictionCode)?.name ?? v.jurisdictionCode;
        say(ANNOUNCE, `Change announced for ${name} from ${formatDate(change.takesEffectOn)}.`, "success");
        navigate(`${desk.base}/rules/${v.jurisdictionCode}`, { keepFeedback: true });
      },
    });
  };
  return (
    <Dialog open={open} label="Announce change" onClose={onClose}>
      <form class="form" noValidate onSubmit={announce}>
        <Problems form={form} order={["jurisdictionCode", "thresholdCents", "takesEffectOn"]} />
        <Refusal form={form} />
        <SelectField form={form} name="jurisdictionCode" label="Jurisdiction"
          options={jurisdictions.map((j) => ({ value: j.code, label: j.name }))} />
        <Field form={form} name="thresholdCents" label="Threshold" mono inputMode="decimal" placeholder="1000.00"
          hint={currency ? `An amount in ${currency}, for example 1000.00.` : undefined} />
        <Field form={form} name="takesEffectOn" label="Takes effect on" mono placeholder="YYYY-MM-DD"
          hint={`From 00:00 ${desk.workspace.city}. Today is ${formatDate(desk.workspace.today)}.`} />
        <div class="form-actions">
          <Button type="submit" variant="primary" disabled={form.busy}>Announce</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RulesScreen() {
  const desk = useDesk();
  const [draft] = useState(() => takeDraft(ANNOUNCE));
  const [announcing, setAnnouncing] = useState(draft !== null);
  const [book] = useResource<{ jurisdictions: RuleBookEntry[] }>(`/api${desk.base}/rules`);
  const jurisdictions = book.state === "ready" ? book.data.jurisdictions : [];
  const own = jurisdictions.find((j) => j.code === desk.workspace.jurisdictionCode);
  const officer = desk.role === "compliance_officer";
  return (
    <div class="screen screen-split">
      <section class="work">
        <div class="screen-head">
          <Heading>Rules</Heading>
          {officer && (
            <Button variant="primary" onClick={() => setAnnouncing(true)}>
              <Icon name="plus" />
              <span>Announce change</span>
            </Button>
          )}
          <p class="lede">Each jurisdiction's Travel Rule threshold in this workspace's rule book. Changes take effect at 00:00 {desk.workspace.city}.</p>
        </div>
        <ActionNote action={ANNOUNCE} />
        {book.state === "loading" ? <Skeleton /> : (
          <Table label="Jurisdiction rules" columns={[{ label: "Jurisdiction" }, { label: "Rule in force", figures: true, width: "132px" },
            { label: "Since", width: "120px" }, { label: "Announced change", width: "164px" }]}
            rows={jurisdictions.map((j) => {
              const change = nextChange(j);
              return {
                key: j.code,
                cells: [
                  <Link href={`${desk.base}/rules/${j.code}`}>{j.name}</Link>,
                  j.ruleInForce ? <Fig>{formatMoney(j.currency, j.ruleInForce.thresholdCents)}</Fig> : <span class="muted">No rule</span>,
                  j.ruleInForce ? <Fig>{formatDate(j.ruleInForce.since)}</Fig> : "",
                  change ? <span class="fig lines"><span>{formatMoney(j.currency, change.thresholdCents)}</span> <span>from {formatDate(change.takesEffectOn)}</span></span>
                    : <span class="muted">None</span>,
                ],
              };
            })} />
        )}
      </section>
      <section class="evidence">
        {own && (
          <div class="panel">
            <h2>{own.name} in force for {desk.workspace.name}</h2>
            <dl class="facts">
              <dt>Threshold</dt>
              <dd>{own.ruleInForce ? <Fig>{formatMoney(own.currency, own.ruleInForce.thresholdCents)}</Fig> : "No rule"}</dd>
              <dt>Since</dt>
              <dd>{own.ruleInForce ? <Fig>{formatDate(own.ruleInForce.since)}</Fig> : "—"}</dd>
              <dt>Announced change</dt>
              <dd>{nextChange(own) ? <Fig>{formatMoney(own.currency, nextChange(own)!.thresholdCents)} from {formatDate(nextChange(own)!.takesEffectOn)}</Fig> : "None"}</dd>
            </dl>
            <p class="field-hint">Withdrawals worth at least the threshold carry the originator and beneficiary data.</p>
          </div>
        )}
      </section>
      {officer && book.state === "ready" && (
        <AnnounceChange open={announcing} onClose={() => setAnnouncing(false)} jurisdictions={jurisdictions}
          initial={draft ?? { jurisdictionCode: desk.workspace.jurisdictionCode, thresholdCents: "", takesEffectOn: desk.workspace.today }} />
      )}
    </div>
  );
}

export function JurisdictionRulesScreen({ code }: { code: string }) {
  const desk = useDesk();
  const [loaded] = useResource<{ jurisdiction: RuleBookEntry }>(`/api${desk.base}/rules/${encodeURIComponent(code)}`);
  if (loaded.state === "loading") return <Skeleton />;
  if (loaded.state === "failed") {
    return (
      <section class="work">
        <Heading>Jurisdiction not found</Heading>
        <p class="note note-refusal"><Icon name="alert" size={18} /><span>{loaded.error.message}</span></p>
      </section>
    );
  }
  const j = loaded.data.jurisdiction;
  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>{j.name} rules</Heading>
          <Link href={`${desk.base}/rules`} class="button button-quiet">All rules</Link>
        </div>
        <ActionNote action={ANNOUNCE} />
        <dl class="facts panel facts-inline">
          <dt>Rule in force</dt>
          <dd>{j.ruleInForce ? <Fig>{formatMoney(j.currency, j.ruleInForce.thresholdCents)} since {formatDate(j.ruleInForce.since)}</Fig> : "No rule"}</dd>
        </dl>
        <Table label="Rule history" columns={[{ label: "Takes effect on" }, { label: "Threshold", figures: true }, { label: "State" },
          { label: "Announced by" }, { label: "Announced at" }]}
          rows={[...j.changes].reverse().map((c) => ({
            key: c.id,
            cells: [
              <Fig>{formatDate(c.takesEffectOn)}</Fig>,
              <Fig>{formatMoney(j.currency, c.thresholdCents)}</Fig>,
              c.state === "scheduled" ? <span class="badge">Scheduled</span> : <span class="badge badge-ink">In force</span>,
              c.announcedBy ?? "Reference table",
              <Fig>{desk.when(c.announcedAt)}</Fig>,
            ],
          }))} />
      </section>
    </div>
  );
}
