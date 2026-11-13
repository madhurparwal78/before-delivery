import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './styles/stage.css';
import './styles/embed.css';
import { contextOf, resolveScenery, valuesOf } from '../shared/evaluator';
import { pointerOf } from '../shared/evaluator/follow';
import { MESSAGES } from '../shared/messages';
import { WS_PATH, type ServerMessage } from '../shared/protocol';
import { ARTBOARDS, DESKTOP_MIN_WIDTH, TABLET_MIN_WIDTH, type Breakpoint, type SceneDocument } from '../shared/types';
import { api, ApiError, publicSettings } from './api';
import { AssetLoader } from './stage/assets';
import { StageDynamics } from './stage/dynamics';
import { placeholders, type Placeholder, type RendererKind } from './stage/engine';
import { useDeviceReducedMotion } from './stage/motion';
import { SceneSurface, type SurfaceHandle } from './stage/SceneSurface';
import { useDescribedAssets } from './stage/useAssets';
import type { SceneState } from './stage/display';

const projectId = window.location.pathname.split('/').filter(Boolean)[1] ?? '';

const breakpointFor = (width: number): Breakpoint => (width >= DESKTOP_MIN_WIDTH ? 'desktop' : width >= TABLET_MIN_WIDTH ? 'tablet' : 'mobile');

interface Published {
  document: SceneDocument;
  version: number;
}

async function fetchPublished(): Promise<Published | null> {
  const response = await fetch(`/api/embed/${projectId}/scene`, { credentials: 'same-origin' });
  if (!response.ok) return null;
  const version = Number(response.headers.get('X-Halation-Version'));
  return { document: (await response.json()) as SceneDocument, version };
}

