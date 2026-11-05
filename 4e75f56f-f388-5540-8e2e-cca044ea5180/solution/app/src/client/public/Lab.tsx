import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BenchInfo, Tier } from "../api.js";
import { ROWS } from "../catalogue.js";
import { dollars, mmss } from "../format.js";
import { PRICES } from "../../shared/prices.js";
import { Icon, Live, NARROW, REDUCED_MOTION, useMedia } from "../ui/kit.js";
import { BILLING_OFFLINE, DEPOSITS_CLOSED, store, useStore } from "./store.js";
import type { LabScene, Look, RingMode } from "./LabScene.js";

type StateText = "Open" | "Atelier only" | "Sold out" | "Held" | "Held by you" | "Offered to you" | "Sold" | "Yours";

const SERVER_TEXT: Record<BenchInfo["state"], StateText> = {
  open: "Open",
  held: "Held",
  held_by_you: "Held by you",
  offered_to_you: "Offered to you",
  sold: "Sold",
  yours: "Yours",
};

function stateText(bench: BenchInfo, tier: Tier, atelierSoldOut: boolean): StateText {
  if (bench.state !== "open" || bench.tier === "bench") return SERVER_TEXT[bench.state];
  if (atelierSoldOut) return "Sold out";
  return tier === "atelier" ? "Open" : "Atelier only";
}

const GLYPH: Record<StateText, "lock" | "clock" | "dot" | "check" | null> = {
  Open: null,
  "Atelier only": "lock",
  "Sold out": "lock",
  Held: "clock",
  "Held by you": null,
  "Offered to you": null,
  Sold: "dot",
  Yours: "check",
};

const PLACEHOLDER: BenchInfo[] = ROWS.flatMap((row) =>
  [1, 2, 3, 4, 5, 6].map((number) => ({ label: `${row}${number}`, row, number, tier: row === "A" || row === "B" ? "atelier" : "bench", state: "open" }) as BenchInfo),
);

function useBenchTexts() {
  const s = useStore();
  const benches = s.benches?.benches ?? PLACEHOLDER;
  const soldOut = s.benches?.tiers.atelier.sold_out ?? false;
  return benches.map((bench) => ({ bench, text: stateText(bench, s.tier, soldOut) }));
}

/** Seconds left on the live hold, re-rendered every quarter second (every second under reduced motion). */
export function useCountdown(): number | null {
  const s = useStore();
  const reduced = useMedia(REDUCED_MOTION);
  const [, tick] = useState(0);
  const live = s.hold !== null;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => tick((n) => n + 1), reduced ? 1000 : 250);
    return () => clearInterval(id);
  }, [live, reduced]);
  return s.secondsLeft();
}

// ---- Bench map ----------------------------------------------------------------------------------

/** The bench map's single Tab stop: your held bench, or the first open bench in reading order. */
export function benchMapStop(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-bench-map] button[tabindex="0"]');
}

