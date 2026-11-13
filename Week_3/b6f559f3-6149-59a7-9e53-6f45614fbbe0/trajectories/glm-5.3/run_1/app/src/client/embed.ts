// The embed: the published scene fills the viewport, the stage stays fixed,
// and scrolling drives scroll progress. The live channel swaps versions.
import { el } from './dom';
import type { SceneBundle } from '../domain/types';
import { artboardForViewportWidth } from '../domain/props';
import { makeEvalContext, evaluateScene } from '../domain/evaluate';
import { meshesFor, createStage, type StageHandle } from './stage';
import type { ModelInfo } from '../domain/evaluate';

interface EmbedState {
  version: number;
  bundle: SceneBundle | null;
  frame: number;
  scroll: number;
  reducedMotion: boolean;
  breakpoint: 'desktop' | 'tablet' | 'mobile';
  stage: StageHandle | null;
  modelInfo: Map<string, ModelInfo>;
}

export async function runEmbed(projectId: string): Promise<void> {
  const root = document.getElementById('app')!;
  const region = el('section', {
    role: 'region',
    'aria-label': 'Scene',
    class: 'embed-stage',
  });
  const valuesList = el('ul', { class: 'scene-values', 'aria-label': 'Scene values' });
  root.append(region, valuesList);

  const state: EmbedState = {
    version: 0,
    bundle: null,
    frame: 0,
    scroll: 0,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    breakpoint: 'desktop',
    stage: null,
    modelInfo: new Map(),
  };

  const loadBundle = async (): Promise<void> => {
    const res = await fetch(`/api/embed/${projectId}/scene`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const source = res.headers.get('x-scene-source') ?? 'bundle';
    void source;
    state.version = Number(res.headers.get('x-halation-version') ?? 0);
    state.bundle = (await res.json()) as SceneBundle;
    region.dataset.version = String(state.version);
    region.dataset.renderer = state.stage?.renderer ?? 'webgl2';
    if (state.stage) {
      state.stage.dispose();
    }
    state.stage = createStage(region);
    region.setAttribute('aria-label', `Scene, version ${state.version}`);
  };

  await loadBundle();

  const sceneEl = (): SceneBundle['scenes'][number] | null => {
    const first = state.bundle?.scenes[0];
    return first ?? null;
  };

  const tick = (): void => {
    const scene = sceneEl();
    if (scene && state.stage && state.bundle) {
      state.breakpoint = artboardForViewportWidth(window.innerWidth);
      region.dataset.breakpoint = state.breakpoint;
      // The clock runs from frame 0 when the page loads, unless reduced.
      if (!state.reducedMotion) {
        const doc = scene;
        state.frame = (state.frame + 1) % Math.max(1, Math.round((doc.durationMs / 1000) * 60));
      } else {
        state.frame = 0;
      }
      region.dataset.frame = String(state.frame);
      const ctx = makeEvalContext({
        frame: state.frame,
        breakpoint: state.breakpoint,
        scroll: state.scroll,
        reducedMotion: state.reducedMotion,
        pointer: null,
        pointerFrames: 0,
        hoverLayerIds: new Set(),
        hoverFrames: 0,
        limits: { particleMax: 2000 },
        modelInfo: state.modelInfo,
        svgInfo: new Map(),
      });
      state.stage.render({
        bundle: state.bundle,
        scene,
        ctx,
        variables: state.bundle.variables,
        meshes: meshesFor(scene, state.bundle, state.modelInfo),
      });
      region.dataset.scrollProgress = String(state.scroll);
      // The hidden scene-values list carries each layer's resolved values.
      valuesList.textContent = '';
      const resolved = evaluateScene(scene, ctx, state.bundle.variables);
      for (const layer of resolved.layers) {
        const li = el('li', { 'data-layer-name': layer.layer.name });
        const values: Record<string, number | string> = {};
        for (const [path, value] of Object.entries(flatten(layer.props))) {
          values[path] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : String(value);
        }
        li.dataset.values = JSON.stringify(values);
        valuesList.append(li);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const onScroll = (): void => {
    const total = document.body.scrollHeight - window.innerHeight;
    state.scroll = total > 0 ? (window.scrollY / total) * 100 : 0;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // The live channel: new versions arrive within 2 s.
  let ws: WebSocket | null = null;
  const connect = (): void => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.addEventListener('open', () => {
      ws?.send(JSON.stringify({ type: 'subscribe', projectId, kind: 'embed' }));
    });
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type: string; number?: number };
        if (msg.type === 'version' && msg.number && msg.number !== state.version) {
          void loadBundle();
        }
      } catch {
        // ignore
      }
    });
    ws.addEventListener('close', () => {
      setTimeout(connect, 2000);
    });
  };
  connect();

  // Polling fallback.
  setInterval(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    const res = await fetch(`/api/embed/${projectId}/version`);
    if (!res.ok) return;
    const data = (await res.json()) as { number: number };
    if (data.number !== state.version) void loadBundle();
  }, 30000);
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, path));
    } else {
      out[path] = v;
    }
  }
  return out;
}
