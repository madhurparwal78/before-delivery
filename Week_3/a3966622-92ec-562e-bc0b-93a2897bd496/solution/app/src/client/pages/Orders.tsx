// The port agent's orders screen: the order form with live clearances, the agency's moves, its invoices.
import { useCallback, useEffect, useRef, useState } from "react";
import { draughtMmFromFeet, draughtMmFromMetres } from "../../shared/draught";
import { clearanceCell, draughtMetres, feetAndQuarters, signedMetres } from "../../shared/numerals";
import { isPortDate, minuteOfDay } from "../../shared/portTime";
import type { Invoice, Move, Plan, Vessel } from "../../shared/types";
import { get, NO_REPLY, request, useKeyedControl } from "../api";
import { navigate, replaceQuery, useLocation } from "../router";
import { Shell } from "../ui/Chrome";
import { clockOf, dollars, statusText } from "../ui/format";
import { countCopy, FormErrors, type FieldErrors } from "../ui/FormErrors";
import { LiveRegion, useLive } from "../ui/live";

const PLAN_PAUSE_MS = 300;
const REST_MS = 500;
const REREAD_MS = 30_000;

const FIELD_IDS: Record<string, string> = {
  vessel_id: "order-vessel",
  boarding_at: "order-date",
  speed_kn: "order-speed",
  duty_minutes: "order-duty",
  draught_m: "order-draught",
  draught_ft: "order-draught",
  block_coefficient: "order-cb",
  gross_tonnage: "order-gt",
  length_m: "order-length",
};

/** A typed number, or the text itself so the server can name what is wrong with it. */
const numberOrText = (text: string): number | string => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text);

interface FormState {
  vessel: string;
  speed: string;
  cb: string;
  length: string;
  gt: string;
  duty: string;
  unit: "metres" | "feet";
  mm: number | null;
  metresText: string;
  feetText: string;
  inchesText: string;
  date: string;
  time: string;
}

const EMPTY: FormState = { vessel: "", speed: "", cb: "", length: "", gt: "", duty: "", unit: "metres", mm: null, metresText: "", feetText: "", inchesText: "", date: "", time: "" };

/** The plan inputs the form currently holds, or null while they cannot make a plan request. */
function planInputs(form: FormState): Record<string, unknown> | null {
  const minutes = minuteOfDay(form.time);
  if (!form.vessel || form.mm === null || !isPortDate(form.date) || minutes === null || form.speed.trim() === "") return null;
  return {
    vessel_id: form.vessel,
    boarding_at: `${form.date}T${form.time}`,
    speed_kn: numberOrText(form.speed),
    draught_m: form.mm / 1000,
    block_coefficient: numberOrText(form.cb),
    gross_tonnage: numberOrText(form.gt),
    length_m: numberOrText(form.length),
  };
}

