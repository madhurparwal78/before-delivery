import { el } from './dom';
import { StageView } from './stage-view';
import { LightField, MotionClock, TiltField, prefersReducedMotion } from './follow-light';
import type { Pointer } from './follow-light';
import { config } from './client-config';
import { evaluate } from '../shared/evaluator';
import type { LoadedAsset } from '../shared/evaluator';
import { ARTBOARDS } from '../shared/types';
import type { Breakpoint, SceneDocument } from '../shared/types';
import { parseGltf } from '../shared/gltf';
import { parseSvgOutline } from '../shared/extrusion';
import { copy, MSG } from '../shared/messages';

function breakpointForWidth(width: number): Breakpoint {
  if (width >= 1024) return 'desktop';
  if (width >= 640) return 'tablet';
  return 'mobile';
}

async function loadAssets(
  projectId: string,
  document_: SceneDocument,
): Promise<{ assets: Record<string, LoadedAsset>; missing: string[] }> {
  const ids = new Set<string>();
  const missing: string[] = [];
  for (const scene of document_.scenes) {
    for (const layer of scene.layers) {
      for (const path of ['assetId', 'svgAssetId', 'modelAssetId']) {
        const value = (layer.props as Record<string, unknown>)[path];
        if (typeof value === 'string' && value) ids.add(value);
      }
    }
  }
  const assets: Record<string, LoadedAsset> = {};
  for (const id of ids) {
    try {
      const response = await fetch(`/api/embed/${projectId}/assets/${id}`);
      if (!response.ok) {
        missing.push(id);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const type = response.headers.get('content-type') ?? '';
      const record = {
        id,
        kind: type.includes('gltf') ? ('model' as const) : type.includes('svg') ? ('svg' as const) : ('image' as const),
        fileName: id,
        bytes: bytes.byteLength,
        sha256: '',
        status: 'confirmed' as const,
        width: null,
        height: null,
        vertices: null,
        clips: [],
      };
      assets[id] = {
        record,
        model:
          record.kind === 'model'
            ? parseGltf(bytes, id, {
                maxBytes: config().modelMaxBytes,
                maxVertices: config().modelMaxVertices,
              }).model
            : null,
        outline:
          record.kind === 'svg' ? parseSvgOutline(new TextDecoder().decode(bytes)).outline : null,
      };
    } catch {
      missing.push(id);
    }
  }
  return { assets, missing };
}

export async function renderEmbed(root: HTMLElement, projectId: string): Promise<void> {
  document.body.classList.add('embed');
  const page = el('div', { class: 'embed-page' });
  const fixed = el('div', { class: 'embed-fixed' });
  page.append(fixed);
  root.append(page);

  const reduced = prefersReducedMotion();
  const stage = new StageView();
  const light = new LightField();
  const clock = new MotionClock();
  const tilts = new Map<string, TiltField>();
  const pointer: Pointer = { x: 0.5, y: 0.5, inside: false };

  let document_: SceneDocument | null = null;
  let version = 0;
  let assets: Record<string, LoadedAsset> = {};
  let missing: string[] = [];
  let startTime = 0;

  const region = el('section', {
    role: 'region',
    'aria-label': 'Loading',
    'data-version': '',
    'data-breakpoint': breakpointForWidth(window.innerWidth),
    'data-frame': '0',
    'data-renderer': stage.renderer,
    'data-scroll-progress': '0',
  });
  const values = el('ul', { class: 'visually-hidden list-reset', 'aria-label': 'Scene values' });
  const placeholders = el('div');
  region.append(stage.element, values, placeholders);
  fixed.append(region);
  stage.element.style.position = 'absolute';
  stage.element.style.inset = '0';

  const load = async (): Promise<void> => {
    const response = await fetch(`/api/embed/${projectId}/scene`);
    if (!response.ok) {
      region.setAttribute('aria-label', MSG.notPublished);
      return;
    }
    version = Number(response.headers.get('X-Halation-Version') ?? '0');
    document_ = (await response.json()) as SceneDocument;
    region.setAttribute('aria-label', `${document_.name}, version ${version}`);
    region.setAttribute('data-version', String(version));
    startTime = performance.now();
    const result = await loadAssets(projectId, document_);
    assets = result.assets;
    missing = result.missing;
    placeholders.textContent = '';
    const scene = document_.scenes[0];
    for (const layer of scene.layers) {
      const props = layer.props as Record<string, unknown>;
      const assetId = [props.assetId, props.modelAssetId].find(
        (value) => typeof value === 'string' && value,
      );
      if (typeof assetId === 'string' && missing.includes(assetId)) {
        placeholders.append(
          el('span', { role: 'img', 'aria-label': copy.storageMissing(layer.name) }),
        );
      }
    }
  };

  await load();

  const scrollProgress = (): number => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, (window.scrollY / max) * 100));
  };

  fixed.addEventListener('pointermove', (event) => {
    const rect = fixed.getBoundingClientRect();
    pointer.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    pointer.y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    pointer.inside = true;
  });
  fixed.addEventListener('pointerleave', () => {
    pointer.inside = false;
  });

  const tick = (now: number): void => {
    if (!document_) {
      window.requestAnimationFrame(tick);
      return;
    }
    const scene = document_.scenes[0];
    const frames = clock.step(now);
    const breakpoint = breakpointForWidth(window.innerWidth);
    const artboard = ARTBOARDS[breakpoint];
    stage.setArtboard(artboard.width, artboard.height);
    light.advanceLevel(now, reduced);
    light.advanceFocus(now, frames, pointer, scene.light.momentum, reduced);
    const frame = reduced ? 0 : Math.max(0, Math.round(((now - startTime) / 1000) * 60));
    const scroll = scrollProgress();
    let tilt = { x: 0, y: 0 };
    for (const layer of scene.layers) {
      if (!layer.events.tilt.enabled) continue;
      let field = tilts.get(layer.id);
      if (!field) {
        field = new TiltField();
        tilts.set(layer.id, field);
      }
      field.advance(now, frames, pointer, layer.events.tilt, reduced);
      tilt = field.current;
    }
    region.setAttribute('data-breakpoint', breakpoint);
    region.setAttribute('data-frame', String(frame));
    region.setAttribute('data-scroll-progress', scroll.toFixed(3));
    const evaluation = evaluate({
      document: document_,
      sceneId: scene.id,
      frame,
      breakpoint,
      scroll,
      reducedMotion: reduced,
      assets,
      particleMax: config().particleMax,
      tilt,
      lightFocus: light.focus,
    });
    values.textContent = '';
    for (const entry of evaluation.layerValues) {
      values.append(
        el('li', {
          'data-layer-name': entry.layerName,
          'data-values': JSON.stringify(entry.values),
        }),
      );
    }
    stage.draw(
      {
        document: document_,
        sceneId: scene.id,
        frame,
        breakpoint,
        scroll,
        reducedMotion: reduced,
        assets,
        particleMax: config().particleMax,
        tilt,
        lightFocus: light.focus,
        imageUrl: (assetId) => `/api/embed/${projectId}/assets/${assetId}`,
      },
      { level: light.level, focus: light.focus },
    );
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);

  const swap = (next: number): void => {
    if (next === version) return;
    void load();
  };

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const connect = (): void => {
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'embed-subscribe', projectId }));
    });
    socket.addEventListener('message', (event) => {
      const parsed = JSON.parse(String(event.data)) as { type?: string; number?: number };
      if (parsed.type === 'version' && typeof parsed.number === 'number') swap(parsed.number);
    });
    socket.addEventListener('close', () => {
      window.setTimeout(connect, 2000);
    });
  };
  connect();

  window.setInterval(() => {
    void fetch(`/api/embed/${projectId}/version`)
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { number: number } | null) => {
        if (result) swap(result.number);
      })
      .catch(() => undefined);
  }, config().embedPollSeconds * 1000);
}
