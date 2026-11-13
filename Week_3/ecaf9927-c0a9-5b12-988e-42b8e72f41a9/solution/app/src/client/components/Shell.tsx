import { useEffect } from 'react';
import { Overlay, useOverlayClose } from '../lib/overlay';
import { SHEETS_QUERY, useMedia } from '../lib/useMedia';
import { useWorkbench, type Tool } from '../workbench';
import { Banners, ModelMessage } from './Banners';
import { CommandStrip } from './CommandStrip';
import { Dialogs } from './Dialogs';
import { FeatureTree } from './FeatureTree';
import { PropertiesContent, useConstrainSelection } from './Properties';
import { Stage } from './Stage';

const TOOL_KEYS: Record<string, Tool> = { l: 'line', o: 'circle', a: 'arc', k: 'point' };
const CONSTRAINT_KEYS = { c: 'coincident', h: 'horizontal', v: 'vertical', p: 'parallel', r: 'perpendicular', e: 'equal', f: 'fix', d: 'dimension' } as const;

function BrandCorner() {
  const { member, signOut } = useWorkbench();
  return (
    <header className="brand panel">
      <h1 className="wordmark">Kerfline Bench</h1>
      <div className="brand-member">
        <span className="member-name">{member?.name}</span>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </header>
  );
}

function AssemblyTabs() {
  const { view, assemblyTab, setAssemblyTab } = useWorkbench();
  if (view?.kind !== 'assembly') return null;
  const tab = (id: 'model' | 'bom', label: string) => (
    <button type="button" role="tab" aria-selected={assemblyTab === id} className={assemblyTab === id ? 'on' : undefined} onClick={() => setAssemblyTab(id)}>
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label="Assembly view" className="tabs panel">
      {tab('model', 'Model')}
      {tab('bom', 'Bill of materials')}
    </div>
  );
}

/** Sketch shortcuts work wherever focus is in the sketch workspace, except in text fields and open dialogs. */
function useSketchShortcuts() {
  const wb = useWorkbench();
  const { apply } = useConstrainSelection();
  const sketching = wb.view?.kind === 'sketch';
  useEffect(() => {
    if (!sketching) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : document.body;
      if (target.closest('input, textarea, select, [role="spinbutton"], [contenteditable="true"], [role="dialog"], [role="slider"]')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === 'Escape') {
        if (wb.selection.length > 0) wb.select([]);
        else wb.setTool('select');
        return;
      }
      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        void wb.deleteSelection();
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool) {
        event.preventDefault();
        wb.setTool(tool);
      } else if (key === 'x' && wb.member?.role === 'founder') {
        event.preventDefault();
        wb.openExtrude();
      } else if (key in CONSTRAINT_KEYS) {
        event.preventDefault();
        void apply(CONSTRAINT_KEYS[key as keyof typeof CONSTRAINT_KEYS]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
}

export function Shell() {
  const wb = useWorkbench();
  const sheets = useMedia(SHEETS_QUERY);
  useSketchShortcuts();
  const bom = wb.view?.kind === 'assembly' && wb.assemblyTab === 'bom';
  const panels = !sheets && !bom;
  return (
    <div className="shell">
      <Stage />
      <BrandCorner />
      <AssemblyTabs />
      {panels && (
        <nav aria-label="Workspace" className="panel tree-panel">
          <FeatureTree />
        </nav>
      )}
      {panels && (
        <aside aria-label="Properties" className="panel props-panel">
          <PropertiesContent />
        </aside>
      )}
      <Banners />
      <ModelMessage />
      <CommandStrip />
      <Dialogs />
      {sheets && wb.sheet === 'tree' && (
        <Overlay label="Feature tree" variant="sheet" onClose={() => wb.setSheet(null)}>
          <SheetHeader title="Feature tree" />
          <FeatureTree />
        </Overlay>
      )}
      {sheets && wb.sheet === 'properties' && (
        <Overlay label="Properties" variant="sheet" onClose={() => wb.setSheet(null)}>
          <SheetHeader title="Properties" />
          <PropertiesContent />
        </Overlay>
      )}
    </div>
  );
}


function SheetHeader({ title }: { title: string }) {
  const close = useOverlayClose();
  return (
    <div className="sheet-header">
      <h2 className="panel-title">{title}</h2>
      <button type="button" onClick={close}>
        Close
      </button>
    </div>
  );
}
