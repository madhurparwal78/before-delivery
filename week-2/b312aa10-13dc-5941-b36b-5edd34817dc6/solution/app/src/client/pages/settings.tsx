import { useEffect, useRef, useState } from "preact/hooks";
import { ApiFailure, get, post, put } from "../api.js";
import { Dialog } from "../dialog.js";
import { Button, Field, errorCopy, focusFirstInvalid, useAction } from "../ui.js";
import { context, showError } from "../store.js";
import type { KitchenInfo, Station } from "../types.js";
import { money, parseDollars, plainMoney } from "../../shared/format.js";
import { WEEKDAY_KEYS, type WeekdayKey } from "../../shared/time.js";
import type { HourlyRate, PeakWindow, RateStatus, ShelfRate } from "../../shared/rules.js";
import { variantCopy } from "../../shared/copy.js";

const DAYS: WeekdayKey[] = [...WEEKDAY_KEYS.slice(1), "sun"];
const DAY_NAMES: Record<WeekdayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function rateText(r: HourlyRate | ShelfRate): string {
  return "shelfDayCents" in r ? `${money(r.shelfDayCents)} a day` : `${money(r.offPeakHourlyCents)} standard · ${money(r.peakHourlyCents)} peak`;
}

const STATIONS_REFRESH_MS = 10_000;
const RATE_STATUS: Record<RateStatus, string> = { past: "Past", current: "Current", scheduled: "Scheduled" };

