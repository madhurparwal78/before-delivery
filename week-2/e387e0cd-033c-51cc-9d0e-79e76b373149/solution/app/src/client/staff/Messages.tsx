// Incoming messages: the list, and a message page with its working copy, the name check, Download original and
// the facts (a column from 1120 px, a bottom sheet below).
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { useResource, useWide } from "../hooks";
import { Heading, Link } from "../router";
import { say } from "../store";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig, Table } from "../ui/Table";
import type { MessageDetail, MessageSummary } from "../types";
import { OUTCOME_TEXT } from "./common-text";
import { downloadFile } from "./common-download";
import { useDesk, type Desk } from "./desk";

const TYPE_TEXT: Record<string, string> = { transfer: "Transfer", answer: "Answer" };
const NAME_CHECK: Record<string, string> = { match: "Name check: Match", partial: "Name check: Partial", no_match: "Name check: No match" };

export function MessagesScreen() {
  const desk = useDesk();
  const [messages] = useResource<{ messages: MessageSummary[] }>(`/api/w/${desk.workspace.slug}/messages`);
  const rows = messages.state === "ready" ? messages.data.messages.map((m) => ({
    key: m.id,
    cells: [
      <Fig>{desk.when(m.receivedAt)}</Fig>,
      m.counterparty.name,
      <Link href={`${desk.base}/messages/${m.id}`} class="fig wrap-anywhere">{m.messageId}</Link>,
      TYPE_TEXT[m.type],
      <span class={m.outcome === "no_match" || m.outcome === "late" || m.outcome === "rejected" ? "text-refusal" : undefined}>
        {OUTCOME_TEXT[m.outcome]}
      </span>,
    ],
  })) : [];
  return (
    <div class="screen">
      <div class="work">
        <div class="screen-head">
          <Heading>Incoming messages</Heading>
          <p class="lede">Signed Travel Rule messages from counterparty exchanges, kept exactly as received.</p>
        </div>
        {messages.state === "loading" ? (
          <div class="skeleton" aria-busy="true"><span /><span /><span /></div>
        ) : (
          <Table label="Incoming messages" rows={rows} columns={[
            { label: "Received" }, { label: "Sender" }, { label: "Message id" }, { label: "Type" }, { label: "Outcome" },
          ]} />
        )}
      </div>
    </div>
  );
}

function Facts({ m, desk }: { m: MessageDetail; desk: Desk }) {
  return (
    <dl class="facts">
      <dt>Received</dt>
      <dd class="fig">{desk.when(m.receivedAt)}</dd>
      <dt>Sender</dt>
      <dd>{m.counterparty.name}</dd>
      <dt>Message id</dt>
      <dd class="fig wrap-anywhere">{m.messageId}</dd>
      <dt>Type</dt>
      <dd>{TYPE_TEXT[m.type]}</dd>
      <dt>Outcome</dt>
      <dd>{OUTCOME_TEXT[m.outcome]}</dd>
      <dt>Size</dt>
      <dd class="fig">{m.sizeBytes} bytes</dd>
      <dt>SHA-256</dt>
      <dd class="fig wrap-anywhere">{m.sha256}</dd>
    </dl>
  );
}

/** The parsed working copy as label and value pairs; nested parties flatten to `Originator name`. */
function workingRows(working: Record<string, unknown>, prefix = ""): [string, string][] {
  return Object.entries(working).flatMap(([key, value]): [string, string][] => {
    const label = `${prefix}${prefix ? " " : ""}${key.replace(/([A-Z])/g, " $1").toLowerCase()}`;
    if (value && typeof value === "object") return workingRows(value as Record<string, unknown>, label);
    return [[label.charAt(0).toUpperCase() + label.slice(1), value === null ? "Erased" : String(value)]];
  });
}

export function MessageScreen({ id }: { id: string }) {
  const desk = useDesk();
  const path = `/api/w/${desk.workspace.slug}/messages/${id}`;
  const [loaded] = useResource<{ message: MessageDetail }>(path);
  const [facts, setFacts] = useState(false);
  const wide = useWide();
  const canDownload = desk.role === "compliance_officer" || desk.role === "compliance_analyst";

  if (loaded.state === "loading") return <div class="skeleton" aria-busy="true"><span /><span /><span /></div>;
  if (loaded.state === "failed") {
    return (
      <section class="work">
        <Heading>Page not found</Heading>
        <p>We couldn't find that page.</p>
      </section>
    );
  }
  const m = loaded.data.message;
  const download = async () => {
    say("original", "Preparing file…", "pending");
    const result = await downloadFile(`${path}/original`);
    say("original", result.ok ? `File downloaded: ${result.name}.` : result.message, result.ok ? "success" : "refusal");
  };
  return (
    <div class="screen screen-split">
      <div class="work">
        <div class="screen-head">
          <Heading class="wrap-anywhere">{`Message ${m.messageId}`}</Heading>
          {!wide && (
            <Button onClick={() => setFacts(true)}>
              <Icon name="info" />
              <span>Show facts</span>
            </Button>
          )}
        </div>
        {m.nameCheck && (
          <div class={`name-check name-check-${m.nameCheck.result}`}>
            <Icon name={m.nameCheck.result === "match" ? "check" : "alert"} />
            <div>
              <p class="name-check-result">{NAME_CHECK[m.nameCheck.result]}</p>
              <p class="muted">Beneficiary compared with the customer {m.nameCheck.customerName} who holds the deposit address.</p>
            </div>
          </div>
        )}
        <section class="panel" aria-label="Working copy">
          <h2>Working copy</h2>
          <p class="muted">The desk works from this parsed copy; the original bytes are kept unchanged.</p>
          <dl class="facts working-copy">
            {workingRows(m.working).map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd class={/amount|address|reference|id$/i.test(label) ? "fig wrap-anywhere" : "wrap-anywhere"}>{value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
        {canDownload && (
          <div class="form-actions">
            <Button onClick={download}>
              <Icon name="download" />
              <span>Download original</span>
            </Button>
            <ActionNote action="original" />
          </div>
        )}
      </div>
      {wide && (
        <div class="evidence">
          <section aria-label="Message facts" class="panel">
            <h2>Message facts</h2>
            <Facts m={m} desk={desk} />
          </section>
        </div>
      )}
      <Dialog open={facts && !wide} label="Message facts" kind="sheet" closeFirst onClose={() => setFacts(false)}>
        <Facts m={m} desk={desk} />
      </Dialog>
    </div>
  );
}
