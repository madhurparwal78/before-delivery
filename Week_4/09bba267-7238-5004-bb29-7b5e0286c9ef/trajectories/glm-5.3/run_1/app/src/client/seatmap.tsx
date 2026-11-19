import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cart, Performance, Seat } from '../shared/api-types';
import { api } from './api';
import { announce } from './live';
import { Dialog } from './dialog';
import { navigate, TopBar, UpdatesRegion } from './shell';
import { SeatGridSvg } from './seat-grid';
import {
  SECTIONS,
  addressToPath,
  announceHold,
  formatCents,
  formatCountdown,
  parseAddress,
  requestHold,
  seatLabelOf,
  seatSelectable,
  type SectionCode,
  type SeatMapAddress,
} from './seat-map-core';

export function SeatMapPage({ path }: { path: string }) {
  const address = useMemo(() => parseAddress(path), [path]);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const [holdPending, setHoldPending] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [sightlineSeatId, setSightlineSeatId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const holdButtonRef = useRef<HTMLButtonElement>(null);
  const checkoutButtonRef = useRef<HTMLButtonElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const performanceId = address?.performanceId ?? null;
  const exchangeMode = address?.exchangeTicketId !== undefined;

  // At desktop width the Cart rail's top lines up with the map frame's top.
  useEffect(() => {
    let raf = 0;
    const alignRail = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const layout = layoutRef.current;
        const frame = frameRef.current;
        if (!layout || !frame) return;
        const offset = frame.getBoundingClientRect().top - layout.getBoundingClientRect().top;
        const clamped = `${Math.max(0, offset)}px`;
        if (layout.style.getPropertyValue('--rail-offset') !== clamped) {
          layout.style.setProperty('--rail-offset', clamped);
        }
      });
    };
    alignRail();
    window.addEventListener('resize', alignRail);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', alignRail);
    };
  });

  useEffect(() => {
    setSelection([]);
    setHoveredSeat(null);
    setSightlineSeatId(null);
    setNotice('');
    void loadAll();
    const interval = window.setInterval(() => void loadAll(), 2000);
    return () => window.clearInterval(interval);
  }, [performanceId]);

  const loadAll = useCallback(async () => {
    if (!performanceId) return;
    const perfResult = await api<Performance>(`/api/performances/${performanceId}`);
    if (!perfResult.ok) {
      setNotFound(true);
      return;
    }
    setPerformance(perfResult.value);
    const seatsResult = await api<{ seats: Seat[] }>(`/api/performances/${performanceId}/seats`);
    if (seatsResult.ok) {
      setSeats(seatsResult.value.seats);
    }
    const cartResult = await api<Cart>(`/api/performances/${performanceId}/cart`);
    if (cartResult.ok) {
      const nextCart = cartResult.value;
      setCart((previous) => {
        const hadSeats = previous !== null && previous.seats.length > 0;
        const nowEmpty = nextCart.seats.length === 0 && nextCart.secondsLeft === null;
        if (hadSeats && nowEmpty) {
          setNotice('Your hold ended and the seats were released.');
          announce('Your hold ended and the seats were released.');
        }
        return nextCart;
      });
    }
  }, [performanceId]);

  const seatById = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);

  const updateAddress = useCallback(
    (changes: Partial<SeatMapAddress>) => {
      if (!address) return;
      navigate(addressToPath({ ...address, ...changes }), true);
    },
    [address],
  );

  const toggleSeat = useCallback(
    (seatId: string) => {
      const seat = seatById.get(seatId);
      if (!seat || !seatSelectable(seat, address?.tier ?? 'all')) return;
      setSelection((current) =>
        current.includes(seatId) ? current.filter((id) => id !== seatId) : [...current, seatId],
      );
    },
    [seatById, address?.tier],
  );

  const onHold = async () => {
    if (!address || exchangeMode) return;
    setHoldPending(true);
    const { outcome, cart: nextCart } = await requestHold(address.performanceId, selection);
    setHoldPending(false);
    if (nextCart) setCart(nextCart);
    announceHold(outcome);
    if (outcome.kind === 'none-held' || outcome.kind === 'some-held') {
      setNotice('Someone else got there first. We kept the rest of your selection.');
      const taken = outcome.taken;
      setSelection((current) => current.filter((id) => !taken.includes(id)));
    } else if (outcome.kind === 'sales-closed') {
      setNotice('Sales for this performance have closed.');
    } else if (outcome.kind === 'all-held') {
      setNotice('');
      setSelection([]);
    }
    void loadAll();
  };

  const onRelease = async (seatId: string) => {
    if (!performanceId) return;
    const result = await api<{ cart: Cart }>(`/api/performances/${performanceId}/holds/${seatId}`, {
      method: 'DELETE',
    });
    if (result.ok) {
      setCart(result.value.cart);
      announce(`Released ${seatLabelOf(seatId)}.`);
      void loadAll();
    }
  };

  const switchSection = (section: SectionCode) => {
    if (!address || section === address.section) return;
    updateAddress({ section, seat: `${section}-A-15` });
  };

  const sightlineTarget = hoveredSeat ?? sightlineSeatId ?? address?.seat ?? null;
  const sightlineSeat = sightlineTarget ? seatById.get(sightlineTarget) ?? null : null;

  if (!address || notFound) {
    return (
      <div className="page">
        <TopBar active={null} />
        <UpdatesRegion />
        <main className="content">
          <h1>We couldn't find that page</h1>
        </main>
      </div>
    );
  }

  const soldOutTiers = (performance?.tiers ?? []).filter((t) => t.remaining === 0);

  return (
    <div className="page seatmap-page">
      <TopBar active="programme" />
      <UpdatesRegion />
      <main className="content seatmap">
        <div className="seatmap-layout" ref={layoutRef}>
          <div className="seatmap-main">
            <header className="performance-header">
              <h1>{performance?.title ?? ''}</h1>
              <p className="start-label">{performance?.startsAtVenue ?? ''}</p>
            </header>
            <div className="hall-key" aria-hidden="true">
              <svg viewBox="0 0 120 62" width="120" height="62">
                <line x1="24" y1="6" x2="96" y2="6" className="hall-key-stage" />
                {SECTIONS.map((section, index) => (
                  <path
                    key={section.code}
                    d={hallKeyArc(index)}
                    className={section.code === address.section ? 'hall-key-active' : 'hall-key-arc'}
                  />
                ))}
              </svg>
            </div>
            <div role="region" aria-label="Notice" className="notice">
              {exchangeMode && !notice ? 'Pick a new seat for your exchange, then choose Exchange to this seat.' : notice}
            </div>
            <div role="tablist" aria-label="Sections" className="sections">
              {SECTIONS.map((section) => (
                <button
                  key={section.code}
                  role="tab"
                  aria-selected={section.code === address.section}
                  tabIndex={section.code === address.section ? 0 : -1}
                  className={`tab ${section.code === address.section ? 'tab-selected' : ''}`}
                  onClick={() => switchSection(section.code)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const index = SECTIONS.findIndex((s) => s.code === section.code);
                    const delta = event.key === 'ArrowLeft' ? -1 : 1;
                    switchSection(SECTIONS[(index + delta + SECTIONS.length) % SECTIONS.length].code);
                  }}
                >
                  {section.name}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Price tier" className="tier-choice">
              <label className={`tier-radio ${address.tier === 'all' ? 'tier-selected' : ''}`}>
                <input
                  type="radio"
                  name="tier"
                  checked={address.tier === 'all'}
                  onChange={() => updateAddress({ tier: 'all' })}
                />
                <span>All tiers</span>
              </label>
              {(performance?.tiers ?? []).map((tier) => (
                <label key={tier.id} className={`tier-radio ${address.tier === tier.id ? 'tier-selected' : ''}`}>
                  <input
                    type="radio"
                    name="tier"
                    checked={address.tier === tier.id}
                    onChange={() => {
                      updateAddress({ tier: tier.id });
                      setSelection((current) =>
                        current.filter((id) => seatById.get(id)?.tierId === tier.id),
                      );
                    }}
                  />
                  <span>{tier.name}</span>
                  <span className="amount">{formatCents(tier.faceCents)}</span>
                  <span>{tier.remaining > 0 ? `${tier.remaining} left` : 'Sold out'}</span>
                </label>
              ))}
            </div>
            {performance?.salesOpen === false && <p className="sales-closed">Sales closed</p>}
            <div className="map-frame" ref={frameRef}>
              <SeatGridSvg
                section={address.section}
                seats={seatById}
                tiers={performance?.tiers ?? []}
                chosenTier={address.tier}
                selection={selection}
                activeSeat={address.seat}
                sightlineSeat={sightlineTarget ?? address.seat}
                onSeatActivate={(seatId) => {
                  updateAddress({ seat: seatId });
                  setSightlineSeatId(seatId);
                }}
                onSeatToggle={toggleSeat}
                onHover={setHoveredSeat}
                onSectionSwitch={switchSection}
                seatSelectable={(seat) => seatSelectable(seat, address.tier)}
              />
            </div>
            <div role="group" aria-label="Sightline" className="sightline-readout">
              {sightlineSeat ? (
                <>
                  <p className="sightline-angle">{sightlineSeat.offCentreDeg}° off centre</p>
                  <p className="sightline-distance">{sightlineSeat.stageDistanceM} m to stage</p>
                  {sightlineSeat.state === 'not_on_sale' && <p>Not on sale</p>}
                  {sightlineSeat.state !== 'on_sale' && sightlineSeat.state !== 'not_on_sale' && !sightlineSeat.mine && <p>Taken</p>}
                  {sightlineSeat.state === 'held' && sightlineSeat.mine && <p>Held by you</p>}
                  {sightlineSeat.state === 'sold' && sightlineSeat.mine && <p>Your ticket</p>}
                  {sightlineSeat.state === 'offered' && sightlineSeat.mine && <p>Offered to you</p>}
                </>
              ) : (
                <>
                  <p className="sightline-angle">0° off centre</p>
                  <p className="sightline-distance">0 m to stage</p>
                </>
              )}
            </div>
            <p className="selection-line">{selection.length} selected</p>
            {exchangeMode ? (
              <ExchangeControl
                disabled={selection.length !== 1 || !performance?.changesOpen}
                performance={performance}
                newSeatId={selection[0] ?? null}
                ticketId={address.exchangeTicketId}
                seatById={seatById}
              />
            ) : (
              <>
                <button
                  ref={holdButtonRef}
                  className="hold-button"
                  disabled={selection.length === 0 || holdPending || !performance?.salesOpen}
                  onClick={() => void onHold()}
                >
                  {holdPending ? 'Holding seats' : 'Hold selected seats'}
                </button>
                {performance?.salesOpen &&
                  soldOutTiers.map((tier) => (
                    <JoinWaitlistControl
                      key={tier.id}
                      performanceId={address.performanceId}
                      tierId={tier.id}
                      tierName={tier.name}
                    />
                  ))}
              </>
            )}
          </div>
          <aside role="region" aria-label="Cart" className="cart" id="cart">
            <h2 id="cart-heading">Cart</h2>
            {cart && cart.seats.length > 0 ? (
              <>
                <ul className="ledger">
                  {cart.seats.map((line) => (
                    <li key={line.seatId} className="ledger-line">
                      <span className="ledger-seat">{line.label}</span>
                      <span className="ledger-tier">{line.tierName}</span>
                      <span className="amount">{formatCents(line.faceCents)}</span>
                      <span className="amount">{formatCents(line.seatFeeCents)}</span>
                      <button className="release-button" onClick={() => void onRelease(line.seatId)}>
                        Release
                      </button>
                    </li>
                  ))}
                </ul>
                <LedgerTotals cart={cart} />
                {cart.secondsLeft !== null && (
                  <p role="timer" aria-label="Hold time left" className="countdown">
                    {formatCountdown(cart.secondsLeft)}
                  </p>
                )}
                <button ref={checkoutButtonRef} className="checkout-button" onClick={() => setCheckoutOpen(true)}>
                  Checkout
                </button>
              </>
            ) : (
              <p className="cart-empty">No seats held.</p>
            )}
          </aside>
        </div>
      </main>
      <CheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        performance={performance}
        cart={cart}
        onPaid={() => void loadAll()}
        openerRef={checkoutButtonRef}
      />
    </div>
  );
}

function LedgerTotals({ cart }: { cart: Cart }) {
  return (
    <dl className="ledger-totals">
      <div><dt>Face value</dt><dd className="amount">{formatCents(cart.faceCents)}</dd></div>
      <div><dt>Seat fees</dt><dd className="amount">{formatCents(cart.seatFeesCents)}</dd></div>
      <div><dt>Order fee</dt><dd className="amount">{formatCents(cart.orderFeeCents)}</dd></div>
      <div><dt>Total</dt><dd className="amount">{formatCents(cart.totalCents)}</dd></div>
    </dl>
  );
}

function JoinWaitlistControl({ performanceId, tierId, tierName: name }: { performanceId: string; tierId: string; tierName: string }) {
  const [open, setOpen] = useState(false);
  const [personName, setPersonName] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <>
      <button className="waitlist-button" onClick={() => setOpen(true)}>
        Join the waitlist for {name}
      </button>
      <Dialog label="Join the waitlist" open={open} onClose={() => setOpen(false)}>
        <h2>Join the waitlist</h2>
        <label className="field">
          <span>Full name</span>
          <input value={personName} onChange={(event) => setPersonName(event.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const result = await api<{ entry: { position: number | null } }>(
                `/api/performances/${performanceId}/tiers/${tierId}/waitlist`,
                { method: 'POST', body: { name: personName, email } },
              );
              setPending(false);
              if (result.ok) {
                announce(`You're on the waitlist for ${name}. Your place is ${result.value.entry.position}.`);
                setOpen(false);
                return;
              }
              if (result.error === 'tier_not_sold_out') {
                announce(`Seats are still on sale in ${name}.`);
                setOpen(false);
                return;
              }
              if (result.error === 'already_waiting') {
                announce(`This email is already on the waitlist for ${name}.`);
                setOpen(false);
                return;
              }
              if (result.error === 'sales_closed') {
                announce('Sales for this performance have closed.');
                setOpen(false);
                return;
              }
              announce('Check these details.');
            }}
          >
            {pending ? 'Joining' : 'Join waitlist'}
          </button>
          <button onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </Dialog>
    </>
  );
}