/** Follows the project's live version: over the live channel, with polling as the fallback. */
function useLiveVersion(): { published: Published | null; loading: boolean } {
  const [published, setPublished] = useState<Published | null>(null);
  const [loading, setLoading] = useState(true);
  const current = useRef<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await fetchPublished();
      current.current = next?.version ?? null;
      setPublished(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    let socket: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    const open = (): void => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${window.location.host}${WS_PATH}`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'embed', projectId }));
      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'version' && message.number !== current.current) void load();
      };
      socket.onclose = () => {
        if (!closed) retry = window.setTimeout(open, 1000);
      };
    };
    open();
    const poll = window.setInterval(() => {
      void api
        .get<{ number: number }>(`/api/embed/${projectId}/version`)
        .then(({ number }) => {
          if (number !== current.current) return load();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404 && current.current !== null) void load();
        });
    }, publicSettings().embedPollSeconds * 1000);
    return () => {
      closed = true;
      window.clearTimeout(retry);
      window.clearInterval(poll);
      socket?.close();
    };
  }, [load]);

  return { published, loading };
}

function EmbedStage({ published }: { published: Published }) {
  const { document: doc, version } = published;
  const scene = doc.scenes[0];
  const reduced = useDeviceReducedMotion();
  const loader = useMemo(() => new AssetLoader((id) => `/api/embed/${projectId}/assets/${id}`), []);
  const assets = useDescribedAssets(doc, loader);
  const webgl = true;
  const [kind, setKind] = useState<RendererKind | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [frame, setFrame] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [notes, setNotes] = useState<Placeholder[]>([]);
  const surface = useRef<SurfaceHandle>(null);
  const region = useRef<HTMLElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const dynamics = useRef(new StageDynamics());
  const dirty = useRef(true);
  const loaderVersion = useRef(-1);
  const start = useRef<number | null>(null);
  const breakpoint = breakpointFor(viewport.width);
  const artboard = ARTBOARDS[breakpoint];
  const ratio = artboard.width / artboard.height;
  const width = Math.floor(Math.min(viewport.width, viewport.height * ratio));
  const height = Math.floor(width / ratio);

  useLayoutEffect(() => {
    const resize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const onScroll = (): void => {
      const span = document.documentElement.scrollHeight - window.innerHeight;
      setScroll(span > 0 ? Math.min(100, Math.max(0, (window.scrollY / span) * 100)) : 0);
    };
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const latest = useRef({ doc, scene, assets, breakpoint, scroll, reduced });
  latest.current = { doc, scene, assets, breakpoint, scroll, reduced };
  useEffect(() => {
    dirty.current = true;
  }, [doc, assets, breakpoint, scroll, reduced, width, height, frame]);

  useEffect(() => {
    let raf = 0;
    const loop = (now: number): void => {
      start.current ??= now;
      const l = latest.current;
      const clock = l.reduced ? 0 : Math.floor(((now - start.current) * 60) / 1000);
      setFrame((previous) => (previous === clock ? previous : clock));
      const handle = surface.current;
      if (handle && l.scene) {
        const step = dynamics.current.step(now, {
          prepared: handle.prepared,
          assets: l.assets,
          breakpoint: l.breakpoint,
          lightEnabled: l.scene.light.enabled,
          lightMomentum: l.scene.light.momentum,
          reduced: l.reduced,
          active: true,
        });
        if (step.moved || dirty.current || loaderVersion.current !== loader.version) {
          dirty.current = false;
          loaderVersion.current = loader.version;
          const state: SceneState = {
            document: l.doc,
            scene: l.scene,
            assets: l.assets,
            breakpoint: l.breakpoint,
            frame: clock,
            scroll: l.scroll,
            reducedMotion: l.reduced,
            dynamics: step.dynamics,
            particleMax: publicSettings().particleMax,
            lightFocus: step.snapshot.focus,
          };
          handle.draw(state);
          const prepared = handle.prepared;
          if (prepared) setNotes((current) => {
            const next = placeholders(prepared, loader);
            return JSON.stringify(next) === JSON.stringify(current) ? current : next;
          });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [loader]);

  const values = useMemo(() => {
    if (!scene) return [];
    const scenery = resolveScenery(scene, contextOf({ frame, breakpoint, scroll, reducedMotion: reduced }, doc.variables));
    return scenery.layers.map((layer) => ({ name: layer.layer.name, id: layer.layer.id, values: valuesOf(layer) }));
  }, [scene, doc.variables, frame, breakpoint, scroll, reduced]);

  const point = (event: ReactPointerEvent): { n: number; m: number } | null => {
    const rect = board.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? pointerOf(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height) : null;
  };
  const release = (): void => dynamics.current.follow.release(performance.now());

  if (!scene) return null;
  const scale = width / artboard.width;
  return (
    <section
      ref={region}
      className="embed-stage"
      role="region"
      aria-label={`${doc.name}, version ${version}`}
      data-version={version}
      data-breakpoint={breakpoint}
      data-frame={frame}
      data-renderer={kind ?? undefined}
      data-scroll-progress={scroll.toFixed(2)}
      style={{ background: scene.background }}
      onPointerMove={(event) => {
        const at = point(event);
        if (at) dynamics.current.follow.setPointer(at.n, at.m);
      }}
      onPointerDown={(event) => {
        const at = event.pointerType === 'touch' ? point(event) : null;
        if (at) dynamics.current.follow.setPointer(at.n, at.m);
      }}
      onPointerUp={(event) => event.pointerType === 'touch' && release()}
      onPointerCancel={release}
      onPointerLeave={(event) => event.pointerType !== 'touch' && release()}
    >
      <div ref={board} className="embed-board" style={{ width, height }}>
        <SceneSurface ref={surface} webgl={webgl} loader={loader} onKind={setKind} />
        {notes.map((note) => (
          <span
            key={note.name}
            className="embed-placeholder"
            role="img"
            aria-label={`${note.name} (storage unavailable)`}
            style={{
              left: note.rect.left * scale,
              top: note.rect.top * scale,
              width: Math.max((note.rect.right - note.rect.left) * scale, 24),
              height: Math.max((note.rect.bottom - note.rect.top) * scale, 24),
            }}
          />
        ))}
      </div>
      <ul className="sr-only" aria-label="Scene values">
        {values.map((layer) => (
          <li key={layer.id} data-layer-name={layer.name} data-values={JSON.stringify(layer.values)}>
            {layer.name}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Embed() {
  const { published, loading } = useLiveVersion();
  if (loading) return null;
  if (!published) return <main className="embed-missing">{MESSAGES.notPublished}</main>;
  return (
    <div className="embed-page">
      <EmbedStage published={published} />
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Embed />);
