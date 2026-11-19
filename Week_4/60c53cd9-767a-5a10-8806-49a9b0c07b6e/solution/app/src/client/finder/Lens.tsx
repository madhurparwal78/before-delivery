/** The Window Lens: a round view that trails the pointer, crossfades between units and grows into the detail's view panel. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { COPY } from "../../shared/copy.js";
import { PANEL_SIZES, viewSrcSet } from "../format.js";
import { DURATIONS, easeOut, easeOutQuad, prefersReducedMotion, tween } from "../motion.js";
import { readUnit } from "../unit-cache.js";

type LensKind = "view" | "outside" | "chip-only";

export interface LensTarget {
  readonly code: string;
  readonly chip: string;
  readonly bearing: number;
  readonly kind: LensKind;
  /** Pointer or focused-cell centre in viewport pixels (ignored for the phone inset). */
  readonly x: number;
  readonly y: number;
}

interface Props {
  readonly target: LensTarget | null;
  /** Set while a home is open: the lens grows into the view panel. */
  readonly pinned: boolean;
  readonly inset: boolean;
  readonly onGrown: () => void;
}

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  round: number;
}

const LENS_SIZE = 224;
const INSET_SIZE = 120;
/** Room the chip needs beside the lens: its gap and its widest size. */
const CHIP_ROOM = 272;
/** Room the chip needs under the lens: its gap and its tallest size. */
const CHIP_HEIGHT = 72;

interface Layer {
  readonly key: string;
  readonly code: string;
  readonly url: string;
}

