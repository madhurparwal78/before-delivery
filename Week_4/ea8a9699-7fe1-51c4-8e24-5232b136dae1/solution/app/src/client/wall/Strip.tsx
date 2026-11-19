// The sprocket strip (brief: Screens > Wall; Interactions > Opening a clip, Strip sampling, Scrubbing,
// Plucking; Motion > Strip dock, Playhead). Frames are sampled from the clip in the browser; the server never
// decodes video.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Scissors, X } from "lucide-react";
import type { Reference } from "../../shared/api.js";
import { timecode, type FrameRate } from "../../shared/timecode.js";
import { dock } from "../lib/motion.js";

const MIN_TILES = 8;
/** Wide enough that a whole frame, fitted inside the tile, still shows what moves in it. */
const TILE_MIN_WIDTH = 96;
const TILE_GAP = 4;
/** How long after a handled tap the click the browser may add is ignored. */
const TAP_CLICK_MS = 800;

export interface PluckRequest {
  frameIndex: number;
  timecode: string;
  /** The tile the frame lifts out of, and the frame as currently drawn in the preview. */
  tile: HTMLElement;
  preview: HTMLCanvasElement;
  /** The PNG of the frame at the clip's full resolution. */
  capture: () => Promise<Blob>;
}

export interface StripHandle {
  focusPlayhead: () => void;
  close: () => void;
}

interface Props {
  clip: Reference;
  onPluck: (request: PluckRequest) => void;
  onClosed: () => void;
}

/** A <video> that seeks one frame at a time and reports each drawn frame. */
function frameSource(src: string): { video: HTMLVideoElement; seek: (time: number) => Promise<void> } {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.src = src;
  let chain: Promise<void> = new Promise((resolve) => {
    if (video.readyState >= 1) resolve();
    else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => resolve(), { once: true });
  });
  const seek = (time: number): Promise<void> => {
    chain = chain.then(
      () =>
        new Promise<void>((resolve) => {
          if (video.error) return resolve();
          const target = Math.min(Math.max(0, time), Math.max(0, (video.duration || time) - 0.001));
          if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return resolve();
          // A media error ends the wait too, so one broken load never holds every later seek.
          const done = (): void => {
            video.removeEventListener("seeked", done);
            video.removeEventListener("error", done);
            resolve();
          };
          video.addEventListener("seeked", done);
          video.addEventListener("error", done);
          video.currentTime = target;
        }),
    );
    return chain;
  };
  return { video, seek };
}

