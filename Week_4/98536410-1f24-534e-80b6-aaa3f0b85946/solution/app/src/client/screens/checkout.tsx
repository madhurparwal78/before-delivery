// The checkout dialog: collection shop, hold, day, time and contact details, then one order per press.
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PausedButton, Status } from "../controls";
import { cartTotalCopy, type useCart } from "../cartState";
import { ApiFailure, api, newRequestKey } from "../lib/api";
import { Figure } from "../lib/figure";
import { focusById, focusIdOf } from "../lib/focus";
import { formatCountdown, formatKm } from "../lib/format";
import { useInterval } from "../lib/hooks";
import { Overlay } from "../lib/overlay";
import { loadScreen, saveScreen } from "../lib/persist";
import { navigate } from "../lib/router";
import { useMe } from "../session";
import { PAUSE_COPY, useStorageDown } from "../storage";
import type { Cart, Hold, Order, SlotDay } from "../types";
import { orderMessageKey, placedCopy } from "./order";

const POLL_MS = 5000;
const ERROR_COPY = "Something went wrong. Try again.";
const ENDED_COPY = "Your hold has ended. Hold again to keep these items.";
const SLOT_GONE_COPY = "That collection time is no longer available. Pick another.";
const NO_SLOTS_COPY = "No collection times in the next 7 days.";
const NO_AREA_COPY = "Choose your area on a product page first.";
const MINUTE = 60;

interface ShopChoice {
  store_id: string;
  name: string;
  distance_km: number;
  complete: boolean;
}

interface Memory {
  day: string;
  time: string;
  name: string;
  email: string;
  focus: string | null;
  scroll: number;
  placement: { key: string; body: string } | null;
}

