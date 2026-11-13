import { useState, useSyncExternalStore } from 'react';
import '../styles/editor.css';
import { EditorProvider, useEditorSelector, useEditorStore } from '../editor/EditorProvider';
import { EditorHeaderActions, EditorStatuses, ScenePicker } from '../editor/EditorHeader';
import { LayersPanel } from '../editor/LayersPanel';
import { PreviewBar } from '../editor/PreviewBar';
import { Timeline } from '../editor/Timeline';
import { VariablesCard } from '../editor/VariablesCard';
import { ViewerHint } from '../editor/controls';
import { Inspector } from '../editor/inspector/Inspector';
import { Readouts } from '../editor/inspector/Readouts';
import { useEditorShortcuts } from '../editor/shortcuts';
import { StagePanel } from '../stage/StagePanel';
import { WorkspaceFooter, WorkspaceHeader } from '../ui/Chrome';
import { Missing } from './Missing';

type Layout = 'phone' | 'tablet' | 'desktop';
type PhoneTab = 'layers' | 'stage' | 'inspector' | 'timeline';

const PHONE_TABS: { id: PhoneTab; label: string }[] = [
  { id: 'layers', label: 'Layers' },
  { id: 'stage', label: 'Stage' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'timeline', label: 'Timeline' },
];

const layoutOf = (width: number): Layout => (width < 640 ? 'phone' : width < 1024 ? 'tablet' : 'desktop');

function useLayout(): Layout {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('resize', listener);
      return () => window.removeEventListener('resize', listener);
    },
    () => layoutOf(window.innerWidth),
  );
}

function EditorSkeleton() {
  return (
    <>
      <WorkspaceHeader />
      <div className="editor-skeleton" aria-busy="true">
        <div className="skeleton-tile" />
        <div className="skeleton-tile skeleton-wide" />
        <div className="skeleton-tile" />
      </div>
    </>
  );
}

function EditorScreen() {
  const { actions } = useEditorStore();
  const canEdit = useEditorSelector((e) => e.canEdit);
  const layout = useLayout();
  const [tab, setTab] = useState<PhoneTab>('layers');
  const phone = layout === 'phone';
  useEditorShortcuts();

  const panel = (id: PhoneTab): { hidden: boolean; role?: 'tabpanel'; id?: string; 'aria-labelledby'?: string } =>
    phone ? { hidden: tab !== id, role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}` } : { hidden: false };

  return (
    <div className="editor" data-layout={layout}>
      {!canEdit && <ViewerHint />}
      <WorkspaceHeader showAuth={!phone}>
        <EditorHeaderActions phone={phone} />
      </WorkspaceHeader>
      {phone && (
        <>
          <div className="status-strip">
            <EditorStatuses />
            <ScenePicker />
          </div>
          <div role="tablist" aria-label="Editor panels" className="panel-tabs">
            {PHONE_TABS.map(({ id, label }) => (
              <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className="tab" onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <main className="editor-main">
        <div className="col col-layers" {...panel('layers')}>
          <LayersPanel />
          <VariablesCard />
        </div>
        <div className="col col-stage" {...panel('stage')}>
          <PreviewBar />
          <div className="stage-slot">
            <StagePanel />
          </div>
        </div>
        <div className="col col-inspector" {...panel('inspector')}>
          <div
            className="inspector-wrap"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) actions.releaseLock();
            }}
          >
            <Inspector />
          </div>
          <Readouts />
        </div>
        <div className="col col-timeline" {...panel('timeline')}>
          <Timeline />
        </div>
      </main>
      <WorkspaceFooter />
    </div>
  );
}

export function Editor({ projectId }: { projectId: string }) {
  return (
    <EditorProvider projectId={projectId} loading={<EditorSkeleton />} missing={<Missing />}>
      <EditorScreen />
    </EditorProvider>
  );
}
