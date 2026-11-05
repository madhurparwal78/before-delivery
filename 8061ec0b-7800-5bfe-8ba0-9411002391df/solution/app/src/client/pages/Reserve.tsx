// Reserve an instrument: student, instrument and size pickers that follow live availability, the waiver, the terms
// in force today and the delivery line that follows the store's cutoff on the server's clock.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AvailabilityItem, Contract, FamilyOverview, PriceList, School } from "../../shared/api.js";
import { formatMoney, formatTaxPercent } from "../../shared/money.js";
import { formatDate, formatDateTime } from "../../shared/storeTime.js";
import { INSTRUMENT_TYPES, instrumentName, sizesFor, sizeWord, type InstrumentType, type Size } from "../../shared/vocabulary.js";
import { call, NETWORK_COPY } from "../api.js";
import { useApp } from "../app.js";
import { errorNotice, info, quiet, Status, type Notice } from "../components/ui.js";
import { hasPassed, SERVER_CLOCK_REFRESH_MS } from "../serverClock.js";

const AVAILABILITY_REFRESH_MS = 5_000;

function countOf(items: AvailabilityItem[], type: InstrumentType, size: Size): number {
  return items.find((i) => i.instrument_type === type && i.size === size)?.available ?? 0;
}

function firstAvailable(items: AvailabilityItem[], type: InstrumentType): Size | null {
  return sizesFor(type).find((s) => countOf(items, type, s) > 0) ?? null;
}

