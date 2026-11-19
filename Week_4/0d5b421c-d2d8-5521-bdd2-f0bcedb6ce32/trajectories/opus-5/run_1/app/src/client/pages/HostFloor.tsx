import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  Booking,
  FloorResponse,
  HostBookingsResponse,
  HostFloorResponse,
  HostFloorTable,
  HostLiveEvent,
  RulesResponse,
} from '../../shared/types';
import { Dialog } from '../components/Dialog';
import { FloorPlan, type PlanOption, type TableVariant } from '../components/FloorPlan';
import { LiveRegion, OutageBanners, PinnedTitle } from '../components/Shell';
import { ApiFailure, apiDelete, apiGet, apiPost, newIdempotencyKey } from '../lib/api';
import { COPY, formatLisbonDate, hostBookingLine } from '../lib/format';
import { useEventStream, useOutage, useReducedMotion } from '../lib/hooks';

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

function tableLabel(ids: string[]): string {
  return ids.join('+');
}

function announcementFor(event: HostLiveEvent): string {
  const id = tableLabel(event.table_ids);
  switch (event.type) {
    case 'hold.created':
      return `Table ${id} held for ${event.time}.`;
    case 'hold.expired':
      return `Hold on table ${id} ended.`;
    case 'hold.released':
      return `Hold on table ${id} released.`;
    case 'booking.created':
      return `Table ${id} booked for ${event.time}, party of ${event.party_size}.`;
    case 'booking.cancelled':
      return `Booking ${event.reference ?? ''} at table ${id} cancelled.`;
    case 'booking.seated':
      return `Table ${id} seated.`;
    case 'booking.completed':
      return `Table ${id} cleared.`;
    case 'booking.no_show':
      return `Table ${id} marked no-show.`;
    case 'walkin.seated':
      return `Walk-in seated at table ${id}, party of ${event.party_size}.`;
    case 'offer.created':
      return `Table ${id} offered to the waitlist for ${event.time}.`;
    case 'offer.claimed':
      return `Waitlist offer for table ${id} claimed.`;
    case 'offer.lapsed':
    default:
      return `Waitlist offer for table ${id} lapsed.`;
  }
}

