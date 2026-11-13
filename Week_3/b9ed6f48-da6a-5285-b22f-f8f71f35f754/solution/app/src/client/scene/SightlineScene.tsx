// The sightline scene (brief: Interactions › Orbiting the sightline scene, Still viewpoints;
// Public screens › slider "Sightline", meter "Alignment", radiogroup "Viewpoints").

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Sculpture, webglAvailable } from "./sculpture.js";
import { buildModel, drawStill, type ShardModel } from "./shardModel.js";
import { YAW_MAX, YAW_MIN, YAW_SPAN, YAW_STEP, alignment, formatAngle, wholeYaw, withinResolveWindow } from "../../shared/sightline.js";
import { COPY, copyFor } from "../../shared/copy.js";
import { chime } from "../sound.js";
import { playMorph } from "../morph.js";

interface SceneChapter {
  number: number;
  numeral: string;
  title: string;
  era: string;
  catalogue_number: string;
  sightline_deg: number;
  viewpoints: number[];
}

interface Props {
  chapter: SceneChapter;
  startResolved: boolean;
  reducedMotion: boolean;
  sound: boolean;
  onEnter: () => void;
  headerExtra: ReactNode;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}

const GROUND = "#0e0f0b";
const INK: [number, number, number] = [236, 228, 210];
const isTextField = (el: EventTarget | null) => el instanceof HTMLElement && (el.matches("input:not([type=radio]), textarea, select") || el.isContentEditable);

/** Waits for the display face so the shards spell the numeral in Instrument Serif. */
async function sculptureModel(chapter: SceneChapter): Promise<ShardModel> {
  await document.fonts.load('400 120px "Instrument Serif"', `${chapter.numeral} ${chapter.title}`);
  return buildModel(chapter.numeral, chapter.title, chapter.sightline_deg, chapter.number * 7919);
}

interface StageProps {
  model: ShardModel;
  yaw: number;
  shown: number;
  resolved: boolean;
  reducedMotion: boolean;
  onYaw: (yaw: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

function WebglStage({ model, yaw, shown, resolved, reducedMotion, onYaw, onKeyDown }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const sculpture = useRef<Sculpture | null>(null);
  const yawRef = useRef(yaw);
  yawRef.current = yaw;
  const wheelYaw = useRef(yaw);

  useLayoutEffect(() => {
    const created = new Sculpture(canvasRef.current as HTMLCanvasElement, model);
    sculpture.current = created;
    const slider = sliderRef.current as HTMLDivElement;
    const fit = () => created.resize(Math.max(1, slider.clientWidth), Math.max(1, slider.clientHeight));
    fit();
    created.setYaw(yawRef.current);
    const resize = new ResizeObserver(fit);
    resize.observe(slider);
    const seen = new IntersectionObserver(([entry]) => created.setVisible(entry.isIntersecting));
    seen.observe(slider);
    return () => {
      resize.disconnect();
      seen.disconnect();
      created.dispose();
      sculpture.current = null;
    };
  }, [model]);

  useLayoutEffect(() => {
    sculpture.current?.setYaw(yaw);
  }, [yaw]);

  useEffect(() => {
    if (resolved) sculpture.current?.settle(reducedMotion);
  }, [resolved, reducedMotion]);

  useEffect(() => {
    // Scroll inside the scene: 3° per 100 px notch; at a limit the page scrolls instead.
    const slider = sliderRef.current as HTMLDivElement;
    const onWheel = (event: WheelEvent) => {
      const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
      const current = yawRef.current;
      if ((delta > 0 && current >= YAW_MAX) || (delta < 0 && current <= YAW_MIN) || delta === 0) return;
      event.preventDefault();
      if (wholeYaw(wheelYaw.current) !== current) wheelYaw.current = current;
      wheelYaw.current = Math.min(YAW_MAX, Math.max(YAW_MIN, wheelYaw.current + (delta / 100) * YAW_STEP));
      onYaw(wholeYaw(wheelYaw.current));
    };
    slider.addEventListener("wheel", onWheel, { passive: false });
    return () => slider.removeEventListener("wheel", onWheel);
  }, [onYaw]);

  const drag = useRef<{ id: number; x: number; yaw: number } | null>(null);

  return (
    <div
      ref={sliderRef}
      className="scene-canvas"
      role="slider"
      tabIndex={0}
      aria-label="Sightline"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      aria-valuetext={`Yaw ${formatAngle(yaw)}, alignment ${shown}%`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        drag.current = { id: event.pointerId, x: event.clientX, yaw: yawRef.current };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const width = event.currentTarget.clientWidth || 1;
        onYaw(wholeYaw(start.yaw + ((event.clientX - start.x) / width) * YAW_SPAN));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}

function StillCanvas({ model, yaw, width, height, className }: { model: ShardModel; yaw: number; width: number; height: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    drawStill(ref.current as HTMLCanvasElement, model, yaw, GROUND, INK);
  }, [model, yaw]);
  return <canvas ref={ref} width={width} height={height} className={className} aria-hidden="true" />;
}

export function SightlineScene({ chapter, startResolved, reducedMotion, sound, onEnter, headerExtra, headingRef }: Props) {
  const sight = chapter.sightline_deg;
  const [yaw, setYaw] = useState(startResolved ? sight : YAW_MIN);
  const [resolved, setResolved] = useState(startResolved);
  const [announcement, setAnnouncement] = useState("");
  const [model, setModel] = useState<ShardModel | null>(null);
  const webgl = useMemo(webglAvailable, []);
  const still = reducedMotion || !webgl;
  const numeralRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let live = true;
    void sculptureModel(chapter).then((m) => live && setModel(m));
    return () => {
      live = false;
    };
  }, [chapter]);

  useLayoutEffect(() => {
    playMorph(chapter.numeral, numeralRef.current as HTMLSpanElement, reducedMotion);
    // Only on arrival: the morph belongs to following the link.
  }, []);

  const turn = useCallback(
    (next: number) => {
      setYaw(next);
      if (!resolved && withinResolveWindow(next, sight)) {
        setResolved(true);
        setAnnouncement(copyFor.chapterResolved(chapter.numeral));
        if (sound) chime();
      }
    },
    [resolved, sight, chapter.numeral, sound],
  );

  const shown = resolved ? 100 : alignment(yaw, sight);
  const align = () => turn(sight);

  const onSliderKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const moves: Record<string, number> = { ArrowLeft: yaw - YAW_STEP, ArrowRight: yaw + YAW_STEP, Home: YAW_MIN, End: YAW_MAX };
    if (!(event.key in moves)) return;
    event.preventDefault();
    turn(wholeYaw(moves[event.key]));
  };

