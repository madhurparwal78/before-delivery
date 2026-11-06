import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatMoney, formatTaxPercent, termMonths } from '../../shared/money';
import { instrumentName, sizeLabel } from '../../shared/labels';
import { formatStoreDate, formatStoreDateTime } from '../../shared/time';
import {
  INSTRUMENT_TYPES,
  type AvailabilityItem,
  type Contract,
  type FamilyResponse,
  type InstrumentType,
  type PriceList,
  type School,
  type Size,
} from '../../shared/types';
import { api, ApiFailure, NetworkFailure } from '../lib/api';
import { NETWORK_COPY, PENDING } from '../lib/copy';
import { serverNow } from '../lib/serverClock';
import { StatusLine } from '../components/StatusLine';

function sizesOf(items: AvailabilityItem[], type: InstrumentType): AvailabilityItem[] {
  return items.filter((item) => item.instrument_type === type);
}

export function Reserve(): ReactNode {
  const [params] = useSearchParams();
  const [family, setFamily] = useState<FamilyResponse | null>(null);
  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [priceList, setPriceList] = useState<PriceList | null>(null);
  const [studentId, setStudentId] = useState(params.get('student') ?? '');
  const [type, setType] = useState<InstrumentType>('cello');
  const [size, setSize] = useState<Size | null>(null);
  const [waiver, setWaiver] = useState(false);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [alternatives, setAlternatives] = useState<AvailabilityItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [deliveryTick, setDeliveryTick] = useState(0);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const alternativesRef = useRef<HTMLButtonElement>(null);
  const sizeRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const reserved = useRef(false);

  const loadAvailability = useCallback(async () => {
    const answer = await api<{ items: AvailabilityItem[] }>('/availability');
    setItems(answer.items);
  }, []);

  const loadSchools = useCallback(async () => {
    const answer = await api<{ server_now: string; schools: School[] }>('/schools');
    setSchools(answer.schools);
  }, []);

  useEffect(() => {
    void (async () => {
      const answer = await api<FamilyResponse>('/family');
      setFamily(answer);
      setStudentId((current) => (current === '' ? answer.students[0]?.id ?? '' : current));
      setPriceList((await api<{ price_list: PriceList }>('/price-lists/current')).price_list);
      await Promise.all([loadAvailability(), loadSchools()]);
    })();
  }, [loadAvailability, loadSchools]);

  useEffect(() => {
    const timer = setInterval(() => void loadAvailability().catch(() => undefined), 5000);
    const schoolTimer = setInterval(() => void loadSchools().catch(() => undefined), 60000);
    const onFocus = (): void => void loadAvailability().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      clearInterval(schoolTimer);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadAvailability, loadSchools]);

  useEffect(() => {
    const timer = setInterval(() => setDeliveryTick((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, []);

  const sizes = sizesOf(items, type);

  useEffect(() => {
    if (sizes.length === 0) return;
    const current = sizes.find((item) => item.size === size);
    if (size === null || current === undefined) {
      const first = sizes.find((item) => item.available > 0);
      setSize(first?.size ?? null);
      return;
    }
    if (current.available === 0) {
      const first = sizes.find((item) => item.available > 0);
      if (first === undefined) {
        setSize(null);
        if (!reserved.current) {
          setStatus(`No ${instrumentName(type)} is available right now.`);
          setStatusError(false);
        }
        return;
      }
      const hadFocus = document.activeElement === sizeRefs.current[current.size];
      setSize(first.size);
      if (!reserved.current) {
        setStatus(
          `The last ${sizeLabel(type, current.size)} ${instrumentName(type)} was just reserved. ${sizeLabel(
            type,
            first.size,
          )} ${instrumentName(type)} is selected instead.`,
        );
        setStatusError(false);
      }
      if (hadFocus) {
        requestAnimationFrame(() => sizeRefs.current[first.size]?.focus());
      }
    }
  }, [items, type, size, sizes]);

  const student = family?.students.find((entry) => entry.id === studentId) ?? null;
  const school = schools.find((entry) => entry.id === student?.school.id) ?? null;

  const upcoming = school?.upcoming_delivery_days ?? [];
  const estimate = serverNow();
  const nextDay =
    estimate === null
      ? upcoming[0]
      : upcoming.find((day) => Date.parse(day.cutoff_at) > estimate) ?? upcoming[upcoming.length - 1];
  void deliveryTick;

  const item = priceList?.items.find((entry) => entry.instrument_type === type) ?? null;

  const reserve = async (chosenSize: Size | null): Promise<void> => {
    if (chosenSize === null) return;
    setBusy(true);
    setAlternatives(null);
    setStatus(PENDING.reserve);
    setStatusError(false);
    try {
      const answer = await api<{ contract: Contract }>('/reservations', {
        method: 'POST',
        body: { student_id: studentId, instrument_type: type, size: chosenSize, waiver },
      });
      const contract = answer.contract;
      reserved.current = true;
      setStatus(
        `Reserved ${contract.instrument.label} ${contract.instrument.serial} for ${contract.student.name}. Hold until ${formatStoreDateTime(
          contract.hold_expires_at ?? '',
        )}. Delivery day ${formatStoreDate(contract.delivery_date ?? '')}.`,
      );
      await Promise.all([loadAvailability(), loadSchools()]);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'unavailable') {
        const list = error.alternatives ?? [];
        setStatus(
          list.length === 0
            ? 'Nothing else is available in that instrument right now.'
            : `That ${sizeLabel(type, chosenSize)} ${instrumentName(type)} is no longer available.`,
        );
        setStatusError(true);
        setAlternatives(list);
        await loadAvailability();
        if (list.length > 0) requestAnimationFrame(() => alternativesRef.current?.focus());
      } else if (error instanceof ApiFailure && error.code === 'student_has_instrument') {
        setStatus(`${student?.name ?? 'That student'} already has an instrument on contract.`);
        setStatusError(true);
      } else if (error instanceof ApiFailure && error.status === 422) {
        setStatus('Choose a student, instrument and size.');
        setStatusError(true);
      } else if (error instanceof NetworkFailure) {
        setStatus(NETWORK_COPY);
        setStatusError(true);
      } else if (error instanceof ApiFailure) {
        setStatus(error.message);
        setStatusError(true);
      }
      await loadSchools();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <h1>Reserve an instrument</h1>

      <p className="label">Student</p>
      <div role="radiogroup" aria-label="Student" className="radio-row">
        {(family?.students ?? []).map((entry) => (
          <label key={entry.id}>
            <input
              type="radio"
              name="student"
              value={entry.id}
              checked={studentId === entry.id}
              onChange={() => {
              reserved.current = false;
              setStudentId(entry.id);
            }}
            />
            {entry.name}
          </label>
        ))}
      </div>

      <p className="label">Instrument</p>
      <div role="radiogroup" aria-label="Instrument" className="radio-row">
        {INSTRUMENT_TYPES.map((entry) => (
          <label key={entry}>
            <input
              type="radio"
              name="instrument"
              value={entry}
              checked={type === entry}
              onChange={() => {
                reserved.current = false;
                setType(entry);
                setSize(null);
              }}
            />
            {instrumentName(entry)}
          </label>
        ))}
      </div>

      <p className="label">Size</p>
      <div role="radiogroup" aria-label="Size" className="radio-row">
        {sizes.map((entry) => {
          const name =
            entry.available > 0
              ? `${sizeLabel(type, entry.size)}, ${entry.available} available`
              : `${sizeLabel(type, entry.size)}, none available`;
          return (
            <label key={entry.size}>
              <input
                type="radio"
                name="size"
                value={entry.size}
                disabled={entry.available === 0}
                checked={size === entry.size}
                ref={(element) => {
                  sizeRefs.current[entry.size] = element;
                }}
                onChange={() => {
                  reserved.current = false;
                  setSize(entry.size);
                }}
              />
              {name}
            </label>
          );
        })}
      </div>

      <div className="field">
        <label>
          <input type="checkbox" checked={waiver} onChange={(event) => setWaiver(event.target.checked)} /> Add
          maintenance and damage waiver
        </label>
      </div>

      {item === null || priceList === null ? null : (
        <ul className="terms-list" aria-label="Terms today">
          <li>
            <span className="label">Monthly rent</span>
            <span className="figure">{formatMoney(item.base_rent_cents)}</span>
          </li>
          <li>
            <span className="label">Waiver</span>
            <span className="figure">{formatMoney(item.waiver_cents)}</span>
          </li>
          <li>
            <span className="label">Purchase price</span>
            <span className="figure">{formatMoney(item.purchase_price_cents)}</span>
          </li>
          <li>
            <span className="label">Sales tax</span>
            <span className="figure">{formatTaxPercent(priceList.tax_rate_bp)}</span>
          </li>
          <li>
            <span className="label">Term</span>
            <span className="figure">{`${termMonths(item.purchase_price_cents, item.base_rent_cents)} months`}</span>
          </li>
        </ul>
      )}

      <p>
        {nextDay === undefined
          ? ''
          : `Reserve before ${formatStoreDateTime(nextDay.cutoff_at)} for delivery day ${formatStoreDate(
              nextDay.date,
            )}.`}
      </p>

      <button
        type="button"
        className="primary"
        disabled={busy || size === null || studentId === ''}
        onClick={() => void reserve(size)}
      >
        Reserve instrument
      </button>

      <StatusLine name="Reservation status" text={status} error={statusError} ref={statusRef} />

      {alternatives !== null && alternatives.length > 0 ? (
        <ul className="plain" aria-label="Available instead">
          {alternatives.map((entry, index) => (
            <li key={`${entry.instrument_type}-${entry.size}`}>
              <button
                type="button"
                ref={index === 0 ? alternativesRef : undefined}
                onClick={() => {
                  setSize(entry.size);
                  void reserve(entry.size);
                }}
              >
                {`Reserve ${sizeLabel(entry.instrument_type, entry.size)} ${instrumentName(entry.instrument_type)}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

    </main>
  );
}
