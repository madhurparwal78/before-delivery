import { invalidValue } from '../../../shared/copy.ts';
import { titleBlockFields } from '../../../shared/geometry/index.ts';
import type { Sheet, Viewport } from '../../../shared/types.ts';
import { sendJson } from '../../api.ts';
import { toastRefusal } from '../../toastRefusal.ts';
import { Button, pushToast } from '../../ui/index.ts';
import { CommitField } from '../controls/CommitField.tsx';

/** The first viewport of a new layout: a 200 by 100 mm window at 1:50 on the world origin. */
const NEW_VIEWPORT = { x: 10, y: 10, width: 200, height: 100, scale: '1:50', view_x: 0, view_y: 0, frozen_layers: [] } as const;

function ViewportFields({ viewport, canEdit }: { viewport: Viewport; canEdit: boolean }) {
  const path = `/api/viewports/${viewport.id}`;
  const setNumber = (label: string, field: 'view_x' | 'view_y', text: string): void => {
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value)) pushToast(invalidValue(label));
    else void toastRefusal(() => sendJson('PATCH', path, { [field]: value }));
  };
  if (!canEdit) {
    return <p className="prop"><span className="label">Viewport</span> <span>{`${viewport.scale}, view ${viewport.view_x},${viewport.view_y}`}</span></p>;
  }
  return (
    <div role="group" aria-label={`Viewport ${viewport.scale}`}>
      <CommitField label="Viewport scale" value={viewport.scale} onCommit={(scale) => void toastRefusal(() => sendJson('PATCH', path, { scale }))} />
      <CommitField label="View centre X" value={String(viewport.view_x)} onCommit={(text) => setNumber('View centre X', 'view_x', text)} />
      <CommitField label="View centre Y" value={String(viewport.view_y)} onCommit={(text) => setNumber('View centre Y', 'view_y', text)} />
    </div>
  );
}

/** The title block of the shown sheet (the filled-in tags are text, the others fields) and its viewports. A change is not applied here: the page learns of it from the live `version` message, a refusal is a toast. */
export function SheetProperties({ sheet, canEdit }: { sheet: Sheet; canEdit: boolean }) {
  return (
    <>
      {titleBlockFields(sheet).map((field) =>
        field.editable && canEdit ? (
          <CommitField key={field.tag} label={field.tag} value={field.value} onCommit={(value) => void toastRefusal(() => sendJson('PATCH', `/api/sheets/${sheet.id}`, { attributes: { [field.tag]: value } }))} />
        ) : (
          <p key={field.tag} className="prop"><span className="label">{field.tag}</span> <span>{field.value}</span></p>
        ),
      )}
      {sheet.viewports.map((viewport) => <ViewportFields key={viewport.id} viewport={viewport} canEdit={canEdit} />)}
      {canEdit ? <Button onClick={() => void toastRefusal(() => sendJson('POST', `/api/sheets/${sheet.id}/viewports`, NEW_VIEWPORT))}>Add viewport</Button> : null}
    </>
  );
}
