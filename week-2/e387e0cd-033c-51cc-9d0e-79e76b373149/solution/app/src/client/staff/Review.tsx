// The review queue: claim (one winner, decided by the server), decide Accept or Reject with a reason, and the
// lost, lapsed and stale copies, which stay on the page through every later poll.
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { pendingDraft, takeDraft, useDraftSource } from "../drafts";
import { usePoll, useResource } from "../hooks";
import { Heading, Link } from "../router";
import { say } from "../store";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button, ChoiceGroup, Field, Problems, Refusal, submit, useForm } from "../ui/forms";
import { Fig, Table } from "../ui/Table";
import type { CaseBody } from "../types";
import { formatCountdown, formatMoney } from "../../shared/format";
import { useDesk } from "./desk";

interface Claim {
  memberId: string;
  memberName: string;
  claimedAt: string;
  endsAt: string;
  remainingSeconds: number;
}

interface QueueCase {
  id: string;
  reference: string;
  counterparty: { id: string; name: string };
  fiatValueCents: bigint;
  currency: string;
  createdAt: string;
  claim: Claim | null;
}

const ACTIONS = ["claim", "decide", "lapsed"];

function DecideDialog({ target, onClose, onDone }: { target: QueueCase | null; onClose: () => void; onDone: () => void }) {
  const desk = useDesk();
  const shown = useRef<QueueCase | null>(null);
  if (target) shown.current = target;
  const form = useForm(() => ({ decision: "reject", reason: "", ...takeDraft("decide") }));
  useDraftSource("decide", () => form.values, target !== null);
  const k = shown.current;
  return (
    <Dialog open={target !== null} label="Decide case" onClose={onClose}>
      {k && (
        <form class="form" noValidate onSubmit={(e) => {
          e.preventDefault();
          void submit(form, {
            action: "decide",
            pending: "Saving decision…",
            call: () => api<{ case: CaseBody }>("POST", `/api/w/${desk.workspace.slug}/review/${k.id}/decision`, {
              json: { decision: form.values.decision, reason: form.values.reason },
            }),
            done: (data) => {
              say("decide", `Decision saved: ${data.case.review?.decision?.decision === "accept" ? "Accepted" : "Rejected"}.`, "success");
              form.set("reason", "");
              onDone();
            },
          });
        }}>
          <p class="muted">
            <Fig>{k.reference}</Fig> to {k.counterparty.name}, <Fig>{formatMoney(k.currency, k.fiatValueCents)}</Fig>
          </p>
          <Problems form={form} order={["decision", "reason"]} />
          <Refusal form={form} />
          <ChoiceGroup name="decision" label="Decision" value={form.values.decision} idBase={form.fieldId("decision")}
            error={form.errors.decision} onChange={(v) => form.set("decision", v)}
            options={[{ value: "accept", label: "Accept" }, { value: "reject", label: "Reject" }]} />
          <Field form={form} name="reason" label="Reason" multiline />
          <div class="form-actions">
            <Button type="submit" variant="primary" disabled={form.busy}>Save decision</Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function ReviewScreen() {
  const desk = useDesk();
  const path = `/api/w/${desk.workspace.slug}/review`;
  const [queue, reload] = useResource<{ cases: QueueCase[]; now: string }>(path);
  const [claiming, setClaiming] = useState<QueueCase | null>(null);
  const [deciding, setDeciding] = useState<QueueCase | null>(null);
  const shownClaim = useRef<QueueCase | null>(null);
  const held = useRef(new Map<string, string>());
  const keptDecision = useRef(pendingDraft() === "decide");
  const analyst = desk.role === "compliance_analyst";
  const me = desk.session.member.id;
  usePoll(reload, 1000);

  const cases = queue.state === "ready" ? queue.data.cases : [];
  useEffect(() => {
    if (queue.state !== "ready") return;
    const mine = new Map(cases.filter((k) => k.claim?.memberId === me).map((k) => [k.id, k.claim!.endsAt]));
    for (const [id, endsAt] of held.current) {
      const still = cases.find((k) => k.id === id);
      if (still && !mine.has(id)) say("lapsed", `Your claim lapsed at ${desk.when(endsAt)}.`, "refusal");
    }
    held.current = mine;
  }, [queue]);

  useEffect(() => {
    if (keptDecision.current && queue.state === "ready") {
      keptDecision.current = false;
      const k = cases.find((c) => c.claim?.memberId === me);
      if (k) setDeciding(k);
    }
  }, [queue.state]);

  const claim = async (k: QueueCase) => {
    say("claim", "Claiming…", "pending");
    const result = await api<{ claim: Claim }>("POST", `${path}/${k.id}/claim`, { json: {} });
    setClaiming(null);
    if (result.ok) say("claim", `Claimed. Your claim lasts until ${desk.when(result.data.claim.endsAt)}.`, "success");
    else say("claim", result.error.message, "refusal");
    await reload();
  };

  if (claiming) shownClaim.current = claiming;
  const mine = cases.find((k) => k.claim?.memberId === me) ?? null;

  const rows = cases.map((k) => {
    const holder = k.claim?.memberId === me;
    return {
      key: k.id,
      cells: [
        <Link href={`${desk.base}/cases/${k.id}`} class="fig">{k.reference}</Link>,
        k.counterparty.name,
        <Fig>{formatMoney(k.currency, k.fiatValueCents)}</Fig>,
        <Fig>{desk.when(k.createdAt)}</Fig>,
        <span class="claim-cell">
          {k.claim && !holder && <span class="muted">Claimed by {k.claim.memberName}</span>}
          {holder && k.claim && (
            <span role="timer" aria-label="Claim countdown" class="claim-timer">Claim ends in <Fig>{formatCountdown(k.claim.remainingSeconds)}</Fig></span>
          )}
          {analyst && (holder
            ? <Button variant="primary" onClick={() => setDeciding(k)}>Decide</Button>
            : <Button onClick={() => setClaiming(k)}>Claim</Button>)}
          {!analyst && !k.claim && <span class="muted">Unclaimed</span>}
        </span>,
      ],
    };
  });

  const claimTarget = shownClaim.current;
  return (
    <div class="screen screen-split">
      <div class="work">
        <div class="screen-head">
          <Heading>Review queue</Heading>
          <p class="lede">Cases to Restricted counterparties wait here for an analyst's decision.</p>
        </div>
        <ActionNote action={ACTIONS} />
        {queue.state === "loading" ? (
          <div class="skeleton" aria-busy="true"><span /><span /><span /></div>
        ) : (
          <Table label="Cases in review" rows={rows} columns={[
            { label: "Reference" }, { label: "Counterparty" }, { label: "Fiat value", figures: true }, { label: "Created" }, { label: "Claim" },
          ]} />
        )}
      </div>
      <div class="evidence">
        <section class="panel claim-panel" aria-label="Your claim">
          <h2>Your claim</h2>
          {mine?.claim ? (
            <dl class="facts">
              <dt>Case</dt>
              <dd class="fig">{mine.reference}</dd>
              <dt>Counterparty</dt>
              <dd>{mine.counterparty.name}</dd>
              <dt>Claimed</dt>
              <dd class="fig">{desk.when(mine.claim.claimedAt)}</dd>
              <dt>Ends</dt>
              <dd class="fig">{desk.when(mine.claim.endsAt)}</dd>
            </dl>
          ) : (
            <p class="muted">{analyst ? "Claim a case to decide it. A claim lasts a fixed time and then lapses." : "Analysts claim and decide these cases; your view is read only."}</p>
          )}
        </section>
      </div>
      <Dialog open={claiming !== null} label="Claim case" onClose={() => setClaiming(null)}>
        {claimTarget && (
          <div class="form">
            <p>
              Claim <Fig>{claimTarget.reference}</Fig> to {claimTarget.counterparty.name}? While you hold the claim, only you can decide it.
            </p>
            <div class="form-actions">
              <Button variant="primary" onClick={() => void claim(claimTarget)}>Claim</Button>
              <Button onClick={() => setClaiming(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Dialog>
      <DecideDialog target={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); void reload(); }} />
    </div>
  );
}
