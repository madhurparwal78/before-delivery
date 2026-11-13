// Phone bottom sheets: Tools (Ribbon and Drafting aids) and Panels (Editor panels and the active panel).
import { PanelsTopLeft, Wrench } from 'lucide-react';
import { Dialog } from '../../ui/Dialog.tsx';
import { useEditorState, useEditorStore } from '../store.ts';
import { DraftingAids } from './DraftingAids.tsx';
import { PanelHost } from './PanelHost.tsx';
import { Ribbon } from './Ribbon.tsx';

export function PhoneBar() {
  const store = useEditorStore();
  return (
    <div className="phone-bar">
      <button type="button" className="btn btn-outline btn-touch" onClick={() => store.setSheet('tools')}>
        <Wrench size={18} strokeWidth={1.5} aria-hidden="true" /><span>Tools</span>
      </button>
      <button type="button" className="btn btn-outline btn-touch" onClick={() => store.setSheet('panels')}>
        <PanelsTopLeft size={18} strokeWidth={1.5} aria-hidden="true" /><span>Panels</span>
      </button>
    </div>
  );
}

export function Sheets() {
  const store = useEditorStore();
  const { sheet } = useEditorState();
  const close = (): void => store.setSheet(null);
  if (sheet === 'tools') {
    return (
      <Dialog label="Tools" variant="sheet" onClose={close} className="sheet">
        <Ribbon />
        <DraftingAids />
      </Dialog>
    );
  }
  if (sheet === 'panels') {
    return (
      <Dialog label="Panels" variant="sheet" onClose={close} className="sheet">
        <PanelHost sheet />
      </Dialog>
    );
  }
  return null;
}
