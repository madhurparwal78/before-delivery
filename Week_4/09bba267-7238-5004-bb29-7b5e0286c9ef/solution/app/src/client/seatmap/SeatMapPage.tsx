// The seat map page: performance header, sections, price tier choice, the plan with its Sightline, and the Cart.
import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { bySeatOrder, hallSeat, seatById, SECTIONS, type SectionCode } from "../../shared/hall.js";
import { exchangeDifferenceCents, formatMoney } from "../../shared/rules.js";
import type { Cart, Order, Performance, Seat, Ticket } from "../../shared/types.js";
import { announce } from "../announce.js";
import { CHANGES_CLOSED, HOLD_ENDED, SALES_CLOSED, SEAT_TAKEN, TICKET_PAUSED } from "../copy.js";
import { get, newKey, request } from "../api.js";
import { clockText, Dialog, EmptyState, Ledger, NoticeRegion, totalsLines, useCountdown } from "../components.js";
import { useLive, useLoader } from "../live.js";
import { navigate } from "../router.js";
import { NotFound } from "../pages/NotFound.js";
import { CheckoutDialog } from "./CheckoutDialog.js";
import { WaitlistDialog } from "./WaitlistDialog.js";
import { CANVASES, lookOf, selectable, seatIdAt } from "./plan.js";
import { SeatPlan } from "./SeatPlan.js";
import { Readout } from "./Sightline.js";


const CODES: SectionCode[] = ["ST", "CI", "BA"];
const labels = (ids: string[]): string => [...ids].sort(bySeatOrder).map((id) => seatById(id).label).join(", ");
const firstActive = (code: SectionCode): string => seatIdAt(code, 0, 15);

interface Place {
  section: SectionCode;
  seat: string;
  tier: string;
}

function placeFromAddress(): Place & { exchange: string | null } {
  const params = new URLSearchParams(location.search);
  const section = CODES.find((c) => c === params.get("section")) ?? "ST";
  const seat = params.get("seat") ?? "";
  return {
    section,
    seat: hallSeat(seat)?.section === section ? seat : firstActive(section),
    tier: params.get("tier") || "all",
    exchange: params.get("exchange"),
  };
}

