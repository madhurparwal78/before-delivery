// The credit meter (Reservation ribbon): three drawn segments whose widths are their balances' share of
// granted credits, one notch per in-flight reservation, and the published reserve, replay, settle and
// release sequences played one after another in ledger order.

import { useEffect, useRef, useState } from "preact/hooks";
import { formatCredits } from "../shared/money";
import { parseUnitsText, unitsPhrase, type Unit } from "../shared/units";
import { get, type CapState, type InFlight, type Job, type JobStatus, type MeterSnapshot } from "./api";
import { EASE, RIBBON_MS, SHORT_MS, day, reducedMotion, usePoll } from "./hooks";

type Segment = "settled" | "reserved" | "available";
const SEGMENTS: Segment[] = ["settled", "reserved", "available"];
// The replay highlight: DESIGN.md vermilion-bright, color-mix(in oklab, #C4391D 70%, #FF8A5C).
const REPLAY_OUTLINE = "#DD5532";
const WORDS: Record<Segment, string> = { settled: "Settled", reserved: "Reserved", available: "Available" };

interface Balances {
  granted: bigint;
  settled: bigint;
  reserved: bigint;
  available: bigint;
}

interface Notch {
  id: string;
  status: JobStatus;
  amount: bigint;
  units: string;
  unit: Unit;
  el: HTMLDivElement;
}

interface NotchTab {
  id: string;
  status: JobStatus;
  label: string;
}

interface Elements {
  segments: Record<Segment, HTMLElement>;
  numerals: Record<Segment, HTMLElement>;
  figures: Record<Segment, HTMLElement>;
  marker: HTMLElement;
  hatch: HTMLElement;
  throttled: HTMLElement;
  announcements: HTMLElement;
  tabsList: HTMLElement;
}

interface Hooks {
  onTabs: (tabs: NotchTab[]) => void;
  teamName: () => string;
}

const balancesOf = (snap: MeterSnapshot): Balances => ({
  granted: BigInt(snap.granted_micro),
  settled: BigInt(snap.settled_micro),
  reserved: BigInt(snap.reserved_micro),
  available: BigInt(snap.available_micro),
});

const sameBalances = (a: Balances, b: Balances): boolean =>
  a.granted === b.granted && a.settled === b.settled && a.reserved === b.reserved && a.available === b.available;

/** An exact decimal string of credits for a micro amount: "4915.000000". */
const exactCredits = (micro: bigint): string => {
  const sign = micro < 0n ? "-" : "";
  const abs = micro < 0n ? -micro : micro;
  return `${sign}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0")}`;
};

const notchLabel = (id: string, estimatedUnits: string, unit: Unit): string =>
  `Job ${id}, ${unitsPhrase(parseUnitsText(estimatedUnits), unit)} reserved`;

const active = (status: JobStatus): boolean => status === "leased" || status === "running";

class Ribbon {
  private shown: Balances | null = null;
  private notches: Notch[] = [];
  private last: MeterSnapshot | null = null;
  private seenReplays = new Set<string>();
  private cap: CapState = "under";
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  private readonly resize = new ResizeObserver(() => this.placeNumerals());

  constructor(private readonly els: Elements, private readonly hooks: Hooks) {
    els.segments.reserved.replaceChildren();
    this.resize.observe(els.numerals.settled.parentElement!);
  }

  dispose(): void {
    this.disposed = true;
    this.resize.disconnect();
  }

  /** Takes a fresh server snapshot and queues the sequences that lead from the last one to it. */
  update(snap: MeterSnapshot): void {
    if (this.disposed) return;
    const previous = this.last;
    this.last = snap;
    const replayKey = (r: { job_id: string; at: string }) => `${r.job_id}@${r.at}`;
    const replays = snap.recent_replays.filter((r) => !this.seenReplays.has(replayKey(r)));
    replays.forEach((r) => this.seenReplays.add(replayKey(r)));
    if (!previous) {
      this.chain = this.chain.then(() => this.init(snap));
      return;
    }
    const before = new Set(previous.in_flight.map((f) => f.job_id));
    const now = new Set(snap.in_flight.map((f) => f.job_id));
    const added = snap.in_flight.filter((f) => !before.has(f.job_id));
    const removed = previous.in_flight.filter((f) => !now.has(f.job_id)).map((f) => f.job_id);
    const finished = Promise.all(removed.map((id) =>
      get<{ job: Job }>(`/api/jobs/${id}`).then((r) => r.job, () => null)));
    this.chain = this.chain
      .then(async () => this.play(snap, added, removed, await finished, replays.map((r) => r.job_id)))
      .catch(() => this.init(snap));
  }

