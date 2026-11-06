import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import {
  clampSpeed, MAX_LEGS, NEW_LEG_SPEED, planPassage, SPEED_MAX, SPEED_MIN, SPEED_PAGE, SPEED_STEP,
  type Anchorage, type EnergyProfile, type LegInput, type PlannedLeg,
} from "../../shared/energy";
import { formatDistance, formatSpeed, formatTime } from "../../shared/format";
import { isoInstant, localToInstant, type Base } from "../../shared/zones";
import { passageUpdates } from "../lib/announce";
import { api, sharedCopy } from "../lib/api";
import { prefersReducedMotion, useLoad, useWide } from "../lib/hooks";
import { navigate, setFlash, takeDraft, takeFlash, useDraft } from "../lib/nav";
import { bad, Button, Field, focusFirstError, Link, NoteLine, ok, Problems, SelectField, useAction } from "../ui/Controls";
import { Dialog, useDialog } from "../ui/Dialog";
import { Ribbon, ribbonPath, areaPath, ribbonY, type RibbonPoint } from "../ui/Ribbon";
import { DataTable, NotFoundPage, type Member } from "../ui/Shell";
import { useKeepAboveBar } from "../ui/StickyBar";
import { Hairline, isTyping, useStrip } from "../ui/Strip";
import { Loader } from "../ui/Visuals";

interface Yacht extends EnergyProfile {
  slug: string;
  name: string;
  base: Base;
}

interface ApiLeg {
  index: number;
  toAnchorageId: string;
  speedKn: number;
  arrivesAt: string;
  arrivalBase: Base;
}

interface PassageView {
  id: string;
  yachtSlug: string;
  name: string;
  status: "draft" | "sent";
  base: Base;
  startAnchorageId: string;
  departureDate: string;
  departureTime: string;
  departsAt: string;
  startChargePct: number;
  legs: ApiLeg[];
  minChargePct: number | null;
}

const editsPassages = (m: Member) => m.role === "captain" || m.role === "fleet_director";

export function Passages({ member, yacht }: { member: Member; yacht: string | null }) {
  const ws = member.workspaceSlug;
  const passages = useLoad<{ passages: PassageView[] }>(`/api/w/${ws}/passages${yacht ? `?yachtSlug=${encodeURIComponent(yacht)}` : ""}`);
  const yachts = useLoad<{ yachts: Yacht[] }>(`/api/w/${ws}/yachts`);
  const names = new Map((yachts.data?.yachts ?? []).map((y) => [y.slug, y.name]));
  if (passages.result && !passages.result.ok && passages.result.status === 404) return <NotFoundPage />;
  return (
    <section>
      <div class="page-title-row">
        <h1 class="rise">Passages</h1>
        {editsPassages(member) ? <Link class="btn btn--primary" href={`/w/${ws}/passages/new`}>New passage</Link> : null}
      </div>
      <p class="lede">{yacht && names.get(yacht) ? `${names.get(yacht)}'s passages. ` : ""}Departures and arrivals are shown in their base's time.</p>
      <Loader active={passages.loading} />
      {passages.data ? (
        <DataTable
          name="Passages"
          captionHidden
          rows={passages.data.passages}
          rowKey={(p) => p.id}
          empty="No passages yet."
          columns={[
            { label: "Passage", cell: (p) => <Link href={`/w/${ws}/passages/${p.id}`}>{p.name}</Link> },
            { label: "Yacht", cell: (p) => names.get(p.yachtSlug) ?? p.yachtSlug },
            { label: "Departs", cell: (p) => <span class="fig">{formatTime(p.departsAt, p.base)}</span> },
            { label: "Lowest arrival", numeric: true, cell: (p) => <span class="fig">{p.minChargePct === null ? "—" : `${p.minChargePct}%`}</span> },
            { label: "Status", cell: (p) => <span class={`pill pill--${p.status}`}>{p.status === "sent" ? "Sent" : "Draft"}</span> },
          ]}
        />
      ) : null}
    </section>
  );
}

