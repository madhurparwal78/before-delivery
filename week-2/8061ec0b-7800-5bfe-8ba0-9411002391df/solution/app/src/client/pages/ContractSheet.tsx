// The contract sheet: the instrument drawing beside the terms, invoice, equity ledger and histories, the Buyout
// Rail ruled full width beneath, and every action legal for the role and state. It reloads after every action.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import type { AvailabilityItem, ConditionEvent, Contract, EquityStatement, Family, Invoice, Payment, Quote,
  Reversal } from "../../shared/api.js";
import { formatMoney, formatTaxPercent, parseDollars } from "../../shared/money.js";
import { formatDate, formatDateTime, storeDateOf } from "../../shared/storeTime.js";
import { CONDITION_KIND_WORDS, CONTRACT_STATUS_WORDS, instrumentName, ledgerEntryText, REVERSAL_REASON_WORDS,
  REVERSAL_REASONS, sizesFor, sizeWord, type ReversalReason, type Size } from "../../shared/vocabulary.js";
import { call, isNetworkOrServerFailure, NETWORK_COPY, newIdempotencyKey, type ApiResult } from "../api.js";
import { Link, useApp, useUser } from "../app.js";
import { BuyoutRail } from "../components/BuyoutRail.js";
import { ConditionDialog } from "../components/ConditionDialog.js";
import { Drawing } from "../components/Drawing.js";
import { errorNotice, Dialog, Field, info, quiet, Status, type Notice } from "../components/ui.js";
import { useBand, useReducedMotion } from "../hooks.js";
import { growHeader, type Motion } from "../motion.js";

/** A message carried to the successor's sheet after an exchange. */
const arrivals = new Map<string, string>();

type DialogName = "payment" | "reverse" | "exchange" | "writeoff" | "return" | "buyout" | "condition";

function historyActor(entry: Contract["history"][number]): string {
  if (entry.actor === "system") return "System";
  return entry.actor_name ?? "Keel & Bell";
}

function startMonth(search: string, term: number, current: number): number {
  const raw = new URLSearchParams(search).get("month");
  if (raw !== null && /^\d+$/.test(raw) && Number(raw) <= term) return Number(raw);
  return Math.min(current, term);
}

