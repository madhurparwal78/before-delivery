import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Cart as CartData, Order, Performance, Seat, Ticket, Tier } from '../../shared/api';
import {
  COPY,
  alreadyWaitingAnnouncement,
  exchangeConfirmedAnnouncement,
  heldAnnouncement,
  releasedAnnouncement,
  takenAnnouncement,
  tierNotSoldOutAnnouncement,
  waitlistJoinedAnnouncement,
} from '../../shared/copy';
import { isSectionCode, labelsInSeatOrder, seatLabel, type SectionCode } from '../../shared/hall';
import { seatFeeCents } from '../../shared/money';
import { Cart } from '../components/Cart';
import { CheckoutDialog } from '../components/CheckoutDialog';
import { ExchangeDialog } from '../components/ExchangeDialog';
import { MapControls } from '../components/MapControls';
import { SeatMap } from '../components/SeatMap';
import { WaitlistDialog } from '../components/WaitlistDialog';
import { api, newIdempotencyKey } from '../lib/api';
import { useAnnouncer } from '../lib/announce';
import { useServerCountdown } from '../lib/countdown';
import { useLiveUpdates } from '../lib/live';
import { useRouter } from '../lib/router';
import { onCartClosedElsewhere, tellOtherTabsCartClosed } from '../lib/tabs';
import { NotFound } from './NotFound';

function defaultSeatId(section: SectionCode): string {
  return `${section}-A-15`;
}

