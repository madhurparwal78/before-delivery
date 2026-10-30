import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair } from 'lucide-react';
import { apiGet, apiSend, serverSkewMs } from '../api';
import { useFeedback } from '../feedback';
import { Dialog } from '../components/Dialog';
import { ServiceDial, type StationState, type StationTile } from '../components/ServiceDial';
import {
  countdownText,
  currentStep,
  formatMinuteOfDay,
  kitchenToday,
  shiftDate,
} from '../kitchenTime';
import type { Booking, DialBlock, DialDay, DialStation, Hold, Policy, Tenant, User } from '../types';

const MIN_HOLD_MINUTES = 60;
const REFRESH_MS = 30_000;

interface InstantState {
  station: DialStation;
  state: StationState;
  block: DialBlock | null;
}

function instantFor(station: DialStation, minute: number): InstantState {
  const probe = Math.min(minute, 1439);
  const covering = station.blocks.filter(
    (block) => block.start_minute <= probe && probe < block.end_minute,
  );
  const occupying = covering.find((block) => block.kind !== 'cleaning');
  if (occupying) {
    return { station, state: occupying.kind === 'hold' ? 'held' : 'booked', block: occupying };
  }
  const cleaning = covering[0];
  if (cleaning) return { station, state: 'cleaning', block: cleaning };
  return { station, state: 'free', block: null };
}

function stateWord(entry: InstantState): string {
  if (entry.state === 'free') return 'free';
  if (entry.state === 'cleaning') return 'cleaning';
  const name = entry.block?.tenant_name;
  if (entry.state === 'held') return name ? `held by ${name}` : 'booked';
  return name ? `booked by ${name}` : 'booked';
}

function useSettled<T>(value: T, delay: number, instant: boolean): [T, boolean] {
  const [settled, setSettled] = useState(value);
  const [moving, setMoving] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (instant) {
      setSettled(value);
      return;
    }
    if (Object.is(value, settled) || timer.current !== null) return;
    setMoving(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setSettled(latest.current);
      window.setTimeout(() => setMoving(false), 220);
    }, delay);
  }, [value, settled, delay, instant]);

  return [settled, moving];
}

