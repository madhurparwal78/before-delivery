import { useCallback, useState } from 'react';
import { gridOf } from '../../shared/grid.js';
import { BreakpointTabs } from '../components/BreakpointTabs.js';
import { Canvas, useSelection } from '../components/Canvas.js';
import { CodePane } from '../components/CodePane.js';
import { PreviewFrame, WidthSlider } from '../components/Preview.js';
import { BASE_TAB_WIDTH, usePreviewWidth } from '../lib/scope.js';
import type { Scope } from '../../shared/types.js';
import { useWorkspace } from '../lib/workspace.js';
import { NotAvailable } from './NotAvailable.js';
import { LiveStatus, LoadingSkeleton, PaneTabs, StatusBar, type Pane } from './Shell.js';

export function ViewPage({ token }: { token: string }) {
  const workspace = useWorkspace({ mode: 'view', token });
  if (workspace.load === 'unavailable') return <NotAvailable signedIn={false} />;
  if (workspace.load === 'loading' || !workspace.layout) return <LoadingSkeleton />;
  return <Viewer workspace={workspace} />;
}

function Viewer({ workspace }: { workspace: ReturnType<typeof useWorkspace> }) {
  const layout = workspace.layout!;
  const preview = usePreviewWidth(layout.breakpoints, workspace.announce);
  const grid = gridOf(layout, preview.scope)!;
  const { selection, set } = useSelection(grid.rows.length, grid.columns.length);
  const [resolved, setResolved] = useState<number[]>([]);
  const [pane, setPane] = useState<Pane>('grid');
  const onResolved = useCallback((columns: number[]) => setResolved((current) => (current.join() === columns.join() ? current : columns)), []);
  const selectScope = (scope: Scope): void => preview.moveTo(scope === 'base' ? BASE_TAB_WIDTH : scope);

  return (
    <div className="editor viewer">
      <header className="topbar">
        <h1>{layout.name}</h1>
        <span className="note">Read-only view</span>
      </header>
      <LiveStatus live={layout.live} />
      <PaneTabs label="View panes" pane={pane} panes={['grid', 'preview', 'code']} onSelect={setPane} />
      <main className="panes">
        <div className="pane canvas" data-pane="grid" data-active={pane === 'grid'}>
          <BreakpointTabs breakpoints={layout.breakpoints} scope={preview.scope} onSelect={selectScope} />
          <Canvas grid={grid} scope={preview.scope} resolved={resolved} selection={selection} onSelect={set} />
        </div>
        <div className="pane side" data-pane="side" data-active={pane === 'preview' || pane === 'code'}>
          <div className="subpane" data-active={pane === 'preview'}>
            <WidthSlider width={preview.width} breakpoints={layout.breakpoints} onMove={preview.moveTo} />
            <PreviewFrame css={layout.css} html={layout.html} width={preview.width} onResolved={onResolved} />
          </div>
          <div className="subpane" data-active={pane === 'code'}>
            <CodePane css={layout.css} html={layout.html} />
          </div>
        </div>
      </main>
      <StatusBar announcement={workspace.announcement} />
    </div>
  );
}