export function SeatMapPage({ performanceId }: { performanceId: string }): JSX.Element {
  const initial = useMemo(placeFromAddress, [performanceId]);
  const [show, setShow] = useState<Performance | null>(null);
  const [missing, setMissing] = useState(false);
  const [seatList, setSeatList] = useState<Seat[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [answer, setAnswer] = useState<{ seconds: number | null; at: number }>({ seconds: null, at: 0 });
  const [section, setSection] = useState<SectionCode>(initial.section);
  const [activeId, setActiveId] = useState(initial.seat);
  const [tierChoice, setTierChoice] = useState(initial.tier);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focusTick, setFocusTick] = useState(0);
  const [notice, setNotice] = useState("");
  const [holding, setHolding] = useState(false);
  const [dialog, setDialog] = useState<"checkout" | "exchange" | "waitlist" | null>(null);
  const [waitlistTier, setWaitlistTier] = useState<string | null>(null);
  const [exchangeTarget, setExchangeTarget] = useState<{ seatId: string; difference: number } | null>(null);
  const answerSeq = useRef(0);
  const [exchangeTicket, setExchangeTicket] = useState<Ticket | null>(null);
  const cartHeading = useRef<HTMLHeadingElement>(null);
  const holdingRef = useRef(false);
  const endedHolds = useRef(new Set<string>());
  const lastCart = useRef<Cart | null>(null);

  const seats = useMemo(() => new Map(seatList.map((s) => [s.id, s])), [seatList]);
  const tiers = useMemo(() => new Map((show?.tiers ?? []).map((t) => [t.id, t])), [show]);
  const exchangeId = initial.exchange;

  /** A hold ends at most once per page, however the page learns of it. */
  const holdEnded = (expiresAt: string): void => {
    if (endedHolds.current.has(expiresAt)) return;
    endedHolds.current.add(expiresAt);
    announce(HOLD_ENDED);
    setNotice(HOLD_ENDED);
  };

  const applyCart = (next: Cart): void => {
    lastCart.current = next;
    setCart(next);
    answerSeq.current += 1;
    setAnswer({ seconds: next.secondsLeft, at: answerSeq.current });
  };

  const applySeats = (next: Seat[]): void => {
    setSeatList(next);
    if (holdingRef.current) return;
    setSelection((current) => {
      if (current.size === 0) return current;
      const byId = new Map(next.map((s) => [s.id, s]));
      const lost = [...current].filter((id) => byId.get(id)?.state !== "on_sale" && !byId.get(id)?.mine);
      const kept = new Set([...current].filter((id) => byId.get(id)?.state === "on_sale"));
      if (lost.length) {
        announce(`Taken by another buyer: ${labels(lost)}.`);
        setNotice(SEAT_TAKEN);
      }
      return kept.size === current.size ? current : kept;
    });
  };

  const refresh = useLoader(async () => {
    const [performanceAnswer, seatsAnswer, cartAnswer] = await Promise.all([
      get<Performance>(`/api/performances/${encodeURIComponent(performanceId)}`),
      get<{ seats: Seat[] }>(`/api/performances/${encodeURIComponent(performanceId)}/seats`),
      get<Cart>(`/api/performances/${encodeURIComponent(performanceId)}/cart`),
    ]);
    if (!performanceAnswer.ok) {
      if (performanceAnswer.status === 404) setMissing(true);
      return;
    }
    setShow(performanceAnswer.data);
    if (seatsAnswer.ok) applySeats(seatsAnswer.data.seats);
    if (cartAnswer.ok) applyCart(cartAnswer.data);
  });

  useEffect(() => {
    refresh();
    if (!exchangeId) return;
    void get<{ orders: Order[] }>("/api/orders").then((found) => {
      const ticket = found.ok ? found.data.orders.flatMap((o) => o.tickets).find((t) => t.id === exchangeId) : undefined;
      setExchangeTicket(ticket ?? null);
      if (ticket) setNotice(`Choose a new seat for ${ticket.label}, then choose Exchange to this seat.`);
    });
  }, [performanceId]);

  useLive((event) => {
    if (event.type === "hold_ended" && event.performanceId === performanceId) holdEnded(event.expiresAt);
    if (event.type === "resync" || event.type === "buyer" || event.type === "hold_ended"
      || (event.type === "seats" && event.performanceId === performanceId)) refresh();
  });

  // The address carries the place on the map; changes replace the history entry.
  useEffect(() => {
    const params = new URLSearchParams({ section, seat: activeId, tier: tierChoice });
    if (exchangeId) params.set("exchange", exchangeId);
    history.replaceState(history.state, "", `/p/${performanceId}?${params.toString()}`);
  }, [section, activeId, tierChoice]);

  /** The countdown reached 0:00: ask the server, which alone says whether the hold has ended. */
  const askServer = async (): Promise<void> => {
    const before = lastCart.current;
    const found = await get<Cart>(`/api/performances/${encodeURIComponent(performanceId)}/cart`);
    if (!found.ok) return;
    if (found.data.seats.length === 0 && before?.expiresAt) holdEnded(before.expiresAt);
    applyCart(found.data);
  };
  const secondsLeft = useCountdown(answer, () => void askServer());

  if (missing) return <NotFound />;

  const toggle = (seatId: string): void => {
    setSelection((current) => {
      const next = new Set(exchangeId ? [] : current);
      if (current.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });
  };

  const activate = (seatId: string, canToggle: boolean): void => {
    setActiveId(seatId);
    if (canToggle) toggle(seatId);
  };

  const moveTo = (seatId: string): void => {
    setActiveId(seatId);
    setFocusTick((n) => n + 1);
  };

  const switchSection = (code: SectionCode, focus: boolean): void => {
    setSection(code);
    setActiveId(firstActive(code));
    setHovered(null);
    if (focus) setFocusTick((n) => n + 1);
  };

  const onKey = (event: KeyboardEvent): void => {
    const active = seatById(activeId);
    const rows = CANVASES[section].rows;
    const rowIndex = rows.findIndex((r) => r.letter === active.row);
    const at = (r: number, n: number): string => seatIdAt(section, Math.max(0, Math.min(rows.length - 1, r)), Math.max(1, Math.min(30, n)));
    const sectionIndex = CODES.indexOf(section);
    let next: string | null = null;
    switch (event.key) {
      case "ArrowLeft": next = at(rowIndex, active.number - 1); break;
      case "ArrowRight": next = at(rowIndex, active.number + 1); break;
      case "ArrowUp": next = at(rowIndex - 1, active.number); break;
      case "ArrowDown": next = at(rowIndex + 1, active.number); break;
      case "Home": next = event.ctrlKey ? at(0, 1) : at(rowIndex, 1); break;
      case "End": next = event.ctrlKey ? at(rows.length - 1, 30) : at(rowIndex, 30); break;
      case "PageUp":
      case "PageDown": {
        event.preventDefault();
        const target = CODES[sectionIndex + (event.key === "PageDown" ? 1 : -1)];
        if (target) switchSection(target, true);
        return;
      }
      case " ":
      case "Enter":
        event.preventDefault();
        if (selectable(seats.get(activeId), tierChoice)) toggle(activeId);
        return;
      default:
        return;
    }
    event.preventDefault();
    moveTo(next);
  };

  const chooseTier = (tierId: string): void => {
    setTierChoice(tierId);
    if (tierId !== "all") setSelection((current) => new Set([...current].filter((id) => seats.get(id)?.tierId === tierId)));
  };

  const hold = async (): Promise<void> => {
    const seatIds = [...selection].sort(bySeatOrder);
    setHolding(true);
    holdingRef.current = true;
    const result = await request<{ cart: Cart; held: string[]; taken: string[] }>(
      "POST", `/api/performances/${encodeURIComponent(performanceId)}/holds`, { seatIds });
    holdingRef.current = false;
    setHolding(false);
    if (result.ok) {
      const { held, taken } = result.data;
      setSelection(new Set());
      applyCart(result.data.cart);
      const parts = [held.length ? `Held ${labels(held)}.` : "", taken.length ? `Taken by another buyer: ${labels(taken)}.` : ""];
      if (held.length || taken.length) announce(parts.filter(Boolean).join(" "));
      setNotice(taken.length ? SEAT_TAKEN : "");
      setSeatList((list) => list.map((s) => (held.includes(s.id) ? { ...s, state: "held", mine: true }
        : taken.includes(s.id) && s.state === "on_sale" ? { ...s, state: "held", mine: false } : s)));
    } else if (result.error.error === "seats_taken") {
      const taken = result.error.taken ?? [];
      setSelection(new Set());
      if (result.error.cart) applyCart(result.error.cart);
      announce(`Taken by another buyer: ${labels(taken)}.`);
      setNotice(SEAT_TAKEN);
      setSeatList((list) => list.map((s) => (taken.includes(s.id) && s.state === "on_sale" ? { ...s, state: "held", mine: false } : s)));
    } else if (result.error.error === "sales_closed") {
      announce(SALES_CLOSED);
      setNotice(SALES_CLOSED);
    } else if (result.error.fields?.seatIds) {
      announce(result.error.fields.seatIds);
      setNotice(result.error.fields.seatIds);
    }
    refresh();
  };

  const release = async (seatId: string): Promise<void> => {
    const result = await request<{ cart: Cart }>("DELETE", `/api/performances/${encodeURIComponent(performanceId)}/holds/${seatId}`);
    if (result.ok) {
      applyCart(result.data.cart);
      announce(`Released ${seatById(seatId).label}.`);
      if (result.data.cart.seats.length === 0) cartHeading.current?.focus();
    }
    refresh();
  };

  if (!show) {
    return (
      <div class="seatmap" aria-busy="true" key="loading">
        <div class="show-head"><p class="kicker">Seat map</p></div>
        <div class="skeleton-line" /><div class="skeleton-line" /><div class="skeleton-line" />
      </div>
    );
  }

  const wedgeId = hovered ?? activeId;
  const wedgeSeat = seatById(wedgeId);
  const held = cart?.seats ?? [];
  const soldOut = show.salesOpen ? show.tiers.filter((t) => t.remaining === 0) : [];
  const chosen = [...selection][0];
  const chosenTier = chosen ? tiers.get(seats.get(chosen)?.tierId ?? "") : undefined;

  return (
    <div class="seatmap" key="ready">
      <header class="show-head">
        <p class="kicker">Seat map</p>
        <h1>{show.title}</h1>
        <p class="show-when">{show.startsAtVenue}</p>
        {show.salesOpen ? null : <p class="sales-closed">Sales closed</p>}
      </header>

      <div class="controls">
        <div class="controls-row">
          <div role="tablist" aria-label="Sections" class="tabs" onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const target = CODES[CODES.indexOf(section) + (event.key === "ArrowRight" ? 1 : -1)];
            if (target) {
              switchSection(target, false);
              document.getElementById(`tab-${target}`)?.focus();
            }
          }}>
            {SECTIONS.map((s) => (
              <button type="button" role="tab" id={`tab-${s.code}`} key={s.code} aria-selected={s.code === section ? "true" : "false"}
                tabIndex={s.code === section ? 0 : -1} aria-controls="seat-plan" onClick={() => switchSection(s.code, false)}>
                {s.name}
              </button>
            ))}
          </div>
          <HallKey section={section} />
        </div>
        <fieldset class="tier-choice">
          <legend id="tier-legend">Price tier</legend>
          <div role="radiogroup" aria-labelledby="tier-legend" class="tier-options">
            <label class="tier-option">
              <input type="radio" name="tier" value="all" checked={tierChoice === "all"} aria-label="All tiers" onChange={() => chooseTier("all")} />
              <span class="tier-name">All tiers</span>
              <span class="tier-meta">Every price</span>
            </label>
            {show.tiers.map((t) => (
              <label class="tier-option" key={t.id}>
                <input type="radio" name="tier" value={t.id} checked={tierChoice === t.id} aria-label={t.name}
                  aria-describedby={`tier-meta-${t.id}`} onChange={() => chooseTier(t.id)} />
                <span class="tier-name">{t.name}</span>
                <span class="tier-meta" id={`tier-meta-${t.id}`}>
                  <span class="fig">{formatMoney(t.faceCents)}</span> · {t.remaining === 0 ? "Sold out" : <><span class="fig">{t.remaining}</span> left</>}
                </span>
              </label>
            ))}
          </div>
          {soldOut.length ? (
            <div class="waitlist-offers">
              {soldOut.map((t) => (
                <button type="button" class="quiet" key={t.id} onClick={() => {
                  setWaitlistTier(t.id);
                  setDialog("waitlist");
                }}>Join the waitlist for {t.name}</button>
              ))}
            </div>
          ) : null}
        </fieldset>
      </div>

      <NoticeRegion label="Notice" text={notice} reserve />

      <div class="map-column" id="seat-plan">
        <SeatPlan section={section} seats={seats} tiers={tiers} tierChoice={tierChoice} selection={selection}
          activeId={activeId} wedgeId={wedgeId} focusTick={focusTick} onActivate={activate} onHover={setHovered} onKey={onKey} />
        <Readout seat={wedgeSeat} look={lookOf(seats.get(wedgeId), selection.has(wedgeId))} />
        <div class="selection-bar">
          <p class="selection-count"><span class="fig">{selection.size}</span> selected</p>
          {exchangeId ? (
            <button type="button" disabled={!exchangeTicket || !chosenTier} onClick={() => {
              if (!exchangeTicket || !chosen || !chosenTier) return;
              setExchangeTarget({ seatId: chosen, difference: exchangeDifferenceCents(exchangeTicket, chosenTier) });
              setDialog("exchange");
            }}>Exchange to this seat</button>
          ) : (
            <button type="button" disabled={selection.size === 0 || !show.salesOpen || holding} onClick={() => void hold()}>
              {holding ? "Holding seats" : "Hold selected seats"}
            </button>
          )}
        </div>
      </div>

      <section aria-label="Cart" class="cart">
        <div class="cart-head">
          <h2 tabIndex={-1} ref={cartHeading}>Cart</h2>
          {held.length && secondsLeft !== null ? (
            <p class="hold-clock"><span class="kicker">Held for</span><span role="timer" aria-label="Hold time left">{clockText(secondsLeft)}</span></p>
          ) : null}
        </div>
        {held.length === 0 || !cart ? <EmptyState text="No seats held." /> : (
          <>
            <ul class="seat-lines">
              {held.map((line) => (
                <li class="seat-line" key={line.seatId}>
                  <div>
                    <p class="seat-name">{line.label}</p>
                    <p class="seat-tier">{line.tierName}</p>
                  </div>
                  <div class="seat-amounts">
                    <span>Face</span> <span class="amount">{formatMoney(line.faceCents)}</span>
                    <span>Seat fee</span> <span class="amount">{formatMoney(line.seatFeeCents)}</span>
                  </div>
                  <button type="button" class="text-button" aria-label={`Release ${line.label}`} onClick={() => void release(line.seatId)}>Release</button>
                </li>
              ))}
            </ul>
            <Ledger lines={totalsLines(cart)} />
            <button type="button" onClick={() => setDialog("checkout")}>Checkout</button>
          </>
        )}
      </section>

      {cart ? (
        <CheckoutDialog open={dialog === "checkout"} cart={cart} performanceId={performanceId} secondsLeft={secondsLeft}
          onClose={() => setDialog(null)} cartHeading={() => cartHeading.current}
          onResult={(kind) => {
            if (kind === "paid" && lastCart.current?.expiresAt) endedHolds.current.add(lastCart.current.expiresAt);
            if (kind === "ended" && lastCart.current?.expiresAt) holdEnded(lastCart.current.expiresAt);
            if (kind === "closed") {
              announce(SALES_CLOSED);
              setNotice(SALES_CLOSED);
            }
            refresh();
          }} />
      ) : null}

      {waitlistTier && tiers.get(waitlistTier) ? (
        <WaitlistDialog open={dialog === "waitlist"} performanceId={performanceId} tier={tiers.get(waitlistTier)!} onClose={() => setDialog(null)} />
      ) : null}

      {exchangeTicket && exchangeTarget ? (
        <ExchangeDialog open={dialog === "exchange"} ticket={exchangeTicket} newSeatId={exchangeTarget.seatId}
          difference={exchangeTarget.difference}
          onClose={() => setDialog(null)}
          onDone={(ticket) => {
            setSelection(new Set());
            if (ticket) {
              setExchangeTicket(ticket);
              setNotice(`Choose a new seat for ${ticket.label}, then choose Exchange to this seat.`);
            }
            refresh();
          }} />
      ) : null}
    </div>
  );
}

