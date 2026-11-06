// The selected panel's cross-section: a steel substrate with the server's layers stacked bottom-up,
// each as thick as its micrometres. Stepping forward grows new layers from the bottom one at a time;
// stepping back removes them from the top down (brief: Motion › the coat stack step, phase two).
// Every panel and stage of a job is drawn on one µm scale, so a filler-thick panel stands taller
// than a factory one and the stack visibly grows or thins between stages.
import { useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { CoatStack } from "../../shared/api.js";
import type { PanelId } from "../../shared/domain.js";
import { filmValue, formatFilm, type FilmUnit } from "../../shared/units.js";
import { EASE_OUT_LONG, type Transition } from "./motion.js";

const TOP_Y = 18;
const BASE_Y = 226;
const STACK_PX = BASE_Y - TOP_Y;
const AXIS_X = 40;
const STACK_X = 46;
const STACK_W = 140;
const LABEL_X = 204;
const LABEL_END = 356;
const LABEL_GAP = 15;
const START_MS = 200;

type Layer = { stage: string; um: number };

function layersAt(data: CoatStack, stage: number | null, panel: PanelId): Layer[] {
  if (stage === null) return [];
  return data.stages[stage]?.panels.find((entry) => entry.panel === panel)?.layers ?? [];
}

function stageClass(stage: string): string {
  return `layer-${stage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function sameLayer(a: Layer | undefined, b: Layer | undefined): boolean {
  return a !== undefined && b !== undefined && a.stage === b.stage && a.um === b.um;
}

export function CrossSection({
  data,
  panel,
  stage,
  transition,
  running,
  unit,
}: {
  data: CoatStack;
  panel: PanelId;
  stage: number | null;
  transition: Transition | null;
  running: MutableRefObject<Animation[]>;
  unit: FilmUnit;
}): JSX.Element {
  const target = layersAt(data, stage, panel);
  const stepping = transition !== null && transition.to === stage;
  const previous = stepping ? layersAt(data, transition.from, panel) : target;
  let common = 0;
  while (common < Math.min(target.length, previous.length) && sameLayer(target[common], previous[common])) common++;
  const forward = stepping && transition.to > transition.from;
  const thickest = Math.max(
    100,
    ...data.stages.flatMap((entry) => entry.panels.map((reading) => reading.layers.reduce((sum, layer) => sum + layer.um, 0))),
  );
  const top = Math.ceil(thickest / 50) * 50;
  const scale = STACK_PX / top;
  const [cleared, setCleared] = useState(0);
  const growing = useRef(new Map<number, SVGRectElement>());
  const leaving = useRef(new Map<number, SVGRectElement>());

  const place = (layers: Layer[]): { layer: Layer; y: number; h: number }[] => {
    let edge = BASE_Y;
    return layers.map((layer) => {
      const h = Math.max(1.5, layer.um * scale);
      edge -= h;
      return { layer, y: edge, h };
    });
  };
  const shown = place(target);
  // Labels top-down at their layer's midpoint, pushed apart where thin layers sit close together.
  const labels = [...shown].reverse().map((entry) => ({ ...entry, mid: entry.y + entry.h / 2, at: entry.y + entry.h / 2 }));
  labels.forEach((label, i) => {
    const above = labels[i - 1];
    if (above) label.at = Math.max(label.at, above.at + LABEL_GAP);
  });
  const overflow = (labels[labels.length - 1]?.at ?? 0) - (BASE_Y + 14);
  if (overflow > 0) labels.forEach((label) => (label.at -= overflow));
  const ghosts = stepping && !forward && cleared !== transition.id ? place(previous).slice(common) : [];

  useLayoutEffect(() => {
    if (!transition) return;
    const animations: Animation[] = [];
    const changes = forward ? target.length - common : previous.length - common;
    const each = changes > 0 ? Math.min(200, 800 / changes) : 0;
    if (forward) {
      for (let i = common; i < target.length; i++) {
        const rect = growing.current.get(i);
        if (!rect) continue;
        animations.push(
          rect.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
            duration: each,
            delay: START_MS + (i - common) * each,
            easing: EASE_OUT_LONG,
            fill: "backwards",
          }),
        );
      }
    } else {
      const count = previous.length - common;
      for (let j = 0; j < count; j++) {
        const rect = leaving.current.get(common + j);
        if (!rect) continue;
        const fromTop = count - 1 - j;
        animations.push(
          rect.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], {
            duration: each,
            delay: START_MS + fromTop * each,
            easing: EASE_OUT_LONG,
            fill: "forwards",
          }),
        );
      }
    }
    running.current.push(...animations);
    const step = transition.id;
    Promise.all(animations.map((animation) => animation.finished)).then(() => setCleared(step), () => setCleared(step));
    // Only a new step starts motion.
  }, [transition?.id]);

  const summary = target.length === 0 ? "Bare substrate: no layers recorded" : target.map((layer) => `${layer.stage} ${formatFilm(layer.um, unit)}`).join(", ");

  return (
    <div className="cross-section">
      <svg viewBox="0 0 360 252" className="cross-svg" role="img" aria-label={`Layers: ${summary}`} focusable="false">
        <text x={AXIS_X - 7} y={TOP_Y - 8} textAnchor="end" className="cross-axis-text">
          {unit === "um" ? "µm" : "mil"}
        </text>
        <path d={`M${AXIS_X} ${TOP_Y}V${BASE_Y}`} className="cross-axis" />
        {[top, top / 2, 0].map((um) => (
          <g key={um}>
            <path d={`M${AXIS_X - 4} ${BASE_Y - um * scale}H${AXIS_X}`} className="cross-axis" />
            <text x={AXIS_X - 7} y={BASE_Y - um * scale + 3.5} textAnchor="end" className="cross-axis-text">
              {filmValue(um, unit)}
            </text>
          </g>
        ))}
        <rect x={STACK_X} y={BASE_Y} width={STACK_W} height="20" className="substrate" />
        <rect x={STACK_X} y={BASE_Y} width={STACK_W} height="20" fill="url(#hatch-steel)" />
        {shown.map(({ layer, y, h }, index) => (
          <rect
            key={`${index}-${layer.stage}`}
            ref={(element) => {
              if (element) growing.current.set(index, element);
              else growing.current.delete(index);
            }}
            x={STACK_X}
            y={y}
            width={STACK_W}
            height={h}
            className={`layer ${stageClass(layer.stage)}`}
          />
        ))}
        {ghosts.map(({ layer, y, h }, offset) => (
          <rect
            key={`ghost-${transition?.id ?? 0}-${offset}`}
            ref={(element) => {
              if (element) leaving.current.set(common + offset, element);
              else leaving.current.delete(common + offset);
            }}
            x={STACK_X}
            y={y}
            width={STACK_W}
            height={h}
            className={`layer ghost ${stageClass(layer.stage)}`}
          />
        ))}
        {labels.map(({ layer, mid, at }, index) => (
          <g key={`label-${index}-${layer.stage}`}>
            <path d={`M${STACK_X + STACK_W + 2} ${mid}H${LABEL_X - 12}L${LABEL_X - 4} ${at}`} className="cross-leader" />
            <text x={LABEL_X} y={at + 4} className="cross-label-name">
              {layer.stage}
            </text>
            <text x={LABEL_END} y={at + 4} textAnchor="end" className="cross-label-value">
              {formatFilm(layer.um, unit)}
            </text>
          </g>
        ))}
        {target.length === 0 ? (
          <text x={LABEL_X} y={BASE_Y + 14} className="cross-empty">
            Bare substrate: no layers
          </text>
        ) : null}
      </svg>
    </div>
  );
}