  return (
    <section
      aria-label="Sightline scene"
      className={`scene-band${resolved ? " is-resolved" : ""}${still ? " is-still" : ""}`}
      onKeyDown={(event) => {
        if ((event.key === "a" || event.key === "A") && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextField(event.target)) {
          event.preventDefault();
          align();
        }
      }}
    >
      <div className="scene-stage">
        <div className="scene-frame">
          {!still && model && <WebglStage model={model} yaw={yaw} shown={shown} resolved={resolved} reducedMotion={reducedMotion} onYaw={turn} onKeyDown={onSliderKey} />}
          {!still && !model && <div className="scene-canvas scene-loading" aria-hidden="true" />}
          {still && (
            <div className="still-stage">
              {!webgl && <p className="still-note">{COPY.noWebgl}</p>}
              {model ? <StillCanvas model={model} yaw={yaw} width={1200} height={620} className="still-large" /> : <div className="still-large scene-loading" aria-hidden="true" />}
              <div role="radiogroup" aria-label="Viewpoints" className="viewpoints">
                {chapter.viewpoints.map((angle) => (
                  <label key={angle} className="viewpoint">
                    <input
                      type="radio"
                      name={`viewpoint-${chapter.number}`}
                      aria-label={`Viewpoint ${formatAngle(angle)}, alignment ${alignment(angle, sight)}%`}
                      checked={yaw === angle}
                      onChange={() => turn(angle)}
                    />
                    {model ? <StillCanvas model={model} yaw={angle} width={300} height={186} className="viewpoint-image" /> : <span className="viewpoint-image scene-loading" />}
                    <span className="viewpoint-text" aria-hidden="true">
                      <span>{formatAngle(angle)}</span>
                      <span>{alignment(angle, sight)}%</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <h1 ref={headingRef} tabIndex={-1} className="scene-title">
            {chapter.title}
          </h1>
        </div>
        <div className="museum-label museum-card">
          <div className="label-head">
            <span className="catalogue">{chapter.catalogue_number}</span>
            {headerExtra}
          </div>
          <span className="label-numeral" ref={numeralRef}>
            {chapter.numeral}
          </span>
          <p className="era">{chapter.era}</p>
          <div role="meter" aria-label="Alignment" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown} className={`readout${resolved ? " is-locked" : ""}`}>
            Alignment {shown}%
          </div>
          <div className="label-actions">
            <button type="button" className="button" onClick={align}>
              Align
            </button>
            <button type="button" className="button button-primary" disabled={!resolved} onClick={onEnter}>
              Enter chapter
            </button>
          </div>
          <div role="status" aria-label="Sightline status" className="scene-status">
            {announcement}
          </div>
          {!resolved && <p className="hint">{still ? "Choose the viewpoint where the shards line up." : "Drag, scroll or use the arrow keys to turn the sculpture."}</p>}
        </div>
      </div>
    </section>
  );
}