  /** Hover or focus on a notch tab outlines its drawn notch. */
  outline(id: string, on: boolean): void {
    this.notches.find((n) => n.id === id)?.el.classList.toggle("notch--outlined", on);
  }

  // ---- drawing -----------------------------------------------------------------------------------

  private percent(micro: bigint, granted: bigint): number {
    if (granted <= 0n || micro <= 0n) return 0;
    return Number((micro * 100_000_000n) / granted) / 1_000_000;
  }

  private drawStatic(b: Balances): void {
    for (const segment of SEGMENTS) {
      const value = b[segment];
      const share = this.percent(value, b.granted);
      const el = this.els.segments[segment];
      el.style.width = `${share}%`;
      el.setAttribute("aria-valuenow", exactCredits(value));
      el.setAttribute("aria-valuemax", exactCredits(b.granted));
      el.setAttribute("aria-valuetext", `${formatCredits(value)} credits`);
    }
    this.placeNumerals();
  }

  /** Each numeral starts at its segment's left edge, pushed right only as far as the previous label needs,
   *  and pulled back left only when it would run past the end of the bar. */
  private placeNumerals(): void {
    const b = this.shown;
    const row = this.els.numerals.settled.parentElement;
    if (!b || !row) return;
    const width = row.clientWidth;
    const gap = 12;
    const sizes = SEGMENTS.map((s) => this.els.numerals[s].offsetWidth);
    let edge = 0;
    const lefts = SEGMENTS.map((s, i) => {
      const start = edge;
      edge += (this.percent(b[s], b.granted) / 100) * width;
      return i === 0 ? 0 : start;
    });
    for (let i = 1; i < lefts.length; i++) lefts[i] = Math.max(lefts[i], lefts[i - 1] + sizes[i - 1] + gap);
    lefts[lefts.length - 1] = Math.min(lefts[lefts.length - 1], width - sizes[sizes.length - 1]);
    for (let i = lefts.length - 2; i >= 0; i--) lefts[i] = Math.max(0, Math.min(lefts[i], lefts[i + 1] - gap - sizes[i]));
    SEGMENTS.forEach((s, i) => {
      this.els.numerals[s].style.left = `${Math.round(lefts[i])}px`;
    });
  }

  private setFigure(segment: Segment, value: bigint): void {
    this.els.figures[segment].textContent = formatCredits(value);
  }

  private makeNotch(f: InFlight, amount: bigint): Notch {
    const el = document.createElement("div");
    el.className = `notch ${active(f.status) ? "notch--active" : "notch--queued"}`;
    el.dataset.job = f.job_id;
    el.style.flexGrow = String(amount);
    return { id: f.job_id, status: f.status, amount, units: f.estimated_units, unit: f.unit, el };
  }

  private publishTabs(): void {
    this.hooks.onTabs(this.notches.map((n) => ({ id: n.id, status: n.status, label: notchLabel(n.id, n.units, n.unit) })));
  }

  private announce(text: string): void {
    const line = document.createElement("p");
    line.textContent = text;
    const region = this.els.announcements;
    region.append(line);
    while (region.childElementCount > 3) region.firstElementChild?.remove();
  }

  /** Moves the drawing to `to`, animating widths and counting numerals unless motion is reduced. */
  private async move(to: Balances, notchMoves: { notch: Notch; to: bigint }[]): Promise<void> {
    const from = this.shown ?? to;
    this.shown = to;
    const animate = !reducedMotion();
    const animations: Partial<Record<Segment, Animation>> = {};
    const all: Animation[] = [];
    for (const segment of SEGMENTS) {
      const start = this.percent(from[segment], from.granted);
      const end = this.percent(to[segment], to.granted);
      if (animate && start !== end) {
        const animation = this.els.segments[segment].animate(
          [{ width: `${start}%` }, { width: `${end}%` }], { duration: RIBBON_MS, easing: EASE });
        animations[segment] = animation;
        all.push(animation);
      }
    }
    for (const { notch, to: amount } of notchMoves) {
      const start = notch.amount;
      notch.amount = amount;
      notch.el.style.flexGrow = String(amount);
      if (animate && start !== amount) {
        all.push(notch.el.animate([{ flexGrow: String(start) }, { flexGrow: String(amount) }],
          { duration: RIBBON_MS, easing: EASE }));
      }
    }
    this.drawStatic(to);
    for (const segment of SEGMENTS) {
      const animation = animations[segment] ?? all[0];
      if (animation && from[segment] !== to[segment]) this.count(segment, from[segment], to[segment], animation);
      else this.setFigure(segment, to[segment]);
    }
    await Promise.all(all.map((a) => a.finished.catch(() => undefined)));
    for (const segment of SEGMENTS) this.setFigure(segment, to[segment]);
    this.placeNumerals();
  }