export function SeatMapPage({ performanceId }: { readonly performanceId: string }): ReactNode {
  const { search, go } = useRouter();
  const { announce } = useAnnouncer();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const [performance, setPerformance] = useState<Performance | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [cart, setCart] = useState<CartData | null>(null);
  const [missing, setMissing] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [holding, setHolding] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirmation, setConfirmation] = useState<Order | null>(null);
  const [paymentNotice, setPaymentNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [waitlistTier, setWaitlistTier] = useState<Tier | null>(null);
  const [joining, setJoining] = useState(false);
  const [exchangeTicket, setExchangeTicket] = useState<Ticket | null>(null);
  const [exchangeSeatId, setExchangeSeatId] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);

  const selectionRef = useRef<ReadonlySet<string>>(selection);
  selectionRef.current = selection;
  const cartRef = useRef<CartData | null>(cart);
  cartRef.current = cart;
  const suppressHoldEnded = useRef(false);
  const holdEndAnnounced = useRef(false);

  const exchangeTicketId = params.get('exchange');
  const section: SectionCode = (() => {
    const value = params.get('section') ?? 'ST';
    return isSectionCode(value) ? value : 'ST';
  })();
  const tierFilter = params.get('tier') ?? 'all';
  const requestedSeat = params.get('seat') ?? defaultSeatId(section);
  const activeSeatId = requestedSeat.startsWith(`${section}-`) ? requestedSeat : defaultSeatId(section);

  const setPlace = useCallback(
    (next: { section?: SectionCode; seat?: string; tier?: string }) => {
      const updated = new URLSearchParams(params);
      if (next.section !== undefined) {
        updated.set('section', next.section);
        updated.set('seat', next.seat ?? defaultSeatId(next.section));
      } else if (next.seat !== undefined) {
        updated.set('seat', next.seat);
      }
      if (next.tier !== undefined) updated.set('tier', next.tier);
      if (!updated.has('section')) updated.set('section', section);
      if (!updated.has('seat')) updated.set('seat', activeSeatId);
      if (!updated.has('tier')) updated.set('tier', tierFilter);
      go(`/p/${performanceId}?${updated.toString()}`, { replace: true });
    },
    [params, go, performanceId, section, activeSeatId, tierFilter],
  );

  useEffect(() => {
    if (params.get('section') === null || params.get('seat') === null || params.get('tier') === null) {
      setPlace({});
    }
  }, [params, setPlace]);

  const refresh = useCallback(async () => {
    const [performanceResult, seatsResult, cartResult] = await Promise.all([
      api.performance(performanceId),
      api.seats(performanceId),
      api.cart(performanceId),
    ]);
    if (performanceResult.status === 404) {
      setMissing(true);
      return;
    }
    if (performanceResult.data !== undefined) setPerformance(performanceResult.data);
    if (seatsResult.data !== undefined) {
      const fresh = seatsResult.data.seats;
      setSeats(fresh);
      const byId = new Map(fresh.map((seat) => [seat.id, seat]));
      const lost = [...selectionRef.current].filter((seatId) => {
        const seat = byId.get(seatId);
        return seat !== undefined && !seat.mine && seat.state !== 'on_sale';
      });
      const claimed = [...selectionRef.current].filter((seatId) => byId.get(seatId)?.mine === true);
      if (lost.length > 0 || claimed.length > 0) {
        setSelection((current) => {
          const next = new Set(current);
          for (const seatId of [...lost, ...claimed]) next.delete(seatId);
          return next;
        });
      }
      if (lost.length > 0) {
        announce(takenAnnouncement(labelsInSeatOrder(lost)));
        setNotice(COPY.seatTakenNotice);
      }
    }
    if (cartResult.data !== undefined) {
      const hadSeats = (cartRef.current?.seats.length ?? 0) > 0;
      const empty = cartResult.data.seats.length === 0;
      setCart(cartResult.data);
      if (!empty) holdEndAnnounced.current = false;
      if (hadSeats && empty && !suppressHoldEnded.current && !holdEndAnnounced.current) {
        holdEndAnnounced.current = true;
        announce(COPY.holdEnded);
        setNotice(COPY.holdEnded);
        setCheckoutOpen(false);
      }
    }
  }, [performanceId, announce]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLiveUpdates({ performanceId }, () => {
    void refresh();
  });

  useEffect(
    () =>
      onCartClosedElsewhere(performanceId, () => {
        suppressHoldEnded.current = true;
      }),
    [performanceId],
  );

  useEffect(() => {
    if (exchangeTicketId === null) {
      setExchangeTicket(null);
      return;
    }
    void (async () => {
      const result = await api.orders();
      const ticket = result.data?.orders
        .flatMap((order) => order.tickets)
        .find((candidate) => candidate.id === exchangeTicketId);
      setExchangeTicket(ticket ?? null);
      if (ticket !== undefined) setNotice(`Choose a new seat for ${ticket.label}.`);
    })();
  }, [exchangeTicketId]);

  const secondsLeft = useServerCountdown(cart?.secondsLeft ?? null, () => {
    void refresh();
  });

  const tiers = performance?.tiers ?? [];
  const salesOpen = performance?.salesOpen ?? false;
  const soldOutTiers = tiers.filter((tier) => tier.remaining === 0);

  const toggleSeat = (seatId: string): void => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(seatId)) next.delete(seatId);
      else if (exchangeTicketId !== null) {
        next.clear();
        next.add(seatId);
      } else next.add(seatId);
      return next;
    });
  };

  const holdSelected = async (): Promise<void> => {
    setHolding(true);
    const result = await api.hold(performanceId, [...selection]);
    setHolding(false);
    if (result.status === 200 && result.data !== undefined) {
      const { held, taken } = result.data;
      setCart(result.data.cart);
      suppressHoldEnded.current = false;
      holdEndAnnounced.current = false;
      setSelection((current) => {
        const next = new Set(current);
        for (const seatId of [...held, ...taken]) next.delete(seatId);
        return next;
      });
      announce(heldAnnouncement(labelsInSeatOrder(held), labelsInSeatOrder(taken)));
      setNotice(taken.length > 0 ? COPY.seatTakenNotice : '');
      void refresh();
      return;
    }
    if (result.error === 'seats_taken') {
      const taken = result.taken ?? [];
      if (result.cart !== undefined) setCart(result.cart);
      setSelection((current) => {
        const next = new Set(current);
        for (const seatId of taken) next.delete(seatId);
        return next;
      });
      announce(takenAnnouncement(labelsInSeatOrder(taken)));
      setNotice(COPY.seatTakenNotice);
      void refresh();
      return;
    }
    if (result.error === 'sales_closed') {
      announce(COPY.salesClosed);
      setNotice(COPY.salesClosed);
      void refresh();
      return;
    }
    const message = result.fields?.seatIds;
    if (message !== undefined) {
      announce(message);
      setNotice(message);
    }
  };

  const releaseSeat = async (seatId: string): Promise<void> => {
    const result = await api.release(performanceId, seatId);
    if (result.data !== undefined) {
      if (result.data.cart.seats.length === 0) {
        suppressHoldEnded.current = true;
        tellOtherTabsCartClosed(performanceId);
      }
      setCart(result.data.cart);
      announce(releasedAnnouncement(seatLabel(seatId)));
      setNotice('');
      void refresh();
      return;
    }
    void refresh();
  };

  const pay = async (name: string, email: string): Promise<void> => {
    setPaying(true);
    setFieldErrors({});
    setPaymentNotice('');
    const result = await api.checkout(performanceId, { name, email }, newIdempotencyKey());
    setPaying(false);
    if (result.status === 201 && result.data !== undefined) {
      suppressHoldEnded.current = true;
      tellOtherTabsCartClosed(performanceId);
      setConfirmation(result.data.order);
      announce(COPY.paymentConfirmed);
      setNotice('');
      void refresh();
      return;
    }
    if (result.status === 402) {
      announce(COPY.checkoutDeclined);
      setPaymentNotice(COPY.checkoutDeclined);
      void refresh();
      return;
    }
    if (result.status === 503) {
      announce(COPY.checkoutPaymentsPaused);
      setPaymentNotice(COPY.checkoutPaymentsPaused);
      void refresh();
      return;
    }
    if (result.status === 422) {
      setFieldErrors(result.fields ?? {});
      announce(COPY.checkDetails);
      return;
    }
    if (result.error === 'cart_empty') {
      holdEndAnnounced.current = true;
      announce(COPY.holdEnded);
      setNotice(COPY.holdEnded);
      setCheckoutOpen(false);
      void refresh();
      return;
    }
    if (result.error === 'sales_closed') {
      announce(COPY.salesClosed);
      setNotice(COPY.salesClosed);
      setCheckoutOpen(false);
      void refresh();
    }
  };

  const joinWaitlist = async (name: string, email: string): Promise<void> => {
    const tier = waitlistTier;
    if (tier === null) return;
    setJoining(true);
    const result = await api.joinWaitlist(performanceId, tier.id, { name, email });
    setJoining(false);
    if (result.status === 201 && result.data !== undefined) {
      announce(waitlistJoinedAnnouncement(tier.name, result.data.entry.position ?? 1));
      setWaitlistTier(null);
      void refresh();
      return;
    }
    if (result.error === 'already_waiting') {
      announce(alreadyWaitingAnnouncement(tier.name));
      setWaitlistTier(null);
      return;
    }
    if (result.error === 'tier_not_sold_out') {
      announce(tierNotSoldOutAnnouncement(tier.name));
      setWaitlistTier(null);
      void refresh();
      return;
    }
    if (result.error === 'sales_closed') {
      announce(COPY.salesClosed);
      setNotice(COPY.salesClosed);
      setWaitlistTier(null);
      return;
    }
    if (result.status === 422) announce(COPY.checkDetails);
  };

  const confirmExchange = async (): Promise<void> => {
    const ticket = exchangeTicket;
    const seatId = exchangeSeatId;
    if (ticket === null || seatId === null) return;
    setExchanging(true);
    const result = await api.exchange(ticket.id, seatId, newIdempotencyKey());
    setExchanging(false);
    setExchangeSeatId(null);
    if (result.status === 200 && result.data !== undefined) {
      announce(exchangeConfirmedAnnouncement(seatLabel(seatId)));
      setSelection(new Set());
      go('/tickets');
      return;
    }
    if (result.error === 'seats_taken') {
      announce(COPY.exchangeSeatTaken);
      setNotice(COPY.exchangeSeatTaken);
      setSelection(new Set());
      void refresh();
      return;
    }
    if (result.status === 402) {
      announce(COPY.exchangeDeclined);
      setNotice(COPY.exchangeDeclined);
      void refresh();
      return;
    }
    if (result.status === 503) {
      announce(COPY.changePaymentsPaused);
      setNotice(COPY.changePaymentsPaused);
      return;
    }
    if (result.error === 'changes_closed') {
      announce(COPY.changesClosed);
      setNotice(COPY.changesClosed);
    }
  };

  if (missing) return <NotFound />;

  const selectedSeats = [...selection];
  const exchangeSeat = selectedSeats.length === 1 ? (selectedSeats[0] ?? null) : null;
  const newTier = tiers.find((tier) => tier.id === seats.find((seat) => seat.id === exchangeSeat)?.tierId);
  const differenceCents =
    exchangeTicket === null || newTier === undefined
      ? 0
      : newTier.faceCents +
        seatFeeCents(newTier.faceCents) -
        (exchangeTicket.faceCents + exchangeTicket.seatFeeCents);
  const dialogOpen = checkoutOpen || waitlistTier !== null || exchangeSeatId !== null;

  return (
    <section className="seat-map-page">
      <div inert={dialogOpen ? true : undefined}>
        <header className="performance-header">
          <h1>{performance?.title ?? ''}</h1>
          <p className="start-label figures">{performance?.startsAtVenue ?? ''}</p>
        </header>

        <MapControls
          section={section}
          tiers={tiers}
          tierFilter={tierFilter}
          onSection={(next) => setPlace({ section: next })}
          onTier={(tierId) => {
            if (tierId !== 'all') {
              setSelection((current) => {
                const kept = new Set<string>();
                for (const seatId of current) {
                  if (seats.find((seat) => seat.id === seatId)?.tierId === tierId) kept.add(seatId);
                }
                return kept;
              });
            }
            setPlace({ tier: tierId });
          }}
        />

        <div className="notice" role="region" aria-label="Notice">
          {notice}
        </div>

        <div className="map-and-cart">
          <div className="map-column">
            <SeatMap
              seats={seats}
              tiers={tiers}
              section={section}
              tierFilter={tierFilter}
              activeSeatId={activeSeatId}
              selection={selection}
              onActivate={(seatId) => setPlace({ seat: seatId })}
              onToggle={toggleSeat}
              onSection={(next) => setPlace({ section: next })}
            />

            <div className="selection-line">
              <p>{`${selection.size} selected`}</p>
              {exchangeTicketId === null ? (
                <button
                  type="button"
                  className="primary"
                  disabled={selection.size === 0 || !salesOpen || holding}
                  onClick={() => {
                    void holdSelected();
                  }}
                >
                  {holding ? 'Holding seats' : 'Hold selected seats'}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={exchangeSeat === null}
                  onClick={() => setExchangeSeatId(exchangeSeat)}
                >
                  Exchange to this seat
                </button>
              )}
              {salesOpen
                ? soldOutTiers.map((tier) => (
                    <button type="button" key={tier.id} onClick={() => setWaitlistTier(tier)}>
                      {`Join the waitlist for ${tier.name}`}
                    </button>
                  ))
                : null}
            </div>
          </div>

          <div className="cart-column">
            <Cart
              cart={cart}
              secondsLeft={secondsLeft}
              onRelease={(seatId) => {
                void releaseSeat(seatId);
              }}
              onCheckout={() => {
                setConfirmation(null);
                setPaymentNotice('');
                setFieldErrors({});
                setCheckoutOpen(true);
              }}
            />
          </div>
        </div>
      </div>

      {checkoutOpen ? (
        <CheckoutDialog
          cart={cart}
          secondsLeft={secondsLeft}
          confirmation={confirmation}
          paymentNotice={paymentNotice}
          fieldErrors={fieldErrors}
          pending={paying}
          onPay={(name, email) => {
            void pay(name, email);
          }}
          onClose={() => setCheckoutOpen(false)}
          onViewTickets={() => {
            setCheckoutOpen(false);
            go('/tickets');
          }}
        />
      ) : null}

      {waitlistTier !== null ? (
        <WaitlistDialog
          tierName={waitlistTier.name}
          pending={joining}
          onJoin={(name, email) => {
            void joinWaitlist(name, email);
          }}
          onClose={() => setWaitlistTier(null)}
        />
      ) : null}

      {exchangeSeatId !== null && exchangeTicket !== null ? (
        <ExchangeDialog
          oldLabel={exchangeTicket.label}
          newLabel={seatLabel(exchangeSeatId)}
          differenceCents={differenceCents}
          pending={exchanging}
          onConfirm={() => {
            void confirmExchange();
          }}
          onClose={() => setExchangeSeatId(null)}
        />
      ) : null}
    </section>
  );
}