export const Strip = forwardRef<StripHandle, Props>(function Strip({ clip, onPluck, onClosed }, handle) {
  const total = clip.totalFrames ?? 1;
  const fps: FrameRate = clip.frameRate ?? 25;
  const region = useRef<HTMLElement | null>(null);
  const band = useRef<HTMLDivElement | null>(null);
  const slider = useRef<HTMLDivElement | null>(null);
  const preview = useRef<HTMLCanvasElement | null>(null);
  const tiles = useRef<Array<HTMLCanvasElement | null>>([]);
  const [frame, setFrame] = useState(0);
  const [bandWidth, setBandWidth] = useState(0);
  const [closing, setClosing] = useState(false);
  const previewSource = useRef<ReturnType<typeof frameSource> | null>(null);
  const shown = useRef<{ frame: number; ready: Promise<void> }>({ frame: -1, ready: Promise.resolve() });
  const dragging = useRef<number | null>(null);
  const tappedAt = useRef(-Infinity);

  // As many evenly spaced frames as fit the band: at least 8, at most the clip's frames.
  const fit = Math.floor((bandWidth + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP));
  const count = Math.min(total, Math.max(MIN_TILES, fit));
  const tileFrames = Array.from({ length: count }, (_, i) => Math.min(total - 1, Math.floor(((i + 0.5) * total) / count)));
  const currentTile = tileFrames.findIndex((_, i) => frame < Math.floor(((i + 1) * total) / tileFrames.length));

  // Dock, then hand focus to the playhead once the strip has settled in place.
  useLayoutEffect(() => {
    if (region.current) {
      const animation = dock(region.current, true);
      animation.onfinish = () => {
        animation.cancel();
        slider.current?.focus();
      };
    }
    const el = band.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBandWidth(el.clientWidth));
    observer.observe(el);
    setBandWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Preview: the frame at the playhead, at the clip's full resolution.
  useEffect(() => {
    const source = frameSource(clip.mediaUrl);
    previewSource.current = source;
    return () => {
      source.video.removeAttribute("src");
      source.video.load();
    };
  }, [clip.mediaUrl]);

  useEffect(() => {
    const source = previewSource.current;
    const canvas = preview.current;
    if (!source || !canvas) return;
    const ready = source.seek((frame + 0.5) / fps).then(() => {
      const { video } = source;
      if (!video.videoWidth) return;
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    });
    shown.current = { frame, ready };
  }, [frame, fps]);

  // Sampled tiles: evenly spaced frames, drawn as each one decodes.
  useEffect(() => {
    const sampler = frameSource(clip.mediaUrl);
    let cancelled = false;
    void (async () => {
      for (const [i, f] of tileFrames.entries()) {
        await sampler.seek((f + 0.5) / fps);
        const canvas = tiles.current[i];
        if (cancelled) return;
        if (!canvas || !sampler.video.videoWidth) continue;
        // Cover-crop the frame to the tile's own shape, so each tile is a full film frame across the band.
        const { videoWidth: vw, videoHeight: vh } = sampler.video;
        const aspect = canvas.clientWidth > 0 && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : vw / vh;
        const sw = Math.min(vw, vh * aspect);
        const sh = sw / aspect;
        canvas.width = 192;
        canvas.height = Math.round(192 / aspect);
        canvas.getContext("2d")?.drawImage(sampler.video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
        canvas.dataset.drawn = "true";
      }
    })();
    return () => {
      cancelled = true;
      sampler.video.removeAttribute("src");
      sampler.video.load();
    };
    // Resampled only when the number of tiles changes; the frame list follows from it.
  }, [count, clip.mediaUrl, fps]);

  const close = useCallback(() => {
    if (closing || !region.current) return;
    setClosing(true);
    const animation = dock(region.current, false);
    animation.onfinish = () => onClosed();
  }, [closing, onClosed]);

  useImperativeHandle(handle, () => ({ focusPlayhead: () => slider.current?.focus(), close }), [close]);

  const frameAt = (clientX: number): number => {
    const box = band.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return frame;
    return Math.max(0, Math.min(total - 1, Math.floor(((clientX - box.left) / box.width) * total)));
  };

  const pluck = (): void => {
    const tile = tiles.current[Math.max(0, currentTile)]?.parentElement ?? band.current;
    const canvas = preview.current;
    if (!tile || !canvas) return;
    const at = frame;
    const ready = shown.current.frame === at ? shown.current.ready : Promise.resolve();
    onPluck({
      frameIndex: at,
      timecode: timecode(at, fps),
      tile,
      preview: canvas,
      capture: () =>
        ready.then(
          () => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no frame"))), "image/png")),
        ),
    });
  };

  // A tap plucks on release: the browser does not always follow a tap that comes right after a scrub with a click.
  const onPluckTap = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (event.pointerType !== "touch" || !inside) return;
    tappedAt.current = event.timeStamp;
    pluck();
  };
  const onPluckClick = (event: React.MouseEvent): void => {
    if (event.timeStamp - tappedAt.current < TAP_CLICK_MS) return;
    pluck();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if ((event.key === "p" || event.key === "P") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      pluck();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const onSliderKey = (event: React.KeyboardEvent): void => {
    const step = event.shiftKey ? fps : 1;
    const next = { ArrowRight: frame + step, ArrowUp: frame + step, ArrowLeft: frame - step, ArrowDown: frame - step, Home: 0, End: total - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setFrame(Math.max(0, Math.min(total - 1, next)));
  };

  const tc = timecode(frame, fps);
  return (
    <section ref={region} className="strip" aria-label="Sprocket strip" onKeyDown={onKeyDown}>
      <div
        ref={band}
        className="strip__band"
        onPointerDown={(event) => {
          event.preventDefault();
          dragging.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          setFrame(frameAt(event.clientX));
          slider.current?.focus();
        }}
        onPointerMove={(event) => {
          if (dragging.current === event.pointerId) setFrame(frameAt(event.clientX));
        }}
        onPointerUp={(event) => {
          if (dragging.current === event.pointerId) setFrame(frameAt(event.clientX));
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
      >
        {tileFrames.map((f, i) => (
          <div key={`${count}-${i}`} className="strip__tile" data-current={i === currentTile ? "true" : undefined}>
            <canvas
              ref={(el) => {
                tiles.current[i] = el;
              }}
              aria-hidden="true"
              data-frame={f}
            />
          </div>
        ))}
        <div
          ref={slider}
          className="strip__playhead"
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={total - 1}
          aria-valuenow={frame}
          aria-valuetext={tc}
          style={{ left: `${((frame + 0.5) / total) * 100}%` }}
          onKeyDown={onSliderKey}
        >
          <span className="strip__line" aria-hidden="true" />
        </div>
      </div>
      <div className="strip__side">
        <canvas ref={preview} className="strip__preview" role="img" aria-label="Frame preview" width={480} height={270} />
        <div className="strip__readout">
          <p className="strip__timecode" role="timer" aria-label="Timecode">
            {tc}
          </p>
          <p className="strip__clip">{clip.title}</p>
        </div>
        <div className="strip__actions">
          <button type="button" className="btn btn--primary" aria-label="Pluck frame" onPointerUp={onPluckTap} onClick={onPluckClick}>
            <Scissors size={16} aria-hidden="true" />
            Pluck
          </button>
          <button type="button" className="btn" aria-label="Close clip" onClick={close}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
        </div>
      </div>
    </section>
  );
});