  /** The numeral follows its segment's eased width progress, so both take exactly the same time. */
  private count(segment: Segment, from: bigint, to: bigint, animation: Animation): void {
    const span = Number(to - from);
    const tick = () => {
      if (this.disposed) return;
      const state = animation.playState;
      if (state === "finished" || state === "idle") {
        this.setFigure(segment, to);
        return;
      }
      const progress = animation.effect?.getComputedTiming().progress;
      const share = typeof progress === "number" ? progress : 0;
      this.setFigure(segment, from + BigInt(Math.round(span * share)));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private fadeIn(el: HTMLElement): void {
    el.hidden = false;
    if (!reducedMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SHORT_MS, easing: EASE });
  }

  // ---- sequences ---------------------------------------------------------------------------------

  private init(snap: MeterSnapshot): void {
    if (this.disposed) return;
    this.notches = snap.in_flight.map((f) => this.makeNotch(f, BigInt(f.reserved_micro)));
    this.els.segments.reserved.replaceChildren(...this.notches.map((n) => n.el));
    this.shown = balancesOf(snap);
    this.drawStatic(this.shown);
    for (const segment of SEGMENTS) this.setFigure(segment, this.shown[segment]);
    this.placeNumerals();
    this.cap = snap.cap_state;
    this.drawCap(snap, false);
    this.publishTabs();
  }

  private async play(snap: MeterSnapshot, added: InFlight[], removed: string[], jobs: (Job | null)[],
    replays: string[]): Promise<void> {
    if (this.disposed || !this.shown) return;
    const finishes = removed.map((id, i) => ({ id, job: jobs[i], notch: this.notches.find((n) => n.id === id) }))
      .sort((a, b) => (a.job?.finished_at ?? "").localeCompare(b.job?.finished_at ?? ""));

    // Whatever the job sequences do not explain (a top-up, a missed poll) is drawn first.
    const predicted = { ...this.shown };
    for (const { job, notch } of finishes) {
      const amount = notch?.amount ?? 0n;
      predicted.reserved -= amount;
      if (job?.status === "succeeded" && job.charged_micro !== null) {
        predicted.settled += BigInt(job.charged_micro);
        predicted.available += amount - BigInt(job.charged_micro);
      } else predicted.available += amount;
    }
    for (const f of added) {
      predicted.available -= BigInt(f.reserved_micro);
      predicted.reserved += BigInt(f.reserved_micro);
    }
    const target = balancesOf(snap);
    if (!sameBalances(predicted, target)) {
      const s = this.shown;
      await this.move({
        granted: target.granted,
        settled: s.settled + target.settled - predicted.settled,
        reserved: s.reserved + target.reserved - predicted.reserved,
        available: s.available + target.available - predicted.available,
      }, []);
    }

    for (const { id, job, notch } of finishes) {
      if (this.disposed) return;
      if (notch) await (job?.status === "succeeded" && job.charged_micro !== null
        ? this.settle(notch, BigInt(job.charged_micro))
        : this.release(notch));
      else if (job) this.announce(`Job ${id} ${job.status === "succeeded" ? "settled" : "released"}`);
    }
    for (const f of added) {
      if (this.disposed) return;
      await this.reserve(f);
    }
    for (const id of replays) {
      if (this.disposed) return;
      await this.replay(id);
    }
    this.syncNotches(snap);
    this.drawCap(snap, true);
    this.shown = target;
    this.drawStatic(target);
    for (const segment of SEGMENTS) this.setFigure(segment, target[segment]);
  }

  private async reserve(f: InFlight): Promise<void> {
    const s = this.shown!;
    const amount = BigInt(f.reserved_micro);
    const notch = this.makeNotch(f, 0n);
    this.notches.push(notch);
    this.els.segments.reserved.append(notch.el);
    this.publishTabs();
    const to = { ...s, available: s.available - amount, reserved: s.reserved + amount };
    this.announce(`Job ${f.job_id} reserved ${unitsPhrase(parseUnitsText(f.estimated_units), f.unit)}, ${formatCredits(to.available)} credits available`);
    await this.move(to, [{ notch, to: amount }]);
  }

  private async settle(notch: Notch, charge: bigint): Promise<void> {
    const s = this.shown!;
    const unused = notch.amount - charge;
    const resized = { ...s, reserved: s.reserved - unused, available: s.available + unused };
    this.announce(`Job ${notch.id} settled ${formatCredits(charge)} credits, ${formatCredits(resized.available)} credits available`);
    await this.move(resized, [{ notch, to: charge }]);
    await this.move({ ...resized, reserved: resized.reserved - charge, settled: resized.settled + charge }, [{ notch, to: 0n }]);
    this.drop(notch);
  }

  private async release(notch: Notch): Promise<void> {
    const s = this.shown!;
    const amount = notch.amount;
    const to = { ...s, reserved: s.reserved - amount, available: s.available + amount };
    this.announce(`Job ${notch.id} released ${formatCredits(amount)} credits, ${formatCredits(to.available)} credits available`);
    await this.move(to, [{ notch, to: 0n }]);
    this.drop(notch);
  }

  private async replay(id: string): Promise<void> {
    this.announce(`Job ${id} already reserved; nothing added`);
    const notch = this.notches.find((n) => n.id === id);
    const tab = this.els.tabsList.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    const targets = [notch?.el, tab].filter((el): el is HTMLElement => Boolean(el));
    if (reducedMotion()) {
      targets.forEach((el) => el.classList.add("replayed"));
      window.setTimeout(() => targets.forEach((el) => el.classList.remove("replayed")), 1000);
      return;
    }
    const flashes = targets.map((el) => el.animate([
      { outlineColor: REPLAY_OUTLINE, outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "1px" },
      { outlineColor: "transparent", outlineStyle: "solid", outlineWidth: "1px", outlineOffset: "1px" },
    ], { duration: SHORT_MS, easing: EASE }));
    await Promise.all(flashes.map((a) => a.finished.catch(() => undefined)));
  }

  private drop(notch: Notch): void {
    notch.el.remove();
    this.notches = this.notches.filter((n) => n !== notch);
    this.publishTabs();
  }

  /** Brings notches exactly to the snapshot: statuses, amounts, order (a job seen in neither poll). */
  private syncNotches(snap: MeterSnapshot): void {
    const byId = new Map(this.notches.map((n) => [n.id, n]));
    this.notches = snap.in_flight.map((f) => {
      const existing = byId.get(f.job_id);
      const notch = existing ?? this.makeNotch(f, BigInt(f.reserved_micro));
      notch.status = f.status;
      notch.amount = BigInt(f.reserved_micro);
      notch.el.style.flexGrow = String(notch.amount);
      notch.el.classList.toggle("notch--active", active(f.status));
      notch.el.classList.toggle("notch--queued", !active(f.status));
      return notch;
    });
    const keep = new Set(this.notches.map((n) => n.el));
    for (const n of byId.values()) if (!keep.has(n.el)) n.el.remove();
    this.els.segments.reserved.append(...this.notches.map((n) => n.el));
    this.publishTabs();
  }

  private drawCap(snap: MeterSnapshot, announceChanges: boolean): void {
    const { marker, hatch, throttled } = this.els;
    const granted = BigInt(snap.granted_micro);
    const offset = BigInt(snap.period.soft_cap_offset_micro);
    const showMarker = snap.cap_state !== "under" && offset >= 0n && offset <= granted;
    marker.style.left = `${this.percent(offset, granted)}%`;
    if (showMarker && marker.hidden) {
      if (announceChanges) this.fadeIn(marker);
      else marker.hidden = false;
    } else if (!showMarker) marker.hidden = true;

    const hard = snap.cap_state === "hard_cap_reached";
    throttled.textContent = hard ? `Hard cap reached — new jobs are throttled until ${day(snap.period.ends_at)}` : "";
    if (hard && hatch.hidden) {
      throttled.hidden = false;
      if (announceChanges) this.fadeIn(hatch);
      else hatch.hidden = false;
    } else if (!hard) {
      hatch.hidden = true;
      throttled.hidden = true;
    }

    if (announceChanges && snap.cap_state !== this.cap) {
      if (this.cap === "under") this.announce(`${this.hooks.teamName()} passed its soft cap`);
      if (hard) this.announce(`${this.hooks.teamName()} is throttled at its hard cap`);
    }
    this.cap = snap.cap_state;
  }
}

export function CreditMeter({ teamId, teamName, onOpenJob }: {
  teamId: string;
  teamName: string;
  onOpenJob: (jobId: string) => void;
}) {
  const segments = { settled: useRef<HTMLDivElement>(null), reserved: useRef<HTMLDivElement>(null), available: useRef<HTMLDivElement>(null) };
  const numerals = { settled: useRef<HTMLDivElement>(null), reserved: useRef<HTMLDivElement>(null), available: useRef<HTMLDivElement>(null) };
  const figures = { settled: useRef<HTMLSpanElement>(null), reserved: useRef<HTMLSpanElement>(null), available: useRef<HTMLSpanElement>(null) };
  const marker = useRef<HTMLDivElement>(null);
  const hatch = useRef<HTMLDivElement>(null);
  const throttled = useRef<HTMLParagraphElement>(null);
  const announcements = useRef<HTMLDivElement>(null);
  const tabsList = useRef<HTMLUListElement>(null);
  const ribbon = useRef<Ribbon | null>(null);
  const name = useRef(teamName);
  name.current = teamName;
  const [tabs, setTabs] = useState<NotchTab[]>([]);

  useEffect(() => {
    const pick = <T,>(refs: Record<Segment, { current: T | null }>) =>
      Object.fromEntries(SEGMENTS.map((s) => [s, refs[s].current!])) as Record<Segment, T>;
    const engine = new Ribbon({
      segments: pick<HTMLElement>(segments),
      numerals: pick<HTMLElement>(numerals),
      figures: pick<HTMLElement>(figures),
      marker: marker.current!,
      hatch: hatch.current!,
      throttled: throttled.current!,
      announcements: announcements.current!,
      tabsList: tabsList.current!,
    }, { onTabs: setTabs, teamName: () => name.current });
    ribbon.current = engine;
    setTabs([]);
    return () => engine.dispose();
  }, [teamId]);

  usePoll(async () => {
    const snap = await get<MeterSnapshot>(`/api/teams/${teamId}/meter`);
    ribbon.current?.update(snap);
  }, 1000, [teamId]);

  return (
    <section class="meter" role="region" aria-label="Credit meter">
      <div class="meter__numerals">
        {SEGMENTS.map((s) => (
          <div key={s} ref={numerals[s]} class={`meter__numeral meter__numeral--${s}`}>
            <span class="meter__word">{WORDS[s]}</span>
            <span ref={figures[s]} class="meter__figure num" />
          </div>
        ))}
      </div>
      <div class="meter__bar">
        {SEGMENTS.map((s) => (
          <div key={s} ref={segments[s]} class={`seg seg--${s}`} role="meter" aria-label={WORDS[s]}
            aria-valuemin={0} aria-valuemax={0} aria-valuenow={0}>
            {s === "available" && <div ref={hatch} class="seg__hatch" hidden />}
          </div>
        ))}
        <div ref={marker} class="meter__marker" role="img" aria-label="Soft cap marker" hidden />
      </div>
      <ul ref={tabsList} class="meter__tabs" aria-label="In-flight jobs">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <button type="button" data-tab={tab.id} aria-label={tab.label}
              class={`notch-tab num ${active(tab.status) ? "notch-tab--active" : "notch-tab--queued"}`}
              onClick={() => onOpenJob(tab.id)}
              onMouseEnter={() => ribbon.current?.outline(tab.id, true)}
              onMouseLeave={() => ribbon.current?.outline(tab.id, false)}
              onFocus={() => ribbon.current?.outline(tab.id, true)}
              onBlur={() => ribbon.current?.outline(tab.id, false)}>
              {tab.id}
            </button>
          </li>
        ))}
      </ul>
      <p ref={throttled} class="meter__throttled" hidden />
      <div ref={announcements} class="sr-only" role="status" aria-live="polite" aria-label="Meter announcements" />
    </section>
  );
}
