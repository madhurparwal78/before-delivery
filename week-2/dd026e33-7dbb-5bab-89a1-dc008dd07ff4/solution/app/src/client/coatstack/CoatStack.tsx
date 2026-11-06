// The coat stack (brief: Job page; Interactions › Panel map, Stage scrubber, Address state; Motion ›
// the coat stack step). The server derives every value; this component only draws them. A step wipes
// the panel fills front to rear, rebuilds the selected panel's cross-section from ~200 ms and counts
// the total film build; with reduced motion every change lands at once.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CoatStack as CoatStackData, CoatStackPanel } from "../../shared/api.js";
import { BAND_LABEL, BAND_LIMIT_UM, PANELS, PANEL_NAME, type Band, type PanelId } from "../../shared/domain.js";
import { filmValue, formatFilm, type FilmUnit } from "../../shared/units.js";
import { prefersReducedMotion } from "../hooks.js";
import { replaceQuery } from "../router.js";
import { StatusRegion, useNote } from "../ui/Feedback.js";
import { BODY, PANEL_SHAPES, PLAN_HEIGHT, PLAN_WIDTH, type PanelShape } from "./geometry.js";
import { CrossSection } from "./CrossSection.js";
import { EASE_OUT_LONG, type Transition } from "./motion.js";

const WIPE_MS = 500;
const STAGGER_MS = 30;
const PHASE_TWO_MS = 200;
const COUNT_MS = 700;

const BAND_CODE: Record<Band, string> = { thin: "THN", factory: "FAC", refinished: "REF", filler_suspected: "FIL" };
const BANDS: readonly Band[] = ["thin", "factory", "refinished", "filler_suspected"];

/** Short stage names for the scrubber ticks; the full name shows above the slider. */
const TICK_NAME: Record<string, string> = {
  Intake: "Intake",
  Stripped: "Stripped",
  "Epoxy primer": "Epoxy",
  "Guide coat": "Guide",
  "2K primer": "2K primer",
  Base: "Base",
  Clear: "Clear",
  "Cut and polish": "Polish",
};

function bandRange(band: Band, unit: FilmUnit): string {
  const { thinBelow, factoryUpTo, refinishedUpTo } = BAND_LIMIT_UM;
  if (band === "thin") return `below ${formatFilm(thinBelow, unit)}`;
  if (band === "factory") return `${filmValue(thinBelow, unit)}–${formatFilm(factoryUpTo, unit)}`;
  if (band === "refinished") return `${filmValue(factoryUpTo + 1, unit)}–${formatFilm(refinishedUpTo, unit)}`;
  return `above ${formatFilm(refinishedUpTo, unit)}`;
}

interface Selection {
  stage: number | null;
  panel: PanelId;
}

function isPanel(value: string | null): value is PanelId {
  return PANELS.some((panel) => panel.id === value);
}

/** The address's stage and panel, falling back to the latest logged stage and the bonnet. */
function selectionFromAddress(stageCount: number): Selection {
  const params = new URLSearchParams(window.location.search);
  const stage = params.get("stage");
  const panel = params.get("panel");
  const index = stage !== null && /^\d+$/.test(stage) && Number(stage) < stageCount ? Number(stage) : stageCount - 1;
  return { stage: stageCount === 0 ? null : index, panel: isPanel(panel) ? panel : "bonnet" };
}

function reading(data: CoatStackData, stage: number | null, panel: PanelId): CoatStackPanel | null {
  if (stage === null) return null;
  return data.stages[stage]?.panels.find((entry) => entry.panel === panel) ?? null;
}

function readingText(entry: CoatStackPanel | null, unit: FilmUnit): string {
  return entry?.film_um === null || !entry ? "No reading" : formatFilm(entry.film_um, unit);
}

