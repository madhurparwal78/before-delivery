// The case page: the Handshake track over the action bar, the evidence column, and every case action. States,
// countdowns and enabled buttons come only from the server's latest answer (polled every second).
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { pendingDraft, takeDraft, useDraftSource } from "../drafts";
import { usePoll, useResource } from "../hooks";
import { Heading, Link } from "../router";
import { say } from "../store";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button, Field, Problems, Refusal, submit, useForm } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig } from "../ui/Table";
import type { ArchivedCase, CaseBody, Station } from "../types";
import { formatCountdown, formatCrypto, formatDate, formatMoney } from "../../shared/format";
import { CASE_STATUS_TEXT } from "./common-text";
import { useDesk, type Desk } from "./desk";
import { HandshakeTrack } from "./Track";

type Loaded = { case: CaseBody | ArchivedCase };
const ACTIONS = ["release", "return", "reason", "ownership", "request-page", "end-request-page", "archive", "restore", "late"];

function isArchived(c: CaseBody | ArchivedCase): c is ArchivedCase {
  return c.archived === true && !("track" in c);
}

function ruleText(k: CaseBody): string {
  const d = k.decidedUnder;
  return d.thresholdCents === null || d.ruleInForceSince === null
    ? `${d.jurisdictionCode}: no rule in force`
    : `${d.jurisdictionCode} rule in force since ${formatDate(d.ruleInForceSince)}`;
}

function retentionText(k: CaseBody, desk: Desk): string {
  const e = k.erasure;
  if (e.status === "erased" && e.erasedAt) return `Personal data erased on ${desk.when(e.erasedAt)}.`;
  if (e.status === "pending") return "Erasing personal data. Waiting for storage to confirm.";
  if (e.status === "scheduled" && e.dueAt) return `Personal data is kept until ${desk.when(e.dueAt)}.`;
  return "The retention time starts when the case closes.";
}

function requestPageText(k: CaseBody, desk: Desk): string {
  const page = k.requestPage;
  if (!page) return k.dataSent?.channel === "network" ? "Sent as a signed network message." : "No data request page.";
  if (page.status === "live") return `Request page live until ${desk.when(page.endsAt)}.`;
  if (page.status === "answered") return `Request page answered on ${desk.when(k.answer?.at ?? page.sentAt)}.`;
  return `Request page ended at ${desk.when(page.endsAt)}.`;
}

function Evidence({ k, desk }: { k: CaseBody; desk: Desk }) {
  const d = k.decidedUnder;
  return (
    <section aria-label="Evidence" class="panel evidence-panel">
      <h2>Evidence</h2>
      <dl class="facts">
        <dt>Counterparty</dt>
        <dd>{k.counterparty ? <Link href={`${desk.base}/counterparties/${k.counterparty.id}`}>{k.counterparty.name}</Link> : "Self-hosted wallet"}</dd>
        <dt>Name as sent</dt>
        <dd>{k.dataSent?.counterpartyNameAsSent ?? d.counterpartyName ?? "Self-hosted wallet"}</dd>
        <dt>Rule</dt>
        <dd>{ruleText(k)}</dd>
        <dt>Threshold</dt>
        <dd><Fig>{d.thresholdCents === null ? "None" : formatMoney(d.thresholdCurrency, d.thresholdCents)}</Fig></dd>
        <dt>Rate</dt>
        <dd><Fig>{formatMoney(k.currency, d.rateCents)}</Fig> per {k.asset}</dd>
        <dt>Fiat value</dt>
        <dd><Fig>{formatMoney(k.currency, k.fiatValueCents)}</Fig></dd>
        {d.counterpartyRule && (
          <>
            <dt>Counterparty rule</dt>
            <dd>{d.counterpartyRule === "in_force" ? "In force" : "No rule"}</dd>
          </>
        )}
        <dt>Originator</dt>
        <dd>
          {k.originator ? (
            <span class="stack">
              <span>{k.originator.name}</span>
              <Fig>{k.originator.identityNumber}</Fig>
              {k.originator.dateOfBirth && <span>Born <Fig>{k.originator.dateOfBirth}</Fig></span>}
            </span>
          ) : "Erased"}
        </dd>
        <dt>Beneficiary</dt>
        <dd>{k.beneficiaryName ?? "Erased"}</dd>
        <dt>Data request</dt>
        <dd>{requestPageText(k, desk)}</dd>
        <dt>Retention</dt>
        <dd>{retentionText(k, desk)}</dd>
      </dl>
    </section>
  );
}