/** Keeps the chip inside the tower stage: beside the lens where it fits, otherwise under or over it. */
const chipPlacement = (target: LensTarget): string => {
  const stage = document.querySelector<HTMLElement>(".pane-tower")?.getBoundingClientRect();
  if (!stage) return "";
  const reach = LENS_SIZE / 2 + CHIP_ROOM;
  if (target.x + reach <= stage.right) return "";
  if (target.x - reach >= stage.left) return " lens-chip-left";
  return target.y + LENS_SIZE / 2 + CHIP_HEIGHT <= stage.bottom ? " lens-chip-below" : " lens-chip-above";
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const FadeImage = ({ layer, active, pinned, onSettled }: { layer: Layer; active: boolean; pinned: boolean; onSettled: (key: string) => void }): ReactNode => {
  const ref = useRef<HTMLImageElement>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  useLayoutEffect(() => {
    const image = ref.current as HTMLImageElement;
    if (prefersReducedMotion()) {
      image.style.opacity = "1";
      settled.current(layer.key);
      return undefined;
    }
    return tween(
      DURATIONS.crossfade,
      (progress) => {
        image.style.opacity = String(progress);
      },
      () => settled.current(layer.key),
      easeOutQuad,
    );
  }, [layer.key]);
  return (
    <img
      ref={ref}
      className="lens-image"
      src={layer.url}
      /* Sweeping shows the stored photograph; once pinned the lens is the view panel, so it takes the panel's copy. */
      srcSet={pinned ? viewSrcSet(layer.url) : undefined}
      sizes={pinned ? PANEL_SIZES : undefined}
      alt={active ? `View from ${layer.code}` : ""}
      aria-hidden={active ? undefined : true}
      draggable={false}
      style={{ opacity: 0 }}
    />
  );
};

export const Lens = ({ target, pinned, inset, onGrown }: Props): ReactNode => {
  const figureRef = useRef<HTMLElement>(null);
  const geometry = useRef<Geometry | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [photoState, setPhotoState] = useState<{ code: string; state: "none" | "pending" | "ready" } | null>(null);
  const currentCode = useRef<string | null>(null);
  const grown = useRef(onGrown);
  grown.current = onGrown;
  const visible = target !== null;
  const code = target?.code ?? null;
  const kind = target?.kind ?? "chip-only";

  const paint = (next: Geometry): void => {
    geometry.current = next;
    const figure = figureRef.current;
    if (!figure) return;
    figure.style.transform = `translate(${next.x}px, ${next.y}px)`;
    figure.style.width = `${next.w}px`;
    figure.style.height = `${next.h}px`;
    figure.style.setProperty("--lens-round", String(next.round));
    figure.style.borderRadius = `${next.round * 50}%`;
  };

  const aim = (to: Geometry, duration: number, done?: () => void): void => {
    cancel.current?.();
    const from = geometry.current;
    if (from === null || duration === 0 || prefersReducedMotion()) {
      paint(to);
      done?.();
      return;
    }
    cancel.current = tween(
      duration,
      (t) => paint({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), w: lerp(from.w, to.w, t), h: lerp(from.h, to.h, t), round: lerp(from.round, to.round, t) }),
      done,
      easeOut,
    );
  };

  const goal = (): Geometry | null => {
    if (target === null) return null;
    if (pinned) {
      const panel = document.querySelector<HTMLElement>("[data-view-panel]");
      if (panel) {
        const box = panel.getBoundingClientRect();
        return { x: box.left, y: box.top, w: box.width, h: box.height, round: 0 };
      }
    }
    if (inset) {
      const slot = document.querySelector<HTMLElement>("[data-lens-slot]")?.getBoundingClientRect();
      if (slot) return { x: slot.left + (slot.width - INSET_SIZE) / 2, y: slot.top + 4, w: INSET_SIZE, h: INSET_SIZE, round: 1 };
    }
    return { x: target.x - LENS_SIZE / 2, y: target.y - LENS_SIZE / 2, w: LENS_SIZE, h: LENS_SIZE, round: 1 };
  };

  // Follow the pointer with a short lag; snap into place the first time the lens appears.
  const wasPinned = useRef(false);
  const announcedGrown = useRef(false);
  const reveal = (): void => {
    if (announcedGrown.current) return;
    announcedGrown.current = true;
    grown.current();
  };
  useEffect(() => {
    const to = goal();
    if (to === null) {
      cancel.current?.();
      geometry.current = null;
      return;
    }
    if (pinned && !wasPinned.current) {
      wasPinned.current = true;
      announcedGrown.current = false;
      aim(to, DURATIONS.lensGrow, reveal);
    } else if (pinned) {
      aim(to, 0, reveal);
    } else {
      wasPinned.current = false;
      aim(to, geometry.current === null || geometry.current.round < 1 ? 0 : DURATIONS.lensLag);
    }
  }, [target?.x, target?.y, target?.code, pinned, inset, visible]);

  useEffect(() => {
    if (!pinned && !inset) return undefined;
    const reaim = (): void => {
      const to = goal();
      if (to) aim(to, 0, pinned ? reveal : undefined);
    };
    window.addEventListener("resize", reaim);
    window.addEventListener("scroll", reaim, true);
    return () => {
      window.removeEventListener("resize", reaim);
      window.removeEventListener("scroll", reaim, true);
    };
  }, [pinned, inset, target?.code]);

  useEffect(() => () => cancel.current?.(), []);

  // The photograph of the unit now under the lens; a slower photograph for a unit the lens has left is dropped.
  useEffect(() => {
    currentCode.current = code;
    setFailed(null);
    if (code === null || kind !== "view") {
      setLayers([]);
      setPhotoState(code === null ? null : { code, state: "none" });
      return;
    }
    setPhotoState({ code, state: "pending" });
    let live = true;
    void readUnit(code).then((read) => {
      if (!live || currentCode.current !== code) return;
      const url = read.unit?.viewUrl ?? null;
      if (url === null) {
        setLayers([]);
        setPhotoState({ code, state: "none" });
        return;
      }
      const image = new Image();
      image.onload = () => {
        if (!live || currentCode.current !== code) return;
        setPhotoState({ code, state: "ready" });
        setLayers((previous) => [...previous.filter((layer) => layer.code !== code), { key: `${code}:${url}`, code, url }]);
      };
      image.onerror = () => {
        if (!live || currentCode.current !== code) return;
        setLayers([]);
        setFailed(code);
      };
      image.src = url;
    });
    return () => {
      live = false;
    };
  }, [code, kind]);

  const settle = (key: string): void => setLayers((previous) => previous.slice(Math.max(0, previous.findIndex((layer) => layer.key === key))));

  if (target === null) return null;
  const chipPlace = pinned || inset ? "" : chipPlacement(target);
  const caption =
    kind === "outside"
      ? COPY.outsideFilters
      : kind === "view" && failed === code
        ? COPY.photoDown
        : kind === "view" && photoState?.code === code && photoState.state === "none" && layers.length === 0
          ? COPY.noPhoto
          : null;

  const host = document.getElementById("lens-root") as HTMLElement;
  return createPortal(
    <figure ref={figureRef} className={`lens${pinned ? " lens-pinned" : ""}${inset ? " lens-inset" : ""}`} aria-label="Window Lens">
      <div className="lens-disc">
        {layers.map((layer) => (
          <FadeImage key={layer.key} layer={layer} active={layer.code === code} pinned={pinned} onSettled={settle} />
        ))}
        {caption ? <p className="lens-caption">{caption}</p> : null}
      </div>
      {kind === "view" ? <span className="lens-north" aria-hidden="true" style={{ transform: `rotate(${360 - target.bearing}deg)` }} /> : null}
      <figcaption className={`lens-chip${pinned ? " lens-chip-hidden" : ""}${chipPlace}`}>{target.chip}</figcaption>
    </figure>,
    host,
  );
};
