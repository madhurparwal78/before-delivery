// Results (`/trains?...`): train cards, class and quota filters, and the selected train's details. Only the reply for
// the selection now shown in the radios may change the screen; the business clock refreshes it at the next edge.
import { SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClassCode, CoachPlanBody, Quota, Station, TrainResult } from "../../shared/api";
import { formatInr, istTime, longDate } from "../../shared/format";
import { CoachPlan } from "../components/CoachPlan";
import { Modal } from "../components/Modal";
import { useRibbon } from "../components/Shell";
import { ApiFailure, api } from "../lib/api";
import { type ServerClock, parseTimestamp, readClock } from "../lib/clock";
import { useLayout } from "../lib/media";
import { Link, navigate, useLocation } from "../lib/router";
import { QUOTAS, QUOTA_LABEL, QuotaRadios } from "./Search";

const CLASS_LABEL: Record<ClassCode, string> = { SL: "Sleeper (SL)", "3A": "AC 3 Tier (3A)" };

function ClassRadios({ value, onChange, name, firstRef }: { value: ClassCode; onChange(c: ClassCode): void; name: string; firstRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div className="stack">
      <span className="legend" id={`${name}-label`}>
        Class
      </span>
      <div className="choices" role="radiogroup" aria-labelledby={`${name}-label`}>
        {(["SL", "3A"] as ClassCode[]).map((c, i) => (
          <label key={c} className="choice">
            <input ref={i === 0 ? firstRef : undefined} type="radio" name={name} value={c} checked={value === c} onChange={() => onChange(c)} />
            {CLASS_LABEL[c]}
          </label>
        ))}
      </div>
    </div>
  );
}

