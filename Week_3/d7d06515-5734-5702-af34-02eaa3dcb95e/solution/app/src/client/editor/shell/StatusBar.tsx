// The status bar: drafting aids (hidden on phones, where the Tools sheet holds them), coordinates, zoom and space.
import { formatLength } from '../../../shared/format.ts';
import { toModel, zoomPercent } from '../canvas/camera.ts';
import { useObservable } from '../observable.ts';
import { useEditorState, useEditorStore } from '../store.ts';
import { DraftingAids } from './DraftingAids.tsx';

function Coordinates() {
  const store = useEditorStore();
  const { layout, drawing } = useEditorState();
  const hud = useObservable(store.hud);
  const camera = useObservable(layout === 'Model' ? store.camera : store.paperCamera);
  const model = hud.pointer ? toModel(camera, hud.pointer.x, hud.pointer.y) : hud.readout;
  const units = drawing?.units ?? 'mm';
  return (
    <span role="status" aria-label="Coordinates" aria-live="off" className="status-item">
      <span className="status-label">X</span> {model ? formatLength(model[0], units) : '—'}
      <span className="status-label status-gap">Y</span> {model ? formatLength(model[1], units) : '—'}
    </span>
  );
}

function Zoom() {
  const store = useEditorStore();
  const { layout } = useEditorState();
  const camera = useObservable(layout === 'Model' ? store.camera : store.paperCamera);
  return (
    <span role="status" aria-label="Zoom" aria-live="off" className="status-item"><span className="status-label">Zoom</span> {zoomPercent(camera)}%</span>
  );
}

export function StatusBar({ phone }: { phone: boolean }) {
  const { layout } = useEditorState();
  return (
    <div className="status-bar">
      {!phone && <DraftingAids />}
      <div className="status-readouts">
        <Coordinates />
        <Zoom />
        <span role="status" aria-label="Space" className="status-item"><span className="status-label">Space</span> {layout === 'Model' ? 'MODEL' : 'PAPER'}</span>
      </div>
    </div>
  );
}
