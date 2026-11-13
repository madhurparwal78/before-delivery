import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULTS, finishName, hubName, modelName } from "../shared/catalogue.js";
import { FIELD, STATUS, marked, unitDone } from "../shared/copy.js";
import type { DayRow, DaySheet, HeldRow, Stock } from "../shared/types.js";
import { follow, room } from "./live.js";
import { call } from "./net.js";
import { Link } from "./router.js";
import { screenNeedsSignIn, session, setReadsRiderData } from "./session.js";
import { RANK, announce } from "./status.js";
import { useStore } from "./store.js";

const key = (model: string, finish: string): string => `${model}:${finish}`;

type Outcome = "ridden" | "no_show" | "delivered";

export function Hub({ search }: { search: string }): JSX.Element {
  const user = useStore(session, (s) => s.user);
  const resetKey = useStore(session, (s) => s.resetKey);
  const seq = useStore(room, (s) => s.drawn?.seq ?? 0);
  const [date, setDate] = useState<string | null>(new URLSearchParams(search).get("date"));
  const [sheet, setSheet] = useState<DaySheet | null>(null);
  const [held, setHeld] = useState<HeldRow[] | null>(null);
  const [stock, setStock] = useState<Stock | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [faults, setFaults] = useState<Record<string, string>>({});
  const asked = useRef(0);
  const dateRef = useRef(date);
  dateRef.current = date;
  const host = user?.role === "hub_host" ? user : null;

  useEffect(() => {
    setReadsRiderData(true);
    return () => setReadsRiderData(false);
  }, []);
  useEffect(() => {
    if (!user) screenNeedsSignIn();
  }, [user?.id]);
  useEffect(() => {
    if (host?.hub) follow({ hub: host.hub, model: DEFAULTS.model, finish: DEFAULTS.finish });
  }, [host?.hub]);
  // typed counts clear only when a different host signs in
  useEffect(() => {
    setCounts({});
    setFaults({});
  }, [resetKey]);

  const load = (): void => {
    if (!host) return;
    const mark = ++asked.current;
    const wanted = dateRef.current;
    void Promise.all([
      call<DaySheet>("GET", `/api/hub/day-sheet${wanted ? `?date=${wanted}` : ""}`),
      call<{ rows: HeldRow[] }>("GET", "/api/hub/held-units"),
      call<Stock>("GET", "/api/hub/stock"),
    ]).then(([s, h, st]) => {
      if (mark !== asked.current) return;
      if (s.ok) setSheet(s.data);
      if (h.ok) setHeld(h.data.rows);
      if (st.ok) setStock(st.data);
    });
  };
  useEffect(load, [host?.id, date, seq]);

  // while counting, the on-hand column is typed into: start from the current counts and keep what was typed
  useEffect(() => {
    if (!stock?.counting) return;
    setCounts((now) => {
      const next = { ...now };
      for (const u of stock.units) if (next[key(u.model, u.finish)] === undefined) next[key(u.model, u.finish)] = String(u.onHand);
      return next;
    });
  }, [stock?.counting, stock?.units.length]);

  const chooseDate = (value: string | null): void => {
    setDate(value);
    const next = value ? `/hub?date=${value}` : "/hub";
    history.replaceState(history.state, "", next);
  };

  const refused = (r: { status: number; code: string | null }): void => {
    if (r.status === 503) announce(STATUS.hostRefused, RANK.other);
    else if (r.code === "illegal_state" || r.code === "lock_expired" || r.code === "too_early") announce(STATUS.alreadyMarked, RANK.other);
    load();
  };

  const mark = async (row: DayRow, outcome: Outcome): Promise<void> => {
    const r = outcome === "delivered" ? await call("POST", `/api/hub/locks/${row.id}/delivered`) : await call("POST", `/api/hub/rides/${row.id}/mark`, { outcome });
    if (r.ok) {
      announce(marked(row.riderName, outcome), RANK.other);
      load();
    } else refused(r);
  };

  const decide = async (row: HeldRow, action: "confirm" | "refuse" | "withdraw"): Promise<void> => {
    const r = await call("POST", `/api/hub/locks/${row.id}/${action}`);
    if (r.ok) {
      announce(unitDone(row.riderName, action === "confirm" ? "confirmed" : action === "refuse" ? "refused" : "withdrawn"), RANK.other);
      load();
    } else refused(r);
  };

  const startCount = async (): Promise<void> => {
    const r = await call<Stock>("POST", "/api/hub/stock-count/start");
    if (r.ok) {
      setStock(r.data);
      announce(STATUS.countStarted, RANK.other);
    } else refused(r);
  };

  const finishCount = async (): Promise<void> => {
    if (!stock) return;
    const bad: Record<string, string> = {};
    const units = stock.units.map((u) => {
      const text = (counts[key(u.model, u.finish)] ?? "").trim();
      if (!/^\d+$/.test(text)) bad[key(u.model, u.finish)] = FIELD.count;
      return { model: u.model, finish: u.finish, onHand: Number(text) };
    });
    setFaults(bad);
    if (Object.keys(bad).length > 0) return;
    const r = await call<Stock>("POST", "/api/hub/stock-count/finish", { units });
    if (r.ok) {
      setStock(r.data);
      setCounts({});
      announce(STATUS.countSaved, RANK.other);
      load();
    } else if (r.code === "invalid_body") setFaults(Object.fromEntries(units.map((u) => [key(u.model, u.finish), FIELD.count])));
    else refused(r);
  };

  if (user && !host) {
    return (
      <main class="work">
        <h1 class="lede">This console is for hub hosts.</h1>
        <Link class="link-action" href="/showroom">
          Back to the showroom
        </Link>
      </main>
    );
  }

  const heading = sheet ? `${hubName(sheet.hub)}, ${sheet.dayLabel}.` : host ? `${hubName(host.hub as string)}.` : "The hub console.";
  const options = sheet ? [...sheet.dates] : [];
  if (date && sheet && !options.some((d) => d.date === date)) options.push({ date, dayLabel: sheet.date === date ? sheet.dayLabel : date });
  const counting = stock?.counting === true;

  return (
    <main class="work">
      <h1 class="lede">{heading}</h1>

      <section class="hub-section">
        <div class="row">
          <label class="field-label">
            <span>Sheet date</span>
            <span class="select">
              <select aria-label="Sheet date" value={date ?? sheet?.date ?? ""} onChange={(e) => chooseDate((e.target as HTMLSelectElement).value)}>
                {options.map((d) => (
                  <option key={d.date} value={d.date}>
                    {d.dayLabel}
                  </option>
                ))}
              </select>
            </span>
          </label>
          {date ? (
            <button class="btn" type="button" onClick={() => chooseDate(null)}>
              Go to today
            </button>
          ) : null}
        </div>
        {sheet && sheet.rows.length === 0 ? (
          <div class="empty">
            <p class="lede">Nothing on this day.</p>
            {date ? null : (
              <button class="btn" type="button" onClick={() => chooseDate(null)}>
                Go to today
              </button>
            )}
          </div>
        ) : null}
        <div class="table-wrap" hidden={!sheet || sheet.rows.length === 0}>
          <table class="stack" aria-label="Day sheet">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Rider</th>
                <th scope="col">Machine</th>
                <th scope="col">Licence</th>
                <th scope="col">State</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {(sheet?.rows ?? []).map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td data-label="Time">{r.label}</td>
                  <td data-label="Rider">{r.riderName}</td>
                  <td data-label="Machine">
                    {modelName(r.model)}
                    {r.finish ? `, ${finishName(r.finish)}` : ""}
                  </td>
                  <td data-label="Licence">{r.licenceLast4 ?? ""}</td>
                  <td data-label="State">{r.state.replace("_", "-")}</td>
                  <td data-label="Action">
                    <span class="row">
                      {r.actions.map((a) => (
                        <button key={a} class="btn" type="button" onClick={() => void mark(r, a)}>
                          {a === "ridden" ? "Mark ridden" : a === "no_show" ? "Mark no-show" : "Mark delivered"}
                          <span class="sr"> {r.riderName}</span>
                        </button>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="hub-section">
        <h2 class="table-title">Held units</h2>
        {held && held.length === 0 ? <p class="lede" style="font-size:var(--text-3)">Nothing is held at this hub.</p> : null}
        <div class="table-wrap" hidden={!held || held.length === 0}>
          <table class="stack" aria-label="Held units">
            <thead>
              <tr>
                <th scope="col">Rider</th>
                <th scope="col">Machine</th>
                <th scope="col">Finish</th>
                <th scope="col">Ends</th>
                <th scope="col">State</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {(held ?? []).map((r) => (
                <tr key={r.id}>
                  <td data-label="Rider">{r.riderName}</td>
                  <td data-label="Machine">{modelName(r.model)}</td>
                  <td data-label="Finish">{finishName(r.finish)}</td>
                  <td data-label="Ends">{r.expiresLabel ?? "No expiry"}</td>
                  <td data-label="State">{r.state.replace("_", " ")}</td>
                  <td data-label="Action">
                    <span class="row">
                      {r.actions.map((a) => (
                        <button key={a} class="btn" type="button" onClick={() => void decide(r, a)}>
                          {a === "confirm" ? "Confirm unit" : a === "refuse" ? "Refuse unit" : "Withdraw unit"}
                          <span class="sr"> {r.riderName}</span>
                        </button>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="hub-section">
        <h2 class="table-title">Stock</h2>
        <div class="row">
          {counting ? (
            <button class="btn primary" type="button" onClick={() => void finishCount()}>
              Finish stock count
            </button>
          ) : (
            <button class="btn" type="button" onClick={() => void startCount()}>
              Start stock count
            </button>
          )}
        </div>
        <div class="table-wrap">
          <table class="stack" aria-label="Stock">
            <thead>
              <tr>
                <th scope="col">Machine</th>
                <th scope="col">Finish</th>
                <th scope="col">On hand</th>
                <th scope="col">Held</th>
                <th scope="col">Units left</th>
              </tr>
            </thead>
            <tbody>
              {(stock?.units ?? []).map((u) => {
                const k = key(u.model, u.finish);
                return (
                  <tr key={k}>
                    <td data-label="Machine">{modelName(u.model)}</td>
                    <td data-label="Finish">{finishName(u.finish)}</td>
                    <td data-label="On hand">
                      {counting ? (
                        <>
                          <input
                            class="input"
                            type="number"
                            role="spinbutton"
                            min="0"
                            step="1"
                            aria-label={`${modelName(u.model)} ${finishName(u.finish)} on hand`}
                            aria-invalid={faults[k] ? "true" : undefined}
                            value={counts[k] ?? String(u.onHand)}
                            onInput={(e) => setCounts({ ...counts, [k]: (e.target as HTMLInputElement).value })}
                          />
                          {faults[k] ? <span class="fault">{faults[k]}</span> : null}
                        </>
                      ) : (
                        u.onHand
                      )}
                    </td>
                    <td data-label="Held">{u.held}</td>
                    <td data-label="Units left">{u.unitsLeft}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

