import { useEffect, useState } from 'react';
import { useViewportSize } from '../lib/useMedia';
import { sketchBounds, type View } from '../lib/geometry';
import { useWorkbench } from '../workbench';
import { AssemblyView, PartView, freeRegion } from './BodyViews';
import { BomTable } from './BomTable';
import { DepthSlider } from './Extrude';
import { GridCanvas } from './GridCanvas';
import { SketchCanvas } from './SketchCanvas';
import type { Sketch } from '../../shared/api';

/** Fits the sketch (and the origin) into the part of the viewport the panels leave free. */
function fit(sketch: Sketch, width: number, height: number): View {
  const region = freeRegion(width, height);
  const { min, max } = sketchBounds(sketch);
  const w = Math.max(max.x - min.x, 20);
  const h = Math.max(max.y - min.y, 20);
  const scale = Math.min(40, Math.max(0.5, Math.min((region.width * 0.7) / w, (region.height * 0.6) / h)));
  return {
    scale,
    ox: region.x + region.width / 2 - ((min.x + max.x) / 2) * scale,
    oy: region.y + region.height / 2 + ((min.y + max.y) / 2) * scale,
  };
}

/** The full-bleed vellum canvas: grid at the bottom, and whichever view the open item calls for on top of it. */
export function Stage() {
  const wb = useWorkbench();
  const { width, height } = useViewportSize();
  const { view, sketch, part, assemblyTab } = wb;
  const [camera, setCamera] = useState<View>({ scale: 4, ox: width / 2, oy: height / 2 });
  const sketchId = view?.kind === 'sketch' ? view.id : null;

  useEffect(() => {
    if (sketch && sketchId) setCamera(fit(sketch, window.innerWidth, window.innerHeight));
    else setCamera({ scale: 4, ox: window.innerWidth / 2, oy: window.innerHeight / 2 });
    // The camera is refitted only when another sketch opens, never while the member pans or zooms.
  }, [sketchId]);

  const feature = view?.kind === 'part' && part ? part.features.find((f) => f.id === view.extrudeId) : undefined;
  const sliding = wb.extrude !== null && (view?.kind === 'sketch' || feature !== undefined);

  return (
    <main className="canvas">
      <GridCanvas view={camera} width={width} height={height} />
      {view?.kind === 'sketch' && sketch && part && <SketchCanvas sketch={sketch} camera={camera} setCamera={setCamera} width={width} height={height} />}
      {view?.kind === 'part' && part && <PartView part={part} />}
      {view?.kind === 'assembly' && assemblyTab === 'model' && <AssemblyView />}
      {view?.kind === 'assembly' && assemblyTab === 'bom' && <BomTable />}
      {sliding && <DepthSlider feature={feature} camera={view?.kind === 'sketch' ? camera : undefined} sketch={sketch} />}
    </main>
  );
}