const BLANK: Memory = { day: "", time: "", name: "", email: "", focus: null, scroll: 0, placement: null };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayName(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

interface ConflictInfo {
  sku: string;
  remaining: number;
}

export function Checkout({ open, restored, opener, cartState, onClose }: {
  open: boolean; restored: boolean; opener: RefObject<HTMLButtonElement | null>; cartState: ReturnType<typeof useCart>; onClose: () => void;
}) {
  const me = useMe();
  const { cart, apply } = cartState;
  const down = useStorageDown();
  const saved = useMemo(() => ({ ...BLANK, ...loadScreen<Memory>(me.user.id, "checkout") }), [me.user.id]);
  const memory = useRef<Memory>(saved);
  const [form, setForm] = useState({ day: saved.day, time: saved.time, name: saved.name, email: saved.email });
  const [shops, setShops] = useState<ShopChoice[] | null>(null);
  const [noArea, setNoArea] = useState(false);
  const [days, setDays] = useState<SlotDay[] | null>(null);
  const [holdAt, setHoldAt] = useState(0);
  const [now, setNow] = useState(0);
  const [holdText, setHoldText] = useState("");
  const [messages, setMessages] = useState("");
  const [totalText, setTotalText] = useState("");
  const [placing, setPlacing] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const holdButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const [bodyNode, setBodyNode] = useState<HTMLDivElement | null>(null);
  const attachBody = useCallback((node: HTMLDivElement | null) => {
    dialog.current = node;
    setBodyNode(node);
  }, []);
  const placingRef = useRef(false);
  const holding = useRef(false);
  const previousTotal = useRef<number | null>(null);
  const endedFor = useRef<string | null>(null);
  const minuteFor = useRef<string | null>(sessionStorage.getItem("tramela:minute"));
  const refocusTime = useRef(false);
  const restoredFocus = useRef(restored || saved.focus !== null);
  const scrolled = useRef(false);
  const timeGroup = useRef<HTMLDivElement | null>(null);
  const shopGroup = useRef<HTMLDivElement | null>(null);
  const checkedAt = useRef(0);

  const remember = (patch: Partial<Memory>) => {
    memory.current = { ...memory.current, ...patch };
    saveScreen(me.user.id, "checkout", memory.current);
  };
  const update = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    remember(patch);
  };

  // ---- reading the server: the cart, the shops, the offered slots ----
  const readSlots = useCallback((shopId: string) => {
    api<{ days: SlotDay[] }>("GET", `/api/stores/${shopId}/slots`).then((answer) => {
      const wanted = memory.current.time;
      const day = answer.days.find((candidate) => candidate.date === memory.current.day);
      if (wanted && !day?.slots.some((slot) => slot.start_utc === wanted)) {
        refocusTime.current = (document.activeElement as HTMLElement | null)?.dataset.focusId?.startsWith("time:") ?? false;
        setForm((current) => ({ ...current, time: "" }));
        remember({ time: "" });
        setMessages(SLOT_GONE_COPY);
      }
      setDays(answer.days);
    }, () => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readAll = useCallback(() => {
    api<Cart>("GET", "/api/cart").then((answer) => {
      apply(answer);
      setHoldAt(performance.now());
      checkedAt.current = performance.now();
      if (answer.store_id) readSlots(answer.store_id);
    }, () => undefined);
    api<{ shops: ShopChoice[] }>("GET", "/api/cart/shops").then((answer) => {
      setNoArea(false);
      setShops(answer.shops);
    }, (error: unknown) => {
      if (error instanceof ApiFailure && error.status === 422) {
        setNoArea(true);
        setShops([]);
        setMessages(NO_AREA_COPY);
      }
    });
  }, [apply, readSlots]);

  useEffect(() => {
    if (open) readAll();
  }, [open, readAll]);
  useInterval(readAll, POLL_MS, open);
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("focus", readAll);
    return () => window.removeEventListener("focus", readAll);
  }, [open, readAll]);

  // ---- the hold countdown follows the server's latest answer, never the device clock ----
  const hold: Hold | null = cart?.hold ?? null;
  const live = hold !== null && hold.status === "active";
  useInterval(() => setNow(performance.now()), 250, open && live);
  const shown = live && hold ? Math.max(0, Math.min(hold.seconds_left, hold.seconds_left - Math.floor((now - holdAt) / 1000))) : 0;
  const waiting = live && shown === 0;
  const windowSeconds = hold ? Math.round((Date.parse(hold.expires_at) - Date.parse(hold.created_at)) / 1000) : 1;
  const holdState = !hold ? null : cart && !live ? hold.status : waiting ? "checking" : "active";

  useEffect(() => {
    if (!hold) return;
    if (hold.status === "active" && shown > 0 && shown <= MINUTE && minuteFor.current !== hold.id) {
      minuteFor.current = hold.id;
      sessionStorage.setItem("tramela:minute", hold.id);
      setHoldText("One minute left on your hold.");
    }
    if (waiting) setHoldText("Checking your hold...");
    if (hold.status === "released" && endedFor.current !== hold.id) {
      endedFor.current = hold.id;
      setHoldText(ENDED_COPY);
      const active = document.activeElement as HTMLElement | null;
      if (active?.dataset.focusId === "hold" || active?.dataset.focusId === "place") refocusHold.current = true;
    }
  }, [hold, shown, waiting]);

  const refocusHold = useRef(false);
  useEffect(() => {
    if (waiting) readAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);
  useEffect(() => {
    if (refocusHold.current && hold?.status === "released") {
      refocusHold.current = false;
      dialog.current?.querySelector<HTMLElement>('[data-focus-id="hold"]')?.focus();
    }
  }, [hold]);

  // ---- the total beneath an open checkout counts in place and is announced once ----
  useEffect(() => {
    if (!cart) return;
    if (previousTotal.current !== null && previousTotal.current !== cart.total_cents) setTotalText(cartTotalCopy(cart.total_cents));
    previousTotal.current = cart.total_cents;
  }, [cart]);

  // ---- focus: a chosen time that vanished, the first focus, and a restored focus ----
  useEffect(() => {
    if (refocusTime.current && days) {
      refocusTime.current = false;
      (timeGroup.current?.querySelector<HTMLElement>("input") ?? timeGroup.current)?.focus();
    }
  }, [days, form.time]);

  useEffect(() => {
    const root = dialog.current;
    if (!open || !root || shops === null || !cart || (cart.store_id !== null && days === null)) return;
    if (restoredFocus.current) {
      restoredFocus.current = false;
      if (memory.current.focus && focusById(root, memory.current.focus)) {
        // a restored control keeps its focus
      } else focusFirst(root);
    } else if (!root.contains(document.activeElement) || document.activeElement === root) focusFirst(root);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shops === null, cart === null, days === null]);

  // a restored scroll position is applied as soon as the content is tall enough to hold it
  useLayoutEffect(() => {
    const scroller = dialog.current?.parentElement;
    if (scrolled.current || !open || !scroller || memory.current.scroll <= 0) return;
    if (scroller.scrollHeight - scroller.clientHeight >= memory.current.scroll) {
      scrolled.current = true;
      scroller.scrollTop = memory.current.scroll;
    }
  });

  function focusFirst(root: HTMLElement) {
    (shopGroup.current?.querySelector<HTMLElement>("input:checked, input") ?? shopGroup.current)?.focus();
    void root;
  }

  useEffect(() => {
    const scroller = bodyNode?.parentElement;
    if (!open || !scroller) return undefined;
    const record = () => remember({ scroll: scroller.scrollTop });
    scroller.addEventListener("scroll", record);
    window.addEventListener("pagehide", record);
    return () => {
      scroller.removeEventListener("scroll", record);
      window.removeEventListener("pagehide", record);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bodyNode]);

  // ---- shop, hold ----
  async function chooseShop(shopId: string) {
    update({ day: "", time: "" });
    setDays(null);
    try {
      apply(await api<Cart>("PUT", "/api/cart/store", { store_id: shopId }));
      remember({ placement: null });
      setHoldAt(performance.now());
      readSlots(shopId);
    } catch {
      setMessages(ERROR_COPY);
    }
  }

  async function takeHold() {
    if (holding.current || !cart) return;
    holding.current = true;
    setHoldText("Holding your items...");
    try {
      await api<Hold>("POST", "/api/holds", {});
      setHoldText(`Items held at ${cart.store_name}.`);
      setMessages("");
      readAll();
    } catch (error) {
      setHoldText("");
      if (error instanceof ApiFailure && error.code === "stock_conflict") {
        const info = { sku: String(error.body.sku), remaining: Number(error.body.remaining) };
        setConflict(info);
        setConflictOpen(true);
        setMessages(`Only ${info.remaining} left at ${cart.store_name}.`);
      } else if (error instanceof ApiFailure && error.code === "store_suspended") {
        setMessages(`${cart.store_name} is not taking orders right now.`);
      } else {
        setMessages(ERROR_COPY);
        readAll();
      }
    }
    holding.current = false;
  }

  async function releaseHold() {
    if (!hold) return;
    try {
      await api<Hold>("DELETE", `/api/holds/${hold.id}`);
      remember({ placement: null });
    } catch {
      setMessages(ERROR_COPY);
    }
    setHoldText("");
    readAll();
  }

  async function removeConflictLine() {
    if (!conflict) return;
    setConflictOpen(false);
    try {
      apply(await api<Cart>("PUT", `/api/cart/lines/${conflict.sku}`, { quantity: 0 }));
    } catch {
      setMessages(ERROR_COPY);
    }
  }

  // ---- placing the order: one key per distinct body, kept across reloads and a session end ----
  async function place() {
    if (placingRef.current) return;
    const previous = memory.current.placement;
    // With no hold in the cart, a sent placement may be what converted it (its answer was lost): only its own key and body can fetch that answer.
    const body = hold
      ? JSON.stringify({ hold_id: hold.id, slot_start_utc: form.time, customer: { name: form.name, email: form.email } })
      : previous?.body;
    if (body === undefined) {
      setMessages(ERROR_COPY);
      return;
    }
    const placement = previous && previous.body === body ? previous : { key: newRequestKey(), body };
    remember({ placement });
    placingRef.current = true;
    setPlacing(true);
    setMessages("Placing your order...");
    try {
      const order = await api<Order>("POST", "/api/orders", JSON.parse(body), { "Request-Key": placement.key });
      remember({ placement: null, day: "", time: "", name: "", email: "" });
      sessionStorage.setItem(orderMessageKey(order.id), placedCopy(order));
      navigate(`/orders/${order.id}`);
    } catch (error) {
      placingRef.current = false;
      setPlacing(false);
      if (error instanceof ApiFailure && error.code === "request_in_progress") setMessages("Your order is still being placed. Wait a moment.");
      else if (error instanceof ApiFailure && error.code === "slot_unavailable") {
        setMessages(SLOT_GONE_COPY);
        readAll();
      } else if (error instanceof ApiFailure && error.code === "hold_expired") {
        setMessages(ENDED_COPY);
        refocusHold.current = true;
        readAll();
      } else {
        if (error instanceof ApiFailure && error.code === "request_key_reuse") remember({ placement: null });
        setMessages(ERROR_COPY);
      }
    }
  }

  const day = days?.find((candidate) => candidate.date === form.day);
  const lines = cart?.lines ?? [];
  const placeNote = placing ? "Placing your order..." : undefined;

  return (
    <>
      <Overlay
        open={open} restored={restored} role="dialog" label="Checkout" onClose={onClose} opener={opener} className="dialog checkout" initialFocus={null}
        onState={() => undefined} keepFocus
      >
        <div
          ref={attachBody} className="checkout-body"
          onFocusCapture={(event) => remember({ focus: focusIdOf(event) })}
        >
          <h2>Checkout</h2>
          <fieldset className="group">
            <legend className="field-label">Collection shop</legend>
            <div ref={shopGroup} role="radiogroup" aria-label="Collection shop" tabIndex={-1}>
              {(shops ?? []).map((shop) => (
                <label key={shop.store_id} className="radio">
                  <input
                    type="radio" name="shop" checked={cart?.store_id === shop.store_id} data-focus-id={`shop:${shop.store_id}`}
                    onChange={() => void chooseShop(shop.store_id)}
                  />
                  <span>{`${shop.name}, ${formatKm(shop.distance_km)} km`}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="hold-row">
            {!noArea && cart?.store_id ? (
              hold?.status === "active" ? (
                <button type="button" className="btn" data-focus-id="hold" onClick={() => void releaseHold()}>Release hold</button>
              ) : hold?.status === "released" ? (
                <button ref={holdButton} type="button" className="btn" data-focus-id="hold" onClick={() => void takeHold()}>Hold again</button>
              ) : (
                <button ref={holdButton} type="button" className="btn" data-focus-id="hold" onClick={() => void takeHold()}>Hold items</button>
              )
            ) : null}
          </div>
          {hold ? (
            <div
              className="hold-timer" role="timer" aria-label="Hold time left" data-seconds-left={shown}
              data-hold-fraction={(shown / windowSeconds).toFixed(3)} data-hold-state={holdState ?? "checking"}
            >
              <span className="countdown">{formatCountdown(shown)}</span>
              <span className="meter" aria-hidden="true"><span className="bar" style={{ transform: `scaleX(${Math.min(1, shown / windowSeconds)})` }} /></span>
            </div>
          ) : null}
          <Status label="Hold status" text={holdText} />
          <fieldset className="group">
            <legend className="field-label">Collection day</legend>
            <div role="radiogroup" aria-label="Collection day" tabIndex={-1}>
              {(days ?? []).map((entry) => (
                <label key={entry.date} className="radio">
                  <input
                    type="radio" name="day" checked={form.day === entry.date} data-focus-id={`day:${entry.date}`}
                    onChange={() => update({ day: entry.date, time: "" })}
                  />
                  <span>{`${weekdayName(entry.date)}, ${entry.date}`}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="group">
            <legend className="field-label">Collection time</legend>
            <div ref={timeGroup} role="radiogroup" aria-label="Collection time" tabIndex={-1}>
              {(day?.slots ?? []).map((slot) => (
                <label key={slot.start_utc} className="radio">
                  <input
                    type="radio" name="time" checked={form.time === slot.start_utc} data-focus-id={`time:${slot.start_utc}`}
                    onChange={() => update({ time: slot.start_utc })}
                  />
                  <span>{slot.start_local}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field-label" htmlFor="checkout-name">Full name</label>
          <input id="checkout-name" className="field" type="text" value={form.name} data-focus-id="name" autoComplete="name" onChange={(event) => update({ name: event.target.value })} />
          <label className="field-label" htmlFor="checkout-email">Email</label>
          <input id="checkout-email" className="field" type="email" value={form.email} data-focus-id="email" autoComplete="email" onChange={(event) => update({ email: event.target.value })} />
          <h3>Your items</h3>
          <ul className="checkout-lines" aria-label="Checkout lines">
            {lines.map((line) => (
              <li key={line.sku}>
                {`${line.name} × ${line.quantity}`}
                {line.status === "short" ? <span className="short">{` Only ${line.available ?? 0} left at ${cart?.store_name}.`}</span> : null}
              </li>
            ))}
          </ul>
          <p className="total-line">Total {cart ? <Figure kind="checkout-total" value={cart.total_cents} unit="euro" className="big" /> : null}</p>
          <Status label="Checkout total" text={totalText} />
          <Status label="Checkout messages" text={noArea ? NO_AREA_COPY : cart?.store_id && days && days.length === 0 && !messages ? NO_SLOTS_COPY : messages} className="status-line alertish" />
          <div className="dialog-actions">
            <PausedButton
              className="btn" paused={down} pauseCopy={PAUSE_COPY.placeOrder} describedBy={placeNote} data-focus-id="place"
              busy={placing} onPaused={setMessages} onPress={() => void place()}
            >
              Place order
            </PausedButton>
            <button type="button" className="btn" data-focus-id="close" onClick={onClose}>Close checkout</button>
          </div>
        </div>
      </Overlay>
      <Overlay
        open={conflictOpen && conflict !== null} role="alertdialog" label="Stock changed" onClose={() => setConflictOpen(false)} opener={holdButton}
        className="dialog stock-changed" initialFocus="[data-first]"
      >
        <div>
          <h2>Stock changed</h2>
          <p>{`Only ${conflict?.remaining ?? 0} left at ${cart?.store_name}.`}</p>
          <div className="dialog-actions">
            <button type="button" className="btn" data-first="" onClick={() => void removeConflictLine()}>Remove line</button>
            <button type="button" className="btn" onClick={() => setConflictOpen(false)}>Back to checkout</button>
          </div>
        </div>
      </Overlay>
    </>
  );
}
