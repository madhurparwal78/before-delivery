import { useState } from 'react';
import { CLIP_FORMAT, NO_XREFS, xrefClip, xrefPlacement } from '../../../shared/copy.ts';
import { fmt3 } from '../../../shared/geometry/index.ts';
import type { Xref } from '../../../shared/types.ts';
import { Button, pushToast } from '../../ui/index.ts';
import { useDrawingSlice, useDrawingStore } from '../../store/index.ts';
import { readRect } from './clipRect.ts';

function XrefItem({ xref, sourceName, canEdit }: { xref: Xref; sourceName: string; canEdit: boolean }) {
  const store = useDrawingStore();
  const [clip, setClip] = useState('');
  const applyClip = (): void => {
    const rect = readRect(clip);
    if (rect) store.edit('XCLIP', [{ type: 'xref_clip', name: xref.name, rect }]);
    else pushToast(CLIP_FORMAT);
  };
  return (
    <li role="group" aria-label={xref.name}>
      <p className="line">
        <span className="strong">{xref.name}</span>
        <span className="muted">{xrefPlacement(sourceName, fmt3(xref.x), fmt3(xref.y), fmt3(xref.scale), fmt3(xref.rotation))}</span>
      </p>
      {xref.clip ? <p className="muted">{xrefClip(xref.clip.map(fmt3).join(','))}</p> : null}
      {canEdit ? (
        <>
          <div className="field-row">
            <input className="field" type="text" aria-label="Clip rectangle" autoComplete="off" placeholder="x1,y1,x2,y2" value={clip} onChange={(event) => setClip(event.target.value)} />
            <Button onClick={applyClip}>Clip</Button>
            <Button disabled={xref.clip === null} onClick={() => store.edit('XCLIP', [{ type: 'xref_clip', name: xref.name, rect: null }])}>Remove clip</Button>
          </div>
          <div className="line">
            <Button onClick={() => store.reloadXref(xref.name)}>Reload</Button>
          </div>
        </>
      ) : null}
    </li>
  );
}

/** `region "Xrefs"`: each attached drawing with its placement, clip and reload. */
export function XrefsPanel() {
  const xrefs = useDrawingSlice((snapshot) => snapshot.state.xrefs);
  const drawings = useDrawingSlice((snapshot) => snapshot.folderDrawings);
  const canEdit = useDrawingSlice((snapshot) => snapshot.canEdit);
  const names = Object.keys(xrefs);
  if (names.length === 0) return <p className="empty">{NO_XREFS}</p>;
  return (
    <ul className="list" role="list" aria-label="Xref list">
      {names.map((name) => (
        <XrefItem key={name} xref={xrefs[name]} sourceName={drawings.find((drawing) => drawing.id === xrefs[name].source)?.name ?? ''} canEdit={canEdit} />
      ))}
    </ul>
  );
}
