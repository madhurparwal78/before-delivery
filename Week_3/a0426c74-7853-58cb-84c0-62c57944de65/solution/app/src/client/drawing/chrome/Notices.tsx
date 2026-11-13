import { useDrawingSlice, useDrawingStore } from '../../store/index.ts';
import { xrefNewVersion } from '../../../shared/copy.ts';
import { Button, Notice } from '../../ui/index.ts';

/** `status "Storage notice"`: a surface block above the command bar with the outcome of publish, underlay, import and export. */
export function StorageNotice() {
  const text = useDrawingSlice((snapshot) => snapshot.storageNotice);
  return <Notice role="status" aria-label="Storage notice" className="storage-notice">{text}</Notice>;
}

/** `status "Xref notice"` at the top of the drawing: `<xref> has a new version. Reload?` with its `button "Reload"`. */
export function XrefNotice() {
  const store = useDrawingStore();
  const names = useDrawingSlice((snapshot) => snapshot.xrefNotices);
  const canEdit = useDrawingSlice((snapshot) => snapshot.canEdit);
  return (
    <div className="chip xref-notice" role="status" aria-label="Xref notice" hidden={names.length === 0}>
      {names.map((name) => (
        <p key={name} className="line">
          <span>{xrefNewVersion(name)}</span>
          {canEdit ? <Button onClick={() => store.reloadXref(name)}>Reload</Button> : null}
        </p>
      ))}
    </div>
  );
}
