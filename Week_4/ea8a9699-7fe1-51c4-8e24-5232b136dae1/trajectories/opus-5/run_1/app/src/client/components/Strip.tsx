import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatTimecode } from '../../shared/timecode.js';
import type { Reference } from '../../shared/types.js';

const minimumSamples = 8;
const tileWidth = 72;
const prefetchLimit = 120;
const blankPixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export interface PluckRequest {
  frameIndex: number;
  timecode: string;
  blob: Blob;
  tileRect: DOMRect;
  tileSrc: string;
}

interface StripProps {
  clip: Reference;
  onClose: () => void;
  onPluck: (request: PluckRequest) => Promise<void>;
}

function frameTime(frameIndex: number, frameRate: number): number {
  return (frameIndex + 0.5) / frameRate;
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2) {
    return;
  }
  await new Promise<void>((settle) => {
    const done = (): void => {
      video.removeEventListener('seeked', done);
      settle();
    };
    video.addEventListener('seeked', done);
    video.currentTime = time;
  });
}

function drawToDataUrl(video: HTMLVideoElement, width: number): string {
  const canvas = document.createElement('canvas');
  const ratio = video.videoHeight === 0 ? 0.5625 : video.videoHeight / video.videoWidth;
  canvas.width = width;
  canvas.height = Math.max(1, Math.round(width * ratio));
  const context = canvas.getContext('2d');
  context?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function Strip({ clip, onClose, onPluck }: StripProps): JSX.Element {
  const totalFrames = clip.totalFrames ?? 1;
  const frameRate = clip.frameRate ?? 25;
  const lastFrame = totalFrames - 1;

  const [frameIndex, setFrameIndex] = useState(0);
  const [sampleCount, setSampleCount] = useState(minimumSamples);
  const [tiles, setTiles] = useState<{ frameIndex: number; src: string }[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const video = useRef<HTMLVideoElement | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<number, string>());
  const seeking = useRef<Promise<void>>(Promise.resolve());
  const wantedFrame = useRef(0);

  useLayoutEffect(() => {
    const element = track.current;
    if (element === null) {
      return undefined;
    }
    const measure = (): void => {
      const width = element.clientWidth;
      const fits = Math.max(minimumSamples, Math.floor(width / tileWidth));
      setSampleCount(Math.min(totalFrames, Math.max(minimumSamples, fits)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [totalFrames]);

  useEffect(() => {
    const element = document.createElement('video');
    element.src = clip.mediaUrl;
    element.preload = 'auto';
    element.muted = true;
    element.playsInline = true;
    video.current = element;
    const onReady = (): void => setReady(true);
    element.addEventListener('loadeddata', onReady);
    return () => {
      element.removeEventListener('loadeddata', onReady);
      element.src = '';
      video.current = null;
    };
  }, [clip.mediaUrl]);

  const frameSource = useCallback(
    async (index: number, width: number): Promise<string | null> => {
      const element = video.current;
      if (element === null) {
        return null;
      }
      const cached = cache.current.get(index);
      if (cached !== undefined) {
        return cached;
      }
      const run = seeking.current.then(async () => {
        await seekTo(element, frameTime(index, frameRate));
        const source = drawToDataUrl(element, width);
        cache.current.set(index, source);
      });
      seeking.current = run.catch(() => undefined);
      await seeking.current;
      return cache.current.get(index) ?? null;
    },
    [frameRate],
  );

  useEffect(() => {
    if (!ready) {
      return;
    }
    let active = true;
    const sampled = Array.from({ length: sampleCount }, (_, index) =>
      Math.min(lastFrame, Math.round((index * totalFrames) / sampleCount)),
    );
    void (async () => {
      const collected: { frameIndex: number; src: string }[] = [];
      for (const index of sampled) {
        const source = await frameSource(index, 160);
        if (!active) {
          return;
        }
        if (source !== null) {
          collected.push({ frameIndex: index, src: source });
          setTiles([...collected]);
        }
      }
      if (totalFrames <= prefetchLimit) {
        for (let index = 0; index < totalFrames; index += 1) {
          if (!active) {
            return;
          }
          await frameSource(index, 320);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [ready, sampleCount, totalFrames, lastFrame, frameSource]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    wantedFrame.current = frameIndex;
    const cached = cache.current.get(frameIndex);
    if (cached !== undefined) {
      setPreview(cached);
      return;
    }
    const nearest = tiles.reduce<{ frameIndex: number; src: string } | null>((best, tile) => {
      if (best === null) {
        return tile;
      }
      return Math.abs(tile.frameIndex - frameIndex) < Math.abs(best.frameIndex - frameIndex) ? tile : best;
    }, null);
    if (nearest !== null) {
      setPreview(nearest.src);
    }
    void frameSource(frameIndex, 320).then((source) => {
      if (source !== null && wantedFrame.current === frameIndex) {
        setPreview(source);
      }
    });
  }, [frameIndex, ready, tiles, frameSource]);

  useEffect(() => {
    track.current?.focus();
  }, []);

  const frameAt = (clientX: number, element: HTMLElement): number => {
    const rect = element.getBoundingClientRect();
    const offset = clientX - rect.left;
    return Math.max(0, Math.min(lastFrame, Math.floor((offset / rect.width) * totalFrames)));
  };

  const scrubbing = useRef(false);

  const onScrubStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    scrubbing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setFrameIndex(frameAt(event.clientX, event.currentTarget));
    track.current?.focus();
  };

  const onScrubMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!scrubbing.current) {
      return;
    }
    event.preventDefault();
    setFrameIndex(frameAt(event.clientX, event.currentTarget));
  };

  const onScrubEnd = (): void => {
    scrubbing.current = false;
  };

  const timecode = formatTimecode(frameIndex, frameRate);

  const selectedTileIndex = tiles.reduce((best, tile, index) => {
    const bestTile = tiles[best];
    if (bestTile === undefined) {
      return index;
    }
    return Math.abs(tile.frameIndex - frameIndex) < Math.abs(bestTile.frameIndex - frameIndex) ? index : best;
  }, 0);

  const pluck = async (): Promise<void> => {
    const element = video.current;
    const tileNodes = track.current?.querySelectorAll('.strip-frames img');
    const tileRect =
      tileNodes !== undefined && tileNodes[selectedTileIndex] !== undefined
        ? tileNodes[selectedTileIndex].getBoundingClientRect()
        : (track.current?.getBoundingClientRect() ?? new DOMRect());
    const tileSrc = cache.current.get(frameIndex) ?? tiles[selectedTileIndex]?.src ?? '';
    if (element === null) {
      return;
    }
    await seekTo(element, frameTime(frameIndex, frameRate));
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext('2d')?.drawImage(element, 0, 0);
    const blob = await new Promise<Blob | null>((settle) => canvas.toBlob(settle, 'image/png'));
    if (blob === null) {
      return;
    }
    await onPluck({ frameIndex, timecode, blob, tileRect, tileSrc });
    track.current?.focus();
  };

  const onStripKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      void pluck();
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const onSliderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const stride = event.shiftKey ? frameRate : 1;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setFrameIndex((current) => Math.min(lastFrame, current + stride));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setFrameIndex((current) => Math.max(0, current - stride));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setFrameIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setFrameIndex(lastFrame);
    }
  };

  const playheadLeft = `${((frameIndex + 0.5) / totalFrames) * 100}%`;

  return (
    <section className="strip-dock" aria-label="Sprocket strip" onKeyDown={onStripKeyDown}>
      <div className="strip-inner">
        <div className="strip-body">
          <div
            className="strip-track"
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={lastFrame}
            aria-valuenow={frameIndex}
            aria-valuetext={timecode}
            onKeyDown={onSliderKeyDown}
            onPointerDown={onScrubStart}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
          >
            <div className="sprockets top" aria-hidden="true">
              {Array.from({ length: 48 }, (_, index) => (
                <span key={index} />
              ))}
            </div>
            <div className="strip-frames">
              {tiles.length === 0
                ? Array.from({ length: sampleCount }, (_, index) => <div className="strip-blank" key={index} />)
                : tiles.map((tile, index) => (
                    <img
                      key={tile.frameIndex}
                      src={tile.src}
                      alt=""
                      className={index === selectedTileIndex ? 'selected' : undefined}
                    />
                  ))}
            </div>
            <div className="sprockets bottom" aria-hidden="true">
              {Array.from({ length: 48 }, (_, index) => (
                <span key={index} />
              ))}
            </div>
            <div className="playhead" style={{ left: playheadLeft }} aria-hidden="true" />
          </div>
        </div>
        <div className="strip-aside">
          <img src={preview ?? blankPixel} alt="Frame preview" />
          <div className="strip-readout">
            <div role="timer" aria-label="Timecode">
              {timecode}
            </div>
            <button type="button" onClick={() => void pluck()}>
              Pluck
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