export function SettingsScreen() {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // The kitchen embedded in the screen document draws the rule editors on load; GET /api/kitchen then refreshes it.
  const [kitchen, setKitchen] = useState<KitchenInfo | null>(context.get()?.kitchen ?? null);
  // Bumped on every save or stale-save refusal so both rule editors redraw from the kitchen returned.
  const [drawn, setDrawn] = useState(0);
  // Station reads are numbered: only the latest answer draws, and a read sent before a Save rates
  // result arrived is discarded, so a version just created never leaves the table.
  const issued = useRef(0);
  const shown = useRef(0);
  const saves = useRef(0);
  const loadStations = (): void => {
    const seq = ++issued.current;
    const gen = saves.current;
    get<{ stations: Station[] }>("/api/stations").then(({ data }) => {
      if (gen !== saves.current || seq < shown.current) return;
      shown.current = seq;
      setStations(data.stations);
    }, (error) => {
      if (!shown.current) showError(errorCopy(error));
    });
  };
  // While Settings is open the stations and rate versions re-read and redraw in place.
  useEffect(() => {
    loadStations();
    get<KitchenInfo>("/api/kitchen").then(({ data }) => {
      setKitchen((shown) => {
        if (shown && JSON.stringify(shown) === JSON.stringify(data)) return shown;
        setDrawn((n) => n + 1);
        return data;
      });
    }, (error) => showError(errorCopy(error)));
    const timer = setInterval(loadStations, STATIONS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  const rulesSaved = (k: KitchenInfo): void => {
    setKitchen(k);
    setDrawn((n) => n + 1);
  };
  const station = stations?.find((s) => s.id === editing) ?? null;
  return (
    <div class="screen">
      <h1>Settings</h1>
      {!stations || !kitchen ? <p class="loading">Loading…</p> : <div class="grid">
        <section class="panel span-12">
          <h2>Stations and rates</h2>
          {(
            <table class="table" aria-label="Stations">
              <thead><tr><th scope="col">Station</th><th scope="col">Current rate</th><th scope="col">Action</th></tr></thead>
              <tbody>
                {stations.map((s) => (
                  <tr>
                    <th scope="row" data-label="Station">{s.name}</th>
                    <td data-label="Current rate">{s.currentRate ? rateText(s.currentRate) : "—"}</td>
                    <td data-label="Action"><Button aria-label={`Edit rates for ${s.name}`} data-edit={s.id} onClick={() => setEditing(s.id)}>Edit rates</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section class="panel span-12">
          <h2>Rate versions</h2>
          {(
            <table class="table" aria-label="Rate versions">
              <thead><tr>
                <th scope="col">Station</th><th scope="col">Effective from</th><th scope="col">Standard hourly</th>
                <th scope="col">Peak hourly</th><th scope="col">Shelf-day</th><th scope="col">Status</th>
              </tr></thead>
              <tbody>
                {stations.flatMap((s) => s.rates.map((r) => (
                  <tr class={r.status === "past" ? "past" : undefined}>
                    <th scope="row" data-label="Station">{s.name}</th>
                    <td data-label="Effective from">{r.effectiveFrom.replace("T", " ")}</td>
                    <td data-label="Standard hourly">{"offPeakHourlyCents" in r ? money(r.offPeakHourlyCents) : ""}</td>
                    <td data-label="Peak hourly">{"peakHourlyCents" in r ? money(r.peakHourlyCents) : ""}</td>
                    <td data-label="Shelf-day">{"shelfDayCents" in r ? money(r.shelfDayCents) : ""}</td>
                    <td data-label="Status">{RATE_STATUS[r.status]}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          )}
        </section>
        <PeakWindows key={`peak-${drawn}`} kitchen={kitchen} onKitchen={rulesSaved} />
        <Requirements key={`req-${drawn}`} kitchen={kitchen} onKitchen={rulesSaved} />
      </div>}
      {station && <RatesDialog key={station.id} station={station} onClose={() => setEditing(null)} onSaved={(saved) => {
        saves.current += 1;
        setEditing(null);
        setStations((list) => list && list.map((x) => (x.id === saved.id ? saved : x)));
      }} />}
    </div>
  );
}

function RatesDialog({ station, onClose, onSaved }: { station: Station; onClose: () => void; onSaved: (s: Station) => void }) {
  const shelf = station.kind === "shelf";
  const current = station.currentRate;
  const cents = (c: number): string => plainMoney(c);
  const [off, setOff] = useState(current && !("shelfDayCents" in current) ? cents(current.offPeakHourlyCents) : "");
  const [peak, setPeak] = useState(current && !("shelfDayCents" in current) ? cents(current.peakHourlyCents) : "");
  const [day, setDay] = useState(current && "shelfDayCents" in current ? cents(current.shelfDayCents) : "");
  const [from, setFrom] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const { busy, run } = useAction();
  const submit = (e: Event): void => {
    e.preventDefault();
    const effectiveFrom = from.trim().replace(" ", "T");
    const body = shelf
      ? { shelfDayCents: parseDollars(day) ?? 0, effectiveFrom }
      : { offPeakHourlyCents: parseDollars(off) ?? 0, peakHourlyCents: parseDollars(peak) ?? 0, effectiveFrom };
    void run("rates", "Saving…", async () => {
      const { data } = await post<{ station: Station }>(`/api/stations/${station.id}/rates`, body);
      onSaved(data.station);
      const saved = data.station.rates.find((r) => r.effectiveFrom === effectiveFrom)?.effectiveFrom ?? effectiveFrom;
      return `New rates for ${station.name} start ${saved.replace("T", " ")}.`;
    }, (error) => {
      if (error instanceof ApiFailure && error.code === "validation_failed") {
        setErrors(error.fieldErrors);
        focusFirstInvalid(form.current);
        return true;
      }
      return false;
    });
  };
  return (
    <Dialog title="Station rates" onClose={onClose}>
      <p class="dialog-lede">{station.name} · now {station.currentRate ? rateText(station.currentRate) : "—"}</p>
      <form ref={form} class="form" onSubmit={submit} noValidate>
        {shelf ? (
          <Field label="Shelf-day rate" error={errors.shelfDayCents} hint="Dollars, e.g. 6.40">{(p) => <input {...p} class="input" type="text" inputMode="decimal" value={day} onInput={(e) => setDay(e.currentTarget.value)} />}</Field>
        ) : (
          <div class="form-row">
            <Field label="Standard hourly rate" error={errors.offPeakHourlyCents} hint="Dollars">{(p) => <input {...p} class="input" type="text" inputMode="decimal" value={off} onInput={(e) => setOff(e.currentTarget.value)} />}</Field>
            <Field label="Peak hourly rate" error={errors.peakHourlyCents} hint="Dollars">{(p) => <input {...p} class="input" type="text" inputMode="decimal" value={peak} onInput={(e) => setPeak(e.currentTarget.value)} />}</Field>
          </div>
        )}
        <Field label="Effective from" error={errors.effectiveFrom} hint="YYYY-MM-DD HH:MM, kitchen time">{(p) => <input {...p} class="input" type="text" autoComplete="off" value={from} onInput={(e) => setFrom(e.currentTarget.value)} />}</Field>
        <div class="actions">
          <Button type="submit" variant="primary" busy={busy === "rates"}>Save rates</Button>
          <Button class="btn-quiet" onClick={onClose}>Close</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A rule save: 412 stale_version redraws both editors from the `current` kitchen in the body. */
function useRuleSave(onKitchen: (k: KitchenInfo) => void) {
  const action = useAction();
  const save = (name: string, path: string, body: Record<string, unknown>, done: string, onInvalid: (e: ApiFailure) => boolean): void => {
    void action.run(name, "Saving…", async () => {
      const { data } = await put<KitchenInfo>(path, body);
      onKitchen(data);
      return done;
    }, (e) => {
      if (e instanceof ApiFailure && e.code === "stale_version" && e.body.current) {
        onKitchen(e.body.current as KitchenInfo);
        showError(variantCopy("stale_version_rules"));
        return true;
      }
      return e instanceof ApiFailure && e.code === "validation_failed" && onInvalid(e);
    });
  };
  return { busy: action.busy, save };
}

/** A new window starts as a complete weekday evening, so it is valid until the operator edits it. */
const NEW_WINDOW: PeakWindow = { days: ["mon", "tue", "wed", "thu", "fri"], start: "16:00", end: "19:00" };

function PeakWindows({ kitchen, onKitchen }: { kitchen: KitchenInfo; onKitchen: (k: KitchenInfo) => void }) {
  const [windows, setWindows] = useState<PeakWindow[]>(kitchen.peakWindows);
  const [error, setError] = useState<string | undefined>();
  const { busy, save: send } = useRuleSave(onKitchen);
  const update = (i: number, change: Partial<PeakWindow>): void => setWindows(windows.map((w, j) => (j === i ? { ...w, ...change } : w)));
  const save = (): void => {
    send("peak", "/api/kitchen/peak-windows", { windows, rulesVersion: kitchen.rulesVersion },
      "Peak windows saved. They apply to bookings confirmed from now on.", (e) => {
        const message = e.fieldErrors.windows ?? e.fieldErrors.rulesVersion;
        if (message) setError(message);
        return Boolean(message);
      });
  };
  return (
    <section class="panel span-8">
      <h2>Peak windows</h2>
      <div role="group" aria-label="Peak windows" class="windows">
        {windows.map((w, i) => (
          <fieldset class="window">
            <legend>Window {i + 1}</legend>
            <div class="days">
              {DAYS.map((d) => (
                <label class="check">
                  <input type="checkbox" checked={w.days.includes(d)} onChange={(e) => update(i, { days: e.currentTarget.checked ? [...w.days, d] : w.days.filter((x) => x !== d) })} />
                  {DAY_NAMES[d]}
                </label>
              ))}
            </div>
            <div class="form-row">
              <Field label="Start" hint="HH:MM">{(p) => <input {...p} class="input" type="text" value={w.start} onInput={(e) => update(i, { start: e.currentTarget.value })} />}</Field>
              <Field label="End" hint="HH:MM">{(p) => <input {...p} class="input" type="text" value={w.end} onInput={(e) => update(i, { end: e.currentTarget.value })} />}</Field>
              <Button aria-label={`Remove window ${i + 1}`} onClick={() => setWindows(windows.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          </fieldset>
        ))}
        {error && <p class="field-error">{error}</p>}
        <div class="actions">
          <Button disabled={windows.length >= 10} onClick={() => setWindows([...windows, NEW_WINDOW])}>Add peak window</Button>
          <Button variant="primary" busy={busy === "peak"} onClick={save}>Save peak windows</Button>
        </div>
      </div>
    </section>
  );
}

function Requirements({ kitchen, onKitchen }: { kitchen: KitchenInfo; onKitchen: (k: KitchenInfo) => void }) {
  const initial = kitchen.requiredDocuments;
  const [insurance, setInsurance] = useState(initial.includes("insurance_certificate"));
  const [card, setCard] = useState(initial.includes("food_handler_card"));
  const { busy, save: send } = useRuleSave(onKitchen);
  const save = (): void => {
    const required = [...(insurance ? ["insurance_certificate"] : []), ...(card ? ["food_handler_card"] : [])];
    send("req", "/api/kitchen/document-requirements", { required, rulesVersion: kitchen.rulesVersion }, "Document requirements saved.", () => false);
  };
  return (
    <section class="panel span-4">
      <h2>Document requirements</h2>
      <label class="check"><input type="checkbox" checked={insurance} onChange={(e) => setInsurance(e.currentTarget.checked)} />Insurance certificate required</label>
      <label class="check"><input type="checkbox" checked={card} onChange={(e) => setCard(e.currentTarget.checked)} />Food-handler card required</label>
      <div class="actions"><Button variant="primary" busy={busy === "req"} onClick={save}>Save requirements</Button></div>
    </section>
  );
}
