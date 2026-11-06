// The planner (brief: Staff screens → `/studio/drops/<id>`; Interactions → Embargo dial; Journey 1).
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { gapMessage } from "../../shared/copy";
import { WEEKDAYS, counted, dateText, marketTime, wallMarketTime } from "../../shared/format";
import { CITY, MARKETS, type Market, ZONE, addDays, copenhagenWall, hhmm, instantText, isoDate, parseDate, parseLocal, wallAt } from "../../shared/time";
import { api, serverNow } from "../api";
import { useNow } from "../countdown";
import { Dial, type DropType, dialState } from "../dial";
import { useDraft } from "../drafts";
import type { Restock, StaffDrop } from "../types";
import { Button, Dialog, Field, Loading, NightMark, PageTitle, Problems, SelectField, StatusRegion, focusLater, refusalMessage, useMessage, useProblems, wholeOrText } from "../ui";

const LAST = 23 * 60 + 45;

function Slider({ minutes, onMinutes, spoken }: { minutes: number; onMinutes: (m: number) => void; spoken: string }): JSX.Element {
  const keys: Record<string, (m: number) => number> = {
    ArrowUp: (m) => m + 15,
    ArrowRight: (m) => m + 15,
    ArrowDown: (m) => m - 15,
    ArrowLeft: (m) => m - 15,
    PageUp: (m) => m + 60,
    PageDown: (m) => m - 60,
    Home: () => 0,
    End: () => LAST,
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    onMinutes(Math.min(Math.max(step(minutes), 0), LAST));
  };
  return (
    <div className="field slider-field">
      <span className="label" id="drop-time-label">
        Drop time
      </span>
      <div
        role="slider"
        tabIndex={0}
        aria-labelledby="drop-time-label"
        aria-valuemin={0}
        aria-valuemax={LAST}
        aria-valuenow={minutes}
        aria-valuetext={spoken}
        className="slider"
        onKeyDown={onKey}
      >
        <span className="slider-track">
          <span className="slider-fill" style={{ width: `${(minutes / LAST) * 100}%` }} />
          <span className="slider-thumb" style={{ left: `${(minutes / LAST) * 100}%` }} />
        </span>
        <span className="mono slider-value">{hhmm({ hour: Math.floor(minutes / 60), minute: minutes % 60 })}</span>
      </div>
    </div>
  );
}

function initialDate(drop: StaffDrop): string {
  const saved = drop.copenhagenGoLive ?? drop.localGoLive;
  return saved ? saved.slice(0, 10) : isoDate(addDays(copenhagenWall(serverNow()), 1));
}

function initialMinutes(drop: StaffDrop): number {
  const saved = drop.copenhagenGoLive ?? drop.localGoLive;
  const wall = saved ? parseLocal(saved) : null;
  return wall ? Math.floor((wall.hour * 60 + wall.minute) / 15) * 15 : 600;
}