const BASE_ANCHORAGE: Record<Base, string> = { split: "split-base", lavrio: "lavrio-base" };

const NEW_FIELDS: Record<string, { label: string; id: string }> = {
  yachtSlug: { label: "Yacht", id: "new-yacht" },
  name: { label: "Passage name", id: "new-name" },
  departureDate: { label: "Departure date", id: "new-date" },
  departureTime: { label: "Departure time", id: "new-time" },
  startChargePct: { label: "Starting charge", id: "new-charge" },
  startAnchorageId: { label: "Start anchorage", id: "new-start" },
};

/** Typed whole percent as a number when it reads as one; anything else goes as typed for the server to refuse. */
const percentValue = (text: string): number | string => (/^\s*\d+\s*$/.test(text) ? Number(text) : text);

export function NewPassage({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const yachts = useLoad<{ yachts: Yacht[] }>(`/api/w/${ws}/yachts`);
  const places = useLoad<{ anchorages: Anchorage[] }>(`/api/w/${ws}/anchorages`);
  const sorted = [...(yachts.data?.yachts ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const [form, setForm] = useState(() => takeDraft<Record<string, string>>("new-passage") ?? { yacht: "", name: "", date: "", time: "", charge: "100", start: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  useDraft("new-passage", form);
  const yacht = sorted.find((y) => y.slug === form.yacht) ?? sorted[0];
  const start = form.start || (yacht ? BASE_ANCHORAGE[yacht.base] : "");

  const submit = (event: Event) => {
    event.preventDefault();
    if (!yacht) return;
    void action.run("Creating passage", async () => {
      const result = await api<{ passage: PassageView }>("POST", `/api/w/${ws}/passages`, {
        yachtSlug: yacht.slug,
        name: form.name,
        startAnchorageId: start,
        departureDate: form.date,
        departureTime: form.time,
        startChargePct: percentValue(form.charge),
        legs: [],
      });
      if (result.ok) {
        const path = `/w/${ws}/passages/${result.data.passage.id}`;
        setFlash(path, COPY.passageCreated);
        navigate(path);
        return null;
      }
      const found = result.body.errors ?? {};
      setErrors(found);
      action.focusLater(() => focusFirstError(Object.keys(NEW_FIELDS).filter((k) => found[k]).map((k) => NEW_FIELDS[k].id)));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  return (
    <section class="narrow-page">
      <h1 class="rise">New passage</h1>
      <p class="lede">Departure date and time are in the yacht's base time.</p>
      <Loader active={yachts.loading || places.loading} />
      {yacht ? (
        <form class="card form" onSubmit={submit} noValidate>
          <Problems errors={errors} labels={NEW_FIELDS} />
          <SelectField
            id="new-yacht"
            label="Yacht"
            value={yacht.slug}
            onChange={(v) => setForm({ ...form, yacht: v, start: "" })}
            options={sorted.map((y) => ({ value: y.slug, label: y.name }))}
          />
          <Field id="new-name" label="Passage name" value={form.name} onInput={(v) => setForm({ ...form, name: v })} error={errors.name} />
          <div class="field-row">
            <Field id="new-date" label="Departure date" value={form.date} onInput={(v) => setForm({ ...form, date: v })} error={errors.departureDate} hint="YYYY-MM-DD" />
            <Field id="new-time" label="Departure time" value={form.time} onInput={(v) => setForm({ ...form, time: v })} error={errors.departureTime} hint="HH:MM, 24-hour" />
          </div>
          <Field id="new-charge" label="Starting charge" type="number" inputMode="numeric" value={form.charge} onInput={(v) => setForm({ ...form, charge: v })} error={errors.startChargePct} hint="Whole percent" />
          <SelectField
            id="new-start"
            label="Start anchorage"
            value={start}
            onChange={(v) => setForm({ ...form, start: v })}
            options={(places.data?.anchorages ?? []).map((a) => ({ value: a.id, label: a.name }))}
            error={errors.startAnchorageId}
          />
          <div class="form__end">
            <NoteLine note={action.note} />
            <Button type="submit" pending={action.pending} pendingLabel="Creating passage">Create passage</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const CARD_W = 300;
const CARD_GAP = 16;
const NARROW_W = 360;

/** Wide: each arrival point sits above the middle of its leg card. Narrow: points spread evenly. */
function ribbonPoints(start: number, legs: PlannedLeg[], wide: boolean): { points: RibbonPoint[]; width: number } {
  if (wide) {
    const width = Math.max(1, legs.length) * (CARD_W + CARD_GAP) - CARD_GAP;
    return { width, points: [{ x: 8, pct: start }, ...legs.map((l, i) => ({ x: i * (CARD_W + CARD_GAP) + CARD_W / 2, pct: l.arrivalChargePct }))] };
  }
  const step = (NARROW_W - 24) / Math.max(1, legs.length);
  return { width: NARROW_W, points: [{ x: 12, pct: start }, ...legs.map((l, i) => ({ x: 12 + step * (i + 1), pct: l.arrivalChargePct }))] };
}

/** `Arrives with 34%`, each digit in its own span so only the changed digits roll. */
function ArrivalCharge({ pct }: { pct: number }) {
  return (
    <p class="leg__charge">
      Arrives with{" "}
      <span class="fig digits">
        {String(pct).split("").map((d, i, all) => (
          <span key={all.length - i} class="digit" data-from-right={all.length - i}>
            {d}
          </span>
        ))}
        %
      </span>
    </p>
  );
}

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

interface Draft {
  name: string;
  date: string;
  time: string;
  charge: string;
  legs: LegInput[];
}

const PLANNER_FIELDS: Record<string, { label: string; id: string }> = {
  name: { label: "Passage name", id: "plan-name" },
  departureDate: { label: "Departure date", id: "plan-date" },
  departureTime: { label: "Departure time", id: "plan-time" },
  startChargePct: { label: "Starting charge", id: "plan-charge" },
  legs: { label: "Legs", id: "plan-add" },
};

export function Planner({ member, id }: { member: Member; id: string }) {
  const ws = member.workspaceSlug;
  const wide = useWide();
  const editor = editsPassages(member);
  const loaded = useLoad<{ passage: PassageView }>(`/api/w/${ws}/passages/${id}`);
  const p = loaded.data?.passage;
  const yachtLoad = useLoad<{ yacht: Yacht }>(p ? `/api/w/${ws}/yachts/${p.yachtSlug}` : null);
  const placesLoad = useLoad<{ anchorages: Anchorage[] }>(`/api/w/${ws}/anchorages`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<"draft" | "sent">("draft");
  const [selected, setSelected] = useState(0);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction();
  const send = useAction();
  const addDialog = useDialog();
  const speeds = useDialog();
  const [arriveAt, setArriveAt] = useState("");
  const legsRef = useRef<HTMLUListElement>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const sheetBar = useRef<HTMLDivElement>(null);
  const sheetBody = useRef<HTMLDivElement>(null);
  const motion = useRef<{ previous: PlannedLeg[]; previousPoints: RibbonPoint[] } | null>(null);
  useDraft("planner", draft);
  useKeepAboveBar(sheetBar, speeds.open, sheetBody);

  useEffect(() => {
    if (p && !draft) {
      setDraft(takeDraft<Draft>("planner") ?? {
        name: p.name, date: p.departureDate, time: p.departureTime, charge: String(p.startChargePct),
        legs: p.legs.map((l) => ({ toAnchorageId: l.toAnchorageId, speedKn: l.speedKn })),
      });
      setStatus(p.status);
    }
  }, [p]);

  useEffect(() => {
    const flash = takeFlash(location.pathname);
    if (flash) save.setNote(ok(flash));
  }, []);

  const places = useMemo(() => new Map((placesLoad.data?.anchorages ?? []).map((a) => [a.id, a])), [placesLoad.data]);
  const yacht = yachtLoad.data?.yacht;
  const departsAt = draft && p ? localToInstant(draft.date, draft.time, p.base) ?? Date.parse(p.departsAt) : 0;
  const startPct = draft && /^\d+$/.test(draft.charge) && Number(draft.charge) <= 100 ? Number(draft.charge) : p?.startChargePct ?? 100;
  const plan = useMemo(
    () => (yacht && draft && p && places.size ? planPassage(yacht, places, p.startAnchorageId, draft.legs, startPct, departsAt) : []),
    [yacht, draft, p, places, startPct, departsAt],
  );
  const strip = useStrip(plan.length, wide, ".leg");
  const { points, width } = ribbonPoints(startPct, plan, wide);
  const minCharge = plan.length ? Math.min(...plan.map((l) => l.arrivalChargePct)) : null;
  const sendable = plan.length > 0 && plan.every((l) => l.reserve === "ok");

  // Every speed change starts the digit roll (180 ms), the band fade (360 ms) and the ribbon ease (720 ms) together.
  useLayoutEffect(() => {
    const before = motion.current;
    motion.current = null;
    if (!before || prefersReducedMotion()) return;
    const list = legsRef.current;
    plan.forEach((leg, i) => {
      const old = before.previous[i];
      if (!old || !list) return;
      const card = list.querySelector<HTMLElement>(`[data-leg="${i}"]`);
      if (!card) return;
      if (old.arrivalChargePct !== leg.arrivalChargePct) {
        const was = String(old.arrivalChargePct);
        const now = String(leg.arrivalChargePct);
        card.querySelectorAll<HTMLElement>(".digit").forEach((el) => {
          const k = Number(el.dataset.fromRight);
          if (was.length !== now.length || was[was.length - k] !== now[now.length - k]) {
            el.animate([{ transform: "translateY(-0.6em)" }, { transform: "none" }], { duration: 180, easing: EASE });
          }
        });
      }
      if (old.reserve !== leg.reserve && leg.reserve === "below_reserve") {
        card.querySelector<HTMLElement>(".band")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: EASE });
      }
    });
    const svg = ribbonRef.current;
    if (svg) {
      const prior = before.previousPoints;
      const ease = (el: Element | null, from: string, to: string) => {
        if (el && from && to && from !== to) (el as HTMLElement).animate([{ d: `path("${from}")` }, { d: `path("${to}")` }], { duration: 720, easing: EASE });
      };
      ease(svg.querySelector(".ribbon__line"), ribbonPath(prior), ribbonPath(points));
      ease(svg.querySelector(".ribbon__area"), areaPath(prior), areaPath(points));
      points.forEach((pt, i) => {
        const was = prior[i];
        if (was && was.pct !== pt.pct) ease(svg.querySelector(`[data-point="${i}"]`), `M ${was.x} ${ribbonY(was.pct)} h 0`, `M ${pt.x} ${ribbonY(pt.pct)} h 0`);
      });
    }
  }, [plan]);

  // A band fading out stays until its 360 ms fade has run.
  useLayoutEffect(() => {
    if (!leaving.size || !legsRef.current) return;
    const fades = [...leaving].map((i) => legsRef.current!.querySelector<HTMLElement>(`[data-leg="${i}"] .band`)?.animate(
      [{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: EASE, fill: "forwards" }));
    Promise.all(fades.map((f) => f?.finished)).then(() => setLeaving(new Set()), () => undefined);
  }, [leaving]);

  if (loaded.result && !loaded.result.ok && loaded.result.status !== 401) return <NotFoundPage />;
  if (!p || !draft || !yacht || !places.size) return <Loader active />;

  const nameOf = (anchorage: string) => places.get(anchorage)?.name ?? anchorage;

  const setSpeed = (index: number, speed: number) => {
    const next = clampSpeed(Math.round(speed * 2) / 2);
    if (next === draft.legs[index].speedKn) return;
    const legs = draft.legs.map((l, i) => (i === index ? { ...l, speedKn: next } : l));
    const after = planPassage(yacht, places, p.startAnchorageId, legs, startPct, departsAt);
    motion.current = { previous: plan, previousPoints: points };
    if (!prefersReducedMotion()) {
      const fading = new Set<number>();
      after.forEach((leg, i) => {
        if (plan[i]?.reserve === "below_reserve" && leg.reserve === "ok") fading.add(i);
      });
      if (fading.size) setLeaving(fading);
    }
    setDraft({ ...draft, legs });
    const leg = after[index];
    passageUpdates.say(COPY.charge(index + 1, nameOf(leg.toAnchorageId), leg.arrivalChargePct));
  };

  const sliderKeys = (index: number) => (event: KeyboardEvent) => {
    const speed = draft.legs[index].speedKn;
    const moves: Record<string, number> = {
      ArrowLeft: speed - SPEED_STEP, ArrowDown: speed - SPEED_STEP, ArrowRight: speed + SPEED_STEP, ArrowUp: speed + SPEED_STEP,
      PageDown: speed - SPEED_PAGE, PageUp: speed + SPEED_PAGE, Home: SPEED_MIN, End: SPEED_MAX,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setSpeed(index, moves[event.key]);
  };

  const slider = (index: number, first = false) => (
    <div class="slider" key={`slider-${index}`}>
      <label for={`speed-${index}${speeds.open ? "-sheet" : ""}`}>Leg {index + 1} speed</label>
      <input
        id={`speed-${index}${speeds.open ? "-sheet" : ""}`}
        type="range"
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={SPEED_STEP}
        value={draft.legs[index].speedKn}
        aria-valuetext={formatSpeed(draft.legs[index].speedKn)}
        data-first={first ? "" : undefined}
        data-slider={index}
        onKeyDown={sliderKeys(index)}
        onInput={(event) => setSpeed(index, Number((event.currentTarget as HTMLInputElement).value))}
      />
      <span class="slider__value fig" aria-hidden="true">{formatSpeed(draft.legs[index].speedKn)}</span>
    </div>
  );

  /** [ and ] select the previous and next leg, whichever control of the legs has focus. */
  const selectLeg = (index: number) => {
    const next = Math.min(Math.max(0, index), plan.length - 1);
    if (next < 0) return;
    setSelected(next);
    strip.setIndex(next);
    const scope = speeds.open ? sheetBody.current : legsRef.current;
    const target = scope?.querySelector<HTMLElement>(`[data-slider="${next}"]`) ?? legsRef.current?.querySelector<HTMLElement>(`[data-remove="${next}"]`);
    target?.focus();
    if (!wide && !speeds.open) legsRef.current?.querySelector(`[data-leg="${next}"]`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
  };
  const legKeys = (event: KeyboardEvent) => {
    if ((event.key !== "[" && event.key !== "]") || isTyping(event.target)) return;
    event.preventDefault();
    const current = Number((event.target as HTMLElement).closest<HTMLElement>("[data-leg]")?.dataset.leg ?? (event.target as HTMLElement).dataset.slider ?? selected);
    selectLeg(current + (event.key === "]" ? 1 : -1));
  };

  const body = () => ({
    name: draft.name,
    startAnchorageId: p.startAnchorageId,
    departureDate: draft.date,
    departureTime: draft.time,
    startChargePct: percentValue(draft.charge),
    legs: draft.legs,
  });

  const savePassage = () =>
    void save.run("Saving passage", async () => {
      send.setNote(null);
      const result = await api<{ passage: PassageView }>("PUT", `/api/w/${ws}/passages/${id}`, body());
      if (result.ok) {
        setErrors({});
        setStatus(result.data.passage.status);
        return ok(COPY.passageSaved);
      }
      const found = result.body.errors ?? {};
      setErrors(found);
      return result.status === 422 ? bad(Object.values(found)[0]) : bad(sharedCopy(result));
    });

  const sendPassage = () =>
    void send.run("Sending to crew", async () => {
      save.setNote(null);
      const result = await api<{ passage: PassageView }>("POST", `/api/w/${ws}/passages/${id}/send`);
      if (result.ok) {
        setStatus("sent");
        return ok(COPY.passageSent);
      }
      if (result.body.error === "below_reserve") return bad(COPY.sendBelowReserve);
      if (result.body.error === "no_legs") return bad(COPY.sendNoLegs);
      return bad(sharedCopy(result));
    });

  const end = draft.legs.length ? draft.legs[draft.legs.length - 1].toAnchorageId : p.startAnchorageId;
  const destinations = [...places.values()].filter((a) => a.id !== end);
  const openAdd = (event: MouseEvent) => {
    setArriveAt(destinations[0]?.id ?? "");
    addDialog.show(event);
  };
  const addLeg = (event: Event) => {
    event.preventDefault();
    if (!arriveAt) return;
    setDraft({ ...draft, legs: [...draft.legs, { toAnchorageId: arriveAt, speedKn: NEW_LEG_SPEED }] });
    addDialog.hide();
  };
  const removeLeg = (index: number) => setDraft({ ...draft, legs: draft.legs.filter((_, i) => i !== index) });

  const ribbon = (
    <div class={wide ? "ribbon-wrap ribbon-wrap--strip" : "ribbon-wrap"} ref={ribbonRef}>
      <Ribbon points={points} width={width} minCharge={minCharge} fluid={!wide} />
    </div>
  );

  const legs = (
    <ul class={wide ? "legs legs--strip" : "legs"} aria-label="Legs" ref={legsRef}>
      {plan.map((leg, i) => {
        const below = leg.reserve === "below_reserve";
        return (
          <li
            key={i}
            class={`leg card${below ? " leg--below" : ""}${wide && i === strip.index ? " is-current" : ""}`}
            data-leg={i}
            data-arrival-charge={leg.arrivalChargePct}
            data-reserve={leg.reserve}
          >
            <h3 class="leg__title">Leg {i + 1}: {nameOf(leg.fromAnchorageId)} to {nameOf(leg.toAnchorageId)}</h3>
            <dl class="leg__facts">
              <div><dt>Distance</dt><dd class="fig">{formatDistance(leg.distanceNm)}</dd></div>
              <div><dt>Speed</dt><dd class="fig">{formatSpeed(leg.speedKn)}</dd></div>
              <div><dt>Arrives</dt><dd class="fig">{formatTime(isoInstant(leg.arrivesAtMs), leg.arrivalBase)}</dd></div>
            </dl>
            <ArrivalCharge pct={leg.arrivalChargePct} />
            {below || leaving.has(i) ? (
              <div class="band" aria-hidden={below ? undefined : "true"}>
                <span class="band__words">Below reserve</span>
              </div>
            ) : null}
            {editor && wide ? slider(i) : null}
            {editor ? (
              <Button variant="quiet" class="leg__remove" data-remove={i} onClick={() => removeLeg(i)}>
                Remove leg {i + 1}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <section class="planner">
      <h1 class="rise">{p.name}</h1>
      <p class="lede">
        {yacht.name} · <span class={`pill pill--${status}`}>{status === "sent" ? "Sent to crew" : "Draft"}</span> · times in each anchorage's base time
      </p>
      {editor ? (
        <form class="card form departure" onSubmit={(e) => { e.preventDefault(); savePassage(); }} noValidate>
          <Problems errors={errors} labels={PLANNER_FIELDS} />
          <div class="field-row field-row--4">
            <Field id="plan-name" label="Passage name" value={draft.name} onInput={(v) => setDraft({ ...draft, name: v })} error={errors.name} />
            <Field id="plan-date" label="Departure date" value={draft.date} onInput={(v) => setDraft({ ...draft, date: v })} error={errors.departureDate} />
            <Field id="plan-time" label="Departure time" value={draft.time} onInput={(v) => setDraft({ ...draft, time: v })} error={errors.departureTime} />
            <Field id="plan-charge" label="Starting charge" type="number" inputMode="numeric" value={draft.charge} onInput={(v) => setDraft({ ...draft, charge: v })} error={errors.startChargePct} />
          </div>
          <p class="muted">Departs from {nameOf(p.startAnchorageId)} at <span class="fig">{formatTime(isoInstant(departsAt), p.base)}</span>.</p>
        </form>
      ) : (
        <p class="card departure">
          Departs from {nameOf(p.startAnchorageId)} at <span class="fig">{formatTime(p.departsAt, p.base)}</span> with{" "}
          <span class="fig">{p.startChargePct}%</span> charge.
        </p>
      )}
      <div class="legs-region" onKeyDown={legKeys}>
        <div class="section-head">
          <h2>Legs</h2>
          {editor ? (
            <div class="section-head__actions">
              {!wide && plan.length ? <Button variant="quiet" onClick={speeds.show} aria-haspopup="dialog">Set speeds</Button> : null}
              <Button variant="quiet" id="plan-add" onClick={(e) => openAdd(e as unknown as MouseEvent)} disabled={draft.legs.length >= MAX_LEGS} aria-haspopup="dialog">
                Add leg
              </Button>
            </div>
          ) : null}
        </div>
        {wide ? (
          <>
            <div class="strip strip--legs" ref={strip.viewport} onWheel={strip.onWheel} onFocusIn={strip.onFocusIn}>
              <div class="strip__track" ref={strip.track}>
                {ribbon}
                {legs}
              </div>
            </div>
            <Hairline label="Legs position" index={strip.index} count={plan.length} />
          </>
        ) : (
          <>
            {ribbon}
            {legs}
          </>
        )}
        {plan.length ? null : <p class="empty">No legs yet.</p>}
      </div>
      {editor ? (
        <div class="planner__actions">
          <div>
            <Button onClick={savePassage} pending={save.pending} pendingLabel="Saving passage">Save passage</Button>
            <NoteLine note={speeds.open ? null : save.note} />
          </div>
          <div>
            <Button variant="quiet" onClick={sendPassage} disabled={!sendable} pending={send.pending} pendingLabel="Sending to crew">Send to crew</Button>
            <NoteLine note={send.note} />
          </div>
        </div>
      ) : null}
      <Dialog handle={addDialog} title="Add leg">
        <form class="form" onSubmit={addLeg} noValidate>
          <SelectField id="add-arrive" label="Arrive at" value={arriveAt} onChange={setArriveAt} options={destinations.map((a) => ({ value: a.id, label: a.name }))} first />
          <p class="muted">New legs start at <span class="fig">{formatSpeed(NEW_LEG_SPEED)}</span>.</p>
          <div class="dialog__actions">
            <Button type="submit">Add leg</Button>
            <Button variant="quiet" onClick={addDialog.hide}>Cancel</Button>
          </div>
        </form>
      </Dialog>
      <Dialog handle={speeds} title="Leg speeds" variant="sheet">
        <div class="sheet-scroll" ref={sheetBody} onKeyDown={legKeys}>
          {plan.map((leg, i) => (
            <div class="sheet-leg" key={i} data-leg={i}>
              <p class="sheet-leg__name">Leg {i + 1} to {nameOf(leg.toAnchorageId)} · <span class="fig">{leg.arrivalChargePct}%</span></p>
              {slider(i, i === selected)}
            </div>
          ))}
          <div class="sheet-bar" ref={sheetBar}>
            <NoteLine note={speeds.open ? save.note : null} />
            <Button onClick={savePassage} pending={save.pending} pendingLabel="Saving passage">Save passage</Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