function Clearances({ form, plan }: { form: FormState; plan: Plan | null }) {
  return (
    <section className="clearances" aria-label="Order clearances">
      <h2>Clearances</h2>
      {!form.vessel ? (
        <p className="muted">Choose a vessel to see clearances</p>
      ) : !plan ? (
        <p className="muted">Enter the boarding date and time to see clearances</p>
      ) : (
        <>
          <p className={plan.window_state === "open" ? "window-state open" : "window-state closed"}>
            {plan.window_state === "open" ? "Window open" : "Window closed"}
          </p>
          <table className="mini">
            <thead>
              <tr>
                <th scope="col">Waypoint</th>
                <th scope="col">Clearance</th>
                <th scope="col">Margin</th>
              </tr>
            </thead>
            <tbody>
              {plan.waypoints.map((w) => (
                <tr key={w.id} className={w.pinch ? "pinch-row" : undefined}>
                  <th scope="row">{w.name}</th>
                  <td className="num">{clearanceCell(w.clearance_mm)}</td>
                  <td className={w.margin_mm < 0 ? "num short" : "num"}>{signedMetres(w.margin_mm)} m</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="estimate">
            Estimate <span className="num">{dollars(plan.estimate.total_cents)}</span> CAD
          </p>
          <ul className="lines muted">
            {plan.estimate.lines.map((l) => (
              <li key={l.label}>
                {l.label} <span className="num">{dollars(l.amount_cents)}</span>
              </li>
            ))}
            <li>Priced by {plan.estimate.tariff_revision}</li>
          </ul>
        </>
      )}
    </section>
  );
}

export function Orders() {
  const { query } = useLocation();
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [painted, setPainted] = useState<{ inputs: string; plan: Plan } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [search, setSearch] = useState(query.get("q") ?? "");
  const orderAnnouncements = useLive();
  const searchAnnouncements = useLive();
  const placeControl = useKeyedControl();
  const inputs = planInputs(form);
  const fingerprint = inputs ? JSON.stringify(inputs) : "";
  const current = useRef(fingerprint);
  current.current = fingerprint;
  const latestInputs = useRef(inputs);
  latestInputs.current = inputs;
  const announcedFor = useRef("");
  const searchText = useRef(search);
  searchText.current = search;
  const searchSeq = useRef(0);

  const update = (changes: Partial<FormState>): void => setForm((f) => ({ ...f, ...changes }));

  const rereadMoves = useCallback(async (): Promise<Move[] | null> => {
    const q = searchText.current.trim();
    const [listed, billed] = await Promise.all([
      get<{ moves: Move[] }>(`/api/moves${q ? `?q=${encodeURIComponent(q)}` : ""}`),
      get<{ invoices: Invoice[] }>("/api/invoices"),
    ]);
    if (billed.kind === "ok") setInvoices(billed.data.invoices);
    if (listed.kind !== "ok" || searchText.current.trim() !== q) return null;
    setMoves(listed.data.moves);
    return listed.data.moves;
  }, []);

  const sayCount = searchAnnouncements.say;
  useEffect(() => {
    void get<{ vessels: Vessel[] }>("/api/vessels").then((o) => o.kind === "ok" && setVessels(o.data.vessels));
    void rereadMoves().then((listed) => {
      if (listed && searchText.current.trim()) sayCount(`${listed.length} moves shown`);
    });
    const timer = setInterval(() => void rereadMoves(), REREAD_MS);
    return () => clearInterval(timer);
  }, [rereadMoves, sayCount]);

  // Live plan: one request per set of inputs after a short pause; only the current inputs' reply paints.
  const sayOrder = orderAnnouncements.say;
  useEffect(() => {
    const body = latestInputs.current;
    if (!body) return;
    const sent = fingerprint;
    const timer = window.setTimeout(() => {
      void request<Plan>("/api/plan", { body }).then((outcome) => {
        if (current.current !== sent) return;
        if (outcome.kind === "ok") setPainted({ inputs: sent, plan: outcome.data });
        else sayOrder("Plan unavailable - last values shown");
      });
    }, PLAN_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [fingerprint, sayOrder]);

  // Announce once per set of inputs, after the form has rested on them and their plan has painted.
  useEffect(() => {
    if (!painted || painted.inputs !== fingerprint || announcedFor.current === fingerprint) return;
    const timer = window.setTimeout(() => {
      const plan = painted.plan;
      const pinch = plan.waypoints.find((w) => w.id === plan.pinch.waypoint_id)?.name ?? "";
      announcedFor.current = painted.inputs;
      sayOrder(
        `${plan.window_state === "open" ? "Window open" : "Window closed"}, pinch ${pinch} ${signedMetres(plan.pinch.margin_mm)} m, estimate ${dollars(plan.estimate.total_cents)} CAD`,
      );
    }, REST_MS);
    return () => window.clearTimeout(timer);
  }, [painted, fingerprint, sayOrder]);

  const chooseVessel = (id: string): void => {
    const vessel = vessels.find((v) => v.id === id);
    if (!vessel) {
      update({ vessel: "" });
      return;
    }
    const parts = feetAndQuarters(vessel.draught_mm);
    update({
      vessel: id,
      speed: String(vessel.speed_kn),
      cb: vessel.block_coefficient.toFixed(2),
      length: String(vessel.length_m),
      gt: String(vessel.gross_tonnage),
      mm: vessel.draught_mm,
      metresText: draughtMetres(vessel.draught_mm),
      feetText: String(parts.feet),
      inchesText: String(parts.inches),
    });
  };

  const switchUnit = (unit: "metres" | "feet"): void => {
    if (form.mm === null) {
      update({ unit });
      return;
    }
    const parts = feetAndQuarters(form.mm);
    update({ unit, metresText: draughtMetres(form.mm), feetText: String(parts.feet), inchesText: String(parts.inches) });
  };

  const placeOrder = async (): Promise<void> => {
    const body: Record<string, unknown> = {
      vessel_id: form.vessel || undefined,
      boarding_at: `${form.date}T${form.time}`,
      speed_kn: numberOrText(form.speed),
      duty_minutes: numberOrText(form.duty),
      block_coefficient: numberOrText(form.cb),
      gross_tonnage: numberOrText(form.gt),
      length_m: numberOrText(form.length),
      draught_m: form.mm === null ? numberOrText(form.unit === "metres" ? form.metresText : "") : form.mm / 1000,
    };
    const key = placeControl.begin(body);
    if (key === null) return;
    orderAnnouncements.say("Placing order...");
    const outcome = await request<Move>("/api/moves", { body, key });
    placeControl.end(outcome);
    if (outcome.kind === "no-reply") {
      orderAnnouncements.say(NO_REPLY);
      return;
    }
    if (outcome.kind === "ok") {
      setErrors({});
      orderAnnouncements.say(`Order ${outcome.data.ref} placed`);
      void rereadMoves();
      return;
    }
    const found = outcome.error.errors ?? { form: outcome.error.message };
    setErrors(found);
    orderAnnouncements.say(countCopy(found));
  };

  const onSearch = (text: string): void => {
    setSearch(text);
    replaceQuery({ q: text.trim() ? text : null });
    const seq = ++searchSeq.current;
    window.setTimeout(async () => {
      if (seq !== searchSeq.current) return;
      const q = text.trim();
      const outcome = await get<{ moves: Move[] }>(`/api/moves${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (seq !== searchSeq.current || outcome.kind !== "ok") return;
      setMoves(outcome.data.moves);
      sayCount(`${outcome.data.moves.length} moves shown`);
    }, 250);
  };

  const plan = painted?.plan ?? null;
  const invalid = (field: string): boolean => errors[field] !== undefined;

  return (
    <Shell>
      <h1 className="page-title">Orders</h1>
      <div className="columns">
        <section className="column" aria-labelledby="order-heading">
          <h2 id="order-heading">Order a pilot move</h2>
          <FormErrors errors={errors} fieldIds={FIELD_IDS} />
          <form
            className="form-grid"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void placeOrder();
            }}
          >
            <label className="field span-2">
              <span>Vessel</span>
              <span className="select">
                <select id="order-vessel" value={form.vessel} onChange={(e) => chooseVessel(e.target.value)} aria-invalid={invalid("vessel_id")}>
                  <option value="">Choose a vessel</option>
                  {vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="field">
              <span>Boarding date</span>
              <input id="order-date" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" className="num" value={form.date} onChange={(e) => update({ date: e.target.value.trim() })} aria-invalid={invalid("boarding_at")} />
            </label>
            <label className="field">
              <span>Boarding time</span>
              <input id="order-time" type="text" inputMode="numeric" placeholder="HH:MM" className="num" value={form.time} onChange={(e) => update({ time: e.target.value.trim() })} aria-invalid={invalid("boarding_at")} />
            </label>
            <fieldset className="field span-2 units" role="radiogroup" aria-label="Draught units">
              <legend>Draught units</legend>
              <label>
                <input type="radio" name="units" checked={form.unit === "metres"} onChange={() => switchUnit("metres")} /> Metres
              </label>
              <label>
                <input type="radio" name="units" checked={form.unit === "feet"} onChange={() => switchUnit("feet")} /> Feet and inches
              </label>
            </fieldset>
            {form.unit === "metres" ? (
              <label className="field span-2">
                <span>Draught in metres</span>
                <input
                  id="order-draught"
                  type="number"
                  step="0.001"
                  className="num"
                  value={form.metresText}
                  aria-invalid={invalid("draught_m")}
                  onChange={(e) => update({ metresText: e.target.value, mm: e.target.value === "" ? null : draughtMmFromMetres(Number(e.target.value)) })}
                />
              </label>
            ) : (
              <>
                <label className="field">
                  <span>Draught feet</span>
                  <input
                    id="order-draught"
                    type="number"
                    step="1"
                    className="num"
                    value={form.feetText}
                    aria-invalid={invalid("draught_m")}
                    onChange={(e) => update({ feetText: e.target.value, mm: draughtMmFromFeet(Number(e.target.value), Number(form.inchesText || 0)) })}
                  />
                </label>
                <label className="field">
                  <span>Draught inches</span>
                  <input
                    type="number"
                    step="0.25"
                    className="num"
                    value={form.inchesText}
                    onChange={(e) => update({ inchesText: e.target.value, mm: draughtMmFromFeet(Number(form.feetText || 0), Number(e.target.value)) })}
                  />
                </label>
              </>
            )}
            <label className="field">
              <span>Speed in knots</span>
              <input id="order-speed" type="number" step="0.5" className="num" value={form.speed} onChange={(e) => update({ speed: e.target.value })} aria-invalid={invalid("speed_kn")} />
            </label>
            <label className="field">
              <span>Duty minutes</span>
              <input id="order-duty" type="number" step="5" className="num" value={form.duty} onChange={(e) => update({ duty: e.target.value })} aria-invalid={invalid("duty_minutes")} />
            </label>
            <label className="field">
              <span>Block coefficient</span>
              <input id="order-cb" type="number" step="0.01" className="num" value={form.cb} onChange={(e) => update({ cb: e.target.value })} aria-invalid={invalid("block_coefficient")} />
            </label>
            <label className="field">
              <span>Length in metres</span>
              <input id="order-length" type="number" step="1" className="num" value={form.length} onChange={(e) => update({ length: e.target.value })} aria-invalid={invalid("length_m")} />
            </label>
            <label className="field span-2">
              <span>Gross tonnage</span>
              <input id="order-gt" type="number" step="100" className="num" value={form.gt} onChange={(e) => update({ gt: e.target.value })} aria-invalid={invalid("gross_tonnage")} />
            </label>
            <div className="span-2 actions">
              <button type="submit" className="primary">
                Place order
              </button>
            </div>
          </form>
          <LiveRegion name="Order announcements" live={orderAnnouncements} />
          <Clearances form={form} plan={plan} />
        </section>
        <section className="column" aria-labelledby="agency-moves">
          <div className="pane-head">
            <h2 id="agency-moves">Your moves</h2>
            <a className="link-button" href="/api/exports/moves.csv" download="moves.csv">
              Export moves
            </a>
          </div>
          <label className="search">
            <span className="sr-only">Search moves</span>
            <input type="search" aria-label="Search moves" placeholder="Search by reference, vessel or status" value={search} onChange={(e) => onSearch(e.target.value)} />
          </label>
          <LiveRegion name="Board announcements" live={searchAnnouncements} />
          {moves === null ? (
            <p className="muted">Loading moves…</p>
          ) : moves.length === 0 ? (
            <p className="muted">No moves match</p>
          ) : (
            <ul className="rows">
              {moves.map((m) => (
                <li key={m.ref} className="row order-row">
                  <a href={`/moves/${encodeURIComponent(m.ref)}`} onClick={(e) => { e.preventDefault(); navigate(`/moves/${encodeURIComponent(m.ref)}`); }} className="ref">
                    {m.ref}
                  </a>
                  <span>{m.vessel.name}</span>
                  <span className="status-chip" data-status={m.status}>
                    {statusText(m)}
                  </span>
                  <span className="num row-meta">
                    {m.boarding_at.slice(0, 10)} {clockOf(m.boarding_at)}
                  </span>
                  <span className="priced">Priced by {m.priced_by.tariff_revision}</span>
                  <span className="num row-meta">{dollars(m.priced_by.total_cents)}</span>
                </li>
              ))}
            </ul>
          )}
          <h2>Invoices</h2>
          {invoices === null ? (
            <p className="muted">Loading invoices…</p>
          ) : invoices.length === 0 ? (
            <p className="muted">No invoices yet</p>
          ) : (
            <ul className="rows">
              {invoices.map((i) => (
                <li key={i.id} className="row">
                  <a href={`/invoices/${encodeURIComponent(i.id)}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${encodeURIComponent(i.id)}`); }}>
                    {i.id}
                  </a>
                  <span>{i.move_ref}</span>
                  <span className="status-chip">{i.state === "issued" ? `Issued ${i.number ?? ""}` : "Pending"}</span>
                  <span className="num row-meta">{dollars(i.total_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
