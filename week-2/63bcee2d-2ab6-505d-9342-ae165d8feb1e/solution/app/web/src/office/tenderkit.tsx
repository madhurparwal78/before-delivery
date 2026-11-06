import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatAmount, formatTime, plainAmount, type Currency, type TimeZone } from "../../../shared/format";
import { get, patch, post, put, type Result } from "../api";
import { linkClick } from "../router";
import { useOffice } from "./context";
import { Dialog, focusRefusal, openDialog } from "./dialog";
import { amountInput, ErrorSummary, fieldId, TextField, useFormId, type Errors } from "./fields";
import { ActionButton, focusId, TableRegion, TitleBlock } from "./layout";
import { useResource } from "./resource";
import "./tenders.css";

// Tender screens shared by the project's Tenders panel and the tender page: studio setup, publishing,
// moving the close and opening bids, and the contractor's sealed bid form.

export type TenderStatus = "draft" | "open" | "closed" | "opened" | "awarded";

export interface StudioTender {
  id: string;
  title: string;
  scope: string;
  project: { id: string; reference: string; name: string };
  closesAt: string | null;
  closesAtLocal: string | null;
  timeZone: TimeZone;
  status: TenderStatus;
  contingencyPercent: string;
  icsSequence: number;
  bidders: { reference: string; companyName: string; contactName: string; contactEmail: string; hasBid: boolean; finalSubmittedAt: string | null }[];
  awardedBidId: string | null;
  /** The controls the server offers in this status. */
  actions: ("save_draft" | "publish" | "move_close" | "open_bids" | "level" | "award")[];
}

interface Bid {
  id: string;
  baseCents: number;
  provisionalSums: { label: string; amountCents: number }[];
  exclusions: { id: string; label: string }[];
  finalSubmittedAt: string;
  amendments: number;
}

export interface ContractorTender {
  id: string;
  title: string;
  scope: string;
  project: { id: string; reference: string; name: string };
  closesAt: string | null;
  closesAtLocal: string | null;
  timeZone: TimeZone;
  status: TenderStatus;
  myBid: Bid | null;
}

export const STATUS_LABEL: Record<TenderStatus, string> = { draft: "Draft", open: "Open", closed: "Closed", opened: "Opened", awarded: "Awarded" };
const zoneName = (zone: TimeZone): string => (zone === "Asia/Singapore" ? "Singapore time" : "Hong Kong time");
const closeText = (tender: { closesAt: string | null; timeZone: TimeZone }): string =>
  tender.closesAt ? formatTime(tender.closesAt, tender.timeZone) : "Not set";

/** A datetime-local value to the second: browsers drop zero seconds, so they are put back. */
const withSeconds = (value: string): string => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value);
const errorsOf = (result: Result<unknown> & { ok: false }): Errors => result.body.errors ?? {};

/** The tender's status heading, a focus target after publish, open bids and award. */
export function TenderStatusBlock({ status }: { status: TenderStatus }) {
  return (
    <div className="tender-status">
      <h2 id="tender-status" tabIndex={-1}>Tender status</h2>
      <p className={`tender-state tender-state-${status}`}>{STATUS_LABEL[status]}</p>
    </div>
  );
}

/** The panel's title block on the tender screens, with the project's newest transmittal. */
export function TenderTitle({ projectId }: { projectId: string }) {
  const transmittals = useResource<{ transmittals: { number: string }[] }>(`/api/projects/${projectId}/transmittals`);
  const numbers = (transmittals.data?.transmittals ?? []).map((t) => t.number).sort();
  return <TitleBlock code="PL-03" name="Tenders" revision={numbers.at(-1) ?? "T-000"} />;
}

/** Refreshes a tender at least every 60 seconds and at its close instant. */
export function useTenderClock(closesAt: string | null, reload: () => Promise<unknown>): void {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const every = setInterval(() => void latest.current(), 60_000);
    const wait = closesAt ? Date.parse(closesAt) - Date.now() : -1;
    const atClose = wait > 0 && wait < 2_147_000_000 ? setTimeout(() => void latest.current(), wait + 50) : undefined;
    return () => {
      clearInterval(every);
      if (atClose) clearTimeout(atClose);
    };
  }, [closesAt]);
}

interface BidderDraft {
  companyName: string;
  contactName: string;
  contactEmail: string;
}

