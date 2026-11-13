import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { SNAP_PIXELS } from "../../shared/limits";
import { frameSize, layersAt, type LayerBox } from "../../shared/layers";
import { round2 } from "../../shared/keyframes";
import { roundHalfUp } from "../../shared/rational";
import type { Clip } from "../../shared/types";
import { checksumColour } from "../lib/format";
import { setLayer, stepLayer } from "./actions";
import { useProject } from "./context";
import { canEdit } from "./state";
import type { ProjectStore } from "./store";

interface Preview {
  clipId: string;
  x: number;
  y: number;
  scale: number;
}

const HANDLES = [
  { handle: "nw", name: "Top left handle", style: { left: -12, top: -12 } },
  { handle: "ne", name: "Top right handle", style: { right: -12, top: -12 } },
  { handle: "se", name: "Bottom right handle", style: { right: -12, bottom: -12 } },
  { handle: "sw", name: "Bottom left handle", style: { left: -12, bottom: -12 } },
] as const;

function fillOf(clip: Clip, sha: string | undefined): string {
  if (clip.kind === "text") return `#${clip.box_colour ?? "000000"}`;
  return checksumColour(sha ?? "000000");
}

/** Nearest locks for a dragged box: the centre first, then the frame's edges, x before y. */
function snap(value: number, half: number, length: number, centreName: string, lowName: string, highName: string): { value: number; guide: string | null } {
  if (Math.abs(value - length / 2) <= SNAP_PIXELS) return { value: length / 2, guide: centreName };
  if (Math.abs(value - half) <= SNAP_PIXELS) return { value: round2(half), guide: lowName };
  if (Math.abs(value + half - length) <= SNAP_PIXELS) return { value: round2(length - half), guide: highName };
  return { value, guide: null };
}

