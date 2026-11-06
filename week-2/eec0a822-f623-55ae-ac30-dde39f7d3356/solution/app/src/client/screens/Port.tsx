import { useEffect, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import { formatDay, formatFigure, formatTime } from "../../shared/format";
import { formatMoney } from "../../shared/money";
import { localClock, type Base } from "../../shared/zones";
import { api, sharedCopy } from "../lib/api";
import { useInterval, useLoad } from "../lib/hooks";
import { navigate, setFlash, takeDraft, takeFlash, useDraft } from "../lib/nav";
import { bad, Button, Field, focusFirstError, NoteLine, ok, Problems, SelectField, useAction } from "../ui/Controls";
import { Dialog, useDialog } from "../ui/Dialog";
import { DataTable, NotFoundPage, type Member } from "../ui/Shell";
import { Loader } from "../ui/Visuals";
import { centimetres } from "./common";

interface Yacht {
  slug: string;
  name: string;
  base: Base;
}

interface Marina {
  id: string;
  name: string;
  base: Base;
  today: string;
  pontoons: { code: string; limitKw: number }[];
}

interface NightView {
  date: string;
  ratePerMetreMinor: number;
  feeMinor: number;
}

interface BerthView {
  code: string;
  lengthM: number;
  widthM: number;
  depthM: number;
  fits: boolean;
  available: boolean;
  nights: NightView[];
  totalMinor: number;
  currency: string;
}

const BASE_MARINA: Record<Base, string> = { split: "split-marina", lavrio: "lavrio-marina" };

function NightsTable({ nights, currency }: { nights: NightView[]; currency: string }) {
  return (
    <DataTable
      name="Nights"
      captionHidden
      rows={nights}
      rowKey={(n) => n.date}
      empty="No nights yet."
      columns={[
        { label: "Night", cell: (n) => <span class="fig">{formatDay(n.date)}</span> },
        { label: "Rate per metre", numeric: true, cell: (n) => <span class="fig">{formatMoney(currency, n.ratePerMetreMinor)}</span> },
        { label: "Fee", numeric: true, cell: (n) => <span class="fig">{formatMoney(currency, n.feeMinor)}</span> },
      ]}
    />
  );
}

const SEARCH_FIELDS: Record<string, { label: string; id: string }> = {
  arrivalDate: { label: "Arrival date", id: "berth-arrival" },
  nights: { label: "Nights", id: "berth-nights" },
};

export function Berths({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const yachts = useLoad<{ yachts: Yacht[] }>(`/api/w/${ws}/yachts`);
  const marinas = useLoad<{ marinas: Marina[] }>(`/api/w/${ws}/marinas`);
  const sorted = [...(yachts.data?.yachts ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const [form, setForm] = useState(() => takeDraft<{ yacht: string; marina: string; arrival: string; nights: string }>("berths")
    ?? { yacht: "", marina: "", arrival: "", nights: "1" });
  const [results, setResults] = useState<{ berths: BerthView[]; query: { yacht: string; marina: string; arrival: string; nights: number } } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<BerthView | null>(null);
  const search = useAction();
  const book = useAction();
  const sheet = useDialog();
  const bookButton = useRef<HTMLButtonElement>(null);
  useDraft("berths", form);
  const yacht = sorted.find((y) => y.slug === form.yacht) ?? sorted[0];
  const marinaId = form.marina || (yacht ? BASE_MARINA[yacht.base] : "");
  const marina = marinas.data?.marinas.find((m) => m.id === marinaId);

  const runSearch = (event: Event) => {
    event.preventDefault();
    if (!yacht || !marina) return;
    void search.run("", async () => {
      const nights = /^\d+$/.test(form.nights) ? form.nights : encodeURIComponent(form.nights);
      const result = await api<{ berths: BerthView[] }>(
        "GET",
        `/api/w/${ws}/marinas/${marina.id}/berths?yachtSlug=${yacht.slug}&arrivalDate=${encodeURIComponent(form.arrival)}&nights=${nights}`,
      );
      if (result.ok) {
        setErrors({});
        setResults({ berths: result.data.berths, query: { yacht: yacht.slug, marina: marina.id, arrival: form.arrival, nights: Number(form.nights) } });
        return null;
      }
      const found = result.body.errors ?? {};
      setErrors(found);
      search.focusLater(() => focusFirstError(Object.keys(SEARCH_FIELDS).filter((k) => found[k]).map((k) => SEARCH_FIELDS[k].id)));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  const confirm = () => {
    if (!chosen || !results) return;
    void book.run("Booking berth", async () => {
      const q = results.query;
      const result = await api<{ booking: { id: string; berthCode: string; arrivalDate: string } }>("POST", `/api/w/${ws}/berth-bookings`, {
        yachtSlug: q.yacht, marinaId: q.marina, berthCode: chosen.code, arrivalDate: q.arrival, nights: q.nights,
      });
      if (result.ok) {
        const path = `/w/${ws}/berth-bookings/${result.data.booking.id}`;
        setFlash(path, COPY.berthBooked(result.data.booking.berthCode, formatDay(result.data.booking.arrivalDate)));
        navigate(path);
        return null;
      }
      book.focusLater(() => bookButton.current?.focus());
      if (result.body.error === "berth_taken") return bad(COPY.berthTaken(chosen.code));
      if (result.body.error === "does_not_fit") return bad(COPY.berthNoFit(sorted.find((y) => y.slug === q.yacht)?.name ?? "", chosen.code));
      const fieldMessage = Object.values(result.body.errors ?? {})[0];
      return bad(fieldMessage ?? sharedCopy(result));
    });
  };

  return (
    <section>
      <h1 class="rise">Berths</h1>
      <p class="lede">Nights are the marina's local dates; each night is priced from the tariff in force on it.</p>
      <Loader active={yachts.loading || marinas.loading} />
      {/* The form shows with its data so nothing below the loader moves when it lands. */}
      {yachts.loading || marinas.loading ? null : <div class="two-col two-col--form">
        <form class="card form" onSubmit={runSearch} noValidate>
          <Problems errors={errors} labels={SEARCH_FIELDS} />
          <SelectField id="berth-yacht" label="Yacht" value={yacht?.slug ?? ""} onChange={(v) => setForm({ ...form, yacht: v, marina: "" })}
            options={sorted.map((y) => ({ value: y.slug, label: y.name }))} />
          <SelectField id="berth-marina" label="Marina" value={marinaId} onChange={(v) => setForm({ ...form, marina: v })}
            options={(marinas.data?.marinas ?? []).map((m) => ({ value: m.id, label: m.name }))} />
          <Field id="berth-arrival" label="Arrival date" value={form.arrival} onInput={(v) => setForm({ ...form, arrival: v })} error={errors.arrivalDate}
            hint={marina ? <>YYYY-MM-DD; today at {marina.name} is <span class="fig">{formatDay(marina.today)}</span></> : "YYYY-MM-DD"} />
          <Field id="berth-nights" label="Nights" type="number" inputMode="numeric" value={form.nights} onInput={(v) => setForm({ ...form, nights: v })} error={errors.nights} />
          <Button type="submit">Search berths</Button>
          <NoteLine note={search.note} />
        </form>
        <div>
          <h2>Results</h2>
          <ul class="rows" aria-label="Berths">
            {(results?.berths ?? []).map((b) => (
              <li key={b.code} class={`row-card berth${b.fits ? "" : " berth--nofit"}`}>
                <div class="row-card__head">
                  <h3>Berth {b.code}</h3>
                  <span class={`pill pill--${b.fits ? "ok" : "no"}`}>{b.fits ? "Fits" : "Doesn't fit"}</span>
                  <span class={`pill pill--${b.available ? "ok" : "no"}`}>{b.available ? "Available" : "Booked"}</span>
                </div>
                <dl class="facts">
                  <div><dt>Length</dt><dd class="fig">{formatFigure(centimetres(b.lengthM))}</dd></div>
                  <div><dt>Width</dt><dd class="fig">{formatFigure(centimetres(b.widthM))}</dd></div>
                  <div><dt>Depth</dt><dd class="fig">{formatFigure(centimetres(b.depthM))}</dd></div>
                </dl>
                <p class="fig berth__fees">
                  {b.nights.map((n) => formatMoney(b.currency, n.feeMinor)).join(" + ")} = <strong>{formatMoney(b.currency, b.totalMinor)}</strong>
                </p>
                {b.fits && b.available ? (
                  <Button onClick={(e) => { setChosen(b); book.setNote(null); sheet.show(e); }} aria-haspopup="dialog">Book berth {b.code}</Button>
                ) : null}
              </li>
            ))}
          </ul>
          {results?.berths.length ? null : <p class="empty">{results ? "No berths at this marina." : "Search to see which berths fit."}</p>}
        </div>
      </div>}
      <Dialog handle={sheet} title="Book berth" variant="sheet">
        {chosen && results ? (
          <>
            <p class="dialog__context">Berth {chosen.code}, {marina?.name}, from <span class="fig">{formatDay(results.query.arrival)}</span></p>
            <NightsTable nights={chosen.nights} currency={chosen.currency} />
            <p class="fig total-line">Total {formatMoney(chosen.currency, chosen.totalMinor)}</p>
            <NoteLine note={book.note} />
            <div class="dialog__actions">
              <Button onClick={confirm} pending={book.pending} pendingLabel="Booking berth" buttonRef={bookButton}>Book berth</Button>
              <Button variant="quiet" onClick={sheet.hide}>Cancel</Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}

interface BookingView {
  id: string;
  yachtSlug: string;
  marinaId: string;
  berthCode: string;
  arrivalDate: string;
  departureDate: string;
  nights: NightView[];
  totalMinor: number;
  currency: string;
  bookedBy: string;
  bookedAt: string;
}

export function BerthBooking({ member, id }: { member: Member; id: string }) {
  const ws = member.workspaceSlug;
  const booking = useLoad<{ booking: BookingView }>(`/api/w/${ws}/berth-bookings/${id}`);
  const marinas = useLoad<{ marinas: Marina[] }>(`/api/w/${ws}/marinas`);
  const yachts = useLoad<{ yachts: Yacht[] }>(`/api/w/${ws}/yachts`);
  const action = useAction();
  useEffect(() => {
    const flash = takeFlash(location.pathname);
    if (flash) action.setNote(ok(flash));
  }, []);
  if (booking.result && !booking.result.ok && booking.result.status !== 401) return <NotFoundPage />;
  const b = booking.data?.booking;
  const marina = marinas.data?.marinas.find((m) => m.id === b?.marinaId);
  return (
    <section class="narrow-page">
      <Loader active={!b || !marina} />
      {b && marina ? (
        <>
          <h1 class="rise">Berth {b.berthCode}, {marina.name}</h1>
          <NoteLine note={action.note} />
          <div class="card">
            <dl class="details">
              <div><dt>Yacht</dt><dd>{yachts.data?.yachts.find((y) => y.slug === b.yachtSlug)?.name ?? b.yachtSlug}</dd></div>
              <div><dt>Arrival</dt><dd class="fig">{formatDay(b.arrivalDate)}</dd></div>
              <div><dt>Departure</dt><dd class="fig">{formatDay(b.departureDate)}</dd></div>
              <div><dt>Total</dt><dd class="fig">{formatMoney(b.currency, b.totalMinor)}</dd></div>
              <div><dt>Booked by</dt><dd>{b.bookedBy}, <span class="fig">{formatTime(b.bookedAt, marina.base)}</span></dd></div>
            </dl>
            <NightsTable nights={b.nights} currency={b.currency} />
          </div>
        </>
      ) : null}
    </section>
  );
}

interface SlotView {
  startsAt: string;
  endsAt: string;
  status: "open" | "full" | "past";
  bookedKw: number;
  bookings: { yachtSlug: string; yachtName: string }[];
}

export function ShorePower({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const yachts = useLoad<{ yachts: Yacht[] }>(`/api/w/${ws}/yachts`);
  const marinas = useLoad<{ marinas: Marina[] }>(`/api/w/${ws}/marinas`);
  const sorted = [...(yachts.data?.yachts ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const [pick, setPick] = useState({ yacht: "", marina: "split-marina", pontoon: "", date: "" });
  const [shown, setShown] = useState<{ marina: string; pontoon: string; date: string } | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const action = useAction();
  const yacht = sorted.find((y) => y.slug === pick.yacht) ?? sorted[0];
  const marina = marinas.data?.marinas.find((m) => m.id === pick.marina);
  const pontoon = pick.pontoon || (marina ? [...marina.pontoons].sort((a, b) => a.code.localeCompare(b.code))[0]?.code ?? "" : "");
  const date = pick.date || marina?.today || "";
  const board = useLoad<{ date: string; base: Base; limitKw: number; slots: SlotView[] }>(
    shown ? `/api/w/${ws}/marinas/${shown.marina}/pontoons/${shown.pontoon}/slots?date=${encodeURIComponent(shown.date)}` : null,
  );
  useInterval(() => void (shown && board.reload()), 10_000);

  useEffect(() => {
    if (!shown && marina && pontoon && date) setShown({ marina: marina.id, pontoon, date });
  }, [marina, pontoon, date]);

  const show = (event: Event) => {
    event.preventDefault();
    if (marina && pontoon) setShown({ marina: marina.id, pontoon, date });
  };

  const bookSlot = (slot: SlotView) => {
    setBooking(slot.startsAt);
    void action.run("Booking slot", async () => {
      const result = await api<{ booking: { slotStart: string } }>("POST", `/api/w/${ws}/shore-power-bookings`, {
        yachtSlug: yacht!.slug, marinaId: shown!.marina, pontoonCode: shown!.pontoon, slotStart: slot.startsAt,
      });
      await board.reload();
      const base = marinas.data?.marinas.find((m) => m.id === shown!.marina)?.base ?? "split";
      if (result.ok) return ok(COPY.slotBooked(formatTime(result.data.booking.slotStart, base)));
      const b = result.body;
      if (b.error === "slot_taken") return bad(COPY.slotTaken(String(b.takenBy), formatTime(String(b.takenAt))));
      if (b.error === "slot_past") return bad(COPY.slotPast);
      if (b.error === "already_booked") return bad(COPY.slotMine);
      return bad(Object.values(b.errors ?? {})[0] ?? sharedCopy(result));
    });
  };

  const status = { open: "Open", full: "Full", past: "Past" } as const;

  return (
    <section>
      <h1 class="rise">Shore power</h1>
      <p class="lede">Thirty-minute slots in the marina's local time, within each pontoon's kilowatt limit.</p>
      <Loader active={yachts.loading || marinas.loading} />
      {yachts.loading || marinas.loading ? null : <div class="two-col two-col--form">
        <form class="card form" onSubmit={show} noValidate>
          <SelectField id="power-yacht" label="Yacht" value={yacht?.slug ?? ""} onChange={(v) => setPick({ ...pick, yacht: v })}
            options={sorted.map((y) => ({ value: y.slug, label: y.name }))} />
          <SelectField id="power-marina" label="Marina" value={pick.marina} onChange={(v) => { setPick({ ...pick, marina: v, pontoon: "", date: "" }); }}
            options={(marinas.data?.marinas ?? []).map((m) => ({ value: m.id, label: m.name }))} />
          <SelectField id="power-pontoon" label="Pontoon" value={pontoon} onChange={(v) => setPick({ ...pick, pontoon: v })}
            options={(marina?.pontoons ?? []).map((p) => ({ value: p.code, label: p.code }))} />
          <Field id="power-date" label="Date" value={date} onInput={(v) => setPick({ ...pick, date: v })} hint="YYYY-MM-DD, the marina's local date" />
          <Button type="submit" variant="quiet">Show slots</Button>
          <NoteLine note={action.note} />
        </form>
        <div>
          <h2>Slot board{board.data ? <span class="muted"> · pontoon {shown?.pontoon}, limit <span class="fig">{board.data.limitKw} kW</span></span> : null}</h2>
          {board.result && !board.result.ok && board.result.status === 422 ? <p class="field__error">{Object.values(board.result.body.errors ?? {})[0]}</p> : null}
          <ul class="slots" aria-label="Slots">
            {(board.data?.slots ?? []).map((s) => {
              const from = localClock(Date.parse(s.startsAt), board.data!.base);
              const to = localClock(Date.parse(s.endsAt), board.data!.base);
              return (
                <li key={s.startsAt} class={`slot slot--${s.status}`}>
                  <span class="slot__time fig">{from}–{to}</span>
                  <span class={`pill pill--${s.status}`}>{status[s.status]}</span>
                  <span class="slot__kw fig">{s.bookedKw} / {board.data!.limitKw} kW</span>
                  <Button variant="quiet" disabled={s.status !== "open"} pending={action.pending && booking === s.startsAt} pendingLabel="Booking slot" onClick={() => bookSlot(s)}>
                    Book {from} slot
                  </Button>
                </li>
              );
            })}
          </ul>
          {board.data && !board.data.slots.length ? <p class="empty">No slots on this date.</p> : null}
        </div>
      </div>}
    </section>
  );
}