export function ContractSheet({ id }: { id: string }): ReactNode {
  const user = useUser();
  const { location, navigate } = useApp();
  const band = useBand();
  const reduced = useReducedMotion();
  const money = user.role !== "tech";
  const owner = user.role === "owner";

  const [contract, setContract] = useState<Contract | "missing" | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [equity, setEquity] = useState<EquityStatement | null>(null);
  const [quotes, setQuotes] = useState<Quote[] | "failed" | null>(null);
  const [events, setEvents] = useState<ConditionEvent[] | null>(null);
  const [parentEmail, setParentEmail] = useState(user.role === "parent" ? user.email : "");
  const [month, setMonth] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(quiet);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reversing, setReversing] = useState<EquityStatement["entries"][number] | null>(null);
  const [quoteOverride, setQuoteOverride] = useState<Quote | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);

  const status = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const succeeded = useRef(false);
  const header = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const growing = useRef<Motion>(null);
  const initialSearch = useRef(location.search);

  const load = useCallback(async (): Promise<Contract | null> => {
    const r = await call<{ contract: Contract }>("GET", `/api/contracts/${encodeURIComponent(id)}`);
    if (!r.ok) {
      if (r.status === 404) setContract("missing");
      else setNotice(errorNotice(NETWORK_COPY));
      return null;
    }
    const c = r.data.contract;
    // Every section of the sheet is fetched first and shown in one render, so nothing pushes the page down
    // as the invoice, ledger, rail quotes and condition history arrive one after another.
    const path = `/api/contracts/${encodeURIComponent(id)}`;
    const railed = money && (c.status === "signed" || c.status === "active");
    const [ev, inv, eq, q] = await Promise.all([
      call<{ events: ConditionEvent[] }>("GET", `${path}/condition-events`),
      money ? call<{ invoice: Invoice }>("GET", `${path}/invoice`) : null,
      money ? call<EquityStatement>("GET", `${path}/equity`) : null,
      railed ? call<{ quotes: Quote[] }>("GET", `${path}/quotes`) : null,
    ]);
    if (inv?.ok) setInvoice(inv.data.invoice);
    if (eq?.ok) setEquity(eq.data);
    if (money) {
      if (q) {
        setQuotes(q.ok ? q.data.quotes : "failed");
        setMonth((m) => m === null ? startMonth(initialSearch.current, c.terms.term_months, c.contract_month) : Math.min(c.contract_month, c.terms.term_months));
      } else {
        setQuotes(null);
      }
    }
    if (ev.ok) setEvents(ev.data.events);
    setContract(c);
    return c;
  }, [id, money]);

  useEffect(() => {
    void load().then((c) => {
      const arrival = arrivals.get(id);
      if (c && arrival) {
        arrivals.delete(id);
        setNotice(info(arrival));
      }
    });
    if (owner) {
      void call<{ families: Family[] }>("GET", "/api/families").then((r) => {
        if (r.ok) setFamilies(r.data.families);
      });
    }
  }, [load, id, owner]);

  useEffect(() => {
    if (owner && contract && contract !== "missing") {
      setParentEmail(families.find((f) => f.id === contract.family_id)?.email ?? "");
    }
  }, [owner, families, contract]);

  useLayoutEffect(() => {
    if (entered.current || !header.current || contract === null || contract === "missing") return;
    entered.current = true;
    growing.current = growHeader(id, header.current);
  }, [contract, id]);

  useLayoutEffect(() => () => growing.current?.stop(), []);

  if (contract === null) {
    return <section className="page"><p className="muted">Loading the contract…</p><Status label="Contract status" notice={notice} /></section>;
  }
  if (contract === "missing") {
    return (
      <section className="page not-found">
        <h1>Contract not found</h1>
        {user.role === "parent" ? <Link to="/family">My family</Link> : <Link to="/register">Back to the register</Link>}
      </section>
    );
  }

  const c = contract;
  const term = c.terms.term_months;
  const showRail = money && (c.status === "signed" || c.status === "active");
  const railMonth = month ?? Math.min(c.contract_month, term);
  const loadedQuotes = Array.isArray(quotes) ? quotes : null;
  const currentQuote = quoteOverride ?? loadedQuotes?.[Math.min(c.contract_month, term)] ?? null;
  const fillEquity = c.status === "paid_off" ? c.terms.purchase_price_cents
    : showRail && loadedQuotes ? loadedQuotes[railMonth].equity_cents : c.equity_cents;

  const openDialog = (name: DialogName) => (event: { currentTarget: HTMLElement }): void => {
    opener.current = event.currentTarget;
    succeeded.current = false;
    setDialog(name);
  };
  const returnFocus = (): HTMLElement | null => (succeeded.current ? status.current : opener.current);
  const finish = async (message: Notice): Promise<void> => {
    succeeded.current = true;
    setDialog(null);
    setNotice(message);
    setQuoteOverride(null);
    await load();
  };
  const failure = (r: ApiResult<unknown> & { ok: false }, copies: Record<string, string>): Notice => {
    if (isNetworkOrServerFailure(r)) return errorNotice(NETWORK_COPY);
    const code = r.error?.code ?? "";
    const fieldCode = r.error?.fields ? Object.values(r.error.fields)[0] : undefined;
    return errorNotice(copies[`${r.status} ${code}`] ?? copies[`${r.status} ${fieldCode ?? ""}`] ?? copies[String(r.status)] ?? NETWORK_COPY);
  };

  const action = async (name: string, pending: string, run: () => Promise<void>): Promise<void> => {
    setBusy(name);
    setNotice(info(pending));
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };

  const sendLink = (): void => void action("send", "Sending…", async () => {
    const r = await call<{ contract: Contract }>("POST", `/api/contracts/${c.id}/signing-link`, {});
    if (r.ok) {
      const expires = r.data.contract.signing_link.expires_at;
      setNotice(info(`Signing link queued for ${parentEmail}. It works until ${expires ? formatDateTime(expires) : ""}.`));
      await load();
    } else setNotice(failure(r, { 409: "This contract can't be sent for signing now." }));
  });
  const revokeLink = (): void => void action("revoke", "Revoking…", async () => {
    const r = await call("POST", `/api/contracts/${c.id}/signing-link/revoke`, {});
    if (r.ok) {
      setNotice(info("Signing link revoked."));
      await load();
    } else setNotice(failure(r, { "409 no_live_link": "There is no live signing link to revoke." }));
  });
  const activate = (): void => void action("activate", "Activating…", async () => {
    const r = await call("POST", `/api/contracts/${c.id}/activate`, {});
    if (r.ok) {
      setNotice(info("Contract active. Monthly billing is set up."));
      await load();
    } else {
      setNotice(failure(r, {
        "409 invalid_transition": "This contract can't be activated now.",
        "409 agreement_not_stored": "The signed agreement isn't stored yet.",
        "503 billing_unavailable": "Billing is unreachable. The contract is still signed; try again in a moment.",
        "503 storage_unavailable": "File storage is unreachable. The contract is still signed; try again in a moment.",
      }));
    }
  });

  const canExchange = owner && c.status === "active" && (c.instrument.instrument_type === "violin" || c.instrument.instrument_type === "cello")
    && sizesFor(c.instrument.instrument_type).indexOf(c.instrument.size) < sizesFor(c.instrument.instrument_type).length - 1;
  const canCondition = user.role !== "parent" && ["signed", "active", "exchanged", "returned"].includes(c.status);
  // Rows keep the API's oldest-first order and their own "equity after", except that each reversal sits directly
  // under the payment it reverses (brief: Visual design, Composition).
  const ledgerRows = (() => {
    let total = 0;
    const rows = (equity?.entries ?? []).map((entry) => ({ entry, equityAfter: (total += entry.amount_cents) }));
    const reversals = rows.filter((r) => r.entry.kind === "reversal");
    return rows.filter((r) => r.entry.kind !== "reversal").flatMap((r) =>
      r.entry.kind === "payment" ? [r, ...reversals.filter((v) => v.entry.payment_id === r.entry.payment_id)] : [r]);
  })();

  const drawing = (
    <Drawing type={c.instrument.instrument_type} size={c.instrument.size} label={c.instrument.label}
      fill={money ? { equity: fillEquity, price: c.terms.purchase_price_cents } : null} />
  );

  return (
    <section className="page sheet">
      <div ref={header} role="group" aria-label="Contract header" className="sheet__head">
        <p className="eyebrow">{c.student.name} · {c.school.name}</p>
        <h1><span className="figure">{c.id}</span> · {c.instrument.label} <span className="figure">{c.instrument.serial}</span></h1>
        <p className={`sheet__status word word--${c.status}`}>Status: {CONTRACT_STATUS_WORDS[c.status]}</p>
        <Status ref={status} label="Contract status" notice={notice} />
      </div>
      <div className={`sheet__grid sheet__grid--${band}`}>
        <div className="sheet__col sheet__col--drawing">
          {drawing}
        </div>
        <div className="sheet__col sheet__col--record">
          {money && (
            <>
              <section className="terms" aria-label="Terms">
                <h2>Terms</h2>
                <dl className="terms-list">
                  <div><dt>Price list</dt><dd className="figure">{c.terms.price_list_id}{c.terms.bound ? "" : " (in force today)"}</dd></div>
                  <div><dt>Monthly rent</dt><dd className="figure">{formatMoney(c.terms.base_rent_cents)}</dd></div>
                  <div><dt>Waiver</dt><dd className="figure">{c.waiver ? formatMoney(c.terms.waiver_cents) : "Not chosen"}</dd></div>
                  <div><dt>Sales tax today</dt><dd className="figure">{formatTaxPercent(c.terms.tax_rate_bp)}</dd></div>
                  <div><dt>Purchase price</dt><dd className="figure">{formatMoney(c.terms.purchase_price_cents)}</dd></div>
                  <div><dt>Term</dt><dd className="figure">{term} months</dd></div>
                  <div className="terms-list__wide"><dt>Equity</dt><dd className="figure equity">{formatMoney(c.equity_cents)}</dd></div>
                  <div className="terms-list__wide"><dt>Discount tiers</dt><dd>
                    <ul className="tier-list">{c.terms.tiers.map((t) => <li key={t.from_month}><span className="label-caps">{t.name}</span> <span className="figure">{t.from_month}{t.to_month === null ? "+" : `–${t.to_month}`}</span> · {t.percent}% off remaining</li>)}</ul>
                  </dd></div>
                  {c.billing_anchor_date && <div><dt>Billing anchor</dt>{" "}<dd className="figure">{formatDate(c.billing_anchor_date)}</dd></div>}
                  {c.next_billing_date && <div><dt>Next billing</dt>{" "}<dd className="figure">{formatDate(c.next_billing_date)}</dd></div>}
                  {c.status === "reserved" || c.status === "agreement_sent" ? (
                    <div><dt>Hold until</dt><dd className="figure">{c.hold_expires_at ? formatDateTime(c.hold_expires_at) : ""}</dd></div>
                  ) : null}
                  <div><dt>Delivery day</dt><dd className="figure">{formatDate(c.delivery_date)}</dd></div>
                </dl>
              </section>
              {invoice && (
                <section className="invoice-section">
                <h2>Monthly invoice</h2>
                <table role="table" className="ledger-table invoice" aria-label="Monthly invoice">
                  <caption>{invoice.billing_date ? `Due ${formatDate(invoice.billing_date)}` : "Not billing"}</caption>
                  <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Line</th><th scope="col" role="columnheader" className="num">Amount</th></tr></thead>
                  <tbody role="rowgroup">
                    {invoice.lines.map((line) => (
                      <tr role="row" key={line.code}>
                        <td role="cell" data-label="Line">{line.code === "sales_tax" ? `${line.label} (${formatTaxPercent(invoice.tax_rate_bp)})` : line.label}</td>
                        <td role="cell" data-label="Amount" className="num figure">{formatMoney(line.amount_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot role="rowgroup"><tr role="row"><th scope="row" role="rowheader">Total</th><td role="cell" data-label="Total" className="num figure">{formatMoney(invoice.total_cents)}</td></tr></tfoot>
                </table>
                </section>
              )}
              {equity && (
                <section className="ledger-section">
                <h2>Equity ledger</h2>
                <table role="table" className="ledger-table ledger" aria-label="Equity ledger">
                  {equity.closed && <caption>Closed: no further entries</caption>}
                  <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Date</th><th scope="col" role="columnheader">Entry</th><th scope="col" role="columnheader" className="num">Amount</th><th scope="col" role="columnheader" className="num">Equity after</th></tr></thead>
                  <tbody role="rowgroup">
                    {equity.entries.length === 0 && <tr role="row"><td role="cell" colSpan={4} className="empty">No equity entries yet.</td></tr>}
                    {ledgerRows.map(({ entry: e, equityAfter }) => (
                      <tr role="row" key={e.id} className={`ledger__row ledger__row--${e.kind}`}>
                        <td role="cell" data-label="Date" className="figure">{formatDate(storeDateOf(new Date(e.created_at)))}</td>
                        <td role="cell" data-label="Entry">
                          <span>{ledgerEntryText(e, c)}</span>
                          {owner && c.status === "active" && e.kind === "payment" && e.reversed === false && e.payment_id && (
                            <button type="button" className="button button--danger button--small" onClick={(event) => {
                              opener.current = event.currentTarget;
                              succeeded.current = false;
                              setReversing(e);
                              setDialog("reverse");
                            }}>Reverse {e.payment_id}</button>
                          )}
                        </td>
                        <td role="cell" data-label="Amount" className={`num figure ${e.amount_cents < 0 ? "negative" : "equity"}`}>{formatMoney(e.amount_cents)}</td>
                        <td role="cell" data-label="Equity after" className="num figure equity">{formatMoney(equityAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </section>
              )}
              <div className="documents">
                {c.signed_at && <a className="doc-link" href={`/api/contracts/${c.id}/agreement.pdf`} target="_blank" rel="noopener"><FileText size={18} aria-hidden="true" />Signed agreement (PDF)</a>}
                {c.status === "paid_off" && <a className="doc-link doc-link--owned" href={`/api/contracts/${c.id}/bill-of-sale.pdf`} target="_blank" rel="noopener"><FileText size={18} aria-hidden="true" />Bill of sale (PDF)</a>}
              </div>
              {owner && (
                <p className="signing-state">
                  <span className="label-caps">Signing link</span>{" "}
                  {c.signing_link.status === "none" ? "Not sent" : `${c.signing_link.status === "live" ? "Live" : c.signing_link.status === "revoked" ? "Revoked" : c.signing_link.status === "used" ? "Used to sign" : "Expired"}${c.signing_link.expires_at && c.signing_link.status === "live" ? `, works until ${formatDateTime(c.signing_link.expires_at)}` : ""}`}
                </p>
              )}
              <section className="history" aria-labelledby="history-title">
                <h2 id="history-title">Contract history</h2>
                <ol aria-label="Contract history" className="provenance">
                  {c.history.map((h, i) => (
                    <li key={i}>{formatDateTime(h.at)} · {h.from ?? "new"} → {h.to} · {historyActor(h)}</li>
                  ))}
                </ol>
              </section>
            </>
          )}
          <section className="conditions" aria-labelledby="conditions-title">
            <h2 id="conditions-title">Condition history</h2>
            <ul aria-label="Condition history" className="condition-list">
              {(events ?? []).map((ev) => (
                <li key={ev.id} className="condition">
                  <p className="condition__head"><span className="label-caps">{CONDITION_KIND_WORDS[ev.kind]}</span> · {formatDateTime(ev.created_at)} · {ev.recorded_by}</p>
                  {ev.notes && <p className="condition__notes">{ev.notes}</p>}
                  <div className="condition__photos">
                    {ev.photos.map((p, n) => <img key={p.id} src={p.url} alt={`${CONDITION_KIND_WORDS[ev.kind]} photo ${n + 1} of ${ev.photos.length}`} loading="lazy" />)}
                  </div>
                </li>
              ))}
            </ul>
            {events !== null && events.length === 0 && <p className="empty">No condition checks recorded yet.</p>}
          </section>
        </div>
      </div>
      {showRail && (
        <BuyoutRail quotes={quotes} currentMonth={c.contract_month} tiers={c.terms.tiers} month={railMonth} reduced={reduced}
          onMonth={setMonth} onRelease={(n) => window.history.replaceState(null, "", `${location.path}?month=${n}`)} />
      )}
      {c.status === "paid_off" && money && <p className="owned-stamp">Owned</p>}
      <div className="sheet__actions" aria-label="Contract actions" role="group">
        {owner && (c.status === "reserved" || c.status === "agreement_sent") && (
          <button type="button" className="button button--primary" disabled={busy === "send"} onClick={sendLink}>Send signing link</button>
        )}
        {owner && c.status === "agreement_sent" && c.signing_link.status === "live" && (
          <button type="button" className="button button--secondary" disabled={busy === "revoke"} onClick={revokeLink}>Revoke signing link</button>
        )}
        {owner && c.status === "signed" && (
          <button type="button" className="button button--primary" disabled={busy === "activate"} onClick={activate}>Activate contract</button>
        )}
        {owner && c.status === "active" && (
          <button type="button" className="button button--primary" onClick={openDialog("payment")}>Record payment</button>
        )}
        {money && c.status === "active" && currentQuote && (
          <button type="button" className="button button--primary" onClick={openDialog("buyout")}>Buy out for {formatMoney(currentQuote.total_cents)}</button>
        )}
        {canExchange && <button type="button" className="button button--secondary" onClick={openDialog("exchange")}>Exchange size</button>}
        {canCondition && <button type="button" className="button button--secondary" onClick={openDialog("condition")}>Record condition</button>}
        {owner && c.status === "active" && (
          <>
            <button type="button" className="button button--secondary" onClick={openDialog("return")}>Mark returned</button>
            <button type="button" className="button button--danger" onClick={openDialog("writeoff")}>Write off</button>
          </>
        )}
      </div>

      <PaymentDialog open={dialog === "payment"} contract={c} parentEmail={parentEmail} returnFocus={returnFocus}
        onClose={() => setDialog(null)} setNotice={setNotice} onDone={finish} failure={failure} />
      <Dialog open={dialog === "reverse"} title="Reverse payment" onClose={() => setDialog(null)} returnFocus={returnFocus}>
        {reversing && <ReverseForm contract={c} reversing={reversing} setNotice={setNotice} onDone={finish}
          onCancel={() => setDialog(null)} failure={failure} />}
      </Dialog>
      <Dialog open={dialog === "exchange"} title="Exchange size" onClose={() => setDialog(null)} returnFocus={returnFocus}>
        <ExchangeForm contract={c} setNotice={setNotice} onCancel={() => setDialog(null)} failure={failure}
          onDone={(newId, message) => {
            succeeded.current = true;
            arrivals.set(newId, message);
            setDialog(null);
            navigate(`/contracts/${newId}`);
          }} />
      </Dialog>
      {(["return", "writeoff"] as const).map((kind) => (
        <Dialog key={kind} open={dialog === kind} title={kind === "return" ? "Confirm return" : "Confirm write-off"}
          onClose={() => setDialog(null)} returnFocus={returnFocus}>
          <p>{kind === "return"
            ? `Mark ${c.instrument.serial} as returned to the store? Billing for ${c.id} stops and the instrument goes back into the fleet.`
            : `Write off ${c.instrument.serial}? Billing for ${c.id} stops and the instrument is retired from the fleet.`}</p>
          <div className="dialog__actions">
            <button type="button" className={kind === "return" ? "button button--primary" : "button button--danger"} disabled={busy === kind}
              onClick={() => void action(kind, "Saving…", async () => {
                const r = await call("POST", `/api/contracts/${c.id}/${kind === "return" ? "return" : "write-off"}`, {});
                if (r.ok) await finish(info(kind === "return" ? "Contract marked returned." : "Contract written off."));
                else setNotice(failure(r, { 503: "Billing is unreachable or hasn't confirmed the cancellation. Nothing was changed; try again in a moment." }));
              })}>Confirm</button>
            <button type="button" className="button button--secondary" onClick={() => setDialog(null)}>Cancel</button>
          </div>
        </Dialog>
      ))}
      <Dialog open={dialog === "buyout"} title="Confirm buyout" onClose={() => setDialog(null)} returnFocus={returnFocus}>
        {currentQuote && <BuyoutForm contract={c} quote={currentQuote} parentEmail={parentEmail} setNotice={setNotice}
          onDone={finish} onCancel={() => setDialog(null)} failure={failure}
          onQuoteChanged={(q) => {
            setQuoteOverride(q);
            setDialog(null);
            void load();
          }} />}
      </Dialog>
      {canCondition && (
        <ConditionDialog open={dialog === "condition"} contractId={c.id} returnFocus={returnFocus}
          onClose={() => setDialog(null)} onDone={(count) => void finish(info(`Condition recorded with ${count} photos.`))} />
      )}
    </section>
  );
}

type Failure = (r: ApiResult<unknown> & { ok: false }, copies: Record<string, string>) => Notice;

function PaymentDialog({ open, contract, parentEmail, returnFocus, onClose, setNotice, onDone, failure }: {
  open: boolean; contract: Contract; parentEmail: string; returnFocus: () => HTMLElement | null; onClose: () => void;
  setNotice: (n: Notice) => void; onDone: (n: Notice) => Promise<void>; failure: Failure;
}): ReactNode {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (open) {
      setAmount("");
      key.current = newIdempotencyKey();
    }
  }, [open]);
  return (
    <Dialog open={open} title="Record payment" onClose={onClose} returnFocus={returnFocus}>
      <form className="form" noValidate onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setNotice(info("Recording payment…"));
        void call<{ payment: Payment; contract: Contract }>("POST", `/api/contracts/${contract.id}/payments`,
          { amount_cents: parseDollars(amount) }, { "Idempotency-Key": key.current }).then(async (r) => {
          setBusy(false);
          if (r.ok) {
            const p = r.data.payment;
            const owned = r.data.contract.status === "paid_off" ? " The instrument is now owned." : "";
            await onDone(info(`Payment of ${formatMoney(p.amount_cents)} recorded: ${formatMoney(p.base_rent_cents)} rent toward ownership, ${formatMoney(p.waiver_cents)} waiver, ${formatMoney(p.tax_cents)} tax. Receipt queued for ${parentEmail}.${owned}`));
            return;
          }
          if (r.status !== 0 && r.status !== 503) key.current = newIdempotencyKey();
          setNotice(failure(r, {
            "422 invalid": "Enter an amount above $0.00.",
            "422 exceeds_remaining": "That's more than the remaining balance. Use buyout instead.",
            "409 invalid_transition": "This contract can't take payments now.",
            "409 idempotency_conflict": "Billing already holds a different charge for this payment. Nothing was recorded.",
            "503 billing_unavailable": "Billing is unreachable. Nothing was recorded; try again in a moment.",
            "503 storage_unavailable": "File storage is unreachable, so this final payment can't close the contract. Nothing was recorded; try again in a moment.",
          }));
        });
      }}>
        <Field label="Amount" htmlFor="payment-amount">
          <div className="money-input"><span aria-hidden="true">$</span>
            <input id="payment-amount" className="figure" inputMode="decimal" autoComplete="off" placeholder="58.46" value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)} />
          </div>
        </Field>
        <p className="muted">Split at today's {formatTaxPercent(contract.terms.tax_rate_bp)} sales tax into rent toward ownership, waiver and tax.</p>
        <div className="dialog__actions">
          <button type="submit" className="button button--primary" disabled={busy}>Save payment</button>
          <button type="button" className="button button--secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function ReverseForm({ contract, reversing, setNotice, onDone, onCancel, failure }: {
  contract: Contract; reversing: EquityStatement["entries"][number];
  setNotice: (n: Notice) => void; onDone: (n: Notice) => Promise<void>; onCancel: () => void; failure: Failure;
}): ReactNode {
  const [reason, setReason] = useState<ReversalReason | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const paymentId = reversing.payment_id ?? "";
  return (
    <form className="form" noValidate onSubmit={(event) => {
      event.preventDefault();
      setBusy(true);
      setNotice(info("Reversing…"));
      void call<{ reversal: Reversal }>("POST", `/api/contracts/${contract.id}/payments/${paymentId}/reversal`,
        { reason }, { "Idempotency-Key": key.current }).then(async (r) => {
        setBusy(false);
        if (r.ok) {
          const rev = r.data.reversal;
          await onDone(info(`Payment ${paymentId} reversed: ${formatMoney(rev.amount_cents)} refunded, ${formatMoney(rev.base_rent_cents)} equity removed.`));
          return;
        }
        if (r.status !== 0 && r.status !== 503) key.current = newIdempotencyKey();
        setNotice(failure(r, {
          "409 payment_reversed": `Payment ${paymentId} was already reversed.`,
          "409 invalid_transition": "Payments can only be reversed on an active contract.",
          422: "Choose a reason.",
          503: "Billing is unreachable. Nothing was reversed; try again in a moment.",
        }));
      });
    }}>
      <p>Refund {formatMoney(reversing.payment_amount_cents ?? 0)} and remove {formatMoney(reversing.amount_cents)} of equity from {contract.id}?</p>
      <fieldset className="picker">
        <legend className="picker__legend">Reason</legend>
        <div role="radiogroup" aria-label="Reason" className="picker__options picker__options--stack">
          {REVERSAL_REASONS.map((r) => (
            <label key={r} className="choice">
              <input type="radio" name="reversal-reason" checked={reason === r} onChange={() => setReason(r)} />
              <span className="choice__text">{REVERSAL_REASON_WORDS[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="dialog__actions">
        <button type="submit" className="button button--danger" disabled={busy}>Confirm reversal</button>
        <button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ExchangeForm({ contract, setNotice, onCancel, onDone, failure }: {
  contract: Contract; setNotice: (n: Notice) => void; onCancel: () => void; failure: Failure;
  onDone: (newId: string, message: string) => void;
}): ReactNode {
  const type = contract.instrument.instrument_type;
  const larger = sizesFor(type).slice(sizesFor(type).indexOf(contract.instrument.size) + 1);
  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [size, setSize] = useState<Size | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const refresh = useCallback(async () => {
    const r = await call<{ items: AvailabilityItem[] }>("GET", "/api/availability");
    if (r.ok) setItems(r.data.items);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const count = (s: Size): number => items.find((i) => i.instrument_type === type && i.size === s)?.available ?? 0;
  return (
    <form className="form" noValidate onSubmit={(event) => {
      event.preventDefault();
      setBusy(true);
      setNotice(info("Exchanging…"));
      void call<{ new_contract: Contract; old_contract: Contract }>("POST", `/api/contracts/${contract.id}/exchange`, { size },
        { "Idempotency-Key": key.current }).then((r) => {
        setBusy(false);
        if (r.ok) {
          const next = r.data.new_contract;
          onDone(next.id, `Exchanged to ${next.instrument.label} ${next.instrument.serial}. ${formatMoney(next.equity_cents)} equity moved from ${contract.id}.`);
          return;
        }
        if (r.status !== 0 && r.status !== 503) key.current = newIdempotencyKey();
        if (r.status === 409 && r.error?.code === "unavailable") void refresh();
        setNotice(failure(r, {
          "409 unavailable": "That size is no longer available.",
          "422 invalid": "Choose a larger size.",
          "503 billing_unavailable": "Billing is unreachable. Nothing was exchanged; try again in a moment.",
          "503 storage_unavailable": "File storage is unreachable. Nothing was exchanged; try again in a moment.",
        }));
      });
    }}>
      <p>Move {contract.student.name} up from the {contract.instrument.label}. Equity of {formatMoney(contract.equity_cents)} carries to the new contract.</p>
      <fieldset className="picker">
        <legend className="picker__legend">New size</legend>
        <div role="radiogroup" aria-label="New size" className="picker__options picker__options--stack">
          {larger.map((s) => (
            <label key={s} className={`choice ${count(s) === 0 ? "choice--none" : ""}`}>
              <input type="radio" name="exchange-size" checked={size === s} disabled={count(s) === 0} onChange={() => setSize(s)} />
              <span className="choice__text">{sizeWord(s)}, {count(s) === 0 ? "none available" : `${count(s)} available`}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="dialog__actions">
        <button type="submit" className="button button--primary" disabled={busy}>Confirm exchange</button>
        <button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted">{instrumentName(type)} sizes only move up.</p>
    </form>
  );
}

function BuyoutForm({ contract, quote, parentEmail, setNotice, onDone, onCancel, onQuoteChanged, failure }: {
  contract: Contract; quote: Quote; parentEmail: string; setNotice: (n: Notice) => void; onDone: (n: Notice) => Promise<void>;
  onCancel: () => void; onQuoteChanged: (q: Quote) => void; failure: Failure;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  return (
    <div>
      <p>Pay {formatMoney(quote.total_cents)} now ({formatMoney(quote.payoff_cents)} plus {formatMoney(quote.tax_cents)} tax) and own {contract.instrument.serial}. {quote.tier.label} applies.</p>
      <div className="dialog__actions">
        <button type="button" className="button button--primary" disabled={busy} onClick={() => {
          setBusy(true);
          setNotice(info("Processing buyout…"));
          void call<{ contract: Contract; buyout: { total_cents: number } }>("POST", `/api/contracts/${contract.id}/buyout`,
            { expected_payoff_cents: quote.payoff_cents }, { "Idempotency-Key": key.current }).then(async (r) => {
            setBusy(false);
            if (r.ok) {
              await onDone(info(`Bought out for ${formatMoney(r.data.buyout.total_cents)}. ${contract.student.name} owns ${contract.instrument.serial}. Ownership letter queued for ${parentEmail}.`));
              return;
            }
            if (r.status !== 0 && r.status !== 503) key.current = newIdempotencyKey();
            if (r.status === 409 && r.error?.code === "quote_changed" && r.error.quote) {
              setNotice(errorNotice(`The payoff is now ${formatMoney(r.error.quote.total_cents)} with tax. Review and confirm again.`));
              onQuoteChanged(r.error.quote);
              return;
            }
            setNotice(failure(r, {
              "409 invalid_transition": "This contract can't be bought out now.",
              "503 billing_unavailable": "Billing is unreachable. The contract is unchanged; try again in a moment.",
              "503 storage_unavailable": "File storage is unreachable. Nothing was charged; the contract is unchanged.",
            }));
          });
        }}>Confirm buyout</button>
        <button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
