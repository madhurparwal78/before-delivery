import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { Icon } from '../icons';
import { openWhenQuiet } from '../stream';
import { compositeHash } from '../../shared/composite';
import { parseColour } from '../../shared/colour';
import { ZOOMS } from '../../shared/rules';
import type { Tag } from '../../shared/timeline';
import { paintPixels } from '../workspace/paint';
import { PreviewPanel } from '../workspace/Preview';

interface SharedSprite {
  name: string;
  width: number;
  height: number;
  seq: number;
  frames: { number: number; duration_ms: number }[];
  tags: Omit<Tag, 'id'>[];
}

const toRgba = (rows: string[][]): Uint8Array => {
  const out = new Uint8Array(rows.length * (rows[0]?.length ?? 0) * 4);
  rows.forEach((row, y) => row.forEach((colour, x) => out.set(parseColour(colour), (y * row.length + x) * 4)));
  return out;
};

/** The read-only view of a link: the stage, its zoom buttons and the preview, and nothing else. */
export function Share({ token }: { token: string }): JSX.Element {
  const [sprite, setSprite] = useState<SharedSprite | null | undefined>(undefined);
  const [ended, setEnded] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [version, setVersion] = useState(0);
  const pixels = useRef(new Map<number, Uint8Array>());
  const canvas = useRef<HTMLCanvasElement>(null);

  /** Fetches the sprite and its frames; `opened` runs as soon as the link is known to be live, before the pixels are fetched. */
  const load = async (opened?: () => void): Promise<void> => {
    const result = await api<{ sprite: SharedSprite }>('GET', `/api/share/${token}`);
    if (!result.ok) return setEnded(true);
    opened?.();
    const next = result.body.sprite;
    await Promise.all(
      next.frames.map(async (frame) => {
        const rows = await api<{ rows: string[][] }>('GET', `/api/share/${token}/frames/${frame.number}/pixels`);
        if (rows.ok) pixels.current.set(frame.number, toRgba(rows.body.rows));
      }),
    );
    setSprite(next);
    setZoom((current) => (current === 0 ? ([8, 4, 2, 1].find((z) => next.width * z <= Math.min(innerWidth - 32, 640) && next.height * z <= 560) ?? 1) : current));
    setVersion((n) => n + 1);
  };

  useEffect(() => {
    let source: EventSource | null = null;
    let gone = false;
    let cancelOpen = (): void => undefined;
    // The stream opens only for a link that answered live, so an unknown link makes no failing request. It
    // opens once the page has settled; on `ready` the sprite is re-read, so a change made meanwhile shows.
    void load(() => {
      if (gone) return;
      cancelOpen = openWhenQuiet(() => {
        if (gone) return;
        const stream = new EventSource(`/api/share/${token}/events`);
        source = stream;
        stream.addEventListener('ready', () => void load());
        stream.addEventListener('stage', () => void load());
        stream.addEventListener('ended', () => {
          setEnded(true);
          stream.close();
        });
        // A link that ended before the stream opened is refused for good: the re-read shows the ended page.
        stream.addEventListener('error', () => {
          if (stream.readyState === EventSource.CLOSED) void load();
        });
      });
    });
    return () => {
      gone = true;
      cancelOpen();
      source?.close();
    };
  }, [token]);

  useLayoutEffect(() => {
    const first = pixels.current.get(1);
    if (!canvas.current || !sprite || !first || zoom === 0) return;
    paintPixels(canvas.current, first, sprite.width, sprite.height, zoom);
    const el = canvas.current;
    el.dataset.frame = '1';
    el.dataset.zoom = String(zoom);
    el.dataset.seq = String(sprite.seq);
    el.dataset.compositeHash = compositeHash(first);
  }, [sprite, zoom, version]);

  if (ended || sprite === null) {
    return (
      <main class="share ended">
        <h1>This link has ended</h1>
        <p>Ask the owner of this sprite for a new link.</p>
      </main>
    );
  }
  if (!sprite) {
    return (
      <main class="share">
        <p class="loading-outline" aria-busy="true">
          Loading sprite
        </p>
      </main>
    );
  }
  const step = (direction: 1 | -1): void => setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]) + direction))] ?? 8);
  return (
    <main class="share">
      <h1>{sprite.name}</h1>
      <div class="stage-box">
        <div class="stage-viewport">
          <div class="stage-frame" style={{ width: `${sprite.width * zoom}px`, height: `${sprite.height * zoom}px` }}>
            <canvas ref={canvas} class="stage" role="application" aria-label="Sprite stage" tabIndex={0} style={{ width: `${sprite.width * zoom}px`, height: `${sprite.height * zoom}px` }} />
          </div>
        </div>
        <div class="zoom-row">
          <button type="button" class="pill icon-only" aria-label="Zoom in" onClick={() => step(1)}>
            <Icon name="plus" />
          </button>
          <button type="button" class="pill icon-only" aria-label="Zoom out" onClick={() => step(-1)}>
            <Icon name="minus" />
          </button>
        </div>
      </div>
      <PreviewPanel
        frameCount={sprite.frames.length}
        durations={sprite.frames.map((f) => f.duration_ms)}
        tags={sprite.tags.map((t, i) => ({ ...t, id: i + 1 }))}
        size={{ width: sprite.width, height: sprite.height }}
        version={version}
        drawFrame={(target, frame) => {
          const rgba = pixels.current.get(frame);
          if (rgba) paintPixels(target, rgba, sprite.width, sprite.height, 1);
        }}
        finished={() => undefined}
      />
    </main>
  );
}
