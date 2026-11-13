// tablist "Editor panels" and the active panel. Docked beside the canvas on desktop, over its left edge on tablets, in a sheet on phones.
import { Activity, Blocks, Layers, Link, ListChecks, PencilLine, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { useMediaQuery } from '../../ui/useMediaQuery.ts';
import { ActivityPanel } from '../panels/ActivityPanel.tsx';
import { BlocksPanel } from '../panels/BlocksPanel.tsx';
import { IssuesPanel } from '../panels/IssuesPanel.tsx';
import { LayersPanel } from '../panels/LayersPanel.tsx';
import { PropertiesPanel } from '../panels/PropertiesPanel.tsx';
import { TracesPanel } from '../panels/TracesPanel.tsx';
import { XrefsPanel } from '../panels/XrefsPanel.tsx';
import { DESKTOP_QUERY, PANELS, useEditorState, useEditorStore, type PanelId } from '../store.ts';

const ICONS: Record<PanelId, LucideIcon> = {
  properties: SlidersHorizontal, layers: Layers, blocks: Blocks, xrefs: Link, traces: PencilLine, activity: Activity, issues: ListChecks,
};

function ActivePanel({ panel }: { panel: PanelId }) {
  switch (panel) {
    case 'properties': return <PropertiesPanel />;
    case 'layers': return <LayersPanel />;
    case 'blocks': return <BlocksPanel />;
    case 'xrefs': return <XrefsPanel />;
    case 'traces': return <TracesPanel />;
    case 'activity': return <ActivityPanel />;
    case 'issues': return <IssuesPanel />;
  }
}

export function PanelHost({ sheet = false }: { sheet?: boolean }) {
  const store = useEditorStore();
  const { activePanel } = useEditorState();
  const docked = useMediaQuery(DESKTOP_QUERY);
  const tabs = useRef(new Map<PanelId, HTMLButtonElement>());

  const choose = (panel: PanelId): void => {
    // On tablets the second click on the active tab closes the panel again.
    store.setActivePanel(!docked && !sheet && activePanel === panel ? null : panel);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const ids = PANELS.map((item) => item.id);
    const index = activePanel ? ids.indexOf(activePanel) : 0;
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const next = forward ? (index + 1) % ids.length : back ? (index + ids.length - 1) % ids.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1;
    const panel = ids[next];
    if (!panel) return;
    event.preventDefault();
    store.setActivePanel(panel);
    tabs.current.get(panel)?.focus();
  };

  return (
    <div className={sheet ? 'panel-host panel-host-sheet' : 'panel-host'}>
      <div role="tablist" aria-label="Editor panels" aria-orientation={sheet ? 'horizontal' : 'vertical'} className="panel-tabs" onKeyDown={onKeyDown}>
        {PANELS.map(({ id, name, label }) => {
          const Icon = ICONS[id];
          const selected = activePanel === id;
          return (
            <button
              key={id}
              ref={(element) => { if (element) tabs.current.set(id, element); else tabs.current.delete(id); }}
              type="button"
              role="tab"
              id={`panel-tab-${id}`}
              aria-label={name}
              aria-selected={selected}
              aria-controls="editor-panel"
              tabIndex={selected || (!activePanel && id === 'properties') ? 0 : -1}
              className="panel-tab"
              onClick={() => choose(id)}
            >
              <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
              {/* The short label is drawn by CSS: the tab's name is its full aria-label, and an abbreviation such as
                  "Prop." in the DOM reads to axe as visible text missing from that name. */}
              <span aria-hidden="true" className="panel-tab-label" data-label={label} />
            </button>
          );
        })}
      </div>
      {activePanel && (
        <div role="tabpanel" id="editor-panel" aria-labelledby={`panel-tab-${activePanel}`} className="panel-content">
          <ActivePanel panel={activePanel} />
        </div>
      )}
    </div>
  );
}