function addMinutesToSlot(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const total = hour * 60 + minute + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const VARIANTS: Record<HostFloorTable['status'], TableVariant> = {
  free: 'free',
  held: 'held',
  booked: 'booked',
  seated: 'seated',
  offered: 'offered',
};

export function HostFloor(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const outage = useOutage();
  const reducedMotion = useReducedMotion();

  const [floorLayout, setFloorLayout] = useState<FloorResponse | null>(null);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [floor, setFloor] = useState<HostFloorResponse | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [walkInStep, setWalkInStep] = useState(false);
  const [walkInParty, setWalkInParty] = useState(2);
  const [focusUnit, setFocusUnit] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadedOnce = useRef(false);
  const requestSeq = useRef(0);
  const showing = params.get('time');
  const openTable = params.get('table');

  const redirecting = useRef(false);
  const goToSignIn = useCallback(
    (ended: boolean): void => {
      if (redirecting.current) return;
      redirecting.current = true;
      const path = window.location.pathname;
      const next = path === '/host' ? `${path}${window.location.search}` : '/host';
      const search = new URLSearchParams({ next });
      if (ended) search.set('ended', '1');
      navigate(`/host/sign-in?${search.toString()}`, { replace: true });
    },
    [navigate],
  );

  const handleFailure = useCallback(
    (failure: unknown): void => {
      if (failure instanceof ApiFailure && failure.status === 401) {
        goToSignIn(loadedOnce.current);
        return;
      }
      if (failure instanceof ApiFailure && failure.status === 503) {
        outage.reportOutage(failure.code);
      }
    },
    [goToSignIn, outage],
  );

  const load = useCallback(async (): Promise<void> => {
    const sequence = requestSeq.current + 1;
    requestSeq.current = sequence;
    try {
      const query = showing ? `?time=${encodeURIComponent(showing)}` : '';
      const [nextFloor, nextBookings] = await Promise.all([
        apiGet<HostFloorResponse>(`/api/host/floor${query}`).catch((failure: unknown) => {
          // An address with a time the server does not accept falls back to the current slot.
          if (failure instanceof ApiFailure && failure.status === 422) {
            return apiGet<HostFloorResponse>('/api/host/floor');
          }
          throw failure;
        }),
        apiGet<HostBookingsResponse>('/api/host/bookings'),
      ]);
      if (sequence !== requestSeq.current) return;
      loadedOnce.current = true;
      setFloor(nextFloor);
      setBookings(nextBookings.bookings);
      // The server picks the Showing time when the address carries none, or one it cannot use.
      if (showing !== nextFloor.time) {
        const next = new URLSearchParams(window.location.search);
        next.set('time', nextFloor.time);
        setParams(next, { replace: true });
      }
    } catch (failure) {
      handleFailure(failure);
    }
  }, [handleFailure, setParams, showing]);

  useEffect(() => {
    void apiGet<FloorResponse>('/api/floor')
      .then(setFloorLayout)
      .catch(() => undefined);
    void apiGet<RulesResponse>('/api/rules')
      .then(setRules)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  useEventStream<HostLiveEvent>(
    '/api/host/events',
    (event) => {
      setAnnouncement(announcementFor(event));
      void load();
    },
    () => void load(),
  );

  /** The Showing time and the open table live in the URL, updated in place. */
  const setShowing = (time: string): void => {
    const next = new URLSearchParams(params);
    next.set('time', time);
    setParams(next, { replace: true });
  };

  const openDialog = (tableId: string | null): void => {
    const next = new URLSearchParams(params);
    if (tableId) next.set('table', tableId);
    else next.delete('table');
    // Closing returns focus to the table that opened the dialog.
    setFocusUnit(tableId === null ? openTable : null);
    setParams(next, { replace: true });
    setWalkInStep(false);
    setWalkInParty(2);
  };

  const act = async (action: () => Promise<void>): Promise<void> => {
    setPending(true);
    try {
      await action();
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        if (failure.code === 'invalid_transition') {
          setAnnouncement('That table has already changed. The plan is up to date.');
        } else if (failure.code === 'too_early') {
          setAnnouncement('');
        }
      }
      handleFailure(failure);
      throw failure;
    } finally {
      setPending(false);
    }
  };

  const options = useMemo<PlanOption[]>(() => {
    if (!floorLayout || !floor) return [];
    const byId = new Map(floor.tables.map((table) => [table.table_id, table]));
    return floorLayout.rooms.flatMap((room) =>
      room.tables.flatMap((table) => {
        const state = byId.get(table.table_id);
        if (!state) return [];
        const label =
          state.status === 'booked' && state.booking
            ? `Booked ${state.booking.time}`
            : state.status === 'free'
              ? 'Free'
              : state.status === 'held'
                ? 'Held'
                : state.status === 'seated'
                  ? 'Seated'
                  : 'Offered';
        return [
          {
            unitId: table.table_id,
            roomId: room.room_id,
            tableIds: [table.table_id],
            accessibleName: `Table ${table.table_id}, ${room.name}, ${label}`,
            statusText: label,
            variant: VARIANTS[state.status],
            maxSeats: table.max_seats,
            settings: state.hold ? state.hold.party_size : 0,
            ring: null,
          },
        ];
      }),
    );
  }, [floor, floorLayout]);

  const dialogTable = floor?.tables.find((table) => table.table_id === openTable) ?? null;
  const slotTimes = rules?.slot_times ?? [];

  if (!floor) {
    return (
      <div className="page host">
        <OutageBanners />
        <PinnedTitle>{COPY.planLoading}</PinnedTitle>
      </div>
    );
  }

  const booking = dialogTable?.booking ?? null;

  return (
    <div className="page host">
      <OutageBanners extra={outage.holds === 'paused' ? COPY.liveUpdatesPaused : null} />
      <PinnedTitle>{`Tonight · ${formatLisbonDate(floor.date)}`}</PinnedTitle>
      <LiveRegion label="Floor updates" message={announcement} />
      <div className="host-grid">
        <section className="region region--covers" aria-label="Tonight's covers">
          <h2>Tonight&apos;s covers</h2>
          <label className="field">
            <span>Showing</span>
            <select
              aria-label="Showing"
              value={showing && slotTimes.includes(showing) ? showing : floor.time}
              onChange={(event) => setShowing(event.target.value)}
            >
              {slotTimes.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          <p className="tabular">{`${floor.totals.covers_free} covers free at ${floor.time}`}</p>
          {floor.totals.rooms.map((room) => (
            <p key={room.room_id} className="tabular">
              {`${room.name}: ${room.covers_free} of ${room.seats} seats free`}
            </p>
          ))}
          <button
            type="button"
            className="button"
            onClick={() => {
              void apiDelete('/api/host/session')
                .catch(() => undefined)
                .then(() => navigate('/host/sign-in'));
            }}
          >
            Sign out
          </button>
        </section>

        <section className="region region--plan" aria-label="Tonight's floor">
          <h2>Tonight&apos;s floor</h2>
          <FloorPlan
            floor={floorLayout ?? { rooms: [], joinable_pairs: [] }}
            label="Tonight's floor"
            options={options}
            reducedMotion={reducedMotion}
            focusUnit={focusUnit}
            onFocusHandled={() => setFocusUnit(null)}
            onActivate={(option) => openDialog(option.unitId)}
          />
        </section>

        <section className="region region--bookings" aria-label="Tonight's bookings">
          <h2>Tonight&apos;s bookings</h2>
          {bookings.length === 0 ? (
            <p className="single-sentence">{COPY.emptyBookings}</p>
          ) : (
            <ul className="bookings">
              {bookings.map((entry) => (
                <li key={entry.reference} className="tabular">
                  {hostBookingLine(entry)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {dialogTable ? (
        <Dialog
          label={`Table ${dialogTable.table_id}`}
          onEscape={pending ? undefined : () => openDialog(null)}
        >
          <p>{`Table ${dialogTable.table_id}`}</p>
          {booking ? <p>{hostBookingLine(booking)}</p> : null}
          {dialogTable.status === 'booked' && booking ? (
            <>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void act(async () => {
                    await apiPost(`/api/host/bookings/${booking.reference}/seat`, {});
                  }).catch(() => undefined);
                }}
              >
                Seat
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void act(async () => {
                    await apiPost(`/api/host/bookings/${booking.reference}/no-show`, {});
                  }).catch((failure: unknown) => {
                    if (failure instanceof ApiFailure && failure.code === 'too_early') {
                      setAnnouncement(
                        `You can mark a no-show from ${addMinutesToSlot(booking.time, 15)}.`,
                      );
                    }
                  });
                }}
              >
                Mark no-show
              </button>
            </>
          ) : null}
          {dialogTable.status === 'seated' && booking ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                void act(async () => {
                  await apiPost(`/api/host/bookings/${booking.reference}/clear`, {});
                }).catch(() => undefined);
              }}
            >
              Clear table
            </button>
          ) : null}
          {dialogTable.status === 'free' && !walkInStep ? (
            <button type="button" className="button" onClick={() => setWalkInStep(true)}>
              Add walk-in
            </button>
          ) : null}
          {walkInStep ? (
            <>
              <label className="field">
                <span>Walk-in party size</span>
                <select
                  aria-label="Walk-in party size"
                  value={walkInParty}
                  onChange={(event) => setWalkInParty(Number(event.target.value))}
                >
                  {PARTY_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button--accent"
                disabled={pending}
                onClick={() => {
                  void act(async () => {
                    await apiPost(
                      '/api/host/walk-ins',
                      {
                        table_id: dialogTable.table_id,
                        party_size: walkInParty,
                      },
                      newIdempotencyKey(),
                    );
                    openDialog(null);
                  }).catch((failure: unknown) => {
                    if (!(failure instanceof ApiFailure)) return;
                    if (failure.code === 'table_taken') {
                      setAnnouncement(`Table ${dialogTable.table_id} is no longer free.`);
                    } else if (failure.code === 'table_not_for_party') {
                      setAnnouncement(
                        `Table ${dialogTable.table_id} doesn't seat a party of ${walkInParty}.`,
                      );
                    }
                  });
                }}
              >
                Seat walk-in
              </button>
            </>
          ) : null}
          <button type="button" className="button" onClick={() => openDialog(null)}>
            Close
          </button>
        </Dialog>
      ) : null}
    </div>
  );
}