export function Reserve(): ReactNode {
  const { location } = useApp();
  const [family, setFamily] = useState<FamilyOverview | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [priceList, setPriceList] = useState<PriceList | null>(null);
  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [student, setStudent] = useState<string | null>(new URLSearchParams(location.search).get("student"));
  const [instrument, setInstrument] = useState<InstrumentType | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [waiver, setWaiver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(quiet);
  const [alternatives, setAlternatives] = useState<AvailabilityItem[] | null>(null);
  // the four first loads that fill the form; it is shown once all have settled, so it never grows under the reader
  const [settled, setSettled] = useState(0);
  const settle = (): void => setSettled((n) => n + 1);
  const sizeRadios = useRef(new Map<Size, HTMLInputElement>());
  const altList = useRef<HTMLUListElement>(null);
  const focusSize = useRef<Size | null>(null);
  const focusAlternative = useRef(false);
  const selection = useRef({ instrument, size });
  selection.current = { instrument, size };

  /** Applies a fresh availability listing in place; a size that ran out under the selection hands it on. */
  const applyAvailability = useCallback((fresh: AvailabilityItem[], announce: boolean) => {
    setItems(fresh);
    const { instrument: type, size: chosen } = selection.current;
    if (type === null || chosen === null || countOf(fresh, type, chosen) > 0) return;
    const next = firstAvailable(fresh, type);
    const hadFocus = document.activeElement === sizeRadios.current.get(chosen);
    setSize(next);
    if (next !== null && hadFocus) focusSize.current = next;
    if (!announce) return;
    setNotice(next === null ? info(`No ${instrumentName(type)} is available right now.`)
      : info(`The last ${sizeWord(chosen)} ${instrumentName(type)} was just reserved. ${sizeWord(next)} ${instrumentName(type)} is selected instead.`));
  }, []);

  const refreshAvailability = useCallback(async (announce: boolean): Promise<AvailabilityItem[] | null> => {
    const r = await call<{ items: AvailabilityItem[] }>("GET", "/api/availability");
    if (!r.ok) return null;
    applyAvailability(r.data.items, announce);
    return r.data.items;
  }, [applyAvailability]);

  const refreshSchools = useCallback(async () => {
    const r = await call<{ schools: School[] }>("GET", "/api/schools");
    if (r.ok) setSchools(r.data.schools);
  }, []);

  useEffect(() => {
    void call<FamilyOverview>("GET", "/api/family").then((r) => {
      if (r.ok) setFamily(r.data);
      else setNotice(errorNotice(NETWORK_COPY));
    }).finally(settle);
    void call<{ price_list: PriceList }>("GET", "/api/price-lists/current").then((r) => {
      if (r.ok) setPriceList(r.data.price_list);
    }).finally(settle);
    void refreshAvailability(false).finally(settle);
    void refreshSchools().finally(settle);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshAvailability(true);
    }, AVAILABILITY_REFRESH_MS);
    const schoolsPoll = window.setInterval(() => void refreshSchools(), SERVER_CLOCK_REFRESH_MS);
    const onFocus = (): void => void refreshAvailability(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(schoolsPoll);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshAvailability, refreshSchools]);

  const schoolId = family?.students.find((s) => s.id === student)?.school.id;
  const school = schools.find((s) => s.id === schoolId);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!school) return;
    const timer = window.setInterval(() => {
      if (hasPassed(school.cutoff_at)) {
        setTick((n) => n + 1);
        void refreshSchools();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [school, refreshSchools]);
  const day = school?.upcoming_delivery_days.find((d) => !hasPassed(d.cutoff_at));

  useLayoutEffect(() => {
    if (focusSize.current !== null) {
      sizeRadios.current.get(focusSize.current)?.focus();
      focusSize.current = null;
    }
    if (focusAlternative.current && altList.current) {
      altList.current.querySelector("button")?.focus();
      focusAlternative.current = false;
    }
  });

  const submit = (chosenSize: Size | null = size): void => {
    setBusy(true);
    setAlternatives(null);
    setNotice(info("Reserving…"));
    const studentName = family?.students.find((s) => s.id === student)?.name ?? "";
    void call<{ contract: Contract }>("POST", "/api/reservations",
      { student_id: student ?? "", instrument_type: instrument, size: chosenSize, waiver }).then(async (r) => {
      setBusy(false);
      void refreshSchools();
      if (r.ok) {
        const c = r.data.contract;
        setInstrument(null);
        setSize(null);
        setNotice(info(`Reserved ${c.instrument.label} ${c.instrument.serial} for ${c.student.name}. Hold until ${formatDateTime(c.hold_expires_at ?? "")}. Delivery day ${formatDate(c.delivery_date)}.`));
        void refreshAvailability(false);
        return;
      }
      if (r.status === 409 && r.error?.code === "unavailable" && instrument !== null && chosenSize !== null) {
        await refreshAvailability(false);
        const others = r.error.alternatives ?? [];
        setNotice(errorNotice(others.length > 0 ? `That ${sizeWord(chosenSize)} ${instrumentName(instrument)} is no longer available.`
          : "Nothing else is available in that instrument right now."));
        setAlternatives(others);
        focusAlternative.current = others.length > 0;
      } else if (r.status === 409 && r.error?.code === "student_has_instrument") {
        setNotice(errorNotice(`${studentName} already has an instrument on contract.`));
      } else if (r.status === 422 || r.status === 404) {
        setNotice(errorNotice("Choose a student, instrument and size."));
      } else {
        setNotice(errorNotice(NETWORK_COPY));
      }
    });
  };

  const terms = instrument && priceList?.items.find((i) => i.instrument_type === instrument);
  const instrumentRunOut = instrument !== null && items.length > 0 && firstAvailable(items, instrument) === null;

  return (
    <section className="page reserve">
      <header className="page__head">
        <p className="eyebrow">My family</p>
        <h1>Reserve an instrument</h1>
        <p className="lede">Choose a child, an instrument and a size. The hold keeps the instrument for you until the agreement is signed.</p>
      </header>
      <form className="reserve__form" noValidate aria-busy={settled < 4} style={settled < 4 ? { visibility: "hidden" } : undefined} onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}>
        <fieldset className="picker">
          <legend className="picker__legend">Student</legend>
          <div role="radiogroup" aria-label="Student" className="picker__options">
            {(family?.students ?? []).map((s) => (
              <label key={s.id} className="choice">
                <input type="radio" name="student" value={s.id} checked={student === s.id} onChange={() => setStudent(s.id)} />
                <span className="choice__text">{s.name}<span className="choice__hint" aria-hidden="true">{s.school.name}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="picker">
          <legend className="picker__legend">Instrument</legend>
          <div role="radiogroup" aria-label="Instrument" className="picker__options">
            {INSTRUMENT_TYPES.map((t) => (
              <label key={t} className="choice">
                <input type="radio" name="instrument" value={t} checked={instrument === t} onChange={() => {
                  setInstrument(t);
                  setAlternatives(null);
                  setSize(firstAvailable(items, t));
                  void refreshAvailability(false).then((fresh) => {
                    if (fresh !== null && selection.current.instrument === t) setSize(firstAvailable(fresh, t));
                  });
                }} />
                <span className="choice__text">{instrumentName(t)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="picker">
          <legend className="picker__legend">Size</legend>
          {instrument === null ? <p className="muted">Choose an instrument to see its sizes.</p> : (
            <div role="radiogroup" aria-label="Size" className="picker__options">
              {sizesFor(instrument).map((s) => {
                const n = countOf(items, instrument, s);
                return (
                  <label key={`${instrument}-${s}`} className={`choice ${n === 0 ? "choice--none" : ""}`}>
                    <input type="radio" name="size" value={s} checked={size === s} disabled={n === 0}
                      ref={(node) => { if (node) sizeRadios.current.set(s, node); else sizeRadios.current.delete(s); }}
                      onChange={() => setSize(s)} />
                    <span className="choice__text">{sizeWord(s)}, {n === 0 ? "none available" : `${n} available`}</span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.currentTarget.checked)} />
          <span>Add maintenance and damage waiver</span>
        </label>
        <section className="reserve__terms" aria-label="Terms in force today">
          <h2 className="h3">Terms in force today</h2>
          {terms && priceList ? (
            <dl className="terms-list">
              <div><dt>Monthly rent</dt><dd className="figure">{formatMoney(terms.base_rent_cents)}</dd></div>
              <div><dt>Waiver</dt><dd className="figure">{waiver ? formatMoney(terms.waiver_cents) : `${formatMoney(terms.waiver_cents)} if added`}</dd></div>
              <div><dt>Purchase price</dt><dd className="figure">{formatMoney(terms.purchase_price_cents)}</dd></div>
              <div><dt>Sales tax</dt><dd className="figure">{formatTaxPercent(priceList.tax_rate_bp)}</dd></div>
              <div><dt>Price list</dt><dd className="figure">{priceList.id}</dd></div>
            </dl>
          ) : <p className="muted">Choose an instrument to see its rent, waiver and purchase price.</p>}
        </section>
        <p className="delivery-line">
          {school && day ? `Reserve before ${formatDateTime(day.cutoff_at)} for delivery day ${formatDate(day.date)}.`
            : "Choose a student to see the delivery day."}
        </p>
        <button type="submit" className="button button--primary" disabled={busy || instrumentRunOut}>Reserve instrument</button>
        <Status label="Reservation status" notice={notice} />
        {alternatives !== null && alternatives.length > 0 && instrument !== null && (
          <ul ref={altList} aria-label="Available instead" className="alternatives">
            {alternatives.map((a) => (
              <li key={a.size}>
                <button type="button" className="button button--secondary" onClick={() => {
                  setSize(a.size);
                  submit(a.size);
                }}>Reserve {sizeWord(a.size)} {instrumentName(instrument)}</button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </section>
  );
}