function panelLabel(panel: PanelId, entry: CoatStackPanel | null, unit: FilmUnit): string {
  if (!entry || entry.film_um === null || !entry.band) return `${PANEL_NAME[panel]}, No reading`;
  return `${PANEL_NAME[panel]}, ${formatFilm(entry.film_um, unit)}, ${BAND_LABEL[entry.band]}`;
}

function announcement(data: CoatStackData, stage: number, panel: PanelId, unit: FilmUnit): string {
  const entry = reading(data, stage, panel);
  const head = `${data.stages[stage]?.name ?? ""}, stage ${stage + 1} of ${data.stages.length}.`;
  if (!entry || entry.film_um === null || !entry.band) return `${head} ${PANEL_NAME[panel]}: no reading.`;
  return `${head} ${PANEL_NAME[panel]}: ${formatFilm(entry.film_um, unit)}, ${BAND_LABEL[entry.band]}.`;
}

export function CoatStackPanes({
  data,
  unit,
  onOpenHistory,
  latestOnChange,
}: {
  data: CoatStackData;
  unit: FilmUnit;
  onOpenHistory: (panel: PanelId) => void;
  /** Bumped when this screen logged a stage: the scrubber moves to the latest stage. */
  latestOnChange: number;
}): JSX.Element {
  const stageCount = data.stages.length;
  const [selection, setSelection] = useState<Selection>(() => selectionFromAddress(stageCount));
  const [transition, setTransition] = useState<Transition | null>(null);
  const [numeral, setNumeral] = useState<number | null>(null);
  const [hover, setHover] = useState<PanelId | null>(null);
  const [announcer, announce] = useNote();
  const nextLayers = useRef(new Map<PanelId, HTMLDivElement>());
  const panelButtons = useRef(new Map<PanelId, HTMLButtonElement>());
  const running = useRef<Animation[]>([]);
  const frame = useRef<number | null>(null);
  const sequence = useRef(0);
  const sliderTrack = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const stage = selection.stage !== null && selection.stage < stageCount ? selection.stage : stageCount === 0 ? null : stageCount - 1;
  const panel = selection.panel;

  useEffect(() => {
    if (latestOnChange > 0 && stageCount > 0) setSelection((current) => ({ ...current, stage: stageCount - 1 }));
  }, [latestOnChange, stageCount]);

  const writeAddress = (next: Selection): void => {
    replaceQuery(next.stage === null ? `panel=${next.panel}` : `stage=${next.stage}&panel=${next.panel}`);
  };

  /** Snaps any step still playing to its end state. */
  const settle = (): void => {
    for (const animation of running.current) animation.finish();
    running.current = [];
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setNumeral(null);
  };

  const goTo = (target: number): void => {
    if (stage === null || target === stage || target < 0 || target >= stageCount) return;
    settle();
    const next = { stage: target, panel };
    setSelection(next);
    writeAddress(next);
    announce(announcement(data, target, panel, unit));
    setTransition(prefersReducedMotion() ? null : { id: ++sequence.current, from: stage, to: target });
  };

  const choosePanel = (next: PanelId): void => {
    if (next === panel) return;
    settle();
    const chosen = { stage, panel: next };
    setSelection(chosen);
    writeAddress(chosen);
    if (stage !== null) announce(announcement(data, stage, next, unit));
  };

  // Phase one (panel wipe) and phase three (numeral count) start together with each step.
  useLayoutEffect(() => {
    if (!transition) return;
    const animations: Animation[] = [];
    PANELS.forEach((entry, order) => {
      const layer = nextLayers.current.get(entry.id);
      if (!layer) return;
      animations.push(
        layer.animate([{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)" }], {
          duration: WIPE_MS,
          delay: order * STAGGER_MS,
          easing: EASE_OUT_LONG,
          fill: "backwards",
        }),
      );
    });
    running.current.push(...animations);
    const from = reading(data, transition.from, panel)?.film_um ?? null;
    const to = reading(data, transition.to, panel)?.film_um ?? null;
    if (from !== null && to !== null && from !== to) {
      const start = performance.now();
      const tick = (): void => {
        const elapsed = performance.now() - start - PHASE_TWO_MS;
        const progress = Math.min(1, Math.max(0, elapsed / COUNT_MS));
        const eased = 1 - (1 - progress) ** 3;
        setNumeral(progress >= 1 ? null : from + Math.trunc((to - from) * eased));
        frame.current = progress >= 1 ? null : requestAnimationFrame(tick);
      };
      setNumeral(from);
      frame.current = requestAnimationFrame(tick);
    }
    // Only a new step starts motion; data and panel are read as they were at that step.
  }, [transition?.id]);

  useEffect(() => () => settle(), []);

  const onPanelKey = (event: KeyboardEvent<HTMLButtonElement>, id: PanelId): void => {
    const index = PANELS.findIndex((entry) => entry.id === id);
    let target: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = Math.min(PANELS.length - 1, index + 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = Math.max(0, index - 1);
    if (target !== null) {
      event.preventDefault();
      const next = PANELS[target]?.id;
      if (next) {
        choosePanel(next);
        panelButtons.current.get(next)?.focus();
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenHistory(id);
    }
  };

  const onSliderKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (stage === null) return;
    const moves: Record<string, number> = {
      ArrowRight: stage + 1,
      ArrowUp: stage + 1,
      ArrowLeft: stage - 1,
      ArrowDown: stage - 1,
      Home: 0,
      End: stageCount - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    goTo(target);
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const track = sliderTrack.current?.getBoundingClientRect();
    if (!track || stageCount < 2) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - track.left) / track.width));
    goTo(Math.round(fraction * (stageCount - 1)));
  };

  const shownStage = stage === null ? null : data.stages[stage];
  const selected = reading(data, stage, panel);
  const fromStage = transition && transition.to === stage ? transition.from : stage;
  const caption = hover ?? null;

  return (
    <>
      <section className="pane" aria-labelledby="car-plan-heading">
        <div className="pane-heading pane-heading-row">
          <h2 id="car-plan-heading">Car plan</h2>
          <p className="plan-caption" aria-hidden="true">
            {caption ? `${PANEL_NAME[caption]} · ${readingText(reading(data, stage, caption), unit)}${reading(data, stage, caption)?.band ? ` · ${BAND_LABEL[reading(data, stage, caption)?.band ?? "thin"]}` : ""}` : ""}
          </p>
        </div>
        <svg className="pattern-defs" width="0" height="0" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="hatch-thin" width="6" height="6" patternUnits="userSpaceOnUse">
              <circle cx="3" cy="3" r="1.1" className="hatch-ink-fill" />
            </pattern>
            <pattern id="hatch-factory" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 3H6" className="hatch-ink" />
            </pattern>
            <pattern id="hatch-refinished" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 3.5H7" className="hatch-ink" />
            </pattern>
            <pattern id="hatch-filler_suspected" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 3.5H7M3.5 0V7" className="hatch-ink" />
            </pattern>
            <pattern id="hatch-steel" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <path d="M0 2.5H5" className="hatch-ink" />
            </pattern>
          </defs>
        </svg>
        <div className="plan-instrument">
        <div className="car-plan" style={{ aspectRatio: `${PLAN_WIDTH} / ${PLAN_HEIGHT}` }}>
          <svg className="car-body" viewBox={`0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`} aria-hidden="true" focusable="false">
            <path d={BODY.silhouette} className="body-silhouette" />
            <path d={BODY.centreline} className="body-centreline" />
            {BODY.tyres.map((tyre) => (
              <path key={tyre} d={tyre} className="body-tyre" />
            ))}
            <path d={BODY.windscreen} className="body-glass" />
            <path d={BODY.rearScreen} className="body-glass" />
            <path d={BODY.bumper} className="body-line" />
          </svg>
          <div role="group" aria-label="Panel map" className="panel-map">
            {PANEL_SHAPES.map((shape) => {
              const entry = reading(data, stage, shape.id);
              const before = reading(data, fromStage, shape.id);
              return (
                <button
                  key={shape.id}
                  ref={(element) => {
                    if (element) panelButtons.current.set(shape.id, element);
                    else panelButtons.current.delete(shape.id);
                  }}
                  type="button"
                  className="panel"
                  style={{
                    left: `${(shape.x / PLAN_WIDTH) * 100}%`,
                    top: `${(shape.y / PLAN_HEIGHT) * 100}%`,
                    width: `${(shape.w / PLAN_WIDTH) * 100}%`,
                    height: `${(shape.h / PLAN_HEIGHT) * 100}%`,
                  }}
                  aria-label={panelLabel(shape.id, entry, unit)}
                  aria-pressed={shape.id === panel}
                  tabIndex={shape.id === panel ? 0 : -1}
                  onClick={() => choosePanel(shape.id)}
                  onKeyDown={(event) => onPanelKey(event, shape.id)}
                  onKeyUp={(event) => {
                    if (event.key === " ") event.preventDefault();
                  }}
                  onPointerEnter={() => setHover(shape.id)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(shape.id)}
                  onBlur={() => setHover(null)}
                >
                  <PanelLayer shape={shape} entry={before} unit={unit} />
                  <PanelLayer
                    shape={shape}
                    entry={entry}
                    unit={unit}
                    layerRef={(element) => {
                      if (element) nextLayers.current.set(shape.id, element);
                      else nextLayers.current.delete(shape.id);
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div className="scrubber">
          <p className="scrubber-stage">
            <span id="stage-slider-label" className="scrubber-label">
              Stage
            </span>
            {shownStage && stage !== null ? (
              <span>
                <span className="display-label">{shownStage.name}</span>
                <span className="mono-text">{` ${stage + 1} / ${stageCount}`}</span>
              </span>
            ) : (
              <span>No stage logged yet</span>
            )}
          </p>
          <div
            role="slider"
            aria-labelledby="stage-slider-label"
            aria-valuemin={stageCount === 0 ? 0 : 1}
            aria-valuemax={stageCount}
            aria-valuenow={stage === null ? 0 : stage + 1}
            aria-valuetext={shownStage && stage !== null ? `${shownStage.name}, stage ${stage + 1} of ${stageCount}` : "No stage logged"}
            aria-disabled={stage === null ? true : undefined}
            tabIndex={stage === null ? -1 : 0}
            className={stage === null ? "slider slider-disabled" : stageCount > 5 ? "slider slider-labeled slider-two-rows" : "slider slider-labeled"}
            onKeyDown={onSliderKey}
            onPointerDown={(event) => {
              if (stage === null) return;
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              fromPointer(event);
            }}
            onPointerMove={(event) => {
              if (dragging.current) fromPointer(event);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
          >
            <div ref={sliderTrack} className="slider-track">
              {data.stages.map((entry) => {
                const left = `${stageCount < 2 ? 50 : (entry.index / (stageCount - 1)) * 100}%`;
                const edge = stageCount < 2 ? "" : entry.index === 0 ? " tick-name-first" : entry.index === stageCount - 1 ? " tick-name-last" : "";
                const row = stageCount > 5 && entry.index % 2 === 1 ? " tick-name-lower" : "";
                return (
                  <span key={entry.index} aria-hidden="true">
                    <span className={entry.index === stage ? "tick tick-current" : "tick"} style={{ left }} />
                    <span className={`tick-name${edge}${row}${entry.index === stage ? " tick-name-current" : ""}`} style={{ left }}>
                      {TICK_NAME[entry.name] ?? entry.name}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="pane-actions">
          <button type="button" className="button" onClick={() => onOpenHistory(panel)}>
            Reading history
          </button>
        </div>
        </div>
        <ul className="band-key" aria-label="Reading bands">
          {BANDS.map((band) => (
            <li key={band}>
              <svg viewBox="0 0 28 20" aria-hidden="true" focusable="false" className={`band-${band}`}>
                <rect x="0.5" y="0.5" width="27" height="19" className="panel-tint" />
                <rect x="0.5" y="0.5" width="27" height="19" fill={`url(#hatch-${band})`} className="band-key-swatch" />
              </svg>
              <span>
                {BAND_LABEL[band]} <span className="band-key-code mono-text">{BAND_CODE[band]}</span>
              </span>
              <span className="mono-text">{bandRange(band, unit)}</span>
            </li>
          ))}
        </ul>
        <StatusRegion name="Stage announcer" note={announcer} className="visually-quiet" />
      </section>

      <section className="pane" aria-labelledby="cross-section-heading">
        <h2 id="cross-section-heading" className="pane-heading">
          Cross-section
        </h2>
        <p className="cross-title">
          <span className="display-label">{PANEL_NAME[panel]}</span>
          {shownStage ? <span className="sub">{` at ${shownStage.name}`}</span> : null}
        </p>
        <CrossSection data={data} panel={panel} stage={stage} transition={transition} running={running} unit={unit} />
        <div className="numeral-block">
          <span className="numeral-label display-label" aria-hidden="true">
            Total film build
          </span>
          <span
            className={numeral === null && selected?.film_um == null ? "numeral numeral-empty" : "numeral mono-text"}
            role="group"
            aria-label="Total film build"
          >
            {numeral !== null ? formatFilm(numeral, unit) : readingText(selected, unit)}
          </span>
          {selected?.band ? <span className={`band-chip band-${selected.band}`}>{BAND_LABEL[selected.band]}</span> : null}
        </div>
        <table aria-label="Panel readings" className="table readings-table">
          <thead>
            <tr>
              <th scope="col">Panel</th>
              <th scope="col" className="numeric">
                Reading
              </th>
              <th scope="col">Band</th>
            </tr>
          </thead>
          <tbody>
            {PANELS.map((entry) => {
              const value = reading(data, stage, entry.id);
              return (
                <tr key={entry.id} className={entry.id === panel ? "row-selected" : undefined}>
                  <td>{entry.name}</td>
                  {value?.film_um === null || !value ? <td className="numeric reading-empty">No reading</td> : <td className="numeric mono-text">{formatFilm(value.film_um, unit)}</td>}
                  <td>{value?.band ? <span className={`band-chip band-${value.band}`}>{BAND_LABEL[value.band]}</span> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function PanelLayer({
  shape,
  entry,
  unit,
  layerRef,
}: {
  shape: PanelShape;
  entry: CoatStackPanel | null;
  unit: FilmUnit;
  layerRef?: (element: HTMLDivElement | null) => void;
}): JSX.Element {
  const band = entry?.band ?? null;
  return (
    <div ref={layerRef} className={`panel-layer ${band ? `band-${band}` : "band-none"}`} aria-hidden="true">
      <svg viewBox={`${shape.x} ${shape.y} ${shape.w} ${shape.h}`} preserveAspectRatio="none" focusable="false">
        <path d={shape.d} className="panel-tint" />
        {band ? <path d={shape.d} fill={`url(#hatch-${band})`} /> : null}
        <path d={shape.d} className={band ? "panel-outline" : "panel-outline panel-outline-empty"} />
        {shape.detail ? <path d={shape.detail} className="panel-detail" /> : null}
      </svg>
      {band && entry?.film_um !== null && entry ? (
        <span className="panel-label">
          <span
            className="panel-plate"
            style={{ left: `${((shape.label.x - shape.x) / shape.w) * 100}%`, top: `${((shape.label.y - shape.y) / shape.h) * 100}%` }}
          >
            {/* Drawn by CSS: the plate is decoration inside a button whose name already carries the reading. */}
            <span className="panel-plate-text" data-text={filmValue(entry.film_um, unit)} />
            <span className="panel-plate-text" data-text={BAND_CODE[band]} />
          </span>
        </span>
      ) : null}
    </div>
  );
}
