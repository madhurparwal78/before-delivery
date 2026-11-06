// Checkout: Tickets → Details → Review and pay, as a dialog over any page. The step lives in the URL, held seats
// come from the server, the draft from session storage. One idempotency key per draft covers every retry.
import { Clock3, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { priceOrder } from "../../shared/allocation.ts";
import { clockTime } from "../../shared/brussels.ts";
import { euro } from "../../shared/money.ts";
import { api } from "../api.ts";
import { closeWithMotion, Dialog } from "../components/Dialog.tsx";
import { Field } from "../components/Field.tsx";
import { copy } from "../copy.ts";
import { navigate, setQuery, useLocation } from "../router.ts";
import { useSession } from "../session.tsx";
import { clearDraft, keyFor, loadDraft, saveDraft, type Draft } from "../state/checkoutDraft.ts";
import { checkoutFeedback, useCheckoutFeedback } from "../state/feedback.ts";
import { refreshProgramme, useProgramme } from "../state/programme.ts";
import type { Hold, Order, Session } from "../types.ts";

const STEPS = [["tickets", "Tickets"], ["details", "Details"], ["review", "Review and pay"]] as const;
type Step = (typeof STEPS)[number][0];
const MAX_PASSES = 10;

export function CheckoutFeedback() {
  const { status, problem } = useCheckoutFeedback();
  return (
    <>
      <p role="status" aria-label="Checkout status" className={`feedback feedback--status${status ? " has-text" : ""}`}>{status}</p>
      <p role="alert" aria-label="Checkout problem" className={`feedback feedback--problem${problem ? " has-text" : ""}`}>{problem}</p>
    </>
  );
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  return <span className="countdown figures">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left</span>;
}

type Line = { key: string; title: string; holder: string; list: number; kind: "seat" | "full" | "day"; day?: string };

export function Checkout() {
  const { search } = useLocation();
  const step = (STEPS.find(([id]) => id === search.get("checkout"))?.[0] ?? "tickets") as Step;
  const { user } = useSession();
  const programme = useProgramme();
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [draft, setDraftState] = useState<Draft>(() => loadDraft());
  const [paying, setPaying] = useState(false);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const group = user?.role === "group_booker";
  const { problem } = useCheckoutFeedback();

  const setDraft = useCallback((next: Draft) => { saveDraft(next); setDraftState(next); }, []);
  const sessionOf = useCallback((id: string): Session | undefined => programme?.sessions.find((s) => s.id === id), [programme]);

  const shown = useRef<Hold[] | null>(null);
  const loadHolds = useCallback(async () => {
    const r = await api.get<{ holds: Hold[] }>("/api/holds");
    if (!r.ok) return;
    const gone = (shown.current ?? []).filter((h) => !r.data.holds.some((x) => x.id === h.id));
    if (gone.length) checkoutFeedback.problem(gone.map((h) => copy.holdExpired(sessionOf(h.session_id)?.title ?? "your session")).join(" "));
    shown.current = r.data.holds;
    setHolds(r.data.holds);
  }, [sessionOf]);

  useEffect(() => { void loadHolds(); }, [loadHolds]);
  useEffect(() => { heading.current?.focus(); }, [step]);

  // When a hold's "Held until" passes, ask the server for the holds again.
  useEffect(() => {
    if (!holds?.length) return;
    const next = Math.min(...holds.map((h) => Date.parse(h.expires_at)));
    const timer = setTimeout(() => void loadHolds(), Math.max(0, next - Date.now()) + 250);
    return () => clearTimeout(timer);
  }, [holds, loadHolds]);

  const lines: Line[] = useMemo(() => {
    const out: Line[] = [];
    const reduced = !group && draft.rate === "reduced";
    for (const h of holds ?? []) {
      const s = sessionOf(h.session_id);
      for (let i = 0; i < h.quantity; i++) {
        out.push({ key: `${h.id}:${i}`, title: s?.title ?? "Seat", holder: "", list: (reduced ? s?.price_reduced_cents : s?.price_full_cents) ?? 0, kind: "seat" });
      }
    }
    const policy = programme?.price_policy;
    for (let i = 0; i < draft.full; i++) out.push({ key: `full:${i}`, title: "Full-festival pass", holder: "", kind: "full", list: (reduced ? policy?.full_festival_reduced_cents : policy?.full_festival_full_cents) ?? 0 });
    for (const day of programme?.festival_days ?? []) {
      for (let i = 0; i < (draft.days[day.date] ?? 0); i++) {
        out.push({ key: `day:${day.date}:${i}`, title: `Day pass — ${day.label}`, holder: "", kind: "day", day: day.date, list: (reduced ? policy?.day_reduced_cents : policy?.day_full_cents) ?? 0 });
      }
    }
    return out.map((l, i) => ({ ...l, holder: group ? draft.names[i] ?? "" : user?.name ?? "" }));
  }, [holds, draft, programme, group, sessionOf, user]);

  const priced = priceOrder(lines.map((l) => l.list), group ? programme?.price_policy.group_discount_percent ?? 0 : null, draft.voucherApplied?.balance_cents ?? 0);
  const passes = [
    ...Array.from({ length: draft.full }, () => ({ product: "full_festival" as const })),
    ...(programme?.festival_days ?? []).flatMap((d) => Array.from({ length: draft.days[d.date] ?? 0 }, () => ({ product: "day" as const, festival_day: d.date }))),
  ];

  const close = (node: HTMLElement | null) => closeWithMotion(node, () => setQuery({ checkout: null }));
  const go = (next: Step) => { checkoutFeedback.clear(); setQuery({ checkout: next }); };

  const toDetails = () => {
    if (!lines.length) return checkoutFeedback.problem("Choose at least one seat or pass to continue.");
    if (group && lines.length < 5) return checkoutFeedback.problem(copy.groupMinimum);
    go("details");
  };

  const toReview = () => {
    if (group && lines.some((_, i) => !(draft.names[i] ?? "").trim())) {
      setFieldError({ names: copy.attendeeNames });
      return checkoutFeedback.problem(copy.attendeeNames);
    }
    setFieldError({});
    go("review");
  };

  const applyVoucher = async () => {
    const code = draft.voucher.trim().toUpperCase();
    if (!code) return;
    const r = await api.get<{ code: string; balance_cents: number }>(`/api/vouchers/${encodeURIComponent(code)}`);
    if (!r.ok) {
      setDraft({ ...draft, voucherApplied: null });
      setFieldError({ voucher: copy.voucherUnknown });
      return checkoutFeedback.problem(copy.voucherUnknown);
    }
    if (r.data.balance_cents <= 0) {
      setDraft({ ...draft, voucherApplied: null });
      setFieldError({ voucher: copy.voucherEmpty });
      return checkoutFeedback.problem(copy.voucherEmpty);
    }
    setFieldError({});
    setDraft({ ...draft, voucher: code, voucherApplied: r.data });
    checkoutFeedback.status(`Voucher ${code} applied: ${euro(r.data.balance_cents)} available.`);
  };

  const inFlight = useRef(false);
  const pay = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPaying(true);
    checkoutFeedback.status(copy.paying);
    const body = {
      hold_ids: (holds ?? []).map((h) => h.id), passes, rate: group ? "full" : draft.rate,
      voucher_code: draft.voucherApplied?.code ?? null, attendee_names: group ? lines.map((_, i) => (draft.names[i] ?? "").trim()) : null,
    };
    const keyed = keyFor(loadDraft(), JSON.stringify(body));
    setDraft(keyed.draft);
    const r = await api.post<Order>("/api/checkout", body, { "Idempotency-Key": keyed.key });
    inFlight.current = false;
    setPaying(false);
    void refreshProgramme();
    if (r.ok) {
      const order = r.data;
      clearDraft();
      if (order.invoice_id) {
        const invoice = await api.get<{ number: string; due_at: string }>(`/api/invoices/${order.invoice_id}`);
        checkoutFeedback.status(invoice.ok ? copy.groupDone(order.ref, invoice.data.number, invoice.data.due_at) : `Order ${order.ref} placed.`);
      } else if (order.rate === "reduced") checkoutFeedback.status(copy.reducedDone(order.ref, order.proof_deadline!));
      else checkoutFeedback.status(copy.fullRateDone(order.ref, user?.email ?? ""));
      navigate(`/orders/${order.id}`);
      return;
    }
    const earliest = holds?.length ? holds.map((h) => h.expires_at).sort()[0]! : null;
    if (r.error === "payment_unavailable") checkoutFeedback.problem(copy.paymentsDown(earliest));
    else if (r.error === "storage_unavailable") checkoutFeedback.problem(copy.passesDown);
    else if (r.error === "hold_expired") {
      const ids = (r.body.hold_ids as string[] | undefined) ?? [];
      const titles = ids.map((id) => sessionOf(holds?.find((h) => h.id === id)?.session_id ?? "")?.title ?? "your session");
      checkoutFeedback.problem(titles.map(copy.holdExpired).join(" "));
      void loadHolds();
    } else if (r.error === "session_cancelled") {
      const cancelled = (holds ?? []).map((h) => sessionOf(h.session_id)).find((s) => s?.status === "cancelled");
      checkoutFeedback.problem(copy.sessionCancelled(cancelled?.title ?? "A session"));
    } else if (r.errors?.voucher_code) checkoutFeedback.problem(r.errors.voucher_code === "empty" ? copy.voucherEmpty : copy.voucherUnknown);
    else if (r.errors?.items === "group_minimum") checkoutFeedback.problem(copy.groupMinimum);
    else if (r.errors?.attendee_names) checkoutFeedback.problem(copy.attendeeNames);
    else checkoutFeedback.problem("Something went wrong with this order. Nothing was charged. Try again in a moment.");
  };

  const release = async (h: Hold) => {
    await api.delete(`/api/holds/${h.id}`);
    shown.current = (shown.current ?? []).filter((x) => x.id !== h.id);
    setHolds(shown.current);
    void refreshProgramme();
    checkoutFeedback.status(`Released your seat for ${sessionOf(h.session_id)?.title ?? "the session"}.`);
  };

  const count = (value: string) => Math.min(MAX_PASSES, Math.max(0, Math.floor(Number(value) || 0)));
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog label="Checkout" onClose={() => close(panelRef.current)} className="checkout" initialFocus={heading}>
      <div ref={panelRef} className="checkout__inner">
        <header className="checkout__head">
          <ol aria-label="Checkout steps" className="steps">
            {STEPS.map(([id, label], i) => (
              <li key={id} aria-current={id === step ? "step" : undefined} className="steps__item"><span className="figures">{i + 1}</span> {label}</li>
            ))}
          </ol>
          <button type="button" className="button button--icon" aria-label="Close checkout" onClick={() => close(panelRef.current)}><X aria-hidden="true" size={22} /></button>
        </header>
        <div className="checkout__body">
          {step === "tickets" && (
            <>
              <h2 className="checkout__title" tabIndex={-1} ref={heading}>Tickets</h2>
              {(holds ?? []).length > 0 && (
                <ul className="held" aria-label="Held seats">
                  {holds!.map((h) => {
                    const title = sessionOf(h.session_id)?.title ?? "Seat";
                    return (
                      <li key={h.id} className="held__row">
                        <span className="held__title">{title}{h.quantity > 1 ? ` × ${h.quantity}` : ""}</span>
                        <span className="held__until figures"><Clock3 aria-hidden="true" size={16} /> Held until {clockTime(Date.parse(h.expires_at))} <Countdown until={h.expires_at} /></span>
                        <button type="button" className="button button--quiet" aria-label={`Release seat for ${title}`} onClick={() => void release(h)}>Release</button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {holds && holds.length === 0 && <p className="hint">No seats held. Add passes below, or hold seats from the schedule.</p>}
              <div className="passes">
                <Field label="Full-festival passes" className="field--count">
                  <input type="number" min={0} max={MAX_PASSES} inputMode="numeric" value={draft.full} onChange={(e) => setDraft({ ...draft, full: count(e.target.value) })} />
                </Field>
                {programme?.festival_days.map((d) => (
                  <Field key={d.date} label={`Day passes for ${d.label}`} className="field--count">
                    <input type="number" min={0} max={MAX_PASSES} inputMode="numeric" value={draft.days[d.date] ?? 0}
                      onChange={(e) => setDraft({ ...draft, days: { ...draft.days, [d.date]: count(e.target.value) } })} />
                  </Field>
                ))}
              </div>
              <div className="checkout__actions"><button type="button" className="button button--primary" onClick={toDetails}>Continue</button></div>
            </>
          )}
          {step === "details" && (
            <>
              <h2 className="checkout__title" tabIndex={-1} ref={heading}>Details</h2>
              {!group && (
                <div role="radiogroup" aria-label="Rate" className="rates">
                  <label className="radio"><input type="radio" name="rate" checked={draft.rate === "full"} onChange={() => setDraft({ ...draft, rate: "full", key: null })} /><span>Full rate</span></label>
                  <label className="radio"><input type="radio" name="rate" checked={draft.rate === "reduced"} onChange={() => setDraft({ ...draft, rate: "reduced", key: null })} /><span>Reduced rate (student or jobseeker)</span></label>
                  <p className="hint">At the reduced rate we authorise your payment and only take it once box office approves your proof.</p>
                </div>
              )}
              <div className="voucher">
                <Field label="Gift voucher code" error={fieldError.voucher}>
                  <input type="text" value={draft.voucher} autoComplete="off" onChange={(e) => setDraft({ ...draft, voucher: e.target.value })} />
                </Field>
                <button type="button" className="button" onClick={() => void applyVoucher()}>Apply voucher</button>
              </div>
              {group && (
                <div className="attendees">
                  {lines.map((l, i) => (
                    <Field key={l.key} label={`Attendee ${i + 1} name`} hint={l.title}
                      error={fieldError.names && !(draft.names[i] ?? "").trim() ? copy.attendeeNames : undefined}>
                      <input type="text" value={draft.names[i] ?? ""}
                        onChange={(e) => { const names = [...draft.names]; names[i] = e.target.value; setDraft({ ...draft, names }); }} />
                    </Field>
                  ))}
                </div>
              )}
              <div className="checkout__actions">
                <button type="button" className="button" onClick={() => go("tickets")}>Back</button>
                <button type="button" className="button button--primary" onClick={toReview}>Continue</button>
              </div>
            </>
          )}
          {step === "review" && (
            <>
              <h2 className="checkout__title" tabIndex={-1} ref={heading}>Review and pay</h2>
              <div className="table-wrap">
                <table aria-label="Order summary" className="ruled figures summary">
                  <thead><tr><th scope="col">Item</th><th scope="col">Holder</th><th scope="col">Price</th><th scope="col">Group discount</th><th scope="col">Voucher</th><th scope="col">To pay</th></tr></thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const p = priced.lines[i]!;
                      return (
                        <tr key={l.key}>
                          <td data-label="Item">{l.title}</td><td data-label="Holder">{l.holder}</td><td data-label="Price">{euro(p.list_cents)}</td>
                          <td data-label="Group discount">{p.group_discount_cents ? `−${euro(p.group_discount_cents)}` : "—"}</td>
                          <td data-label="Voucher">{p.voucher_cents ? `−${euro(p.voucher_cents)}` : "—"}</td><td data-label="To pay">{euro(p.charged_cents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><th scope="row" colSpan={5}>Total</th><td>{euro(priced.total_cents)}</td></tr></tfoot>
                </table>
              </div>
              {!group && draft.rate === "reduced" && <p className="hint">Reduced rate: we authorise {euro(priced.total_cents)} now and take it only after your proof is approved.</p>}
              <div className="checkout__actions">
                <button type="button" className="button" onClick={() => go("details")}>Back</button>
                <button type="button" className={`button button--primary button--pay${paying ? " is-busy" : ""}`} disabled={paying} onClick={() => void pay()}>
                  {group ? "Place order on invoice" : `Pay ${euro(priced.total_cents)}`}
                </button>
              </div>
            </>
          )}
          <div className={`checkout__feedback${problem ? " has-problem" : ""}`}><CheckoutFeedback /></div>
        </div>
      </div>
    </Dialog>
  );
}