interface SetupValues {
  title: string;
  scope: string;
  close: string;
  contingency: string;
  bidders: BidderDraft[];
}

const emptyBidder = (): BidderDraft => ({ companyName: "", contactName: "", contactEmail: "" });

function SetupForm({ projectId, timeZone, tender, onSaved }: {
  projectId: string; timeZone: TimeZone; tender: StudioTender | null; onSaved: (tender: StudioTender) => void;
}) {
  const office = useOffice();
  const form = useFormId("tender-setup");
  const ref = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [values, setValues] = useState<SetupValues>(() => {
    const restored = office.takeDraft("tender-setup") as SetupValues | null;
    if (restored) return restored;
    return tender
      ? { title: tender.title, scope: tender.scope, close: tender.closesAtLocal ?? "", contingency: tender.contingencyPercent,
        bidders: tender.bidders.length ? tender.bidders.map(({ companyName, contactName, contactEmail }) => ({ companyName, contactName, contactEmail })) : [emptyBidder()] }
      : { title: "", scope: "", close: "", contingency: "", bidders: [emptyBidder()] };
  });
  const set = (key: "title" | "scope" | "close" | "contingency") => (value: string) => setValues((v) => ({ ...v, [key]: value }));
  const setBidder = (index: number, key: keyof BidderDraft) => (value: string) =>
    setValues((v) => ({ ...v, bidders: v.bidders.map((b, i) => (i === index ? { ...b, [key]: value } : b)) }));

  const save = async (): Promise<void> => {
    office.announce("Saving…");
    const body = {
      title: values.title, scope: values.scope, closesAtLocal: values.close ? withSeconds(values.close) : null,
      contingencyPercent: values.contingency, bidders: values.bidders,
    };
    const result = tender
      ? await patch<{ tender: StudioTender }>(`/api/tenders/${tender.id}`, body)
      : await post<{ tender: StudioTender }>(`/api/projects/${projectId}/tenders`, body);
    if (result.ok) {
      flushSync(() => setErrors({}));
      office.announce("Tender draft saved.");
      onSaved(result.data.tender);
      focusId("publish-tender");
      return;
    }
    office.announce("");
    const body409 = office.refused(result, { id: "tender-setup", values: { ...values } });
    if (!body409) return;
    flushSync(() => setErrors(errorsOf(result)));
    if (!body409.errors) office.alert(body409.error === "illegal_transition" ? "That can't be done while this tender is no longer a draft." : "The draft wasn't saved.");
    focusRefusal(ref.current);
  };

  return (
    <form ref={ref} id={form} className="tender-setup" noValidate onSubmit={(event) => event.preventDefault()}>
      <ErrorSummary errors={errors} form={form} />
      <div className="setup-grid">
        <TextField form={form} name="title" label="Tender title" value={values.title} onChange={set("title")} error={errors.title} />
        <TextField form={form} name="contingencyPercent" label="Contingency percent" value={values.contingency} inputMode="decimal"
          onChange={set("contingency")} error={errors.contingencyPercent} hint="Up to 25.00, added to every levelled bid." />
      </div>
      <TextField form={form} name="scope" label="Scope" multiline value={values.scope} onChange={set("scope")} error={errors.scope} />
      <TextField form={form} name="closesAtLocal" label="Close date and time" type="datetime-local" step="1" value={values.close}
        onChange={set("close")} error={errors.closesAtLocal} hint={zoneName(timeZone)} />
      <div className="bidder-list">
        {values.bidders.map((bidder, index) => (
          <fieldset key={index} className="bidder">
            <legend>Bidder {index + 1}</legend>
            <TextField form={form} name={`bidders[${index}].companyName`} label="Company name" value={bidder.companyName}
              onChange={setBidder(index, "companyName")} error={errors[`bidders[${index}].companyName`]} />
            <TextField form={form} name={`bidders[${index}].contactName`} label="Contact name" value={bidder.contactName}
              onChange={setBidder(index, "contactName")} error={errors[`bidders[${index}].contactName`]} />
            <TextField form={form} name={`bidders[${index}].contactEmail`} label="Contact email" type="email" value={bidder.contactEmail}
              onChange={setBidder(index, "contactEmail")} error={errors[`bidders[${index}].contactEmail`]} />
            <button type="button" className="button button-quiet" onClick={() => setValues((v) => ({ ...v, bidders: v.bidders.filter((_, i) => i !== index) }))}>
              Remove bidder {index + 1}
            </button>
          </fieldset>
        ))}
      </div>
      {errors.bidders && <p className="field-error" tabIndex={-1}>{errors.bidders}</p>}
      <div className="actions">
        <button type="button" className="button" onClick={() => {
          flushSync(() => setValues((v) => ({ ...v, bidders: [...v.bidders, emptyBidder()] })));
          document.getElementById(fieldId(form, `bidders[${values.bidders.length}].companyName`))?.focus();
        }}>Add bidder</button>
        <ActionButton primary pending="Saving…" onAction={save}>Save draft</ActionButton>
      </div>
    </form>
  );
}