export function Stage({ interactive }: { interactive: boolean }): ReactNode {
  const { store, state } = useProject();
  const boxRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [guides, setGuides] = useState<string[]>([]);
  const size = frameSize(state.project.aspect_ratio);
  const frame = state.skim ? state.skim.frame : state.playhead;
  const mode = state.skim ? "skim" : "playhead";
  const layers = layersAt(frame, state.clips, state.rows, state.media, size);
  const clips = new Map(state.clips.map((clip) => [clip.id, clip]));
  const locked = new Set(state.rows.filter((row) => row.locked).map((row) => row.id));
  const shaping = interactive && mode === "playhead" && canEdit(state.role);

  const pixelsPerProjectPixel = (): number => (boxRef.current?.clientWidth ?? size.width) / size.width;

  const beginMove = (event: PointerEvent<HTMLButtonElement>, layer: LayerBox): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const start = { px: event.clientX, py: event.clientY, x: layer.x, y: layer.y };
    const ppp = pixelsPerProjectPixel();
    let latest = { x: layer.x, y: layer.y };
    const move = (moveEvent: globalThis.PointerEvent): void => {
      const rawX = start.x + roundHalfUp((moveEvent.clientX - start.px) / ppp);
      const rawY = start.y + roundHalfUp((moveEvent.clientY - start.py) / ppp);
      const x = snap(rawX, layer.width / 2, size.width, "centre-x", "left", "right");
      const y = snap(rawY, layer.height / 2, size.height, "centre-y", "top", "bottom");
      latest = { x: x.value, y: y.value };
      setPreview({ clipId: layer.clip_id, ...latest, scale: layer.scale });
      setGuides([x.guide, y.guide].filter((guide): guide is string => guide !== null));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const change: { x?: number; y?: number } = {};
      if (latest.x !== start.x) change.x = latest.x;
      if (latest.y !== start.y) change.y = latest.y;
      if (Object.keys(change).length) void setLayer(store, layer.clip_id, change);
      setPreview(null);
      setGuides([]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const beginScale = (event: PointerEvent<HTMLButtonElement>, layer: LayerBox): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const element = boxRef.current?.querySelector<HTMLElement>(`[data-layer-box="${layer.clip_id}"]`);
    const rect = element?.getBoundingClientRect();
    if (!rect) return;
    const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const distance = (x: number, y: number): number => Math.hypot(x - centre.x, y - centre.y);
    const first = distance(event.clientX, event.clientY) || 1;
    let scale = layer.scale;
    const move = (moveEvent: globalThis.PointerEvent): void => {
      scale = Math.min(1000, Math.max(1, round2((layer.scale * distance(moveEvent.clientX, moveEvent.clientY)) / first)));
      setPreview({ clipId: layer.clip_id, x: layer.x, y: layer.y, scale });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (scale !== layer.scale) void setLayer(store, layer.clip_id, { scale });
      setPreview(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section
      ref={boxRef}
      role="region"
      aria-label="Stage"
      data-stage-mode={mode}
      data-stage-frame={frame}
      className="stage"
      style={{ aspectRatio: `${size.width} / ${size.height}`, ["--ratio" as string]: size.width / size.height }}
    >
      <div className="stage-fade" key={mode}>
        {layers.map((layer) => {
          const clip = clips.get(layer.clip_id);
          if (!clip) return null;
          const shown = preview?.clipId === layer.clip_id ? { ...layer, x: preview.x, y: preview.y, scale: preview.scale, width: round2((layer.width / layer.scale) * preview.scale), height: round2((layer.height / layer.scale) * preview.scale) } : layer;
          const canShape = shaping && !locked.has(clip.row_id);
          return (
            <div
              key={layer.clip_id}
              data-layer-box={layer.clip_id}
              data-x={shown.x.toFixed(2)}
              data-y={shown.y.toFixed(2)}
              data-width={shown.width.toFixed(2)}
              data-height={shown.height.toFixed(2)}
              data-scale={shown.scale.toFixed(2)}
              data-rotation={shown.rotation.toFixed(2)}
              data-opacity={shown.opacity.toFixed(2)}
              className="layer"
              style={{
                left: `${((shown.x - shown.width / 2) / size.width) * 100}%`,
                top: `${((shown.y - shown.height / 2) / size.height) * 100}%`,
                width: `${(shown.width / size.width) * 100}%`,
                height: `${(shown.height / size.height) * 100}%`,
                opacity: shown.opacity / 100,
                transform: `rotate(${shown.rotation}deg)`,
                background: fillOf(clip, clip.media_id ? state.media[clip.media_id]?.sha256 : undefined),
              }}
            >
              {clip.kind === "text" ? (
                <span className="layer-text" style={{ color: `#${clip.text_colour ?? "ffffff"}`, fontWeight: clip.font_weight ?? 400 }}>
                  {clip.text}
                </span>
              ) : null}
              {canShape ? (
                <>
                  <button
                    type="button"
                    className="layer-hit"
                    aria-label={`Layer ${clip.name}`}
                    onPointerDown={(event) => beginMove(event, layer)}
                    onKeyDown={(event) => layerKey(event, store, clip.id)}
                  />
                  {HANDLES.map((handle) => (
                    <button
                      type="button"
                      key={handle.handle}
                      data-handle={handle.handle}
                      aria-label={`${handle.name} ${clip.name}`}
                      className="handle"
                      style={handle.style}
                      onPointerDown={(event) => beginScale(event, layer)}
                    />
                  ))}
                </>
              ) : null}
            </div>
          );
        })}
        {guides.map((guide) => (
          <div key={guide} data-stage-guide={guide} className={`stage-guide ${guide}`} />
        ))}
      </div>
    </section>
  );
}

function layerKey(event: KeyboardEvent<HTMLButtonElement>, store: ProjectStore, clipId: string): void {
  const step = event.shiftKey ? 10 : 1;
  if (event.key === "Escape") {
    document.querySelector<HTMLElement>(`[data-clip-id="${clipId}"]`)?.focus();
  } else if (event.key === "ArrowLeft") stepLayer(store, clipId, "x", -step);
  else if (event.key === "ArrowRight") stepLayer(store, clipId, "x", step);
  else if (event.key === "ArrowUp") stepLayer(store, clipId, "y", -step);
  else if (event.key === "ArrowDown") stepLayer(store, clipId, "y", step);
  else if (event.code === "BracketLeft") stepLayer(store, clipId, "scale", -step);
  else if (event.code === "BracketRight") stepLayer(store, clipId, "scale", step);
  else return;
  event.preventDefault();
  event.stopPropagation();
}
