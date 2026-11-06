import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { prefersReduced } from "../lib/media";
import { FLAVOUR_NAMES } from "../../shared/format";
import { CanArt } from "./CanArt";
import { SCENE_FLAVOURS } from "./flavours";

// The can turntable. One angle drives both renderers: the WebGL can when the browser has
// WebGL, and the layered drawing otherwise. Drag the width of the can for half a turn; the
// buttons and arrow keys turn an eighth; each scene scrolled turns a quarter; idle, it turns
// once every 24 seconds and rests for 5 seconds after any input.

const STEP = 45;
const TURN_MS = 333;
const IDLE_DEG_PER_MS = 360 / 24_000;
const REST_MS = 5000;

export interface CanView {
  draw: (angle: number, flavour: string) => void;
  dispose: () => void;
}

const ease = (t: number) => 1 - (1 - t) ** 3;
const wrap = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

export function Turntable({ scenes }: { scenes: React.RefObject<(HTMLElement | null)[]> }) {
  const stage = useRef<HTMLDivElement>(null);
  const still = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<"pending" | "webgl" | "still">("pending");
  const [flavour, setFlavour] = useState(SCENE_FLAVOURS[0]);
  const state = useRef({
    base: 0,
    turnFrom: 0,
    turnTo: 0,
    turnStart: -1,
    lastInput: -Infinity,
    dragging: false,
    dragX: 0,
    visible: true,
    flavour: SCENE_FLAVOURS[0],
    shown: -1,
    drawn: Number.NaN,
    drawnFlavour: "",
    view: null as CanView | null,
  });

  const touch = (now = performance.now()) => {
    state.current.lastInput = now;
  };

  const turn = (direction: 1 | -1) => {
    const s = state.current;
    const now = performance.now();
    touch(now);
    const from = s.turnStart >= 0 ? s.turnTo : s.base;
    if (prefersReduced()) {
      s.base = from + direction * STEP;
      s.turnStart = -1;
      return;
    }
    s.turnFrom = s.turnStart >= 0 ? s.base : from;
    s.base = s.turnFrom;
    s.turnTo = from + direction * STEP;
    s.turnStart = now;
  };

  useEffect(() => {
    const s = state.current;
    let frame = 0;
    let last = performance.now();

    const scrollAngle = (): number => {
      const tops = scenes.current.flatMap((e) => (e ? [e.getBoundingClientRect().top + window.scrollY] : []));
      let angle = 0;
      for (let i = 0; i < tops.length - 1; i++) {
        angle += Math.min(1, Math.max(0, (window.scrollY - tops[i]) / (tops[i + 1] - tops[i]))) * 90;
      }
      return angle;
    };
    const sceneFlavour = (): string => {
      const middle = window.innerHeight / 2;
      const els = scenes.current;
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        if (el && el.getBoundingClientRect().top <= middle) return SCENE_FLAVOURS[i];
      }
      return SCENE_FLAVOURS[0];
    };

    const loop = () => {
      const now = performance.now();
      const dt = Math.min(100, now - last);
      last = now;
      const reduced = prefersReduced();
      if (s.turnStart >= 0) {
        const t = Math.min(1, (now - s.turnStart) / TURN_MS);
        s.base = s.turnFrom + (s.turnTo - s.turnFrom) * ease(t);
        if (t >= 1) {
          s.base = s.turnTo;
          s.turnStart = -1;
        }
      } else if (!reduced && !s.dragging && s.visible && now - s.lastInput >= REST_MS) {
        s.base += IDLE_DEG_PER_MS * dt;
      }
      const angle = s.base + (reduced ? 0 : scrollAngle());
      const shown = wrap(angle);
      const nextFlavour = sceneFlavour();
      if (nextFlavour !== s.flavour) {
        s.flavour = nextFlavour;
        setFlavour(nextFlavour);
      }
      if (shown !== s.shown || s.flavour !== s.drawnFlavour) {
        s.shown = shown;
        stage.current?.setAttribute("aria-label", `${FLAVOUR_NAMES[s.flavour]} can, turned ${shown} degrees`);
      }
      if (angle !== s.drawn || s.flavour !== s.drawnFlavour) {
        s.drawn = angle;
        s.drawnFlavour = s.flavour;
        still.current?.style.setProperty("--label-shift", `${(((angle % 360) + 360) % 360) * (160 / 360)}px`);
        if (s.visible) s.view?.draw(angle, s.flavour);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const observer = new IntersectionObserver(([entry]) => {
      s.visible = entry.isIntersecting;
    });
    if (stage.current) observer.observe(stage.current);

    let cancelled = false;
    import("./webgl")
      .then(({ createCanView }) => {
        if (cancelled || !canvasHost.current) return;
        const view = createCanView(canvasHost.current);
        if (!view) {
          s.drawn = Number.NaN;
          setRenderer("still");
          return;
        }
        s.view = view;
        s.drawn = Number.NaN;
        setRenderer("webgl");
      })
      .catch(() => {
        s.drawn = Number.NaN;
        setRenderer("still");
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      s.view?.dispose();
      s.view = null;
    };
  }, [scenes]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      turn(event.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    const s = state.current;
    s.dragging = true;
    s.dragX = event.clientX;
    s.turnStart = -1;
    touch();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const s = state.current;
    if (!s.dragging) return;
    const width = event.currentTarget.getBoundingClientRect().width || 1;
    s.base += ((event.clientX - s.dragX) / width) * 180;
    s.dragX = event.clientX;
    touch();
  };
  const onUp = () => {
    state.current.dragging = false;
    touch();
  };

  return (
    <div className="turntable">
      <div
        ref={stage}
        className={`can-stage-art flavour-${flavour} renderer-${renderer}`}
        role="img"
        tabIndex={0}
        aria-label={`${FLAVOUR_NAMES[flavour]} can, turned ${Math.max(0, state.current.shown)} degrees`}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div ref={canvasHost} className="can-canvas" aria-hidden="true" />
        {renderer !== "webgl" && (
          <div ref={still} className="can-still" aria-hidden="true">
            <CanArt flavour={flavour} />
          </div>
        )}
      </div>
      <div className="turn-buttons">
        <button type="button" className="btn btn-cream icon-btn" aria-label="Turn can left" onClick={() => turn(-1)}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-cream icon-btn" aria-label="Turn can right" onClick={() => turn(1)}>
          <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
