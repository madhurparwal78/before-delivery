import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { CHAPTERS, FINISHES, HUBS, MODELS, finishName, hubName, modelName, type ChapterId } from "../shared/catalogue.js";
import { parseInstant, timeLabel } from "../shared/clock.js";
import { staleStatus } from "../shared/copy.js";
import { lockBlocked, roomUrl } from "../shared/derive.js";
import { rupees } from "../shared/money.js";
import type { Reading } from "../shared/types.js";
import { pressLock } from "./dialogs.js";
import { Elevation } from "./elevation.js";
import { room } from "./live.js";
import { Link, useRoute } from "./router.js";
import { applyUrl, choose, jumpTo, selectPart, stage, startStage } from "./stage.js";
import { useStore } from "./store.js";
import { Choice, Layer, Pick } from "./ui.js";

// --- hero

function Hero(): JSX.Element {
  const s = useStore(stage, (x) => x);
  const href = roomUrl({ model: s.model, hub: s.hub, finish: s.finish, ch: "frame", part: null, at: 0 });
  return (
    <section class="hero">
      <h1 class="word">
        <span>MAL</span>
        <span>HAR</span>
      </h1>
      <div class="copy">
        <p>A motorcycle priced for your road, on the day you ride it away.</p>
        <Link class="link-action" href={href}>
          Start the build
        </Link>
      </div>
    </section>
  );
}

// --- the stage

function PartsList({ chapter, inSheet }: { chapter: ChapterId; inSheet?: boolean }): JSX.Element {
  const part = useStore(stage, (s) => s.part);
  const paused = useStore(stage, (s) => s.paused);
  const parts = (CHAPTERS.find((c) => c.id === chapter) as (typeof CHAPTERS)[number]).parts;
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [focused, setFocused] = useState(0);
  const roving = part ? parts.findIndex((p) => p.id === part) : Math.min(focused, parts.length - 1);

  const pick = (id: string): void => {
    if (paused) return;
    selectPart(id);
  };
  const move = (to: number): void => {
    const i = (to + parts.length) % parts.length;
    setFocused(i);
    refs.current[i]?.focus();
  };
  return (
    <div class={inSheet ? "parts-list" : "parts"} role="listbox" aria-label="Parts" aria-disabled={paused ? "true" : undefined}>
      {parts.map((p, i) => (
        <div
          key={p.id}
          role="option"
          tabIndex={roving === i ? 0 : -1}
          aria-selected={part === p.id ? "true" : "false"}
          ref={(el: HTMLDivElement | null) => {
            refs.current[i] = el;
          }}
          onFocus={() => setFocused(i)}
          onClick={() => pick(p.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(i + 1 >= parts.length ? parts.length - 1 : i + 1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(i - 1 < 0 ? 0 : i - 1);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick(p.id);
            }
          }}
        >
          {p.name}
        </div>
      ))}
    </div>
  );
}