function duration(from: string, to: string): string {
  const minutes = Math.round((parseTimestamp(to) - parseTimestamp(from)) / 60_000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function bookHref(t: TrainResult, cls: ClassCode, quota: Quota): string {
  return `/book?train=${t.number}&run_date=${t.run_date}&from=${t.from.code}&to=${t.to.code}&class=${cls}&quota=${quota}`;
}

function TrainDetails({ train, cls, quota }: { train: TrainResult; cls: ClassCode; quota: Quota }) {
  const layout = useLayout();
  const [plan, setPlan] = useState<CoachPlanBody | null>(null);
  const [coach, setCoach] = useState("");
  const [inspected, setInspected] = useState("");
  const entry = train.classes[0];
  useEffect(() => {
    let live = true;
    api<CoachPlanBody>(`/api/trains/${train.number}/runs/${train.run_date}/coaches?class=${cls}&from=${train.from.code}&to=${train.to.code}`).then(
      (body) => {
        if (!live) return;
        setPlan(body);
        setCoach((c) => (body.coaches.some((x) => x.coach === c) ? c : (body.coaches[0]?.coach ?? "")));
      },
      () => live && setPlan(null),
    );
    return () => {
      live = false;
    };
  }, [train, cls]);
  return (
    <section className="panel stack" aria-label="Train details">
      <div className="panel-title">
        <h2>{`${train.number} ${train.name}`}</h2>
        <span className="kicker">{`${cls} · ${QUOTA_LABEL[quota]}`}</span>
      </div>
      <p className="small">
        Chart at <time>{istTime(train.chart_at)} IST</time>, {longDate(train.chart_at)}
        {entry ? (entry.window === "not_yet_open" ? ` · booking opens ${istTime(entry.opens_at)} IST, ${longDate(entry.opens_at)}` : "") : ""}
      </p>
      <div className="lanes">
        <div className="lane">
          <h3>RAC LANE</h3>
          <p className="small">{entry?.rac === null || !entry ? "No RAC on this quota" : `${entry.rac} RAC places free on this stretch`}</p>
        </div>
        <div className="lane">
          <h3>WL LANE</h3>
          <p className="small">
            {entry?.wl_type ? `${entry.wl_type} ${entry.wl} waiting · cap ${entry.wl_cap}` : "No waiting list on this quota"}
          </p>
        </div>
      </div>
      {plan ? (
        <CoachPlan
          coaches={plan.coaches}
          vertical={layout === "phone"}
          selected={coach}
          onSelect={setCoach}
          onActivate={(c, berth) => {
            const b = plan.coaches.find((x) => x.coach === c)?.berths.find((x) => x.berth === berth);
            setInspected(b ? `Berth ${c} ${berth}: ${b.state.replace(/_/g, " ")}` : "");
          }}
        />
      ) : (
        <p className="small muted">Coach plan loading</p>
      )}
      <p className="small muted" aria-live="polite">{inspected || "Preview of berth states for this stretch. Choose seats on the booking page."}</p>
    </section>
  );
}

export function Results() {
  const { search } = useLocation();
  const layout = useLayout();
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const date = search.get("date") ?? "";
  const [cls, setCls] = useState<ClassCode>(search.get("class") === "3A" ? "3A" : "SL");
  const [quota, setQuota] = useState<Quota>(QUOTAS.find((q) => q === search.get("quota")) ?? "GN");
  const [trains, setTrains] = useState<TrainResult[] | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [searchStatus, setSearchStatus] = useState("Checking trains");
  const [availability, setAvailability] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const firstRadio = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const selection = useRef({ cls, quota, selected });
  selection.current = { cls, quota, selected };
  const clock = useRef<ServerClock | null>(null);
  const edge = useRef<number | null>(null);
  const firstLayout = useRef(layout);

  const name = useCallback((code: string) => stations.find((s) => s.code === code)?.name ?? code, [stations]);

  const load = useCallback(
    async (c: ClassCode, q: Quota, purpose: "search" | "change" | "clock"): Promise<TrainResult[] | null> => {
      const mine = ++latest.current;
      let body: { trains: TrainResult[] };
      try {
        body = await api<{ trains: TrainResult[] }>(`/api/trains?from=${from}&to=${to}&date=${date}&quota=${q}&class=${c}`);
      } catch (error) {
        if (mine !== latest.current || purpose !== "search") return null;
        const errors = error instanceof ApiFailure ? error.body?.errors : undefined;
        setTrains([]);
        setSearchStatus(errors ? Object.values(errors).join(" ") : "Can't reach Pakka right now. Try the search again.");
        return null;
      }
      if (mine !== latest.current) return null;
      setTrains(body.trains);
      let chosen = selection.current.selected;
      if (purpose === "search" && firstLayout.current === "desktop" && !chosen && body.trains[0]) {
        chosen = body.trains[0].number;
        setSelected(chosen);
      }
      // The next opening or chart instant the server has not yet reported as passed. One the device clock thinks
      // has passed stays the edge, so the screen asks again until the server's answer flips.
      const times = body.trains.flatMap((t) => [
        ...(t.chart_prepared ? [] : [parseTimestamp(t.chart_at)]),
        ...t.classes.filter((e) => e.window === "not_yet_open").map((e) => parseTimestamp(e.opens_at)),
      ]);
      edge.current = times.sort((a, b) => a - b)[0] ?? null;
      if (purpose !== "search") {
        const train = body.trains.find((t) => t.number === chosen);
        const entry = train?.classes[0];
        if (train && entry) setAvailability(`${train.number} ${c} ${QUOTA_LABEL[q]}: ${entry.label}`);
      }
      return body.trains;
    },
    [from, to, date],
  );

  useEffect(() => {
    let live = true;
    const run = async (): Promise<void> => {
      const [list, serverClock] = await Promise.all([
        api<{ stations: Station[] }>("/api/stations").then((b) => b.stations, () => []),
        readClock().catch(() => null),
      ]);
      if (!live) return;
      setStations(list);
      clock.current = serverClock;
      const found = await load(selection.current.cls, selection.current.quota, "search");
      if (!found || !live) return;
      const named = (code: string): string => list.find((s) => s.code === code)?.name ?? code;
      setSearchStatus(
        found.length
          ? `${found.length} trains from ${named(from)} to ${named(to)} on ${longDate(date)}`
          : `No trains run between ${named(from)} and ${named(to)} on ${longDate(date)}.`,
      );
    };
    void run();
    const timer = window.setInterval(() => {
      const at = edge.current;
      if (at === null || !clock.current || clock.current.now() < at) return;
      edge.current = null;
      readClock().then(
        (fresh) => {
          clock.current = fresh;
          void load(selection.current.cls, selection.current.quota, "clock");
        },
        () => undefined,
      );
    }, 1000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [load, from, to, date]);

  const change = (c: ClassCode, q: Quota): void => {
    setCls(c);
    setQuota(q);
    navigate(`/trains?from=${from}&to=${to}&date=${date}&quota=${q}&class=${c}`, { replace: true, state: history.state });
    void load(c, q, "change");
  };

  const selectedTrain = trains?.find((t) => t.number === selected);
  const ribbonTrain = selectedTrain ?? trains?.[0];
  useRibbon(
    ribbonTrain
      ? ribbonTrain.stops.map((s) => ({ code: s.code, name: s.name, at: s.departure_at, end: s.code === from || s.code === to }))
      : [
          { code: from, name: name(from), end: true },
          { code: to, name: name(to), end: true },
        ],
  );

  const filters = (prefix: string, withFirstRef: boolean) => (
    <div className="stack">
      <ClassRadios value={cls} onChange={(c) => change(c, quota)} name={`${prefix}-class`} firstRef={withFirstRef ? firstRadio : undefined} />
      <QuotaRadios value={quota} onChange={(q) => change(cls, q)} name={`${prefix}-quota`} />
    </div>
  );

  const cards = (
    <ul className="plain train-list" aria-label="Trains">
      {(trains ?? []).map((t) => {
        const entry = t.classes[0];
        const isSelected = t.number === selected;
        return (
          <li key={t.number} className="train-card" data-selected={isSelected}>
            <div className="panel-title">
              <h3>{`${t.number} ${t.name}`}</h3>
              <span className="kicker">{`${cls} · ${QUOTA_LABEL[quota]}`}</span>
            </div>
            <div className="train-times">
              <span>
                <time dateTime={t.from.departure_at}>{istTime(t.from.departure_at)}</time> <span className="small">{t.from.code}</span>
              </span>
              <span className="line">
                <span className="mono">{duration(t.from.departure_at, t.to.arrival_at)}</span>
              </span>
              <span>
                <time dateTime={t.to.arrival_at}>{istTime(t.to.arrival_at)}</time> <span className="small">{t.to.code}</span>
              </span>
            </div>
            <p className="small muted">
              Chart at <time>{istTime(t.chart_at)} IST</time>, {longDate(t.chart_at)} · run of {longDate(t.run_date)}
            </p>
            <div className="card-actions">
              <span className="row">
                <span className="availability">{entry?.label}</span>
                <span className="money">{entry ? formatInr(entry.adult_fare_paise) : ""}</span>
                <span className="small muted">per adult</span>
              </span>
              <span className="row">
                <button type="button" className="button ghost" aria-expanded={layout === "desktop" ? undefined : isSelected} onClick={() => setSelected(t.number)}>
                  Show details<span className="visually-hidden">{` ${t.number}`}</span>
                </button>
                {entry?.window === "open" ? (
                  <Link className="button primary" href={bookHref(t, cls, quota)}>
                    {`Book ${t.number} ${cls}`}
                  </Link>
                ) : null}
              </span>
            </div>
            {isSelected && layout !== "desktop" ? <TrainDetails train={t} cls={cls} quota={quota} /> : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="results-title">
        <div className="panel-title">
          <h1 id="results-title">{`${name(from)} to ${name(to)}`}</h1>
          <Link href="/" className="small">
            Change search
          </Link>
        </div>
        <p className="small">
          <span className="mono">{`${from} → ${to}`}</span> · {date ? longDate(date) : ""} · {QUOTA_LABEL[quota]} · {CLASS_LABEL[cls]}
        </p>
        <p className="status-line strong" role="status" aria-label="Search result">
          {searchStatus}
        </p>
        <p className="status-line" role="status" aria-label="Availability">
          {availability}
        </p>
        {layout === "phone" ? (
          <div>
            <button ref={filtersButton} type="button" className="button" onClick={() => setSheetOpen(true)}>
              <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
              Filters
            </button>
          </div>
        ) : null}
      </section>
      <div className={`results ${layout}`}>
        {layout !== "phone" ? <aside className="panel">{filters("inline", false)}</aside> : null}
        <div className="stack">{cards}</div>
        {layout === "desktop" ? (
          <div className="pane-details">{selectedTrain ? <TrainDetails train={selectedTrain} cls={cls} quota={quota} /> : null}</div>
        ) : null}
      </div>
      {layout === "phone" ? (
        <Modal open={sheetOpen} label="Filters" onClose={() => setSheetOpen(false)} initialFocus={firstRadio} opener={filtersButton} className="sheet">
          <div className="panel-title">
            <h2>Filters</h2>
            <button type="button" className="button ghost" onClick={() => setSheetOpen(false)}>
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
              Close filters
            </button>
          </div>
          {filters("sheet", true)}
        </Modal>
      ) : null}
    </div>
  );
}