function CheckoutDialog({
  open,
  onClose,
  performance,
  cart,
  onPaid,
  openerRef,
}: {
  open: boolean;
  onClose: () => void;
  performance: Performance | null;
  cart: Cart | null;
  onPaid: () => void;
  openerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [personName, setPersonName] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [paymentNotice, setPaymentNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{ orderId: string; email: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef(`checkout-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (open) {
      setErrors({});
      setPaymentNotice('');
      window.setTimeout(() => nameRef.current?.focus(), 30);
    }
  }, [open]);

  const pay = async () => {
    if (!performance) return;
    setPending(true);
    const result = await api<{ order: { id: string } }>(`/api/performances/${performance.id}/checkout`, {
      method: 'POST',
      body: { name: personName, email },
      idempotencyKey: idempotencyKey.current,
    });
    setPending(false);
    if (result.ok) {
      setConfirmation({ orderId: (result.value as { order: { id: string } }).order.id, email });
      announce('Payment confirmed. Your tickets are issued.');
      return;
    }
    if (result.status === 422 && result.fields) {
      setErrors(result.fields);
      announce('Check these details.');
      return;
    }
    if (result.error === 'payment_declined') {
      setPaymentNotice('Your payment was declined. Your seats were released.');
      announce('Your payment was declined. Your seats were released.');
      return;
    }
    if (result.error === 'payments_unavailable') {
      setPaymentNotice('Payments are paused right now. Your seats stay held until your hold ends. Please try again shortly.');
      announce('Payments are paused right now. Your seats stay held until your hold ends. Please try again shortly.');
      return;
    }
    if (result.error === 'cart_empty') {
      announce('Your hold ended and the seats were released.');
      onClose();
      onPaid();
      return;
    }
    if (result.error === 'sales_closed') {
      announce('Sales for this performance have closed.');
      onClose();
      onPaid();
    }
  };

  return (
    <Dialog
      label="Checkout"
      open={open}
      onClose={() => {
        setConfirmation(null);
        setPaymentNotice('');
        onClose();
      }}
      closeBlocked={pending || confirmation !== null}
      onClosedFocusRef={openerRef}
      fallbackFocusId="cart-heading"
    >
      {confirmation ? (
        <div className="checkout-confirmation">
          <h2>You're in</h2>
          <p>Order {confirmation.orderId}</p>
          <div role="region" aria-label="Receipt" className="receipt-panel">
            {cart && (
              <>
                <ul className="ledger">
                  {cart.seats.map((line) => (
                    <li key={line.seatId} className="ledger-line">
                      <span className="ledger-seat">{line.label}</span>
                      <span className="ledger-tier">{line.tierName}</span>
                      <span className="amount">{formatCents(line.faceCents)}</span>
                      <span className="amount">{formatCents(line.seatFeeCents)}</span>
                    </li>
                  ))}
                </ul>
                <LedgerTotals cart={cart} />
              </>
            )}
          </div>
          <p className="receipt-line">A receipt is on its way to {confirmation.email}.</p>
          <div className="dialog-actions">
            <a className="button-link" href="/tickets">View my tickets</a>
            <button
              onClick={() => {
                setConfirmation(null);
                onClose();
                onPaid();
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="checkout-form">
          <h2>Checkout</h2>
          {cart && cart.secondsLeft !== null && (
            <p role="timer" aria-label="Hold time left" className="countdown">
              {formatCountdown(cart.secondsLeft)}
            </p>
          )}
          <ul className="ledger">
            {(cart?.seats ?? []).map((line) => (
              <li key={line.seatId} className="ledger-line">
                <span className="ledger-seat">{line.label}</span>
                <span className="ledger-tier">{line.tierName}</span>
                <span className="amount">{formatCents(line.faceCents)}</span>
                <span className="amount">{formatCents(line.seatFeeCents)}</span>
              </li>
            ))}
          </ul>
          {cart && <LedgerTotals cart={cart} />}
          {Object.keys(errors).length > 0 && (
            <div className="error-summary">
              <h3>Check these details</h3>
              <ul>
                {Object.entries(errors).map(([field, message]) => (
                  <li key={field}>
                    <a
                      href={`#checkout-${field}`}
                      onClick={(event) => {
                        event.preventDefault();
                        const target = field === 'name' ? nameRef.current : emailRef.current;
                        target?.focus();
                      }}
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="field">
            <span>Full name</span>
            <input ref={nameRef} id="checkout-name" value={personName} onChange={(event) => setPersonName(event.target.value)} />
            {errors.name && <p className="field-error">{errors.name}</p>}
          </label>
          <label className="field">
            <span>Email</span>
            <input ref={emailRef} id="checkout-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            {errors.email && <p className="field-error">{errors.email}</p>}
          </label>
          <div role="region" aria-label="Payment notice" className="payment-notice">
            {paymentNotice}
          </div>
          <div className="dialog-actions">
            <button className="pay-button" disabled={pending} onClick={() => void pay()}>
              {pending ? 'Confirming payment' : `Pay ${formatCents(cart?.totalCents ?? 0)}`}
            </button>
            <button disabled={pending} onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ExchangeControl({
  disabled,
  performance,
  newSeatId,
  ticketId,
  seatById,
}: {
  disabled: boolean;
  performance: Performance | null;
  newSeatId: string | null;
  ticketId: string | undefined;
  seatById: Map<string, Seat>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [oldTicket, setOldTicket] = useState<{ seatId: string; faceCents: number; seatFeeCents: number } | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!ticketId) return;
    void (async () => {
      const result = await api<{ orders: { tickets: { id: string; seatId: string; faceCents: number; seatFeeCents: number }[] }[] }>('/api/orders');
      if (result.ok) {
        for (const order of result.value.orders) {
          const ticket = order.tickets.find((t) => t.id === ticketId);
          if (ticket) {
            setOldTicket({ seatId: ticket.seatId, faceCents: ticket.faceCents, seatFeeCents: ticket.seatFeeCents });
            return;
          }
        }
      }
    })();
  }, [ticketId]);

  const newSeat = newSeatId ? seatById.get(newSeatId) ?? null : null;
  const newTier = newSeat?.tierId ? performance?.tiers.find((t) => t.id === newSeat.tierId) ?? null : null;
  const difference = newTier && oldTicket
    ? newTier.faceCents + newTier.seatFeeCents - (oldTicket.faceCents + oldTicket.seatFeeCents)
    : 0;

  return (
    <>
      <button className="hold-button" disabled={disabled} onClick={() => setOpen(true)}>
        Exchange to this seat
      </button>
      <Dialog label="Confirm exchange" open={open} onClose={() => setOpen(false)}>
        <h2>Confirm exchange</h2>
        <p>From {oldTicket ? seatLabelOf(oldTicket.seatId) : ''}</p>
        <p>To {newSeat ? seatLabelOf(newSeat.id) : ''}</p>
        <p className="difference-line">
          {difference > 0 ? `You pay ${formatCents(difference)}` : difference < 0 ? `We refund ${formatCents(-difference)}` : 'No price difference'}
        </p>
        {notice && <p className="payment-notice">{notice}</p>}
        <div className="dialog-actions">
          <button
            disabled={pending}
            onClick={async () => {
              if (!ticketId || !newSeatId) return;
              setPending(true);
              const result = await api<{ differenceCents: number }>(`/api/tickets/${ticketId}/exchange`, {
                method: 'POST',
                body: { newSeatId },
                idempotencyKey: `exchange-${ticketId}-${Math.random().toString(36).slice(2)}`,
              });
              setPending(false);
              if (result.ok) {
                setOpen(false);
                announce(`Exchange confirmed. Your new seat is ${seatLabelOf(newSeatId)}.`);
                window.setTimeout(() => navigate('/tickets'), 800);
                return;
              }
              if (result.error === 'seats_taken') {
                announce('That seat was just taken. Pick another seat.');
                setOpen(false);
                return;
              }
              if (result.error === 'payment_declined') {
                setNotice('Your payment was declined. Your ticket is unchanged.');
                announce('Your payment was declined. Your ticket is unchanged.');
                return;
              }
              if (result.error === 'payments_unavailable') {
                setNotice('Payments are paused right now. Your ticket is unchanged. Please try again shortly.');
                announce('Payments are paused right now. Your ticket is unchanged. Please try again shortly.');
                return;
              }
              if (result.error === 'changes_closed') {
                announce('Exchanges and refunds closed 24 hours before the performance.');
                return;
              }
            }}
          >
            {pending ? 'Confirming exchange' : 'Confirm exchange'}
          </button>
          <button disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </Dialog>
    </>
  );
}

function hallKeyArc(index: number): string {
  const radii = [16, 26, 36];
  const r = radii[index];
  return `M ${60 - r} 52 A ${r} ${r} 0 0 1 ${60 + r} 52`;
}