function HallKey({ section }: { section: SectionCode }): JSX.Element {
  const arcs: [SectionCode, number][] = [["ST", 11], ["CI", 21], ["BA", 31]];
  return (
    <svg class="hall-key" viewBox="0 0 72 44" aria-hidden="true" focusable="false">
      <rect x="27" y="3" width="18" height="4" />
      {arcs.map(([code, r]) => (
        <path key={code} class={code === section ? "chosen" : ""}
          d={`M ${36 - r * 0.97} ${9 + r * 0.25} A ${r} ${r} 0 0 0 ${36 + r * 0.97} ${9 + r * 0.25}`} />
      ))}
    </svg>
  );
}

interface ExchangeProps {
  open: boolean;
  ticket: Ticket;
  newSeatId: string;
  difference: number;
  onClose: () => void;
  onDone: (ticket: Ticket | null) => void;
}

const EXCHANGE_COPY: Record<string, string> = {
  seats_taken: "That seat was just taken. Pick another seat.",
  payment_declined: "Your payment was declined. Your ticket is unchanged.",
  payments_unavailable: TICKET_PAUSED,
  changes_closed: CHANGES_CLOSED,
};

function ExchangeDialog({ open, ticket, newSeatId, difference, onClose, onDone }: ExchangeProps): JSX.Element {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const newLabel = seatById(newSeatId).label;
  const line = difference > 0 ? `You pay ${formatMoney(difference)}` : difference < 0 ? `We refund ${formatMoney(-difference)}` : "No price difference";

  useEffect(() => {
    if (open) {
      setMessage("");
      setDone(null);
    }
  }, [open]);

  const confirmExchange = async (): Promise<void> => {
    setPending(true);
    setMessage("");
    const result = await request<{ order: Order; differenceCents: number }>("POST", `/api/tickets/${ticket.id}/exchange`, { newSeatId }, newKey());
    setPending(false);
    if (result.ok) {
      const copy = `Exchange confirmed. Your new seat is ${newLabel}.`;
      announce(copy);
      setDone(copy);
      onDone(result.data.order.tickets.find((t) => t.id === ticket.id) ?? null);
      return;
    }
    const copy = EXCHANGE_COPY[result.error.error] ?? Object.values(result.error.fields ?? {})[0] ?? "";
    announce(copy);
    setMessage(copy);
    if (result.error.error === "seats_taken") onDone(null);
  };

  return (
    <Dialog label="Confirm exchange" open={open} busy={pending} onClose={onClose}>
      <div class="dialog-body">
        <h2>{done ? "Exchange confirmed" : "Confirm exchange"}</h2>
        {done ? (
          <>
            <p>{done}</p>
            <div class="dialog-actions">
              <button type="button" data-autofocus="" onClick={() => navigate("/tickets")}>View my tickets</button>
              <button type="button" class="quiet" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div class="ledger">
              <div class="ledger-row"><span>From</span> <span class="amount">{ticket.label}</span></div>
              <div class="ledger-row"><span>To</span> <span class="amount">{newLabel}</span></div>
              <div class="ledger-row ledger-total"><span>{line}</span></div>
            </div>
            <NoticeRegion label="Exchange notice" text={message} />
            <div class="dialog-actions">
              <button type="button" disabled={pending} onClick={() => void confirmExchange()}>{pending ? "Confirming exchange" : "Confirm exchange"}</button>
              <button type="button" class="quiet" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