function Toolbar(): JSX.Element {
  const ch = useStore(stage, (s) => s.ch);
  const paused = useStore(stage, (s) => s.paused);
  const [focus, setFocus] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = CHAPTERS.findIndex((c) => c.id === ch);
  const roving = focus >= 0 ? focus : current;
  const go = (i: number): void => {
    const n = (i + CHAPTERS.length) % CHAPTERS.length;
    setFocus(n);
    refs.current[n]?.focus();
  };
  const activate = (i: number): void => {
    if (paused) return;
    jumpTo((CHAPTERS[i] as (typeof CHAPTERS)[number]).id);
    const button = refs.current[i];
    const el = bar.current;
    if (button && el) el.scrollTo({ left: button.offsetLeft - (el.clientWidth - button.offsetWidth) / 2 });
  };
  useEffect(() => setFocus(current), [current]);
  return (
    <div class="toolbar" role="toolbar" aria-label="Chapters" aria-disabled={paused ? "true" : undefined} ref={bar}>
      {CHAPTERS.map((c, i) => (
        <button
          key={c.id}
          type="button"
          tabIndex={roving === i ? 0 : -1}
          aria-pressed={c.id === ch ? "true" : "false"}
          ref={(el) => {
            refs.current[i] = el;
          }}
          onFocus={() => setFocus(i)}
          onClick={() => activate(i)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              go(i + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              go(i - 1);
            } else if (e.key === "Home") {
              e.preventDefault();
              go(0);
            } else if (e.key === "End") {
              e.preventDefault();
              go(CHAPTERS.length - 1);
            }
          }}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function StageView({ reading }: { reading: Reading | null }): JSX.Element {
  const s = useStore(stage, (x) => x);
  const canvas = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null);
  const statement = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState(false);
  const chapter = CHAPTERS.find((c) => c.id === s.ch) as (typeof CHAPTERS)[number];
  const part = chapter.parts.find((p) => p.id === s.part);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startStage({ canvas: canvas.current as HTMLCanvasElement, label: label.current, cover: cover.current, statement: statement.current }).then((fn) => {
      if (cancelled) fn();
      else stop = fn;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <section class="stage" id="stage" aria-label="The build">
      <div class="pin">
        <canvas ref={canvas} class="scene" role="img" aria-label={`Malhar ${modelName(s.model)} showroom`} />
        <div class="elevations">
          {CHAPTERS.map((c) => (
            <Elevation key={c.id} chapter={c.id} model={s.model} finish={s.finish} reading={reading} current={c.id === s.ch} />
          ))}
        </div>
        <div class="dissolve-cover" ref={cover} />
        <div class="part-label" ref={label} style="visibility:hidden">
          <strong>{part?.name}</strong>
          <span>{part?.sentence}</span>
        </div>
        <div class="statement" ref={statement}>
          <h2>{chapter.statement}</h2>
        </div>
        <div class="stage-controls">
          <Choice label="Model" value={s.model} options={MODELS} onChange={(model) => choose({ model })} />
          <Pick label="Hub city" value={s.hub} options={HUBS} onChange={(hub) => choose({ hub })} />
          <Choice label="Finish" value={s.finish} options={FINISHES} onChange={(finish) => choose({ finish })} />
        </div>
        <PartsList chapter={s.ch} />
        <button class="btn parts-button" type="button" onClick={() => setSheet(true)}>
          Parts
        </button>
        <Layer open={sheet} sheet label="Parts" onClose={() => setSheet(false)}>
          <PartsList chapter={s.ch} inSheet />
        </Layer>
        <Toolbar />
      </div>
    </section>
  );
}

// --- price

function PriceSection(): JSX.Element {
  const reading = useStore(room, (s) => s.drawn);
  const failed = useStore(room, (s) => s.failed);
  const lastGood = useStore(room, (s) => s.lastGoodAt);
  const blocked = lockBlocked(reading, failed);
  const q = reading?.quote;
  const asOf = failed && lastGood ? `As of ${timeLabel(parseInstant(lastGood) as number)}` : null;
  const units = reading?.unitsLeft ?? 0;
  return (
    <section class="price" id="price">
      {reading?.stale ? <p class="outage">{staleStatus(reading)}</p> : null}
      <h2 class="price-lede">On the road, on the day.</h2>
      <div class="inner">
        <div role="region" aria-label="On-road price" class="numerals">
          {reading && q ? (
            <>
              <div class="numeral">
                <div class="figure">{rupees(q.exShowroomPaise)}</div>
                <p>Ex-showroom: the factory price with {q.gstPercent}% GST.</p>
              </div>
              <div class="numeral">
                <div class="figure">
                  {rupees(q.onRoadPaise)}
                  {asOf ? <small>{asOf}</small> : null}
                </div>
                <p>
                  On the road in {hubName(reading.hub)}: ex-showroom, {q.roadTaxPercent}% road tax and insurance.
                </p>
              </div>
              <p class="stock">
                <span>
                  {units === 1 ? "1 unit" : `${units} units`} left in {finishName(reading.finish)} at {hubName(reading.hub)}.
                </span>
                {reading.stale ? <small>Stock as of {reading.stockAsOfLabel}</small> : null}
              </p>
            </>
          ) : (
            <p class="stock">Reading price…</p>
          )}
        </div>
        <div>
          <button class="btn primary" type="button" aria-disabled={blocked ? "true" : undefined} onClick={() => !blocked && void pressLock()}>
            Lock this price
          </button>
        </div>
      </div>
    </section>
  );
}

// --- the page

export function Showroom({ initial }: { initial: Reading | null }): JSX.Element {
  const reading = useStore(room, (s) => s.drawn) ?? initial;
  const { path, search } = useRoute();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    applyUrl(search, path);
  }, [search, path]);
  return (
    <div class="page long">
      <Hero />
      <StageView reading={reading} />
      <PriceSection />
      <section class="invite">
        <h2 class="lede">Hear it before you decide.</h2>
        <Link class="link-action" href="/test-ride">
          Book a test ride
        </Link>
      </section>
      <footer class="footer" aria-label="Footer">
        <div class="word" aria-hidden="true">
          MALHAR
        </div>
      </footer>
    </div>
  );
}