/** The studio's tender: setup while draft, then publishing, moving the close and opening bids. */
export function StudioTenderView({ projectId, timeZone, tender, onChanged }: {
  projectId: string; timeZone: TimeZone; tender: StudioTender | null; onChanged: (tender: StudioTender) => void;
}) {
  const office = useOffice();
  const moveForm = useFormId("move-close");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveValue, setMoveValue] = useState("");
  const [moveErrors, setMoveErrors] = useState<Errors>({});
  const canAct = office.member?.role === "director" || office.member?.role === "project_lead";

  const changed = (next: StudioTender): void => flushSync(() => onChanged(next));

  const publish = async (): Promise<void> => {
    if (!tender) return;
    office.announce("Publishing…");
    const result = await post<{ tender: StudioTender }>(`/api/tenders/${tender.id}/publish`, {});
    if (result.ok) {
      office.announce(`Tender published. Invitations sent to ${result.data.tender.bidders.length} bidders.`);
      flushSync(() => setPublishing(false));
      changed(result.data.tender);
      focusId("tender-status");
      return;
    }
    office.announce("");
    const body = office.refused(result);
    if (!body) return;
    const copy = body.errors ? Object.values(body.errors).join(" ") : "That can't be done while this tender is no longer a draft.";
    office.alert(copy);
    flushSync(() => setPublishError(copy));
    focusRefusal(openDialog());
  };

  const move = async (): Promise<void> => {
    if (!tender) return;
    office.announce("Saving…");
    const result = await patch<{ tender: StudioTender }>(`/api/tenders/${tender.id}`, { closesAtLocal: withSeconds(moveValue) });
    if (result.ok) {
      const next = result.data.tender;
      office.announce(`Close moved to ${closeText(next)}. Updated invitations sent to ${next.bidders.length} bidders.`);
      flushSync(() => setMoving(false));
      changed(next);
      focusId("move-close");
      return;
    }
    office.announce("");
    const body = office.refused(result, { id: "move-close", values: { closesAtLocal: moveValue } });
    if (!body) return;
    if (!body.errors) office.alert("That can't be done while this tender is closed.");
    flushSync(() => setMoveErrors(errorsOf(result)));
    focusRefusal(openDialog());
  };

  const openBids = async (): Promise<void> => {
    if (!tender) return;
    office.announce("Opening bids…");
    const result = await post<{ tender: StudioTender }>(`/api/tenders/${tender.id}/open-bids`, {});
    if (result.ok) {
      const next = result.data.tender;
      office.announce(`Bids opened. ${next.bidders.filter((b) => b.hasBid).length} bids are ready to level.`);
      changed(next);
      focusId("tender-status");
      return;
    }
    office.announce("");
    const body = office.refused(result);
    if (!body) return;
    office.alert(body.error === "tender_still_open"
      ? `Bids can be opened from ${closeText({ closesAt: String(body.closesAt), timeZone })}.`
      : "That can't be done while this tender is no longer closed.");
  };

  if (!tender || tender.actions.includes("save_draft")) {
    return (
      <div className="tender-view">
        <TenderStatusBlock status="draft" />
        <SetupForm key={tender?.id ?? "new"} projectId={projectId} timeZone={timeZone} tender={tender} onSaved={changed} />
        {tender?.actions.includes("publish") && canAct && (
          <div className="actions publish-row">
            <button id="publish-tender" type="button" className="button button-primary" onClick={() => {
              setPublishError("");
              setPublishing(true);
            }}>Publish tender</button>
          </div>
        )}
        {tender && (
          <Dialog title="Publish tender" open={publishing} onCancel={() => setPublishing(false)} error={publishError}
            actions={<ActionButton primary type="submit" pending="Publishing…" onAction={publish}>Publish and send invitations</ActionButton>}>
            <p>Each of the {tender.bidders.length} bidders receives their own invitation, a single-use sign-in link and a calendar
              file for the close at {closeText(tender)}. Bids stay sealed until you open them after close.</p>
          </Dialog>
        )}
      </div>
    );
  }

  return (
    <div className="tender-view">
      <TenderStatusBlock status={tender.status} />
      <dl className="tender-facts">
        <div><dt>Tender</dt><dd>{tender.title}</dd></div>
        <div><dt>Closes</dt><dd>{closeText(tender)}</dd></div>
        <div><dt>Contingency</dt><dd>{tender.contingencyPercent}%</dd></div>
        <div><dt>Calendar sequence</dt><dd>{tender.icsSequence}</dd></div>
      </dl>
      <p className="tender-scope">{tender.scope}</p>
      <TableRegion label="Bidders, scrollable">
        <table aria-label="Bidders">
          <thead><tr><th scope="col">Bidder</th><th scope="col">Contact</th><th scope="col">Bid</th></tr></thead>
          <tbody>
            {tender.bidders.map((bidder) => (
              <tr key={bidder.reference}>
                <td>{bidder.reference} {bidder.companyName}</td>
                <td>{bidder.contactName}<br /><span className="muted">{bidder.contactEmail}</span></td>
                <td>{bidder.finalSubmittedAt ? `Sealed bid received ${formatTime(bidder.finalSubmittedAt, tender.timeZone)}` : "No bid yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
      {canAct && (
        <div className="actions tender-actions">
          {tender.actions.includes("move_close") && (
            <button id="move-close" type="button" className="button" onClick={() => {
              setMoveValue(tender.closesAtLocal ?? "");
              setMoveErrors({});
              setMoving(true);
            }}>Move close</button>
          )}
          {tender.actions.includes("open_bids") && (
            <ActionButton primary pending="Opening bids…" onAction={openBids}>Open bids</ActionButton>
          )}
          {(tender.status === "opened" || tender.status === "awarded") && (
            <a className="button button-primary" href={`/office/tenders/${tender.id}/levelling`}
              onClick={(event) => linkClick(event, `/office/tenders/${tender.id}/levelling`)}>Open levelling</a>
          )}
        </div>
      )}
      <Dialog title="Move close" open={moving} onCancel={() => setMoving(false)}
        actions={<ActionButton primary type="submit" pending="Saving…" onAction={move}>Save new close</ActionButton>}>
        <ErrorSummary errors={moveErrors} form={moveForm} />
        <TextField form={moveForm} name="closesAtLocal" label="Close date and time" type="datetime-local" step="1" value={moveValue}
          onChange={setMoveValue} error={moveErrors.closesAtLocal} hint={zoneName(timeZone)} />
        <p className="muted">Every bidder gets an updated calendar file and a fresh sign-in link.</p>
      </Dialog>
    </div>
  );
}

interface SumDraft {
  label: string;
  amount: string;
}

/** The invited contractor's sealed bid: one bid, amended any number of times before close. */
export function BidForm({ tender, currency, reload }: { tender: ContractorTender; currency: Currency | null; reload: () => Promise<unknown> }) {
  const office = useOffice();
  const form = useFormId("bid");
  const ref = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [values, setValues] = useState<{ base: string; sums: SumDraft[]; exclusions: string[] }>(() => {
    const restored = office.takeDraft("bid") as { base: string; sums: SumDraft[]; exclusions: string[] } | null;
    if (restored) return restored;
    const bid = tender.myBid;
    return bid
      ? { base: plainAmount(bid.baseCents), sums: bid.provisionalSums.map((s) => ({ label: s.label, amount: plainAmount(s.amountCents) })), exclusions: bid.exclusions.map((e) => e.label) }
      : { base: "", sums: [], exclusions: [] };
  });
  const amended = !!tender.myBid;

  const submit = async (): Promise<void> => {
    office.announce(amended ? "Submitting amendment…" : "Submitting bid…");
    const body = {
      baseCents: amountInput(values.base),
      provisionalSums: values.sums.map((s) => ({ label: s.label, amountCents: amountInput(s.amount) })),
      exclusions: values.exclusions.map((label) => ({ label })),
    };
    const result = amended ? await put<{ bid: Bid }>(`/api/tenders/${tender.id}/bid`, body) : await post<{ bid: Bid }>(`/api/tenders/${tender.id}/bid`, body);
    if (result.ok) {
      const at = formatTime(result.data.bid.finalSubmittedAt, tender.timeZone);
      flushSync(() => setErrors({}));
      office.announce(amended ? `Bid amended at ${at}. Your latest amendment is the one that counts.` : `Bid submitted at ${at}.`);
      await reload();
      return;
    }
    office.announce("");
    const refusal = office.refused(result, { id: "bid", values: { ...values } });
    if (!refusal) return;
    if (refusal.error === "tender_closed") {
      office.alert(`This tender closed at ${closeText({ closesAt: String(refusal.closedAt ?? tender.closesAt), timeZone: tender.timeZone })}. Late bids and amendments can't be accepted.`);
      return;
    }
    flushSync(() => setErrors(errorsOf(result)));
    if (!refusal.errors) office.alert("Your bid wasn't saved. Reload and check the tender.");
    focusRefusal(ref.current);
  };

  const setSum = (index: number, key: keyof SumDraft) => (value: string) =>
    setValues((v) => ({ ...v, sums: v.sums.map((s, i) => (i === index ? { ...s, [key]: value } : s)) }));

  return (
    <form ref={ref} id={form} className="bid-form" noValidate onSubmit={(event) => event.preventDefault()}>
      <h2>Your sealed bid</h2>
      <p className="muted">Only you can see these figures until the studio opens the bids after close{currency ? `, in ${currency}` : ""}.</p>
      <ErrorSummary errors={errors} form={form} />
      <TextField form={form} name="baseCents" label="Base amount" inputMode="decimal" value={values.base}
        onChange={(base) => setValues((v) => ({ ...v, base }))} error={errors.baseCents} hint="For example 1250.00" />
      {values.sums.map((sum, index) => (
        <fieldset key={index} className="bidder">
          <legend>Provisional sum {index + 1}</legend>
          <TextField form={form} name={`provisionalSums[${index}].label`} label="Provisional sum label" value={sum.label}
            onChange={setSum(index, "label")} error={errors[`provisionalSums[${index}].label`]} />
          <TextField form={form} name={`provisionalSums[${index}].amountCents`} label="Provisional sum amount" inputMode="decimal" value={sum.amount}
            onChange={setSum(index, "amount")} error={errors[`provisionalSums[${index}].amountCents`]} />
        </fieldset>
      ))}
      {errors.provisionalSums && <p className="field-error" tabIndex={-1}>{errors.provisionalSums}</p>}
      {values.exclusions.map((label, index) => (
        <TextField key={index} form={form} name={`exclusions[${index}].label`} label="Exclusion" value={label}
          onChange={(value) => setValues((v) => ({ ...v, exclusions: v.exclusions.map((e, i) => (i === index ? value : e)) }))}
          error={errors[`exclusions[${index}].label`]} />
      ))}
      <div className="actions">
        <button type="button" className="button" onClick={() => setValues((v) => ({ ...v, sums: [...v.sums, { label: "", amount: "" }] }))}>Add provisional sum</button>
        <button type="button" className="button" onClick={() => setValues((v) => ({ ...v, exclusions: [...v.exclusions, ""] }))}>Add exclusion</button>
        {amended
          ? <ActionButton primary pending="Submitting amendment…" onAction={submit}>Submit amendment</ActionButton>
          : <ActionButton primary pending="Submitting bid…" onAction={submit}>Submit bid</ActionButton>}
      </div>
      {tender.myBid && (
        <p className="muted">Last submitted {formatTime(tender.myBid.finalSubmittedAt, tender.timeZone)}
          {tender.myBid.amendments ? `, after ${tender.myBid.amendments} amendments` : ""}. Base {currency ? formatAmount(currency, tender.myBid.baseCents) : plainAmount(tender.myBid.baseCents)}.</p>
      )}
    </form>
  );
}

/** The project's currency for display, read once for a tender's project. */
export function useProjectCurrency(projectId: string | null): Currency | null {
  const [currency, setCurrency] = useState<Currency | null>(null);
  useEffect(() => {
    if (!projectId) return;
    void get<{ project: { currency: Currency } }>(`/api/projects/${projectId}`).then((result) => {
      if (result.ok) setCurrency(result.data.project.currency);
    });
  }, [projectId]);
  return currency;
}
