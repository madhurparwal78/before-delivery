import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BAND_LABEL, type Band, type CoatStack as CoatStackData } from '../../shared/coatstack';
import { PANELS, type PanelId } from '../../shared/panels';
import { FILM_UNIT_LABEL, filmReading, filmValue, type FilmUnit } from '../../shared/units';

interface PanelBox {
  readonly id: PanelId;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The car plan is drawn from shapes in code: front at the top, 12 outlined panels. */
const PANEL_BOXES: readonly PanelBox[] = [
  { id: 'front_valance', left: 10, top: 0, width: 80, height: 9 },
  { id: 'bonnet', left: 15, top: 10, width: 70, height: 20 },
  { id: 'front_wing_l', left: 0, top: 10, width: 14, height: 20 },
  { id: 'front_wing_r', left: 86, top: 10, width: 14, height: 20 },
  { id: 'door_l', left: 15, top: 31, width: 16, height: 31 },
  { id: 'door_r', left: 69, top: 31, width: 16, height: 31 },
  { id: 'sill_l', left: 0, top: 31, width: 14, height: 31 },
  { id: 'sill_r', left: 86, top: 31, width: 14, height: 31 },
  { id: 'roof', left: 32, top: 31, width: 36, height: 31 },
  { id: 'rear_quarter_l', left: 0, top: 63, width: 30, height: 25 },
  { id: 'rear_quarter_r', left: 70, top: 63, width: 30, height: 25 },
  { id: 'boot_lid', left: 10, top: 89, width: 80, height: 11 },
];

const WIPE_STAGGER_MS = 30;
const WIPE_MS = 500;
const LAYER_DELAY_MS = 200;
const LAYER_STEP_MS = 200;
const COUNT_MS = 700;

export interface CoatStackProps {
  readonly data: CoatStackData;
  readonly stageIndex: number;
  readonly panelId: PanelId;
  readonly unit: FilmUnit;
  readonly reducedMotion: boolean;
  readonly readOnly: boolean;
  onSelectPanel(panel: PanelId): void;
  onSelectStage(index: number): void;
  onOpenHistory(): void;
}

interface PanelState {
  readonly film: number | null;
  readonly band: Band | null;
}

function panelsAt(data: CoatStackData, stageIndex: number): Map<PanelId, PanelState> {
  const slice = data.stages[stageIndex];
  const map = new Map<PanelId, PanelState>();
  for (const panel of PANELS) {
    const entry = slice?.panels.find((candidate) => candidate.panel === panel.id);
    map.set(panel.id, { film: entry?.film_um ?? null, band: entry?.band ?? null });
  }
  return map;
}

export function PanelMap({
  data,
  stageIndex,
  panelId,
  unit,
  reducedMotion,
  onSelectPanel,
  onOpenHistory,
}: Omit<CoatStackProps, 'onSelectStage' | 'readOnly'>): ReactNode {
  const current = panelsAt(data, stageIndex);
  const [shown, setShown] = useState(() => stageIndex);
  const timer = useRef<number | undefined>(undefined);
  const groupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (stageIndex === shown) return;
    if (reducedMotion) {
      setShown(stageIndex);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setShown(stageIndex),
      WIPE_MS + PANELS.length * WIPE_STAGGER_MS,
    );
    return () => window.clearTimeout(timer.current);
  }, [stageIndex, shown, reducedMotion]);

  const previous = panelsAt(data, shown);
  const wiping = shown !== stageIndex && !reducedMotion;

  const move = (step: number): void => {
    const index = PANELS.findIndex((panel) => panel.id === panelId);
    const next = PANELS[index + step];
    if (next === undefined) return;
    onSelectPanel(next.id);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-panel="${next.id}"]`)?.focus();
  };

  return (
    <div className="car-plan">
      <svg className="car-outline" viewBox="0 0 100 200" aria-hidden="true" focusable="false">
        <path
          d="M14 6 Q50 -2 86 6 L96 26 L96 176 L86 196 Q50 202 14 196 L4 176 L4 26 Z"
          className="car-outline-path"
        />
        <path d="M30 60 Q50 56 70 60 L70 64 Q50 60 30 64 Z" className="car-glass" />
        <path d="M30 128 Q50 124 70 128 L70 132 Q50 128 30 132 Z" className="car-glass" />
      </svg>
      <div className="panel-map" role="group" aria-label="Panel map" ref={groupRef}>
        {PANEL_BOXES.map((box) => {
          const panel = PANELS.find((entry) => entry.id === box.id);
          const now = current.get(box.id) ?? { film: null, band: null };
          const before = previous.get(box.id) ?? { film: null, band: null };
          const order = (panel?.order ?? 1) - 1;
          const name = panel?.name ?? box.id;
          const label =
            now.film === null || now.band === null
              ? `${name}, No reading`
              : `${name}, ${filmReading(now.film, unit)}, ${BAND_LABEL[now.band]}`;
          return (
            <button
              type="button"
              key={box.id}
              data-panel={box.id}
              className={`panel band-${before.band ?? 'none'}${panelId === box.id ? ' panel-selected' : ''}`}
              aria-label={label}
              aria-pressed={panelId === box.id}
              tabIndex={panelId === box.id ? 0 : -1}
              style={{
                left: `${box.left}%`,
                top: `${box.top}%`,
                width: `${box.width}%`,
                height: `${box.height}%`,
              }}
              onClick={() => onSelectPanel(box.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(1);
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenHistory();
                }
              }}
            >
              <span
                className={`panel-wipe band-${now.band ?? 'none'}${wiping ? ' panel-wipe-run' : ''}`}
                style={{ transitionDelay: `${order * WIPE_STAGGER_MS}ms` }}
                aria-hidden="true"
              />
              <span className="panel-name" aria-hidden="true">
                {name}
              </span>
            </button>
          );
        })}
      </div>
      <svg className="car-silhouette" viewBox="0 0 100 200" aria-hidden="true" focusable="false">
        <path d="M18 0 Q50 -2 82 0 L100 14 L100 186 L82 200 Q50 202 18 200 L0 186 L0 14 Z" />
        <path d="M30 60 Q50 55 70 60" />
        <path d="M30 130 Q50 135 70 130" />
      </svg>
    </div>
  );
}

export function StageScrubber({
  data,
  stageIndex,
  onSelectStage,
}: {
  data: CoatStackData;
  stageIndex: number;
  onSelectStage(index: number): void;
}): ReactNode {
  const count = data.stages.length;
  const stage = data.stages[stageIndex];
  const valueText =
    stage === undefined
      ? 'No stage logged'
      : `${stage.name}, stage ${stageIndex + 1} of ${count}`;
  return (
    <div className="scrubber">
      <input
        type="range"
        aria-label="Stage"
        aria-valuetext={valueText}
        min={0}
        max={Math.max(0, count - 1)}
        step={1}
        value={stageIndex}
        disabled={count === 0}
        onChange={(event) => onSelectStage(Number(event.target.value))}
      />
      <div className="scrubber-ticks" aria-hidden="true">
        {data.stages.map((entry, index) => (
          <button
            type="button"
            key={entry.name}
            tabIndex={-1}
            className={index === stageIndex ? 'tick tick-current' : 'tick'}
            onClick={() => onSelectStage(index)}
          >
            {entry.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CrossSection({
  data,
  stageIndex,
  panelId,
  unit,
  reducedMotion,
}: {
  data: CoatStackData;
  stageIndex: number;
  panelId: PanelId;
  unit: FilmUnit;
  reducedMotion: boolean;
}): ReactNode {
  const slice = data.stages[stageIndex];
  const panel = slice?.panels.find((entry) => entry.panel === panelId);
  const layers = panel?.layers ?? [];
  const total = panel?.film_um ?? null;
  const shownTotal = useCountTo(total ?? 0, reducedMotion);
  const maximum = Math.max(200, ...layers.map((layer) => layer.um));

  return (
    <div className="cross-section">
      <div className="cross-section-stack" key={`${panelId}-${stageIndex}`}>
        {[...layers].reverse().map((layer, index) => (
          <div
            className={reducedMotion ? 'coat-layer' : 'coat-layer coat-layer-grow'}
            key={`${layer.stage}-${String(index)}`}
            style={{
              height: `${Math.max(8, (layer.um / maximum) * 100)}%`,
              animationDelay: reducedMotion
                ? undefined
                : `${LAYER_DELAY_MS + (layers.length - 1 - index) * LAYER_STEP_MS}ms`,
            }}
          >
            <span className="coat-layer-name">{layer.stage}</span>
            <span className="coat-layer-value mono">{filmReading(layer.um, unit)}</span>
          </div>
        ))}
        {layers.length === 0 ? <p className="coat-empty">No coat stack yet.</p> : null}
      </div>
      <p className="total-film">
        <span className="total-film-label">Total film build</span>
        <span className="total-film-value mono">
          {total === null ? '—' : `${filmValue(shownTotal, unit)} ${FILM_UNIT_LABEL[unit]}`}
        </span>
      </p>
    </div>
  );
}

/** Counts the numeral to the server value, in monospaced digits. */
function useCountTo(target: number, reducedMotion: boolean): number {
  const [value, setValue] = useState(target);
  const frame = useRef<number | undefined>(undefined);
  const from = useRef(target);

  useEffect(() => {
    if (reducedMotion) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / COUNT_MS);
      const next = Math.round(origin + (target - origin) * progress);
      setValue(next);
      if (progress < 1) frame.current = window.requestAnimationFrame(step);
      else from.current = target;
    };
    frame.current = window.requestAnimationFrame(step);
    return () => {
      if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
      from.current = target;
    };
  }, [target, reducedMotion]);

  return value;
}

export function PanelReadingsTable({
  data,
  stageIndex,
  unit,
}: {
  data: CoatStackData;
  stageIndex: number;
  unit: FilmUnit;
}): ReactNode {
  const slice = data.stages[stageIndex];
  return (
    <table className="readings-table">
      <caption className="visually-hidden">Panel readings</caption>
      <thead>
        <tr>
          <th scope="col">Panel</th>
          <th scope="col">Reading</th>
          <th scope="col">Band</th>
        </tr>
      </thead>
      <tbody>
        {PANELS.map((panel) => {
          const entry = slice?.panels.find((candidate) => candidate.panel === panel.id);
          return (
            <tr key={panel.id}>
              <th scope="row">{panel.name}</th>
              <td className="mono">
                {entry?.film_um === null || entry?.film_um === undefined
                  ? 'No reading'
                  : filmReading(entry.film_um, unit)}
              </td>
              <td>
                <span className={`band-chip band-${entry?.band ?? 'none'}`}>
                  {entry?.band === null || entry?.band === undefined
                    ? '—'
                    : BAND_LABEL[entry.band]}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