function BenchMap() {
  const s = useStore();
  const items = useBenchTexts();
  const [active, setActive] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const held = s.hold?.labels[0] ?? null;
  const restStop = held ?? items.find((item) => item.text === "Open")?.bench.label ?? "A1";
  const stop = active ?? restStop;
  const order = items.map((item) => item.bench.label);

  const move = (label: string) => {
    setActive(label);
    refs.current.get(label)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const current = (event.target as HTMLElement).dataset.label;
    if (event.key === "Escape") {
      event.preventDefault();
      void store.release();
      return;
    }
    if (!current) return;
    const index = order.indexOf(current);
    const row = current.slice(0, 1);
    const number = Number(current.slice(1));
    const rowIndex = ROWS.indexOf(row as (typeof ROWS)[number]);
    let next: string | undefined;
    if (matchMedia(NARROW).matches) {
      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = order[Math.min(order.length - 1, index + 1)];
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = order[Math.max(0, index - 1)];
    } else {
      if (event.key === "ArrowRight") next = `${row}${Math.min(6, number + 1)}`;
      if (event.key === "ArrowLeft") next = `${row}${Math.max(1, number - 1)}`;
      if (event.key === "ArrowDown") next = `${ROWS[Math.min(3, rowIndex + 1)]}${number}`;
      if (event.key === "ArrowUp") next = `${ROWS[Math.max(0, rowIndex - 1)]}${number}`;
    }
    if (event.key === "Home") next = `${row}1`;
    if (event.key === "End") next = `${row}6`;
    if (next) {
      event.preventDefault();
      move(next);
    }
  };

  return (
    <div
      class="map"
      role="grid"
      aria-label="Bench map"
      data-bench-map
      onKeyDown={onKeyDown}
      onFocusOut={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !(event.currentTarget as HTMLElement).contains(next)) setActive(null);
      }}
    >
      {ROWS.map((row) => (
        <div class="map__row" role="row" aria-label={`Row ${row}`} key={row}>
          <span class="map__rowhead" role="rowheader">
            <span class="sr-only">Row </span>
            {row}
          </span>
          {items
            .filter((item) => item.bench.row === row)
            .map(({ bench, text }) => {
              const selected = s.selection.includes(bench.label);
              const glyph = GLYPH[text];
              return (
                <div role="gridcell" class="map__cell" key={bench.label}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) refs.current.set(bench.label, el);
                    }}
                    class="bench"
                    data-label={bench.label}
                    data-tier={bench.tier}
                    data-state={text.toLowerCase().replace(/ /g, "-")}
                    data-selected={selected ? "true" : undefined}
                    aria-label={`Bench ${bench.label}, ${text}`}
                    aria-pressed={s.isClinic && !s.hold ? selected : undefined}
                    tabIndex={bench.label === stop ? 0 : -1}
                    onFocus={() => setActive(bench.label)}
                    onClick={() => store.choose(bench.label, text)}
                  >
                    <span class="bench__head">
                      {glyph && <Icon name={glyph} class="bench__glyph" />}
                      <span class="bench__label">{bench.label}</span>
                    </span>{" "}
                    <span class="bench__state">{text}</span>
                  </button>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

// ---- Tier switch, waitlist, banners -------------------------------------------------------------

function TierSwitch() {
  const s = useStore();
  const soldOut = s.benches?.tiers.atelier.sold_out ?? false;
  return (
    <div class="tiers" role="radiogroup" aria-label="Tier">
      {(["bench", "atelier"] as const).map((tier) => (
        <label class="tiers__option" key={tier} data-tier={tier}>
          <input type="radio" name="tier" value={tier} checked={s.tier === tier} onChange={() => store.setTier(tier)} />
          <span class="tiers__text">
            {tier === "atelier" && <Icon name="lock" class="gold" />}
            {tier === "bench" ? "Bench" : "Atelier"}
            {tier === "atelier" && soldOut && <span class="tiers__sold"> Sold out</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

function holdableIn(tier: Tier): boolean {
  const tiers = store.benches?.tiers;
  if (!tiers) return true;
  return tier === "bench" ? tiers.bench.remaining > 0 : tiers.atelier.remaining > 0;
}

function Waitlist() {
  const s = useStore();
  if (s.hold || s.isClinic || holdableIn(s.tier) || s.me?.waitlist || (s.role && s.role !== "practitioner")) return null;
  const name = s.tier === "bench" ? "Bench" : "Atelier";
  return (
    <button type="button" class="button button--quiet waitlist" onClick={() => void store.joinWaitlist(s.tier)}>
      Join the {name} waitlist
    </button>
  );
}

function SoldOut() {
  const s = useStore();
  if (s.tier !== "atelier" || !s.benches?.tiers.atelier.sold_out) return null;
  return (
    <div class="soldout">
      <h3 class="soldout__title">
        <Icon name="lock" class="gold" /> Atelier is sold out
      </h3>
      <p>All 10 Atelier places are taken. Join the Atelier waitlist and we will offer you the next Atelier bench that opens.</p>
    </div>
  );
}

function BillingBanner() {
  const s = useStore();
  if (!s.billingOffline) return null;
  return (
    <div class="banner" role="alert">
      {BILLING_OFFLINE}
    </div>
  );
}

// ---- Hold panel ---------------------------------------------------------------------------------

function KineticLabel({ prefix, label }: { prefix: string; label: string }) {
  const reduced = useMedia(REDUCED_MOTION);
  if (reduced) return <>{`${prefix}${label}`}</>;
  return (
    <>
      {prefix}
      <span class="sr-only">{label}</span>
      <span class="letters" aria-hidden="true" key={label}>
        {[...label].map((char, i) => (
          <span data-letter class="letter" style={{ "--i": String(i) }} key={`${label}-${i}`}>
            {char}
          </span>
        ))}
      </span>
    </>
  );
}

export function HoldPanel({ onPay, compact }: { onPay: (kind: "deposit" | "full" | "group") => void; compact?: boolean }) {
  const s = useStore();
  const left = useCountdown();
  const hold = s.hold;
  const tier: Tier = hold?.labels[0]?.match(/^[AB]/) ? "atelier" : "bench";
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && (s.hold || s.selection.length)) {
      event.preventDefault();
      void store.release();
    }
  };
  let body;
  if (s.holding.length) {
    body = (
      <>
        <h3 class="hold__title" id="hold-heading" tabIndex={-1}>
          {s.holding.length > 1 ? `Holding ${s.holding.length} benches` : `Holding Bench ${s.holding[0] ?? ""}`}
        </h3>
      </>
    );
  } else if (hold) {
    const group = hold.groupId !== null;
    const checking = left !== null && left <= 0;
    const depositsOpen = s.benches?.deposits_open === true;
    body = (
      <>
        <h3 class="hold__title" id="hold-heading" tabIndex={-1}>
          {group ? `${hold.labels.length} benches held: ${hold.labels.join(", ")}` : <KineticLabel prefix="Bench " label={hold.labels[0] ?? ""} />}
        </h3>
        <p class="hold__timer">
          <span class="hold__timer-label">Held for you</span>
          <span role="timer" aria-label="Hold time remaining" class="mono timer">
            {mmss(left ?? 0)}
          </span>
        </p>
        {checking && <p class="hold__note">Checking your hold</p>}
        <div class="hold__actions">
          {group ? (
            <button type="button" class="button button--primary" onClick={() => onPay("group")}>
              Pay group invoice
            </button>
          ) : (
            <>
              {depositsOpen && (
                <button type="button" class="button button--primary" onClick={() => onPay("deposit")}>
                  Pay deposit
                </button>
              )}
              <button type="button" class={`button ${depositsOpen ? "" : "button--primary"}`} onClick={() => onPay("full")}>
                Pay in full
              </button>
            </>
          )}
          <button type="button" class="button button--quiet" onClick={() => void store.release()}>
            {group ? "Release benches" : "Release bench"}
          </button>
        </div>
        {!group && !depositsOpen && <p class="hold__note">{DEPOSITS_CLOSED}</p>}
        {!compact && !group && depositsOpen && (
          <p class="hold__fine">
            Deposit <span class="num">${dollars(PRICES[tier].deposit)}</span> now, or <span class="num">${dollars(PRICES[tier].full)}</span> in full.
          </p>
        )}
      </>
    );
  } else if (s.selection.length) {
    body = (
      <>
        <h3 class="hold__title" id="hold-heading" tabIndex={-1}>
          {s.selection.length} {s.selection.length === 1 ? "bench" : "benches"} selected
        </h3>
        <ul class="hold__list">
          {s.selection.map((label) => (
            <li key={label}>Bench {label}</li>
          ))}
        </ul>
        <div class="hold__actions">
          <button type="button" class="button button--primary" onClick={() => void store.placeHold(s.selection)}>
            Hold {s.selection.length} {s.selection.length === 1 ? "bench" : "benches"}
          </button>
          <button type="button" class="button button--quiet" onClick={() => store.clearSelection()}>
            Clear selection
          </button>
        </div>
      </>
    );
  } else if (s.confirmed.length) {
    body = (
      <>
        <h3 class="hold__title" id="hold-heading" tabIndex={-1}>
          {s.confirmed.length > 1 ? `Group invoice confirmed: ${s.confirmed.length} seats on one invoice` : `Bench ${s.confirmed[0]} is yours`}
        </h3>
        <p class="hold__note">
          Your receipt is on its way. <a href="/account">See My seats</a>
        </p>
      </>
    );
  } else {
    body = (
      <>
        <h3 class="hold__title" id="hold-heading" tabIndex={-1}>
          Your hold
        </h3>
        <p class="hold__note">
          {s.isClinic ? "Select up to six benches, then hold them together on the lab clock." : "Pick an open bench to hold it on the lab clock."}
        </p>
      </>
    );
  }
  return (
    <section class={`hold ${compact ? "hold--compact" : ""}`} aria-label="Your hold" onKeyDown={onKeyDown}>
      {body}
    </section>
  );
}

// ---- Scene host ---------------------------------------------------------------------------------

function webglAvailable(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

const LOOK: Record<StateText, Look> = {
  Open: "open",
  "Atelier only": "atelier",
  "Sold out": "atelier",
  Held: "held",
  "Held by you": "mine",
  "Offered to you": "mine",
  Sold: "sold",
  Yours: "yours",
};

function selectionFor(): { label: string | null; ring: RingMode } {
  const s = store;
  if (s.hold) return { label: s.hold.labels[0] ?? null, ring: "depleting" };
  if (s.selection.length) return { label: s.selection[s.selection.length - 1] ?? null, ring: "none" };
  if (s.confirmed.length) return { label: s.confirmed[0] ?? null, ring: "band" };
  const yours = s.benches?.benches.find((b) => b.state === "yours");
  return { label: yours?.label ?? null, ring: yours ? "band" : "none" };
}

function SceneHost({ chapter }: { chapter: { current: HTMLElement | null } }) {
  const s = useStore();
  const items = useBenchTexts();
  const region = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<LabScene | null>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    let disposed = false;
    let frame = 0;
    void import("./LabScene.js").then(({ LabScene }) => {
      if (disposed || !region.current || !canvas.current) return;
      scene.current = new LabScene(region.current, canvas.current, (label) => {
        const item = store.benches?.benches.find((b) => b.label === label);
        if (item) store.choose(label, stateText(item, store.tier, store.benches?.tiers.atelier.sold_out ?? false));
      });
      store.emit();
      const start = performance.now();
      const count = () => {
        const value = Math.min(100, ((performance.now() - start) / 800) * 100);
        setProgress(value);
        if (value < 100) frame = requestAnimationFrame(count);
        else setReady(true);
      };
      frame = requestAnimationFrame(count);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      scene.current?.dispose();
    };
  }, []);

  useEffect(() => {
    // The camera reads the chapter's place on the page every frame, so it is never a scroll event
    // behind; setScroll redraws only when the progress actually changes.
    let frame = 0;
    const follow = () => {
      const section = chapter.current;
      if (section && scene.current) {
        const rect = section.getBoundingClientRect();
        const span = rect.height - window.innerHeight;
        scene.current.setScroll(span > 0 ? -rect.top / span : 0);
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [ready, chapter]);

  const looks = useMemo(() => {
    const map = new Map<string, Look>();
    for (const { bench, text } of items) map.set(bench.label, s.selection.includes(bench.label) ? "mine" : LOOK[text]);
    return map;
  }, [items, s.selection]);

  const selection = selectionFor();
  useEffect(() => {
    if (!scene.current) return;
    scene.current.setLooks(looks);
    scene.current.setSelection(selection.label, selection.ring, () => {
      const left = store.secondsLeft();
      return left === null || !store.hold ? null : left / store.hold.duration;
    });
  });

  return (
    <div class="scene" role="region" aria-label="Lab scene" ref={region} data-ready={ready ? "true" : "false"}>
      <canvas ref={canvas} class="scene__canvas" aria-hidden="true" />
      {!ready && (
        <div class="preloader" role="progressbar" aria-label="Loading the lab" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span class="preloader__count mono">{String(Math.round(progress)).padStart(3, "0")}</span>
          <span class="preloader__bar" style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
      )}
      <p class="scene__hint">Drag to orbit the lab</p>
    </div>
  );
}

// ---- The lab chapter ----------------------------------------------------------------------------

export function LabStage({ onPay, chapter }: { onPay: (kind: "deposit" | "full" | "group") => void; chapter: { current: HTMLElement | null } }) {
  const s = useStore();
  const narrow = useMedia(NARROW);
  const reduced = useMedia(REDUCED_MOTION);
  const webgl = useMemo(() => !reduced && webglAvailable(), [reduced]);
  return (
    <div class="lab__stage">
      {webgl ? <SceneHost chapter={chapter} /> : null}
      <div class="lab__controls">
        {!reduced && !webgl && <p class="lab__note">The 3D lab needs WebGL. Here is the flat bench plan.</p>}
        <TierSwitch />
        <SoldOut />
        <BillingBanner />
        <BenchMap />
        <Waitlist />
        {!narrow && <HoldPanel onPay={onPay} />}
        <Live label="Bench updates" message={s.message} />
      </div>
    </div>
  );
}