function WithdrawDialog({ drop, onDone, onClose }: { drop: StaffDrop; onDone: () => void; onClose: () => void }): JSX.Element {
  const draft = useDraft("withdraw", { reason: "" });
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const r = await api("POST", `/api/drops/${drop.id}/withdraw`, draft.value);
    setPending(false);
    if (r.ok) {
      draft.clear();
      onDone();
      return;
    }
    setErrors(r.fields);
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  return (
    <Dialog title="Withdraw drop" alert={alert} alertKey={attempt} onClose={() => (draft.clear(), onClose())}>
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <p>The public page will show the drop as withdrawn, holds are voided and preview links close. Claims are kept.</p>
        <Field id="withdraw-reason" label="Reason" value={draft.value.reason} onChange={(reason) => draft.set({ reason })} error={errors.reason} />
        <div className="dialog-actions">
          <Button type="submit" variant="danger" pending={pending} pendingText="Withdrawing…">
            Withdraw drop
          </Button>
          <Button onClick={() => (draft.clear(), onClose())}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function VipDialog({ drop, onDone, onClose }: { drop: StaffDrop; onDone: (n: number, city: string) => void; onClose: () => void }): JSX.Element {
  const draft = useDraft("vip", { market: "copenhagen", list: "" });
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const members = draft.value.list
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = /^(.*?)\s*<([^>]*)>$/.exec(line);
        return m ? { name: m[1], email: m[2] } : { name: "", email: line };
      });
    setPending(true);
    const r = await api<{ items: unknown[] }>("POST", `/api/drops/${drop.id}/waitlist/vip`, { market: draft.value.market, members });
    setPending(false);
    if (r.ok) {
      draft.clear();
      onDone(members.length, CITY[draft.value.market as Market]);
      return;
    }
    const listErrors = Object.entries(r.fields).filter(([k]) => k.startsWith("members"));
    setErrors({
      market: r.fields.market ?? "",
      list: listErrors.length ? listErrors.map(([k, v]) => (k === "members" ? v : `Line ${Number(k.split(".")[1]) + 1}: ${v}`)).join(" ") : "",
    });
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  return (
    <Dialog title="Add VIP members" alert={alert} alertKey={attempt} onClose={() => (draft.clear(), onClose())}>
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <SelectField id="vip-market" label="Market" value={draft.value.market} onChange={(market) => draft.set((d) => ({ ...d, market }))} options={MARKETS.map((m): [string, string] => [m, CITY[m]])} error={errors.market || undefined} />
        <Field
          id="vip-list"
          label="VIP list"
          hint="One member per line, as Name <email>."
          multiline
          rows={5}
          value={draft.value.list}
          onChange={(list) => draft.set((d) => ({ ...d, list }))}
          error={errors.list || undefined}
        />
        <div className="dialog-actions">
          <Button type="submit" variant="primary" pending={pending} pendingText="Adding members…">
            Add members
          </Button>
          <Button onClick={() => (draft.clear(), onClose())}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RestockPanel({ drop, onSaved, announce }: { drop: StaffDrop; onSaved: () => void; announce: (m: ReturnType<typeof refusalMessage> | string) => void }): JSX.Element {
  const draft = useDraft("restock", { date: "", time: "", pieces: Object.fromEntries(MARKETS.map((m) => [m, "0"])) as Record<Market, string> });
  const [pending, setPending] = useState(false);
  const p = useProblems([
    { path: "firstRestock", id: "restock-date", label: "First restock date" },
    ...MARKETS.map((m) => ({ path: `pieces.${m}`, id: `restock-${m}`, label: `${CITY[m]} restock pieces` })),
  ]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    announce("Saving restock…");
    const pieces = Object.fromEntries(MARKETS.map((m) => [m, wholeOrText(draft.value.pieces[m])]));
    const r = await api<Restock>("POST", `/api/drops/${drop.id}/restocks`, { firstRestock: `${draft.value.date.trim()}T${draft.value.time.trim()}`, pieces });
    setPending(false);
    if (r.ok) {
      p.clear();
      draft.clear();
      announce(`Weekly restock saved: every ${WEEKDAYS.find((w) => w.toLowerCase() === r.data.weekday) ?? r.data.weekday} at ${r.data.copenhagenTime} Copenhagen time.`);
      onSaved();
      return;
    }
    if (r.status === 422) p.show(r.fields);
    announce(refusalMessage(r));
  };
  return (
    <section className="panel restock-panel" aria-label="Weekly restock">
      <h2>Weekly restock</h2>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Problems problems={p.problems} regionRef={p.regionRef} />
        <div className="form-row">
          <Field id="restock-date" label="First restock date" hint="YYYY-MM-DD" value={draft.value.date} onChange={(date) => draft.set((d) => ({ ...d, date }))} error={p.errors.firstRestock} />
          <Field id="restock-time" label="Restock time" hint="HH:MM, Copenhagen" value={draft.value.time} onChange={(time) => draft.set((d) => ({ ...d, time }))} />
        </div>
        <div className="pieces-grid">
          {MARKETS.map((m) => (
            <Field
              key={m}
              id={`restock-${m}`}
              label={`${CITY[m]} restock pieces`}
              type="number"
              value={draft.value.pieces[m]}
              onChange={(v) => draft.set((d) => ({ ...d, pieces: { ...d.pieces, [m]: v } }))}
              error={p.errors[`pieces.${m}`]}
            />
          ))}
        </div>
        <Button type="submit" pending={pending} pendingText="Saving restock…">
          Save restock
        </Button>
      </form>
    </section>
  );
}

export function PlannerScreen({ id }: { id: string }): JSX.Element {
  const [drop, setDrop] = useState<StaffDrop | null>(null);
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    const [d, r] = await Promise.all([api<StaffDrop>("GET", `/api/drops/${id}`), api<{ items: Restock[] }>("GET", `/api/drops/${id}/restocks`)]);
    if (d.ok) setDrop(d.data);
    else setMissing(true);
    if (r.ok) setRestocks(r.data.items);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (missing) return <p className="panel">This drop can't be found in your workspace.</p>;
  if (!drop) return <Loading />;
  return <Planner drop={drop} restocks={restocks} reload={load} />;
}

function Planner({ drop, restocks, reload }: { drop: StaffDrop; restocks: Restock[]; reload: () => Promise<void> }): JSX.Element {
  const [dateText_, setDateText] = useState(() => initialDate(drop));
  const [type, setType] = useState<DropType>(drop.type);
  const [minutes, setMinutes] = useState(() => initialMinutes(drop));
  const [message, setMessage] = useMessage();
  const [busy, setBusy] = useState<"" | "save" | "schedule">("");
  const [dialog, setDialog] = useState<"" | "withdraw" | "vip">("");
  const withdrawButton = useRef<HTMLButtonElement>(null);
  const vipButton = useRef<HTMLButtonElement>(null);
  const now = useNow();
  const [date, setDate] = useState(() => parseDate(initialDate(drop)) ?? addDays(copenhagenWall(serverNow()), 1));
  useEffect(() => {
    const parsed = parseDate(dateText_.trim());
    if (parsed) setDate(parsed);
  }, [dateText_]);
  const state = dialState(date, type, minutes);
  const wall = { ...date, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0 };
  const spoken = wallMarketTime(wall, "copenhagen");
  const local = `${isoDate(date)}T${hhmm(wall)}`;

  const saveTime = async (): Promise<void> => {
    if (busy || state.gap) return;
    setBusy("save");
    setMessage("Saving time…");
    const body = type === "simultaneous" ? { type, copenhagenGoLive: local } : { type, localGoLive: local };
    const r = await api<StaffDrop>("PATCH", `/api/drops/${drop.id}`, body);
    setBusy("");
    if (r.ok) {
      setMessage(`Go-live saved: ${r.data.goLiveAt ? marketTime(Date.parse(r.data.goLiveAt)) : ""}.`);
      await reload();
    } else setMessage(r.status === 422 ? Object.values(r.fields).join(" ") || r.message : refusalMessage(r));
  };
  const schedule = async (): Promise<void> => {
    if (busy) return;
    setBusy("schedule");
    setMessage("Scheduling…");
    const r = await api<StaffDrop>("POST", `/api/drops/${drop.id}/schedule`);
    setBusy("");
    if (r.ok) {
      setMessage("Drop scheduled.");
      await reload();
    } else setMessage(r.status === 422 ? Object.values(r.fields).join(" ") || r.message : refusalMessage(r));
  };
  const shifted = state.pins.filter((p) => p.shiftMinutes && p.local);
  const upcoming = restocks
    .flatMap((r) => r.nextInstants)
    .sort()
    .slice(0, 8);

  return (
    <div className="planner">
      <div className="screen-head">
        <p className="eyebrow">
          {drop.status === "draft" ? "Draft" : drop.status === "sold_out" ? "Sold out" : drop.status[0].toUpperCase() + drop.status.slice(1)} · {drop.type === "rolling" ? "Rolling" : "Simultaneous"}
        </p>
        <PageTitle>{`Plan ${drop.name}`}</PageTitle>
        <StatusRegion name="Planner status" message={message} />
      </div>
      <div className="planner-grid">
        <section className="panel dial-panel" aria-labelledby="dial-heading">
          <h2 id="dial-heading" className="sr-only">
            Go-live
          </h2>
          <div className="dial-controls">
            <Field id="drop-date" label="Drop date" hint="YYYY-MM-DD, Copenhagen" value={dateText_} onChange={setDateText} />
            <fieldset className="radios" role="radiogroup" aria-labelledby="drop-type-legend">
              <legend id="drop-type-legend">Drop type</legend>
              {(["simultaneous", "rolling"] as const).map((t) => (
                <label key={t} className="radio">
                  <input type="radio" name="planner-type" value={t} checked={type === t} onChange={() => setType(t)} />
                  {t === "simultaneous" ? "Simultaneous" : "Rolling"}
                </label>
              ))}
            </fieldset>
            <Slider minutes={minutes} onMinutes={setMinutes} spoken={spoken} />
          </div>
          <div className="dial-notes">
            {state.gap ? <p className="note">{gapMessage(dateText(date))}</p> : null}
            {shifted.map((p) => (
              <p key={p.market} className="note">
                {`${CITY[p.market]} skips an hour that night, so it opens at ${p.local ? hhmm(p.local) : ""}.`}
              </p>
            ))}
          </div>
          <Dial state={state} minutes={minutes} onMinutes={setMinutes} now={now} />
        </section>
        <section className="panel ledger-panel markets-sheet" aria-label="Markets">
          <h2>Market times</h2>
          <p className="ledger-caption">
            Copenhagen instant <span className="mono">{state.copenhagenUtc === null ? "—" : instantText(state.copenhagenUtc)}</span>
          </p>
          <table aria-label="Market times" className="ruled ledger">
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Local time</th>
                <th scope="col">Night</th>
                <th scope="col">Opens</th>
                <th scope="col">UTC</th>
              </tr>
            </thead>
            <tbody>
              {state.pins.map((p) => (
                <tr key={p.market}>
                  <th scope="row">{CITY[p.market]}</th>
                  <td className="mono">{p.local ? hhmm(p.local) : "—"}</td>
                  <td>{p.local ? p.night ? <NightMark /> : "Day" : "—"}</td>
                  <td className="mono">{p.utc === null ? "—" : dateText(wallAt(p.utc, ZONE[p.market])).slice(0, -5)}</td>
                  <td className="mono utc">
                    {p.utc === null ? (
                      "—"
                    ) : (
                      <>
                        <span aria-hidden="true" title={instantText(p.utc)}>{`${instantText(p.utc).slice(11, 16)}Z`}</span>
                        <span className="sr-only">{instantText(p.utc)}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="planner-save sticky-bar" data-sticky-bar>
          <Button variant="primary" pending={busy === "save"} pendingText="Saving time…" disabled={state.gap} onClick={() => void saveTime()}>
            Save time
          </Button>
        </div>
        <div className="planner-actions">
          <Button pending={busy === "schedule"} pendingText="Scheduling…" onClick={() => void schedule()}>
            Schedule drop
          </Button>
          <Button variant="danger" buttonRef={withdrawButton} onClick={() => setDialog("withdraw")}>
            Withdraw drop
          </Button>
          <Button buttonRef={vipButton} onClick={() => setDialog("vip")}>
            Add VIP members
          </Button>
        </div>
        <RestockPanel drop={drop} onSaved={() => void reload()} announce={setMessage} />
        <section className="panel" aria-labelledby="next-restocks">
          <h2 id="next-restocks">Next restocks</h2>
          <div className="table-scroll" tabIndex={0}>
          <table aria-label="Next restocks" className="ruled">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Copenhagen</th>
                <th scope="col">London</th>
                <th scope="col">New York</th>
                <th scope="col">UTC</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length ? (
                upcoming.map((at, i) => {
                  const ms = Date.parse(at);
                  return (
                    <tr key={`${at}-${i}`}>
                      <td className="mono">{i + 1}</td>
                      <td className="mono">{`${dateText(wallAt(ms, ZONE.copenhagen))}, ${hhmm(wallAt(ms, ZONE.copenhagen))}`}</td>
                      <td className="mono">{hhmm(wallAt(ms, ZONE.london))}</td>
                      <td className="mono">{hhmm(wallAt(ms, ZONE.new_york))}</td>
                      <td className="mono utc">{at}</td>
                    </tr>
                  );
                })
              ) : (
                <tr className="empty-row">
                  <td colSpan={5}>Nothing here yet.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </section>
      </div>
      {dialog === "withdraw" ? (
        <WithdrawDialog
          drop={drop}
          onClose={() => {
            setDialog("");
            focusLater(() => withdrawButton.current);
          }}
          onDone={() => {
            setDialog("");
            setMessage("Drop withdrawn. Its public page now shows it as withdrawn.");
            void reload();
            focusLater(() => document.querySelector<HTMLElement>("main h1"));
          }}
        />
      ) : null}
      {dialog === "vip" ? (
        <VipDialog
          drop={drop}
          onClose={() => {
            setDialog("");
            focusLater(() => vipButton.current);
          }}
          onDone={(n, city) => {
            setDialog("");
            setMessage(`${counted(n, "VIP member")} added to the ${city} waitlist.`);
            focusLater(() => vipButton.current);
          }}
        />
      ) : null}
    </div>
  );
}
