// The drawing canvas: role "application", Canvas 2D for the base drawing, overlays above it, and the view controls.
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { drawingExtents, visibleLayerNames } from '../../../shared/geometry.ts';
import { LoadingStrokes } from '../../ui/LoadingStrokes.tsx';
import { useObservable } from '../observable.ts';
import { pendingOf } from '../commandLine/machine.ts';
import { useEditorState, useEditorStore } from '../store.ts';
import { WHEEL_STEP } from './camera.ts';
import { paintGround, paintPaper, paintScene, type Projection } from './draw.ts';
import { useCanvasInput } from './input.ts';
import { Overlay, projectionOf } from './Overlay.tsx';
import { buildScene } from './scene.ts';
import { ViewControls } from './ViewControls.tsx';

const MAX_DPR = 2;

export function Canvas() {
  const store = useEditorStore();
  const state = useEditorState();
  const { drawing, layout, selection, aids, activeTrace, playback, machine, openError } = state;
  const paper = layout !== 'Model';
  const camera = useObservable(paper ? store.paperCamera : store.camera);
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLCanvasElement>(null);

  const scene = useMemo(() => {
    if (!drawing) return null;
    const visible = visibleLayerNames(drawing.layers);
    const own = drawing.objects.filter((object) => visible.has(object.layer)).map((object) => ({ object, faded: false }));
    const xrefs = drawing.xrefs.filter((xref) => xref.status === 'loaded').flatMap((xref) => xref.objects.map((object) => ({ object, faded: true })));
    return buildScene([...own, ...xrefs], drawing.layers, drawing.units);
  }, [drawing]);

  const extents = useMemo(() => (drawing ? drawingExtents(drawing.objects, drawing.layers) : null), [drawing]);
  const halo = useMemo(() => new Set([...selection, ...pendingOf(machine)]), [selection, machine]);
  const tracing = (activeTrace ?? playback) !== null;

  useCanvasInput(host, store);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = (): void => {
      const box = element.getBoundingClientRect();
      store.camera.setSize(box.width, box.height);
      store.paperCamera.setSize(box.width, box.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [store]);

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element || camera.width === 0 || camera.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.round(camera.width * dpr);
    const height = Math.round(camera.height * dpr);
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p: Projection = projectionOf(camera);
    if (paper && drawing && scene) {
      const scale = drawing.layouts.find((item) => item.name === layout)?.viewport_scale;
      paintPaper(ctx, p, camera.width, camera.height, { scene, title: drawing.name.replace(/\.dxf$/i, ''), scale, plotStyle: drawing.plot_style, extents });
    } else {
      paintGround(ctx, p, camera.width, camera.height, aids.grid);
      if (scene) paintScene(ctx, scene, p, camera.width, camera.height, { dim: tracing, halo });
    }
  }, [camera, scene, paper, layout, drawing, extents, halo, aids.grid, tracing]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const zoomIn = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
    const zoomOut = event.key === '-' || event.code === 'NumpadSubtract';
    if (!zoomIn && !zoomOut) return;
    event.preventDefault();
    (paper ? store.paperCamera : store.camera).zoomBy(zoomIn ? WHEEL_STEP : 1 / WHEEL_STEP);
  };

  return (
    <div className={tracing ? 'canvas-frame is-trace' : 'canvas-frame'}>
      <div ref={host} role="application" aria-label="Drawing canvas" tabIndex={0} className="canvas-host" onKeyDown={onKeyDown}>
        <canvas ref={surface} aria-hidden="true" />
      </div>
      {!paper && <Overlay />}
      {!paper && (
        <svg className="ucs-glyph" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
          <path d="M10 46V12M10 46H44" />
          <path d="M6 17 10 11 14 17M39 42 45 46 39 50" />
          <text x="16" y="16">Y</text>
          <text x="46" y="38">X</text>
        </svg>
      )}
      <ViewControls />
      {!drawing && !openError && <div className="canvas-loading"><LoadingStrokes /></div>}
    </div>
  );
}