export function DialScreen({
  user,
  reducedMotion,
}: {
  user: User;
  reducedMotion: boolean;
}): JSX.Element {
  const { perform, background, reportProblem, fieldErrors } = useFeedback();
  const [date, setDate] = useState(() => kitchenToday());
  const [value, setValue] = useState(() => currentStep());
  const [day, setDay] = useState<DialDay | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [payWith, setPayWith] = useState<'account' | 'hour_pack'>('account');
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [arc, setArc] = useState<{ start: number; end: number; pending: boolean } | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const confirmKey = useRef<{ id: string; key: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadDay = useCallback(
    async (target: string, announce: boolean): Promise<void> => {
      const options = {
        errors: () => "Couldn't load the day. Retrying in 30 seconds.",
        run: () => apiGet<DialDay>(`/api/dial?date=${target}`),
      };
      const result = announce
        ? await perform({ pending: 'Loading the day…', success: () => '', ...options })
        : await background(options);
      if (result) setDay(result);
    },
    [perform, background],
  );

  useEffect(() => {
    void loadDay(date, true);
  }, [date, loadDay]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadDay(date, false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [date, loadDay]);

  useEffect(() => {
    void apiGet<{ current: Policy }>('/api/cancellation-policy')
      .then((result) => setPolicy(result.current))
      .catch(() => setPolicy(null));
    void apiGet<{ tenants: Tenant[] }>('/api/tenants')
      .then((result) => setTenants(result.tenants))
      .catch(() => setTenants([]));
  }, []);

  useEffect(() => {
    if (!hold) return undefined;
    const tick = (): void => {
      const left = Date.parse(hold.expires_at) - (Date.now() - serverSkewMs());
      setRemainingMs(left);
      if (left <= 0) {
        setHold(null);
        void loadDay(date, false);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [hold, date, loadDay]);

  const stations = day?.stations ?? [];
  const hasLiveHoldBlock = stations.some((station) =>
    station.blocks.some((block) => block.kind === 'hold'),
  );
  const [, setHoldTick] = useState(0);
  useEffect(() => {
    if (!hasLiveHoldBlock) return undefined;
    const timer = window.setInterval(() => setHoldTick((count) => count + 1), 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveHoldBlock]);

  const instants = useMemo(
    () => stations.map((station) => instantFor(station, value)),
    [stations, value],
  );
  const openCount = instants.filter((entry) => entry.state === 'free').length;

  const [settledValue, rolling] = useSettled(value, 100, reducedMotion);
  const [settledTileValue, fading] = useSettled(value, 50, reducedMotion);
  const settledInstants = useMemo(
    () => stations.map((station) => instantFor(station, settledTileValue)),
    [stations, settledTileValue],
  );
  const settledOpenCount = useMemo(
    () => stations.filter((station) => instantFor(station, settledValue).state === 'free').length,
    [stations, settledValue],
  );

  const heldLabel = (entry: InstantState): string => {
    if (entry.state === 'free') return 'Free';
    if (entry.state === 'cleaning') return 'Cleaning';
    if (entry.state === 'held' && entry.block?.expires_at) {
      const left = Date.parse(entry.block.expires_at) - (Date.now() - serverSkewMs());
      return `Held ${countdownText(left)}`;
    }
    return 'Booked';
  };

  const tiles: StationTile[] = settledInstants.map((entry) => ({
    id: entry.station.id,
    name: entry.station.name,
    state: entry.state,
    tileLabel: heldLabel(entry),
    accessibleName: `${entry.station.name}, ${stateWord(entry)}`,
  }));

  const selected = instants.find((entry) => entry.station.id === selectedStationId) ?? null;
  const selectedFree = selected !== null && selected.state === 'free';

  const refresh = useCallback(() => void loadDay(date, false), [date, loadDay]);

  const placeHold = async (
    stationId: string,
    startLocal: string,
    endLocal: string,
    weeks: number,
    notes: string,
    tenantId: string | null,
  ): Promise<Hold | null> => {
    const body: Record<string, unknown> = {
      station_id: stationId,
      date,
      start_local: startLocal,
      end_local: endLocal,
      weeks,
      notes,
    };
    if (tenantId) body['tenant_id'] = tenantId;
    const station = stations.find((candidate) => candidate.id === stationId);
    const result = await perform({
      pending: 'Placing hold…',
      success: (placed: Hold) =>
        `Hold ${placed.ref} placed. It expires at ${placed.expires_at.slice(11, 19)}.`,
      errors: (failure) => {
        if (failure.code === 'slot_taken') {
          return `${station ? station.name : 'That station'} isn't free for that whole time, including cleaning. Pick another gap.`;
        }
        if (failure.code === 'tenant_not_active') {
          return "Your business can't book right now. Check Documents.";
        }
        if (failure.code === 'document_expires_before_booking') {
          return 'A required document expires before this booking. Upload a renewal first.';
        }
        if (failure.code === 'validation_failed') return 'Check the start and end times.';
        return null;
      },
      run: () => apiSend<Hold>('POST', '/api/holds', body),
    });
    if (result) {
      setHold(result);
      setPayWith('account');
      refresh();
    }
    return result;
  };

  const onArcRelease = (span: { start: number; end: number }): void => {
    if (!selectedStationId) {
      setArc(null);
      return;
    }
    if (span.end - span.start < MIN_HOLD_MINUTES) {
      setArc(null);
      reportProblem('Check the start and end times.');
      return;
    }
    setArc({ ...span, pending: true });
    void placeHold(
      selectedStationId,
      formatMinuteOfDay(span.start),
      formatMinuteOfDay(span.end),
      1,
      '',
      user.role === 'operator' ? (activeTenants[0]?.id ?? null) : null,
    ).then((result) => {
      setArc(result ? { ...span, pending: false } : null);
      if (result) window.setTimeout(() => setArc(null), 400);
    });
  };

  const releaseHold = async (): Promise<void> => {
    if (!hold) return;
    const ref = hold.ref;
    const result = await perform({
      pending: 'Releasing hold…',
      success: () => `Hold ${ref} released.`,
      errors: (failure) => (failure.status === 404 ? 'That hold is no longer live.' : null),
      run: () => apiSend<void>('DELETE', `/api/holds/${ref}`, null),
    });
    if (result !== null) setHold(null);
    refresh();
  };

  const confirmHold = async (): Promise<void> => {
    if (!hold) return;
    const ref = hold.ref;
    const attemptId = `${ref}:${payWith}`;
    if (!confirmKey.current || confirmKey.current.id !== attemptId) {
      confirmKey.current = { id: attemptId, key: crypto.randomUUID() };
    }
    setConfirming(true);
    const result = await perform({
      pending: 'Confirming…',
      success: () => `Booked. Confirmation for ${ref} was emailed to ${ownerEmail}.`,
      errors: (failure) => {
        confirmKey.current = null;
        if (failure.code === 'hold_expired') {
          return 'This hold expired. Place it again if the time is still free.';
        }
        if (failure.code === 'invalid_transition') return 'This hold is already confirmed.';
        if (failure.code === 'tenant_not_active') {
          return "Your business can't book right now. Check Documents.";
        }
        if (failure.code === 'document_expires_before_booking') {
          return 'A required document expires before this booking. Upload a renewal first.';
        }
        if (failure.code === 'insufficient_hours') {
          const needed = Number(failure.details['needed_minutes'] ?? 0);
          const balance = Number(failure.details['balance_minutes'] ?? 0);
          return `Your hour pack has ${hoursText(balance)} left; this booking needs ${hoursText(needed)}.`;
        }
        if (failure.code === 'billing_unavailable') {
          return 'Billing is unreachable. Nothing was booked or charged, and your hold is kept until it expires.';
        }
        if (failure.code === 'mail_unavailable') {
          return 'Email is unreachable. Nothing was booked or charged, and your hold is kept until it expires.';
        }
        return null;
      },
      run: () =>
        apiSend<{ ref: string; bookings: Booking[] }>(
          'POST',
          `/api/holds/${ref}/confirm`,
          { pay_with: payWith },
          { idempotencyKey: confirmKey.current!.key },
        ),
    });
    setConfirming(false);
    if (result) {
      confirmKey.current = null;
      setHold(null);
    }
    refresh();
  };

  const activeTenants = useMemo(
    () => tenants.filter((tenant) => tenant.status === 'active'),
    [tenants],
  );

  const ownerEmail = useMemo(() => {
    const target = hold ? hold.tenant_id : user.tenant_id;
    const tenant = tenants.find((candidate) => candidate.id === target);
    return tenant ? tenant.owner_email : 'the tenant owner';
  }, [tenants, hold, user.tenant_id]);

  return (
    <div className="dial-screen">
      <div className="dial-column">
        <h1>Service dial</h1>
        <div className="day-bar">
          <button type="button" onClick={() => setDate(shiftDate(date, -1))}>
            <ChevronLeft size={16} aria-hidden="true" />
            Previous day
          </button>
          <div>
            <label htmlFor="dial-day">Day</label>
            <input
              id="dial-day"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <button type="button" onClick={() => setDate(shiftDate(date, 1))}>
            <ChevronRight size={16} aria-hidden="true" />
            Next day
          </button>
          <button
            type="button"
            onClick={() => {
              setDate(kitchenToday());
              setValue(currentStep());
            }}
          >
            <Crosshair size={16} aria-hidden="true" />
            Now
          </button>
        </div>
        <div className="dial-wrap">
          <ServiceDial
            value={value}
            onValue={setValue}
            tiles={tiles}
            selectedStationId={selectedStationId}
            onSelectStation={setSelectedStationId}
            openCount={openCount}
            stationCount={stations.length}
            displayedValue={settledValue}
            displayedOpenCount={settledOpenCount}
            rolling={rolling}
            fadingTiles={fading}
            reducedMotion={reducedMotion}
            arcEnabled={selectedFree}
            arc={arc}
            onArcChange={(next) => setArc(next ? { ...next, pending: false } : null)}
            onArcRelease={onArcRelease}
          />
        </div>
      </div>

      <section className="rail" aria-label="Selected instant">
        <h2>Selected instant</h2>
        {instants.map((entry, index) => (
          <div
            key={entry.station.id}
            className={`rail-row${entry.station.id === selectedStationId ? ' selected' : ''}`}
          >
            <span className="num">{String(index + 1).padStart(2, '0')}</span>
            <span>
              {entry.station.name}
              <br />
              <strong>{railStateLabel(entry)}</strong>
              {entry.block?.tenant_name ? ` — ${entry.block.tenant_name}` : ''}
              {entry.station.id === selectedStationId && entry.block ? (
                <span className="mono"> {detailFor(entry, user)}</span>
              ) : null}
            </span>
            <span className="num">
              {entry.block ? `until ${formatMinuteOfDay(entry.block.end_minute)}` : ''}
            </span>
          </div>
        ))}

        <div className="rail-actions">
          <button
            type="button"
            className="primary"
            disabled={!selectedFree}
            onClick={() => setPlaceOpen(true)}
          >
            Hold this station
          </button>

          {reducedMotion ? (
            <TimeListbox value={value} onValue={setValue} />
          ) : null}
        </div>

        {hold ? (
          <section className="hold-panel" aria-label={`Hold ${hold.ref}`}>
            <h3>Hold {hold.ref}</h3>
            <div role="timer" aria-label="Hold time left" className="hold-timer">
              Expires in {countdownText(remainingMs)}
            </div>
            <div role="radiogroup" aria-label="Pay with" className="radio-row">
              <label>
                <input
                  type="radio"
                  name="pay-with"
                  value="account"
                  checked={payWith === 'account'}
                  onChange={() => setPayWith('account')}
                />
                Account
              </label>
              <label>
                <input
                  type="radio"
                  name="pay-with"
                  value="hour_pack"
                  checked={payWith === 'hour_pack'}
                  onChange={() => setPayWith('hour_pack')}
                />
                Hour pack
              </label>
            </div>
            {policy ? (
              <p className="policy-line">
                Cancellation: free until {policy.free_window_hours} hours before start, then{' '}
                {policy.late_fee_percent}% charge (policy v{policy.version})
              </p>
            ) : null}
            <div className="row-actions">
              <button
                type="button"
                className="primary"
                disabled={confirming}
                onClick={() => void confirmHold()}
              >
                Confirm booking
              </button>
              <button type="button" onClick={() => void releaseHold()}>
                Release hold
              </button>
            </div>
          </section>
        ) : null}
      </section>

      {placeOpen && selected ? (
        <PlaceHoldDialog
          stationName={selected.station.name}
          defaultStart={Math.min(value, 1380)}
          tenants={user.role === 'operator' ? activeTenants : []}
          fieldErrors={fieldErrors}
          onClose={() => setPlaceOpen(false)}
          onSubmit={async (form) => {
            const placed = await placeHold(
              selected.station.id,
              form.start,
              form.end,
              form.weeks,
              form.notes,
              form.tenantId,
            );
            if (placed) setPlaceOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function hoursText(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function railStateLabel(entry: InstantState): string {
  if (entry.state === 'free') return 'Free';
  if (entry.state === 'cleaning') return 'Cleaning';
  if (entry.state === 'held') return 'Held';
  return 'Booked';
}

function detailFor(entry: InstantState, user: User): string {
  const block = entry.block;
  if (!block) return '';
  if (user.role === 'operator') {
    return `${block.contact_email ?? ''} ${block.notes ?? ''}`.trim();
  }
  if (block.tenant_id === user.tenant_id) {
    return `${block.ref ?? ''} ${formatMinuteOfDay(block.start_minute)}–${formatMinuteOfDay(block.end_minute)} ${block.notes ?? ''}`.trim();
  }
  return `Booked until ${formatMinuteOfDay(block.end_minute)}`;
}

function TimeListbox({
  value,
  onValue,
}: {
  value: number;
  onValue: (minute: number) => void;
}): JSX.Element {
  const options = useMemo(
    () => Array.from({ length: 97 }, (_, index) => index * 15),
    [],
  );
  return (
    <div
      role="listbox"
      aria-label="Time"
      tabIndex={0}
      className="time-listbox"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          onValue(Math.min(1440, value + 15));
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          onValue(Math.max(0, value - 15));
        }
      }}
    >
      {options.map((minute) => (
        <div
          key={minute}
          role="option"
          aria-selected={minute === value}
          onClick={() => onValue(minute)}
        >
          {formatMinuteOfDay(minute)}
        </div>
      ))}
    </div>
  );
}

interface PlaceHoldForm {
  start: string;
  end: string;
  weeks: number;
  notes: string;
  tenantId: string | null;
}

function PlaceHoldDialog({
  stationName,
  defaultStart,
  tenants,
  fieldErrors,
  onClose,
  onSubmit,
}: {
  stationName: string;
  defaultStart: number;
  tenants: Tenant[];
  fieldErrors: Record<string, string>;
  onClose: () => void;
  onSubmit: (form: PlaceHoldForm) => Promise<void>;
}): JSX.Element {
  const [start, setStart] = useState(formatMinuteOfDay(defaultStart));
  const [end, setEnd] = useState(formatMinuteOfDay(Math.min(1440, defaultStart + 60)));
  const [weeks, setWeeks] = useState(1);
  const [notes, setNotes] = useState('');
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const startOptions = Array.from({ length: 96 }, (_, index) => index * 15);
  const endOptions = Array.from({ length: 96 }, (_, index) => (index + 1) * 15);

  return (
    <Dialog title="Place hold" onClose={onClose}>
      <p>{stationName}</p>
      <div className="field">
        <label htmlFor="hold-start">Start</label>
        <select id="hold-start" value={start} onChange={(event) => setStart(event.target.value)}>
          {startOptions.map((minute) => (
            <option key={minute} value={formatMinuteOfDay(minute)}>
              {formatMinuteOfDay(minute)}
            </option>
          ))}
        </select>
        {fieldErrors['start_local'] ? (
          <p className="field-error">{fieldErrors['start_local']}</p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="hold-end">End</label>
        <select id="hold-end" value={end} onChange={(event) => setEnd(event.target.value)}>
          {endOptions.map((minute) => (
            <option key={minute} value={formatMinuteOfDay(minute)}>
              {formatMinuteOfDay(minute)}
            </option>
          ))}
        </select>
        {fieldErrors['end_local'] ? <p className="field-error">{fieldErrors['end_local']}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="hold-weeks">Repeat weekly</label>
        <select
          id="hold-weeks"
          value={weeks}
          onChange={(event) => setWeeks(Number.parseInt(event.target.value, 10))}
        >
          <option value={1}>Just this day</option>
          {Array.from({ length: 11 }, (_, index) => index + 2).map((count) => (
            <option key={count} value={count}>
              {count} weeks
            </option>
          ))}
        </select>
      </div>
      {tenants.length > 0 ? (
        <div className="field">
          <label htmlFor="hold-tenant">Tenant</label>
          <select
            id="hold-tenant"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
          >
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.business_name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="hold-notes">Notes</label>
        <textarea
          id="hold-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          style={{ width: '100%' }}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() =>
            void onSubmit({ start, end, weeks, notes, tenantId: tenantId === '' ? null : tenantId })
          }
        >
          Place hold
        </button>
      </div>
    </Dialog>
  );
}
