import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  AvailabilityResponse,
  ConfirmResponse,
  FloorResponse,
  HoldResponse,
  PlanResponse,
  PublicLiveEvent,
  RulesResponse,
} from '../../shared/types';
import { FloorPlan, type PlanOption } from '../components/FloorPlan';
import { PartySizes } from '../components/PartySizes';
import { LiveRegion, OutageBanners, PinnedTitle } from '../components/Shell';
import {
  ApiFailure,
  apiDelete,
  apiGet,
  apiPost,
  releaseHoldOnUnload,
  serverNowMs,
} from '../lib/api';
import {
  ANNOUNCE_NOT_FOR_PARTY,
  ANNOUNCE_SLOT_CLOSED,
  COPY,
  announceHoldEnded,
  announceHoldGranted,
  announceHoldPending,
  announceReleased,
  announceTableTaken,
  bookingSummaryLine,
  countdownText,
  depositParagraph,
  euros,
  lisbonDateNow,
  slotOptionName,
} from '../lib/format';
import { useCountdown, useEventStream, useOutage, useReducedMotion } from '../lib/hooks';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

interface HoldState {
  holdId: string;
  unitId: string;
  tableIds: string[];
  expiresAt: string;
  partySize: number;
  depositCents: number;
}

function idempotencyKeyFor(holdId: string, body: unknown): string {
  const text = JSON.stringify(body);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${holdId.slice(0, 32)}-${(hash >>> 0).toString(16)}`;
}

export function Book(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const outage = useOutage();
  const reducedMotion = useReducedMotion();

  const [floor, setFloor] = useState<FloorResponse | null>(null);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planState, setPlanState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [hold, setHold] = useState<HoldState | null>(null);
  const [endedTable, setEndedTable] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [acceptDeposit, setAcceptDeposit] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [focusUnit, setFocusUnit] = useState<string | null>(null);

  const rawParty = params.get('party');
  const rawDate = params.get('date');
  const rawTime = params.get('time');
  const party = (() => {
    const parsed = Number(rawParty);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 2;
  })();
  const today = lisbonDateNow(serverNowMs());
  const date = (() => {
    if (!rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return today;
    if (rawDate < today) return today;
    const horizon = rules?.booking_horizon_days ?? 30;
    const [year, month, day] = today.split('-').map(Number) as [number, number, number];
    const latest = new Date(Date.UTC(year, month - 1, day + horizon)).toISOString().slice(0, 10);
    return rawDate > latest ? today : rawDate;
  })();
  const slots = availability?.slots ?? [];
  const chosenSlot = rawTime ? slots.find((slot) => slot.time === rawTime) : undefined;
  const time = chosenSlot && chosenSlot.bookable ? chosenSlot.time : null;

  const holdSeconds = rules?.hold_seconds ?? 300;
  const countdown = useCountdown(hold ? hold.expiresAt : null, holdSeconds, reducedMotion);

  useEffect(() => {
    void apiGet<FloorResponse>('/api/floor')
      .then(setFloor)
      .catch(() => undefined);
    void apiGet<RulesResponse>('/api/rules')
      .then(setRules)
      .catch(() => undefined);
  }, []);

  /** Applying a default rewrites the URL in place, without adding a history entry. */
  useEffect(() => {
    const next = new URLSearchParams();
    next.set('date', date);
    next.set('party', String(party));
    if (rawTime && (!availability || (chosenSlot && chosenSlot.bookable))) {
      next.set('time', rawTime);
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [availability, chosenSlot, date, params, party, rawTime, setParams]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const nextAvailability = await apiGet<AvailabilityResponse>(
        `/api/availability?date=${date}&party=${party}`,
      );
      setAvailability(nextAvailability);
      if (time) {
        setPlan(await apiGet<PlanResponse>(`/api/plan?date=${date}&time=${time}&party=${party}`));
      } else {
        setPlan(null);
      }
      setPlanState('idle');
    } catch {
      setPlanState('failed');
    }
  }, [date, party, time]);

  useEffect(() => {
    setPlanState('loading');
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onShow = (): void => void refresh();
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [refresh]);

  const endHold = useCallback(
    (unitId: string) => {
      setHold(null);
      setEndedTable(unitId);
      setAnnouncement(announceHoldEnded(unitId));
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    if (hold && countdown.msLeft <= 0) endHold(hold.unitId);
  }, [countdown.msLeft, endHold, hold]);

  useEventStream<PublicLiveEvent>(
    `/api/floor/events?date=${date}`,
    (event) => {
      if (
        event.type === 'hold.expired' &&
        hold &&
        event.table_ids.some((id) => hold.tableIds.includes(id))
      ) {
        endHold(hold.unitId);
        return;
      }
      void refresh();
    },
    () => void refresh(),
  );

  const holdRef = useRef<HoldState | null>(null);
  holdRef.current = hold;
  useEffect(() => {
    const onHide = (): void => {
      const live = holdRef.current;
      if (live) releaseHoldOnUnload(live.holdId);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const releaseLiveHold = useCallback(
    async (announce: boolean): Promise<boolean> => {
      const live = hold;
      if (!live) return true;
      try {
        await apiDelete(`/api/holds/${live.holdId}`);
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.status === 503) {
          outage.reportOutage(failure.code);
          return false;
        }
      }
      setHold(null);
      setEndedTable(null);
      if (announce) setAnnouncement(announceReleased(live.unitId));
      return true;
    },
    [hold, outage],
  );

  const choice = useRef({ date, party, time });
  useEffect(() => {
    const previous = choice.current;
    if (previous.date === date && previous.party === party && previous.time === time) return;
    choice.current = { date, party, time };
    if (hold) void releaseLiveHold(false);
  }, [date, hold, party, releaseLiveHold, time]);

  const changeChoice = async (next: {
    date?: string;
    party?: number;
    time?: string | null;
  }): Promise<void> => {
    const nextDate = next.date ?? date;
    const nextParty = next.party ?? party;
    const nextTime = next.time === undefined ? time : next.time;
    if (nextDate === date && nextParty === party && nextTime === time) return;
    if (hold && !(await releaseLiveHold(true))) return;
    choice.current = { date: nextDate, party: nextParty, time: nextTime };
    const search = new URLSearchParams();
    search.set('date', nextDate);
    search.set('party', String(nextParty));
    if (nextTime) search.set('time', nextTime);
    setParams(search);
  };

  const chooseTable = async (option: PlanOption): Promise<void> => {
    if (option.variant === 'held') return;
    if (option.variant === 'taken') {
      setAnnouncement(announceTableTaken(option.unitId));
      return;
    }
    if (option.variant !== 'fits') {
      setAnnouncement(ANNOUNCE_NOT_FOR_PARTY);
      return;
    }
    const previousDeposit = hold?.depositCents ?? null;
    if (hold && !(await releaseLiveHold(false))) return;
    if (!time) return;
    setAnnouncement(announceHoldPending(option.unitId));
    try {
      const granted = await apiPost<HoldResponse>('/api/holds', {
        date,
        time,
        party_size: party,
        table_id: option.unitId,
      });
      setHold({
        holdId: granted.hold_id,
        unitId: granted.table_id,
        tableIds: option.tableIds,
        expiresAt: granted.expires_at,
        partySize: granted.party_size,
        depositCents: granted.deposit_cents,
      });
      setEndedTable(null);
      setErrors({});
      if (previousDeposit !== null && previousDeposit !== granted.deposit_cents) {
        setAcceptDeposit(false);
      }
      setAnnouncement(announceHoldGranted(granted.table_id));
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === 'table_taken') setAnnouncement(announceTableTaken(option.unitId));
      else if (failure.code === 'table_not_for_party') setAnnouncement(ANNOUNCE_NOT_FOR_PARTY);
      else if (failure.code === 'slot_not_bookable') setAnnouncement(ANNOUNCE_SLOT_CLOSED);
      else if (failure.status === 503) outage.reportOutage(failure.code);
      void refresh();
    }
  };

  const onRelease = async (): Promise<void> => {
    const live = hold;
    if (!live) return;
    if (await releaseLiveHold(true)) {
      setFocusUnit(live.unitId);
      void refresh();
    }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!hold) return;
    const found: Record<string, string> = {};
    if (name.trim().length === 0) found.name = COPY.nameError;
    if (!EMAIL_PATTERN.test(email.trim())) found.email = COPY.emailError;
    if (phone.length > 32) found.phone = COPY.phoneError;
    if (hold.depositCents > 0 && !acceptDeposit) found.deposit = COPY.depositError;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAnnouncement(Object.values(found).join(' '));
      return;
    }
    const body: Record<string, unknown> = {
      name: name.trim(),
      email: email.trim(),
    };
    if (phone.trim().length > 0) body.phone = phone.trim();
    if (hold.depositCents > 0) body.accept_deposit = true;
    setConfirming(true);
    try {
      const result = await apiPost<ConfirmResponse>(
        `/api/holds/${hold.holdId}/confirm`,
        body,
        idempotencyKeyFor(hold.holdId, body),
      );
      // The details belong to the booking that has just been made, so the form starts empty if
      // the guest comes back to this page.
      setName('');
      setEmail('');
      setPhone('');
      setAcceptDeposit(false);
      setHold(null);
      setEndedTable(null);
      navigate(new URL(result.manage_url).pathname);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === 'hold_expired') endHold(hold.unitId);
      else if (failure.code === 'payment_failed') setAnnouncement(COPY.paymentFailed);
      else if (failure.status === 503) outage.reportOutage(failure.code);
      else if (failure.code === 'table_taken') {
        setAnnouncement(announceTableTaken(hold.unitId));
        void refresh();
      } else if (failure.status === 422) setErrors(failure.fields);
    } finally {
      setConfirming(false);
    }
  };

  const options = useMemo<PlanOption[]>(() => {
    if (!floor || !plan) return [];
    const roomName = new Map(floor.rooms.map((room) => [room.room_id, room.name]));
    const list: PlanOption[] = [];
    for (const room of floor.rooms) {
      for (const table of room.tables) {
        const planTable = plan.tables.find((entry) => entry.table_id === table.table_id);
        if (!planTable) continue;
        const isHeld = hold?.unitId === table.table_id;
        const variant = isHeld
          ? 'held'
          : planTable.status === 'fits'
            ? 'fits'
            : planTable.status === 'taken'
              ? 'taken'
              : 'muted';
        const statusText = isHeld
          ? 'Held by you'
          : planTable.status === 'fits'
            ? 'Fits your party'
            : planTable.status === 'taken'
              ? 'Taken'
              : 'Not for your party';
        list.push({
          unitId: table.table_id,
          roomId: room.room_id,
          tableIds: [table.table_id],
          accessibleName: `Table ${table.table_id}, ${room.name}, ${table.min_seats} to ${table.max_seats} seats, ${statusText}`,
          statusText,
          variant,
          maxSeats: table.max_seats,
          settings: isHeld && hold ? hold.partySize : 0,
          ring: isHeld ? { fraction: countdown.fraction } : null,
        });
      }
      for (const pair of floor.joinable_pairs) {
        const planPair = plan.pairs.find((entry) => entry.pair_id === pair.pair_id);
        if (!planPair) continue;
        const [first, second] = pair.tables as [string, string];
        if (!room.tables.some((table) => table.table_id === first)) continue;
        const isHeld = hold?.unitId === pair.pair_id;
        const variant = isHeld
          ? 'held'
          : planPair.status === 'fits'
            ? 'fits'
            : planPair.status === 'taken'
              ? 'taken'
              : 'muted';
        const statusText = isHeld
          ? 'Held by you'
          : planPair.status === 'fits'
            ? 'Fits your party'
            : planPair.status === 'taken'
              ? 'Taken'
              : 'Not for your party';
        list.push({
          unitId: pair.pair_id,
          roomId: room.room_id,
          tableIds: [first, second],
          accessibleName: `Tables ${first} and ${second} joined, ${roomName.get(room.room_id) ?? ''}, ${pair.min_seats} to ${pair.max_seats} seats, ${statusText}`,
          statusText,
          variant,
          maxSeats: pair.max_seats,
          settings: isHeld && hold ? hold.partySize : 0,
          ring: isHeld ? { fraction: countdown.fraction } : null,
        });
      }
    }
    return list;
  }, [countdown.fraction, floor, hold, plan]);

  const waitlistHref = `/waitlist?date=${date}&party=${party}&earliest=${time ?? '18:00'}&latest=${
    time ?? '22:00'
  }`;
  const depositCents = hold?.depositCents ?? 0;
  const holdLive = hold !== null;

  return (
    <div className="page book">
      <OutageBanners />
      <PinnedTitle>{bookingSummaryLine(date, time, party)}</PinnedTitle>
      <LiveRegion label="Booking updates" message={announcement} />
      <div className="book-grid">
        <section className="region region--find" aria-label="Find a time">
          <h2>Find a time</h2>
          <PartySizes party={party} onChoose={(size) => void changeChoice({ party: size })} />
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              value={date}
              min={today}
              max={(() => {
                const horizon = rules?.booking_horizon_days ?? 30;
                const [year, month, day] = today.split('-').map(Number) as [number, number, number];
                return new Date(Date.UTC(year, month - 1, day + horizon))
                  .toISOString()
                  .slice(0, 10);
              })()}
              onChange={(event) => {
                if (event.target.value) void changeChoice({ date: event.target.value });
              }}
            />
          </label>
          <SlotList
            slots={slots}
            date={date}
            chosen={time}
            onChoose={(value) => void changeChoice({ time: value })}
          />
        </section>

        <section className="region region--plan" aria-label="Floor plan">
          <h2>Floor plan</h2>
          {planState === 'loading' ? <p className="single-sentence">{COPY.planLoading}</p> : null}
          {planState === 'failed' ? <p className="single-sentence">{COPY.planFailed}</p> : null}
          {floor && plan ? (
            <FloorPlan
              floor={floor}
              label="Tables"
              options={options}
              reducedMotion={reducedMotion}
              focusUnit={focusUnit}
              onFocusHandled={() => setFocusUnit(null)}
              onActivate={(option) => void chooseTable(option)}
            />
          ) : null}
        </section>

        <section className="region region--table" aria-label="Your table">
          <h2>Your table</h2>
          {holdLive && hold ? (
            <div className="hold-status">
              <span
                role="progressbar"
                aria-label="Hold time remaining"
                aria-valuemin={0}
                aria-valuemax={holdSeconds}
                aria-valuenow={countdown.secondsLeft}
                className={`ring${reducedMotion ? ' ring--stepped' : ''}`}
                style={{
                  ['--ring-fraction' as string]: `${countdown.fraction * 360}deg`,
                }}
              />
              <span className="tabular">{`Held for ${countdownText(countdown.msLeft)}`}</span>
              <button type="button" className="button" onClick={() => void onRelease()}>
                Release table
              </button>
            </div>
          ) : null}
          {endedTable ? <p className="notice">{announceHoldEnded(endedTable)}</p> : null}
          <form className="details" onSubmit={(event) => void submit(event)}>
            <label className="field">
              <span>Name</span>
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {errors.name ? <p className="field-error">⚠ {errors.name}</p> : null}
            <label className="field">
              <span>Email</span>
              <input type="text" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            {errors.email ? <p className="field-error">⚠ {errors.email}</p> : null}
            <label className="field">
              <span>Phone (optional)</span>
              <input type="text" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            {errors.phone ? <p className="field-error">⚠ {errors.phone}</p> : null}
            {depositCents > 0 ? (
              <>
                <p className="deposit-paragraph">{depositParagraph(depositCents)}</p>
                <label className="field field--check">
                  <input
                    type="checkbox"
                    checked={acceptDeposit}
                    onChange={(event) => setAcceptDeposit(event.target.checked)}
                  />
                  <span>{`I accept the €${euros(depositCents)} deposit and the refund rule above`}</span>
                </label>
                {errors.deposit ? <p className="field-error">⚠ {errors.deposit}</p> : null}
              </>
            ) : null}
            <button
              type="submit"
              className="button button--accent"
              disabled={!holdLive || confirming}
            >
              {confirming
                ? 'Booking...'
                : depositCents > 0
                  ? `Pay €${euros(depositCents)} and book`
                  : 'Book table'}
            </button>
          </form>
        </section>
      </div>
      <Link className="link" to={waitlistHref}>
        Join the waitlist
      </Link>
    </div>
  );
}

function SlotList({
  slots,
  date,
  chosen,
  onChoose,
}: {
  slots: AvailabilityResponse['slots'];
  date: string;
  chosen: string | null;
  onChoose: (time: string) => void;
}): JSX.Element {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    slots.findIndex((slot) => slot.time === chosen),
  );

  const move = (index: number): void => {
    const next = Math.min(Math.max(index, 0), slots.length - 1);
    refs.current[next]?.focus();
  };

  return (
    <div role="listbox" aria-label="Times" className="slots">
      {slots.map((slot, index) => (
        <div
          key={slot.time}
          ref={(node) => {
            refs.current[index] = node;
          }}
          role="option"
          aria-label={slotOptionName(slot, date)}
          aria-selected={slot.time === chosen}
          aria-disabled={!slot.bookable}
          tabIndex={index === activeIndex ? 0 : -1}
          className={`slot${slot.bookable ? '' : ' slot--closed'}${
            slot.time === chosen ? ' slot--chosen' : ''
          }`}
          onClick={() => {
            if (slot.bookable) onChoose(slot.time);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              move(index + 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              move(index - 1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              move(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              move(slots.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (slot.bookable) onChoose(slot.time);
            }
          }}
        >
          <span className="tabular">{slotOptionName(slot, date)}</span>
        </div>
      ))}
    </div>
  );
}
