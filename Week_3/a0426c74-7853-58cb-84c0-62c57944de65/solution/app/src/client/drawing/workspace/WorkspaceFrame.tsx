import { useId } from 'react';
import type { ReactNode } from 'react';
import { Dialog, PanelHeader, Tabs } from '../../ui/index.ts';
import type { PanelName, Panels } from './usePanels.ts';
import '../../styles/drawing/workspace.css';

/** What each panel renders; the grid of Entities is its own stop, every other panel is wrapped in a `region`. */
export type PanelContent = Partial<Record<PanelName, ReactNode>>;

interface WorkspaceFrameProps {
  panels: Panels;
  content: PanelContent;
  /** the drawing pane with its corner chips */
  pane: ReactNode;
  /** `status "Storage notice"` and the command bar, under the pane */
  footer: ReactNode;
}

const LEFT_COLUMN: readonly PanelName[] = ['Entities', 'Layers'];

function DeskPanel({ name, panels, content }: { name: PanelName; panels: Panels; content: PanelContent }) {
  const bodyId = useId();
  const open = panels.isOpen(name);
  return (
    <div className="panel" data-panel={name}>
      <PanelHeader name={name} open={open} onToggle={() => panels.toggle(name)} controls={bodyId} />
      {open ? <div id={bodyId} className="panel-body">{content[name]}</div> : null}
    </div>
  );
}

function TabbedPanel({ panels, content, label }: { panels: Panels; content: PanelContent; label: string }) {
  const id = useId();
  const items = panels.available.map((name) => ({ id: name, label: name, tabId: `${id}-tab-${name}`, panelId: `${id}-panel` }));
  const select = (id: string): void => {
    const next = panels.available.find((name) => name === id);
    if (next) panels.selectTab(next);
  };
  return (
    <>
      <Tabs label={label} items={items} selected={panels.tab} onSelect={select} className="ws-tabs" />
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${panels.tab}`} className="ws-tabpanel">
        {content[panels.tab]}
      </div>
    </>
  );
}

/** The three arrangements of the Drawing and Review screens: desk columns, tablet strip, phone bottom sheet. */
export function WorkspaceFrame({ panels, content, pane, footer }: WorkspaceFrameProps) {
  if (panels.layout === 'desk') {
    const left = panels.available.filter((name) => LEFT_COLUMN.includes(name));
    const right = panels.available.filter((name) => !LEFT_COLUMN.includes(name));
    return (
      <div className="ws ws--desk">
        {left.length > 0 ? (
          <div className="ws-column ws-column--left">{left.map((name) => <DeskPanel key={name} name={name} panels={panels} content={content} />)}</div>
        ) : null}
        <div className="ws-centre">{pane}{footer}</div>
        {right.length > 0 ? (
          <div className="ws-column ws-column--right">{right.map((name) => <DeskPanel key={name} name={name} panels={panels} content={content} />)}</div>
        ) : null}
      </div>
    );
  }
  if (panels.layout === 'tablet') {
    return (
      <div className="ws ws--tablet">
        <div className="ws-centre">{pane}{footer}</div>
        <TabbedPanel panels={panels} content={content} label="Panels" />
      </div>
    );
  }
  return (
    <div className="ws ws--phone">
      <div className="ws-centre">{pane}{footer}</div>
      {panels.sheetOpen ? (
        <Dialog name="Panel" placement="bottom" titleHidden opener={panels.sheetOpener} onClose={panels.closeSheet}>
          <TabbedPanel panels={panels} content={content} label="Panel sections" />
        </Dialog>
      ) : null}
    </div>
  );
}