function StationFacts({ k, station, desk }: { k: CaseBody; station: Station; desk: Desk }) {
  const d = k.decidedUnder;
  const answer = k.answer
    ? `${k.answer.decision === "accepted" ? "Accepted" : "Rejected"}${k.answer.late ? " (late)" : ""}, ${desk.when(k.answer.at)}`
    : k.status === "no_response" ? "No response" : "No answer yet";
  return (
    <div class="station-sheet">
      <p class="station-sheet-state">
        <span class={`dot state-${station.state}`} aria-hidden="true" />
        <span>{station.text}</span>
      </p>
      <p class="fig muted">{station.at ? desk.when(station.at) : "Not reached yet"}</p>
      <dl class="facts">
        <dt>Name as sent</dt>
        <dd>{k.dataSent?.counterpartyNameAsSent ?? d.counterpartyName ?? "Self-hosted wallet"}</dd>
        <dt>Rule</dt>
        <dd>{ruleText(k)}{d.thresholdCents !== null && <>, threshold <Fig>{formatMoney(d.thresholdCurrency, d.thresholdCents)}</Fig></>}</dd>
        <dt>Rate</dt>
        <dd><Fig>{formatMoney(k.currency, d.rateCents)}</Fig> per {k.asset}</dd>
        <dt>Fiat value</dt>
        <dd><Fig>{formatMoney(k.currency, k.fiatValueCents)}</Fig></dd>
        <dt>Answer</dt>
        <dd>{answer}</dd>
        {station.station === "counterparty" && k.review?.decision && (
          <>
            <dt>Review</dt>
            <dd>{k.review.decision.decision === "accept" ? "Accepted" : "Rejected"} by {k.review.decision.decidedBy}: {k.review.decision.reason}</dd>
          </>
        )}
        {station.station === "data_sent" && k.dataSent && (
          <>
            <dt>Sent</dt>
            <dd>{k.dataSent.channel === "network" ? "Signed network message" : "Data request page by mail"}</dd>
          </>
        )}
        {station.station === "answered" && k.ownership.required && (
          <>
            <dt>Ownership</dt>
            <dd>{k.ownership.confirmedOn ? `Confirmed on ${formatDate(k.ownership.confirmedOn)} by ${k.ownership.recordedBy}` : "Waiting for the customer's confirmation"}</dd>
          </>
        )}
        {station.station === "closed" && k.releaseReason && (
          <>
            <dt>Release reason</dt>
            <dd>{k.releaseReason.text}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function ReasonDialog({ open, label, action, button, pending, success, path, onClose, onDone }: {
  open: boolean; label: string; action: string; button: string; pending: string; success: string; path: string;
  onClose: () => void; onDone: () => void;
}) {
  const form = useForm(() => ({ reason: takeDraft(action)?.reason ?? "" }));
  useDraftSource(action, () => form.values, open);
  return (
    <Dialog open={open} label={label} onClose={onClose}>
      <form class="form" noValidate onSubmit={(e) => {
        e.preventDefault();
        void submit(form, {
          action, pending, call: () => api<Loaded>("POST", path, { json: { reason: form.values.reason } }),
          done: () => {
            say(action, success, "success");
            onDone();
          },
        });
      }}>
        <Problems form={form} />
        <Refusal form={form} />
        <Field form={form} name="reason" label="Reason" multiline />
        <div class="form-actions">
          <Button type="submit" variant="primary" disabled={form.busy}>{button}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function OwnershipDialog({ open, path, today, onClose, onDone }: { open: boolean; path: string; today: string; onClose: () => void; onDone: () => void }) {
  const form = useForm(() => ({ confirmedOn: takeDraft("ownership")?.confirmedOn ?? today }));
  useDraftSource("ownership", () => form.values, open);
  return (
    <Dialog open={open} label="Record ownership" onClose={onClose}>
      <form class="form" noValidate onSubmit={(e) => {
        e.preventDefault();
        void submit(form, {
          action: "ownership", pending: "Saving…",
          call: () => api<Loaded>("POST", path, { json: { confirmedOn: form.values.confirmedOn } }),
          done: () => {
            say("ownership", "Ownership confirmed.", "success");
            onDone();
          },
        });
      }}>
        <p class="muted">The customer confirmed they own the self-hosted wallet on this business date.</p>
        <Problems form={form} />
        <Refusal form={form} />
        <Field form={form} name="confirmedOn" label="Confirmed on" mono placeholder="YYYY-MM-DD" hint="A business date, YYYY-MM-DD." />
        <div class="form-actions">
          <Button type="submit" variant="primary" disabled={form.busy}>Record</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

type Opened = "return" | "reason" | "ownership" | null;

function CaseActions({ k, desk, apiPath, reload, setOpened }: {
  k: CaseBody; desk: Desk; apiPath: string; reload: () => void; setOpened: (o: Opened) => void;
}) {
  const role = desk.role;
  const open = k.outcome === null;
  const ops = role === "operations_lead";
  const officer = role === "compliance_officer";
  const caseWorker = officer || role === "compliance_analyst";
  const run = async (action: string, pending: string, method: string, path: string, success: (c: CaseBody) => string) => {
    say(action, pending, "pending");
    const result = await api<{ case: CaseBody }>(method, path, method === "DELETE" ? {} : { json: {} });
    if (result.ok) say(action, success(result.data.case), "success");
    else say(action, result.error.message, "refusal");
    reload();
  };
  const buttons = [
    ops && <Button key="release" variant="primary" disabled={!k.releaseAllowed}
      onClick={() => run("release", "Releasing…", "POST", `${apiPath}/release`, () => "Released. The withdrawal can leave.")}>Release</Button>,
    ops && <Button key="return" disabled={!open} onClick={() => setOpened("return")}>Return withdrawal</Button>,
    caseWorker && k.ownership.required && (
      <Button key="ownership" disabled={k.status !== "awaiting_ownership"} onClick={() => setOpened("ownership")}>Record ownership</Button>),
    officer && k.answerDueAt !== null && (
      <Button key="reason" disabled={k.status !== "no_response" || k.releaseReason !== null} onClick={() => setOpened("reason")}>Record reason</Button>),
    caseWorker && k.dataSent?.channel === "request_page" && (
      <Button key="send" disabled={!open || k.answer !== null}
        onClick={() => run("request-page", "Sending…", "POST", `${apiPath}/request-page`, (c) => `New request page sent to ${c.requestPage?.contactEmail ?? ""}.`)}>
        Send new request page</Button>),
    caseWorker && k.dataSent?.channel === "request_page" && (
      <Button key="end" disabled={k.requestPage?.status !== "live"}
        onClick={() => run("end-request-page", "Ending…", "DELETE", `${apiPath}/request-page`, () => "Request page ended.")}>End request page</Button>),
    officer && <Button key="archive" disabled={open} onClick={() => run("archive", "Saving…", "POST", `${apiPath}/archive`, () => "Case archived.")}>Archive case</Button>,
  ].filter(Boolean);
  return (
    <section aria-label="Case actions" class={`case-actions${buttons.length ? " has-buttons" : ""}`} data-sticky-bar={buttons.length ? "" : undefined}>
      <div class="case-actions-buttons">
        {buttons.length ? buttons : <p class="muted">Your role follows this case; its actions belong to other roles.</p>}
      </div>
      <ActionNote action={ACTIONS} />
    </section>
  );
}

function CaseDialogs({ desk, apiPath, reload, opened, setOpened }: {
  desk: Desk; apiPath: string; reload: () => void; opened: Opened; setOpened: (o: Opened) => void;
}) {
  const done = () => {
    setOpened(null);
    reload();
  };
  return (
    <>
      <ReasonDialog open={opened === "return"} label="Return withdrawal" action="return" button="Return withdrawal" pending="Returning…"
        success="Returned to the customer's balance." path={`${apiPath}/return`} onClose={() => setOpened(null)} onDone={done} />
      <ReasonDialog open={opened === "reason"} label="Record release reason" action="reason" button="Save reason" pending="Saving reason…"
        success="Reason recorded. The operations lead can now release this withdrawal." path={`${apiPath}/release-reason`}
        onClose={() => setOpened(null)} onDone={done} />
      <OwnershipDialog open={opened === "ownership"} path={`${apiPath}/ownership`} today={desk.workspace.today}
        onClose={() => setOpened(null)} onDone={done} />
    </>
  );
}

function ArchivedView({ k, desk, apiPath, reload }: { k: ArchivedCase; desk: Desk; apiPath: string; reload: () => void }) {
  const restore = async () => {
    say("restore", "Saving…", "pending");
    const result = await api("POST", `${apiPath}/restore`, { json: {} });
    say("restore", result.ok ? "Case brought back." : result.error.message, result.ok ? "success" : "refusal");
    reload();
  };
  return (
    <div class="screen screen-split">
      <div class="work">
        <div class="screen-head">
          <Heading>{`Case ${k.reference}`}</Heading>
          <span class="badge">Archived</span>
        </div>
        <div role="toolbar" aria-label="Handshake track" class="track track-empty">
          <p class="muted">The Handshake track returns, exactly as it was, when the case is brought back.</p>
        </div>
        <section aria-label="Case actions" class="case-actions has-buttons">
          <div class="case-actions-buttons">
            {desk.role === "compliance_officer" && <Button variant="primary" onClick={restore}>Bring back</Button>}
          </div>
          <ActionNote action={ACTIONS} />
        </section>
      </div>
      <div class="evidence">
        <section aria-label="Evidence" class="panel evidence-panel">
          <h2>Evidence</h2>
          <dl class="facts">
            <dt>Closed</dt>
            <dd class="fig">{desk.when(k.closedAt)}</dd>
            <dt>Retention</dt>
            <dd>{`Archived on ${desk.when(k.archivedAt)}.`}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

export function CaseScreen({ id }: { id: string }) {
  const desk = useDesk();
  const apiPath = `/api/w/${desk.workspace.slug}/cases/${id}`;
  const [loaded, reload] = useResource<Loaded>(apiPath);
  const [sheet, setSheet] = useState<number | null>(null);
  const shownSheet = useRef(0);
  const [opened, setOpened] = useState<Opened>(null);
  const previous = useRef<Station[] | null>(null);
  const shownTrack = useRef<Station[] | null>(null);
  const announcedLate = useRef(false);
  usePoll(reload, 1000);

  useEffect(() => {
    const dialog = pendingDraft();
    if (dialog === "return" || dialog === "reason" || dialog === "ownership") setOpened(dialog);
  }, []);

  const k = loaded.state === "ready" ? loaded.data.case : null;
  const full = k && !isArchived(k) ? k : null;
  if (full && shownTrack.current !== full.track) {
    previous.current = shownTrack.current;
    shownTrack.current = full.track;
  }
  useEffect(() => {
    if (full?.status === "no_response" && !announcedLate.current && full.answerDueAt) {
      announcedLate.current = true;
      say("late", `No response. The answer period ended at ${desk.when(full.answerDueAt)}.`, "refusal");
    }
  }, [full?.status]);

  if (loaded.state === "loading") return <div class="skeleton" aria-busy="true"><span /><span /><span /></div>;
  if (loaded.state === "failed") {
    return (
      <section class="work">
        <Heading>Page not found</Heading>
        <p>We couldn't find that page.</p>
      </section>
    );
  }
  if (!full) return <ArchivedView k={k as ArchivedCase} desk={desk} apiPath={apiPath} reload={() => void reload()} />;

  if (sheet !== null) shownSheet.current = sheet;
  const station = full.track[shownSheet.current];
  return (
    <div class="case-screen">
      <div class="case-head">
        <div class="screen-head">
          <Heading>{`Case ${full.reference}`}</Heading>
          <span class={`badge status-${full.status}`}>
            {full.status === "awaiting_answer" && <span class="waiting-marker" aria-hidden="true" />}
            {CASE_STATUS_TEXT[full.status]}
          </span>
        </div>
        <dl class="case-figures">
          <div><dt>Amount</dt><dd class="fig">{formatCrypto(full.asset, full.amount)}</dd></div>
          <div><dt>Fiat value</dt><dd class="fig">{formatMoney(full.currency, full.fiatValueCents)}</dd></div>
          <div><dt>Created</dt><dd class="fig">{desk.when(full.createdAt)}</dd></div>
          <div><dt>Destination</dt><dd class="fig wrap-anywhere">{full.destinationAddress}</dd></div>
        </dl>
      </div>
      <div class="case-track">
        <HandshakeTrack track={full.track} previous={previous.current} when={desk.when} onOpen={setSheet} />
        {full.status === "awaiting_answer" && full.answerRemainingSeconds !== null && (
          <p role="timer" aria-label="Answer countdown" class="countdown">
            <Icon name="ring" size={18} />
            <span>Answer due in <span class="fig">{formatCountdown(full.answerRemainingSeconds)}</span></span>
          </p>
        )}
        {full.status === "no_response" && full.answerDueAt && (
          <p class="note note-refusal late-note">
            <Icon name="alert" size={18} />
            <span>{`No response. The answer period ended at ${desk.when(full.answerDueAt)}.`}</span>
          </p>
        )}
      </div>
      <CaseActions k={full} desk={desk} apiPath={apiPath} reload={() => void reload()} setOpened={setOpened} />
      <section class="panel case-rest" aria-label="Parties">
        <h2>Parties</h2>
        <dl class="facts">
          <dt>Created by</dt>
          <dd>{full.createdBy.kind === "member" ? full.createdBy.name : `Partner key ${full.createdBy.label}`}</dd>
          <dt>Sending address</dt>
          <dd class="fig wrap-anywhere">{full.sendingAddress}</dd>
          <dt>Wallet</dt>
          <dd>{full.wallet === "self_hosted" ? "Self-hosted" : "Hosted by the counterparty"}</dd>
          {full.answerDueAt && (
            <>
              <dt>Answer due</dt>
              <dd class="fig">{desk.when(full.answerDueAt)}</dd>
            </>
          )}
        </dl>
      </section>
      <div class="evidence case-evidence">
        <Evidence k={full} desk={desk} />
      </div>
      <CaseDialogs desk={desk} apiPath={apiPath} reload={() => void reload()} opened={opened} setOpened={setOpened} />
      <Dialog open={sheet !== null} label={station.label} kind="side" closeFirst onClose={() => setSheet(null)}>
        <StationFacts k={full} station={station} desk={desk} />
      </Dialog>
    </div>
  );
}
