import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { BILLING_COUNTRIES, seedHash, seedUniform, vatCents, vatRate } from "../../shared/rules";
import { api, IdempotentAction, type EditionStatus, type Editions, type Order } from "../api";
import { copy, money } from "../copy";
import { draw, drawStill, webglAvailable } from "../gl/renderer";
import { Link, signInHref } from "../router";
import { useReducedMotion, useSession, useViewport } from "../session";
import { LiveCanvas } from "./LiveCanvas";
import { Dialog, ErrorSummary, FieldError, LiveStatus, useAnnouncer, type Announcer } from "./ui";

// The Edition Lens: pointer, touch and keyboard choose edition N of a run, the lens renders N's seed
// variation, and a hold opens the checkout sheet. Hold times always come from the server.

interface StagePiece {
  slug: string;
  title: string;
  editionCount: number;
  priceCents: number;
}

const TAP_SLOP = 8;

export function EditionStage({
  piece,
  initial,
  variant,
  onEditionChange,
}: {
  piece: StagePiece;
  initial: number;
  variant: "hero" | "piece";
  onEditionChange?: (n: number, status: EditionStatus) => void;
}) {
  const M = piece.editionCount;
  const reduced = useReducedMotion();
  const viewport = useViewport();
  const { me, loaded } = useSession();
  const announcer = useAnnouncer();
  const stage = useRef<HTMLDivElement>(null);
  const lensCanvas = useRef<HTMLCanvasElement>(null);
  const lensBox = useRef<HTMLDivElement>(null);
  const numeral = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(() => Math.min(Math.max(1, initial), M));
  const [moved, setMoved] = useState(false);
  const [statuses, setStatuses] = useState<Map<number, { status: EditionStatus; mine: boolean }>>(new Map());
  const [order, setOrder] = useState<Order | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const start = { x: M <= 1 ? 0.5 : (Math.min(Math.max(1, initial), M) - 1) / (M - 1), y: 0.5 };
  const target = useRef(start);
  const shown = useRef(start);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const holdAction = useRef(new IdempotentAction());
  const locked = order !== null && (order.state === "held" || order.state === "paying");
  const lensSize = viewport === "phone" ? 176 : 240;
  const nRef = useRef(n);
  nRef.current = n;
  const redrawLens = useRef<() => void>(() => undefined);
  const holdStart = useRef(0);
  const { say } = announcer;

  const refresh = useCallback(async () => {
    const result = await api<Editions>("GET", `/api/pieces/${piece.slug}/editions`);
    if (result.ok) setStatuses(new Map(result.data.editions.map((e) => [e.number, { status: e.status, mine: e.held_by_you }])));
  }, [piece.slug]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const statusOf = (number: number): EditionStatus => statuses.get(number)?.status ?? "available";
  const status = statusOf(n);
  const ring = order && order.edition === n && locked ? "mine" : statuses.get(n)?.mine ? "mine" : status;

  useEffect(() => onEditionChange?.(n, status), [n, status, onEditionChange]);

  // the URL follows N without adding history entries
  useEffect(() => {
    if (!moved) return;
    const url = new URL(window.location.href);
    url.searchParams.set("edition", String(n));
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [n, moved]);

  // numeral jump: slightly larger back to normal in about a sixth of a second
  useEffect(() => {
    if (!moved || reduced) return;
    numeral.current?.animate([{ transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }, [n, moved, reduced]);

  const placeFor = useCallback((number: number) => ({ x: M <= 1 ? 0.5 : (number - 1) / (M - 1), y: 0.5 }), [M]);

  // the lens: its position eases toward the target (or jumps under reduced motion); it renders N's seed
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const started = last;
    const paint = () => {
      const box = stage.current;
      const lens = lensBox.current;
      const canvas = lensCanvas.current;
      if (!box || !lens || !canvas) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (reduced) shown.current = { ...target.current };
      else {
        const k = 1 - Math.exp(-dt / 0.11);
        shown.current = {
          x: shown.current.x + (target.current.x - shown.current.x) * k,
          y: shown.current.y + (target.current.y - shown.current.y) * k,
        };
      }
      const width = box.clientWidth;
      const height = box.clientHeight;
      const r = lensSize / 2;
      const cx = Math.min(Math.max(shown.current.x * width, r), width - r);
      const cy = Math.min(Math.max(shown.current.y * height, r), height - r);
      lens.style.transform = `translate(${cx - r}px, ${cy - r}px)`;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const size = Math.round(lensSize * ratio);
      if (canvas.width !== size) {
        canvas.width = size;
        canvas.height = size;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      const drawn = draw(context, {
          program: { kind: "house", slug: piece.slug },
          width: Math.round(width * ratio),
          height: Math.round(height * ratio),
          time: reduced ? 0 : (now - started) / 1000,
          seed: seedUniform(seedHash(piece.slug, nRef.current)),
          uniforms: {},
          crop: { x: Math.round((cx - r) * ratio), y: Math.round((cy - r) * ratio), w: size, h: size },
        });
      if (!drawn && !webglAvailable()) drawStill(context, `${piece.slug}:${nRef.current}`, size, size);
    };
    // like every canvas, the lens stops drawing while the stage is fully off screen
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    if (stage.current) observer.observe(stage.current);
    const loop = () => {
      if (visible) paint();
      frame = requestAnimationFrame(loop);
    };
    redrawLens.current = paint;
    paint();
    if (!reduced) frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reduced, lensSize, piece.slug]);

  useEffect(() => redrawLens.current(), [n, ring]);

  const choose = useCallback(
    (number: number, place = true) => {
      const next = Math.min(Math.max(1, number), M);
      setN(next);
      setMoved(true);
      if (place) target.current = placeFor(next);
      nRef.current = next;
      redrawLens.current();
    },
    [M, placeFor],
  );

  const fromPointer = (event: PointerEvent) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const fx = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    const fy = Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1);
    target.current = { x: fx, y: fy };
    choose(Math.round(1 + fx * (M - 1)), false);
    if (reduced) redrawLens.current();
  };

  // ---- holds ----

  const signInToHold = (number: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("edition", String(number));
    window.location.assign(signInHref(url.pathname + url.search));
  };

  const askForHold = async () => {
    const wanted = nRef.current;
    if (locked && order && (order.edition === wanted || order.state === "paying")) {
      choose(order.edition);
      setSheetOpen(true);
      return;
    }
    if (!loaded || requesting) return;
    if (!me) return signInToHold(wanted);
    setRequesting(true);
    const result = await holdAction.current.send<{ order: Order }>("POST", `/api/pieces/${piece.slug}/editions/${wanted}/holds`, undefined);
    setRequesting(false);
    if (result.ok) {
      const held = result.data.order;
      holdStart.current = held.seconds_left ?? 0;
      setOrder(held);
      setSecondsLeft(held.seconds_left ?? 0);
      choose(held.edition);
      say(copy.holdGranted(held.edition, M, held.seconds_left ?? 0));
      setSheetOpen(true);
      void refresh();
      return;
    }
    if (result.status === 401) return signInToHold(wanted);
    if (result.error.code === "edition_taken") {
      const next = typeof result.error.next_free === "number" ? result.error.next_free : null;
      say(next === null ? copy.allTaken : copy.taken(wanted, next));
      if (next !== null) choose(next);
      void refresh();
      return;
    }
    if (result.status === 403) say("Only collector accounts can hold editions.");
    else if (result.error.code === "own_piece") say("This is your own run; collectors choose its editions.");
    else say(result.error.message);
  };

  // reloading a held piece page locks the lens on the held number and reopens the sheet
  useEffect(() => {
    if (!me?.roles.includes("collector")) return;
    void api<{ order: Order }>("GET", `/api/orders/current?piece=${encodeURIComponent(piece.slug)}`).then((result) => {
      if (!result.ok) return;
      const current = result.data.order;
      holdStart.current = current.seconds_left ?? 0;
      setOrder(current);
      setSecondsLeft(current.seconds_left ?? 0);
      choose(current.edition);
      setSheetOpen(true);
    });
  }, [me, piece.slug, choose]);

  // the hold's countdown ticks every second from the server's seconds_left and resyncs every 30 seconds
  const heldId = order?.state === "held" ? order.id : null;
  useEffect(() => {
    if (!heldId) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      setSecondsLeft((s) => Math.max(0, s - 1));
      if (ticks % 30 === 0) {
        void api<{ order: Order }>("GET", `/api/orders/${heldId}`).then((result) => {
          if (result.ok && result.data.order.state === "held") setSecondsLeft(result.data.order.seconds_left ?? 0);
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [heldId]);

  const heldEdition = order?.state === "held" ? order.edition : null;
  useEffect(() => {
    if (heldEdition === null) return;
    if (secondsLeft <= 0) {
      say(copy.holdExpired(heldEdition));
      setOrder(null);
      setSheetOpen(false);
      void refresh();
      return;
    }
    if (secondsLeft >= holdStart.current) return;
    if (secondsLeft % 60 === 0) say(copy.minutesLeft(secondsLeft / 60, heldEdition));
    else if (secondsLeft === 30) say(copy.thirtySeconds(heldEdition));
  }, [secondsLeft, heldEdition, say, refresh]);

  // after Pay: re-read the order every 2 seconds until Kill Bill's answer shows
  const payingId = order?.state === "paying" || order?.state === "paid" || order?.state === "invoiced" ? order.id : null;
  useEffect(() => {
    if (!payingId) return;
    let said = "";
    const timer = window.setInterval(async () => {
      const result = await api<{ order: Order }>("GET", `/api/orders/${payingId}`);
      if (!result.ok) return;
      const current = result.data.order;
      let line = "";
      if (current.state === "receipted") line = copy.confirmed(current.edition, current.edition_count);
      else if (current.state === "failed") line = copy.paymentFailed(current.edition);
      else if (current.state === "paid" && current.invoice_status === "pending" && current.invoice_number) line = copy.invoicePending(current.invoice_number);
      if (line && line !== said) {
        said = line;
        say(line);
      }
      setOrder(current);
      if (current.state === "receipted" || current.state === "failed") void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [payingId, say, refresh]);

  const release = async () => {
    if (!order) return;
    await api("DELETE", `/api/orders/${order.id}/hold`);
    setOrder(null);
    setSheetOpen(false);
    void refresh();
  };

  // ---- input ----

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    if (!locked) fromPointer(event);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const down = pointer.current;
    if (down && down.id === event.pointerId && Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP) down.moved = true;
    if (locked) return;
    if (event.pointerType === "mouse" || down) fromPointer(event);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const down = pointer.current;
    pointer.current = null;
    if (!down || down.id !== event.pointerId || down.moved) return;
    void askForHold();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void askForHold();
      return;
    }
    // a hold stops the lens following the pointer; the keyboard may still step to another number,
    // whose hold would replace this one
    if (order?.state === "paying") return;
    if (event.key in steps) choose(nRef.current + (steps[event.key] ?? 0));
    else if (event.key === "Home") choose(1);
    else if (event.key === "End") choose(M);
    else return;
    event.preventDefault();
  };

  const caption = moved ? `of ${M} · ${status}` : `of ${M} · move to choose`;

  return (
    <div className={`edition-stage stage-${variant}`}>
      <div
        ref={stage}
        className="stage-surface"
        role="slider"
        tabIndex={0}
        aria-label="Edition"
        aria-valuemin={1}
        aria-valuemax={M}
        aria-valuenow={n}
        aria-valuetext={`Edition ${n} of ${M}, ${status}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pointer.current = null)}
        onKeyDown={onKeyDown}
      >
        <LiveCanvas
          program={{ kind: "house", slug: piece.slug }}
          slug={piece.slug}
          still={reduced}
          scale={variant === "hero" ? 0.6 : 0.8}
          className={`stage-canvas ${reduced ? "" : "canvas-fade"}`}
          scene={() => ({ seed: 0, uniforms: {}, time: (t) => t })}
          noteFallback
        />
        <div
          ref={lensBox}
          className={`lens lens-${ring} ${locked ? "is-locked" : ""} ${variant === "hero" && !moved ? "is-waiting" : ""}`}
          style={{ width: lensSize, height: lensSize }}
          aria-hidden="true"
        >
          <canvas ref={lensCanvas} className="lens-canvas" />
        </div>
      </div>
      <div className="edition-readout" aria-hidden="true">
        <span ref={numeral} className="edition-numeral">{n}</span>
        <span className="edition-caption">{caption}</span>
      </div>
      <LiveStatus label="Checkout status" announcer={announcer} className="checkout-status" />
      {order ? (
        <CheckoutSheet
          open={sheetOpen}
          order={order}
          piece={piece}
          secondsLeft={secondsLeft}
          announcer={announcer}
          returnFocus={stage}
          onClose={() => setSheetOpen(false)}
          onRelease={() => void release()}
          onOrder={(next) => setOrder(next)}
        />
      ) : null}
    </div>
  );
}

function CheckoutSheet({
  open,
  order,
  piece,
  secondsLeft,
  announcer,
  returnFocus,
  onClose,
  onRelease,
  onOrder,
}: {
  open: boolean;
  order: Order;
  piece: StagePiece;
  secondsLeft: number;
  announcer: Announcer;
  returnFocus: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onRelease: () => void;
  onOrder: (order: Order) => void;
}) {
  const ids = { billing_name: useId(), email: useId(), billing_country: useId() };
  const [name, setName] = useState(order.billing_name ?? "");
  const [email, setEmail] = useState(order.email ?? "");
  const [country, setCountry] = useState(order.billing_country ?? "US");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pay = useRef(new IdempotentAction());
  const { say } = announcer;
  const rate = vatRate(country);
  const vat = vatCents(piece.priceCents, rate);
  const gross = piece.priceCents + vat;
  const latest = announcer.messages[announcer.messages.length - 1]?.text;
  const done = order.state === "receipted";
  const paying = order.state !== "held";
  const heading = useMemo(() => `${piece.title} — edition ${order.edition} of ${piece.editionCount}`, [piece, order.edition]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await pay.current.send<{ order: Order }>("POST", `/api/orders/${order.id}/buy`, { billing_name: name, email, billing_country: country });
    setBusy(false);
    if (result.ok) {
      setFields({});
      onOrder(result.data.order);
      say(copy.paying);
      return;
    }
    if (result.status === 422) {
      setFields(result.error.fields ?? {});
      return;
    }
    setFields({});
    if (result.status === 503) say(copy.paymentsDown);
    else if (result.error.code === "hold_expired") say(copy.holdExpired(order.edition));
    else say(result.error.message);
  };

  return (
    <Dialog open={open} label="Checkout" onClose={onClose} returnFocus={returnFocus} variant="sheet" initialFocus="[data-autofocus]">
      <p className="sheet-line">{heading}</p>
      {order.state === "held" ? <p className="sheet-timer">{copy.heldFor(secondsLeft)}</p> : null}
      {latest ? <p className="sheet-status" aria-hidden="true">{latest}</p> : null}
      {done ? (
        <Link to="/library" className="button button-accent">
          Open library
        </Link>
      ) : (
        <form className="sheet-form" onSubmit={(event) => void submit(event)} noValidate>
          <ErrorSummary fields={fields} ids={ids} />
          <label htmlFor={ids.billing_name}>Billing name</label>
          <input id={ids.billing_name} data-autofocus type="text" autoComplete="name" value={name} disabled={paying}
            aria-invalid={Boolean(fields.billing_name)} aria-describedby={fields.billing_name ? `${ids.billing_name}-error` : undefined}
            onChange={(e) => setName(e.target.value)} />
          <FieldError id={`${ids.billing_name}-error`} message={fields.billing_name} />
          <label htmlFor={ids.email}>Email</label>
          <input id={ids.email} type="email" autoComplete="email" value={email} disabled={paying}
            aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? `${ids.email}-error` : undefined}
            onChange={(e) => setEmail(e.target.value)} />
          <FieldError id={`${ids.email}-error`} message={fields.email} />
          <label htmlFor={ids.billing_country}>Billing country</label>
          <select id={ids.billing_country} value={country} disabled={paying}
            aria-invalid={Boolean(fields.billing_country)} aria-describedby={fields.billing_country ? `${ids.billing_country}-error` : undefined}
            onChange={(e) => setCountry(e.target.value)}>
            {BILLING_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <FieldError id={`${ids.billing_country}-error`} message={fields.billing_country} />
          <dl className="price-lines">
            <div><dt>Net</dt><dd>{money(piece.priceCents)}</dd></div>
            <div><dt>VAT {rate}%</dt><dd>{money(vat)}</dd></div>
            <div className="price-total"><dt>Total</dt><dd>{money(gross)}</dd></div>
          </dl>
          {paying ? null : (
            <div className="sheet-actions">
              <button type="submit" className="button button-accent" disabled={busy}>
                Pay {money(gross)}
              </button>
              <button type="button" className="button button-ghost" onClick={onRelease}>
                Release hold
              </button>
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
}
