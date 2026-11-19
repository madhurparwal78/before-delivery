import { useCallback, useEffect, useRef, useState } from 'react';
import { gapIn, gridOf, sameRect } from '../../shared/grid.js';
import { versionSaved } from '../../shared/messages.js';
import { checkGap } from '../../shared/rules.js';
import { stepSize } from '../../shared/sizes.js';
import type { Axis, Rect, Scope, ShareInfo } from '../../shared/types.js';
import { Canvas, rectOfSelection, useSelection, type TrackActions } from '../components/Canvas.js';
import { CodePane } from '../components/CodePane.js';
import { FormDialog } from '../components/Dialogs.js';
import { NoticeArea } from '../components/NoticeArea.js';
import { PreviewFrame, WidthSlider } from '../components/Preview.js';
import { Rail } from '../components/Rail.js';
import { ShareDialog } from '../components/ShareDialog.js';
import { VersionsDrawer } from '../components/VersionsDrawer.js';
import { Link } from '../lib/router.js';
import { BASE_TAB_WIDTH, usePreviewWidth } from '../lib/scope.js';
import { request } from '../lib/api.js';
import type { ErrorBody } from '../lib/api.js';
import { saveText, useWorkspace, type Outcome } from '../lib/workspace.js';
import { LiveStatus, LoadingSkeleton, PaneTabs, StatusBar, type Pane } from './Shell.js';
import { NotAvailable } from './NotAvailable.js';

type Dialogue = { type: 'name'; rect: Rect; scope: Scope; initial: string } | { type: 'breakpoint' } | { type: 'version' } | { type: 'versions' } | { type: 'share'; share: ShareInfo } | null;

const typingInto = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !['range', 'radio', 'checkbox', 'button'].includes(target.type)) || (target instanceof HTMLElement && target.isContentEditable);

export function EditorPage({ id }: { id: string }) {
  const workspace = useWorkspace({ mode: 'edit', id });
  if (workspace.load === 'unavailable') return <NotAvailable signedIn />;
  if (workspace.load === 'loading' || !workspace.layout) return <LoadingSkeleton />;
  return <Editor workspace={workspace} />;
}

function Editor({ workspace }: { workspace: ReturnType<typeof useWorkspace> }) {
  const layout = workspace.layout!;
  const { submit, announce, call, setEditProblem } = workspace;
  const preview = usePreviewWidth(layout.breakpoints, announce);
  const grid = gridOf(layout, preview.scope)!;
  const { selection, set } = useSelection(grid.rows.length, grid.columns.length);
  const [resolved, setResolved] = useState<number[]>([]);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [pane, setPane] = useState<Pane>('grid');
  const scopeRef = useRef<Scope>(preview.scope);
  scopeRef.current = preview.scope;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const onResolved = useCallback((columns: number[]) => setResolved((current) => (current.join() === columns.join() ? current : columns)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
      if (typingInto(event.target) || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      void submit(() => ({ kind: event.shiftKey ? 'redo' : 'undo' }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit]);

  const tracks: TrackActions = {
    setSize: (axis, index, size) => submit(() => ({ kind: 'set_track', scope: scopeRef.current, axis, index, size })),
    step: (axis, index, direction) =>
      void submit((current) => {
        const scope = scopeRef.current;
        const list = axis === 'column' ? gridOf(current, scope)?.columns : gridOf(current, scope)?.rows;
        const next = list && list[index - 1] ? stepSize(list[index - 1], direction) : null;
        return next ? { kind: 'set_track', scope, axis, index, size: next } : null;
      }),
    remove: (axis, index) => void submit(() => ({ kind: 'remove_track', scope: scopeRef.current, axis, index })),
  };

  const addTrack = (axis: Axis, after: number): void => void submit(() => ({ kind: 'add_track', scope: scopeRef.current, axis, after }));

  const onTrackKey = (key: 'c' | 'C' | 'r' | 'R'): void => {
    const { cursor } = selectionRef.current;
    if (key === 'c') addTrack('column', cursor.column);
    else if (key === 'r') addTrack('row', cursor.row);
    else tracks.remove(key === 'C' ? 'column' : 'row', key === 'C' ? cursor.column : cursor.row);
  };

  const openName = (): void => {
    const rect = rectOfSelection(selectionRef.current);
    const exact = grid.areas.find((area) => sameRect(area, rect));
    setDialogue({ type: 'name', rect, scope: scopeRef.current, initial: exact ? exact.name : '' });
  };

  const setGap = async (axis: 'row' | 'column', text: string): Promise<Outcome> => {
    const value = text.trim() === '' ? Number.NaN : Number(text);
    const message = checkGap(value);
    if (message) {
      setEditProblem(message);
      return { ok: false, message };
    }
    return submit((current) => {
      const scope = scopeRef.current;
      const before = gapIn(current, scope).gap;
      return value === before[axis] ? null : { kind: 'set_gap', scope, row: axis === 'row' ? value : before.row, column: axis === 'column' ? value : before.column };
    });
  };

  const openShare = async (): Promise<void> => {
    const result = await call(() => request<ShareInfo>('GET', `/api/layouts/${layout.id}/share`));
    if (result?.status === 200) setDialogue({ type: 'share', share: result.body });
  };

  const selectScope = (scope: Scope): void => preview.moveTo(scope === 'base' ? BASE_TAB_WIDTH : scope);

  const gap = gapIn(layout, preview.scope);
  const rail = (
    <Rail
      breakpoints={layout.breakpoints}
      scope={preview.scope}
      gap={gap.gap}
      inheritedFrom={gap.source === preview.scope ? null : gap.source}
      designers={workspace.designers}
      onSelect={selectScope}
      onAddBreakpoint={() => setDialogue({ type: 'breakpoint' })}
      onRemoveBreakpoint={() => void submit(() => ({ kind: 'remove_breakpoint', min_width: scopeRef.current as number }))}
      onGap={setGap}
      onAddTrack={(axis) => addTrack(axis, axis === 'column' ? selectionRef.current.cursor.column : selectionRef.current.cursor.row)}
    />
  );

  return (
    <div className="editor">
      <header className="topbar">
        <Link to="/" className="back">
          Your layouts
        </Link>
        <h1>{layout.name}</h1>
        <div role="status" aria-label="Save state" className="save-state mono">
          {saveText(workspace.saveState)}
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => setDialogue({ type: 'version' })}>
            Save version
          </button>
          <button type="button" onClick={() => setDialogue({ type: 'versions' })}>
            Versions
          </button>
          {layout.role === 'owner' && (
            <button type="button" onClick={() => void openShare()}>
              Share
            </button>
          )}
        </div>
      </header>
      <NoticeArea notice={workspace.notice} />
      <LiveStatus live={layout.live} />
      <PaneTabs pane={pane} onSelect={setPane} panes={['grid', 'tracks', 'preview', 'code']} />
      <main className="panes">
        <div className="pane rail" data-pane="tracks" data-active={pane === 'tracks'}>
          {rail}
        </div>
        <div className="pane canvas" data-pane="grid" data-active={pane === 'grid'}>
          <Canvas
            grid={grid}
            scope={preview.scope}
            resolved={resolved}
            selection={selection}
            onSelect={set}
            editing={{
              tracks,
              onName: openName,
              onClear: () => void submit(() => ({ kind: 'clear_cells', scope: scopeRef.current, ...rectOfSelection(selectionRef.current) })),
              onTrackKey,
            }}
          />
        </div>
        <div className="pane side" data-pane="side" data-active={pane === 'preview' || pane === 'code'}>
          <div className="subpane" data-active={pane === 'preview'}>
            <WidthSlider width={preview.width} breakpoints={layout.breakpoints} onMove={preview.moveTo} />
            <PreviewFrame css={layout.css} html={layout.html} width={preview.width} onResolved={onResolved} />
          </div>
          <div className="subpane" data-active={pane === 'code'}>
            <CodePane css={layout.css} html={layout.html} onApply={(css) => submit(() => ({ kind: 'apply_css', css }))} />
          </div>
        </div>
      </main>
      <StatusBar announcement={workspace.announcement} problem={workspace.editProblem} />

      {dialogue?.type === 'name' && (
        <FormDialog
          label="Name area"
          field="Area name"
          initial={dialogue.initial}
          submit="Save area"
          mono
          returnFocus={() => document.querySelector<HTMLElement>('[role=gridcell][data-cursor]')}
          onClose={() => setDialogue(null)}
          onSubmit={(name) => submit(() => ({ kind: 'set_area', scope: dialogue.scope, name, ...dialogue.rect }), true)}
        />
      )}
      {dialogue?.type === 'breakpoint' && (
        <FormDialog
          label="Add breakpoint"
          field="Minimum width"
          initial=""
          submit="Add"
          mono
          inputMode="numeric"
          onClose={() => setDialogue(null)}
          onSubmit={(width) => submit(() => ({ kind: 'add_breakpoint', min_width: width.trim() === '' ? Number.NaN : Number(width) }), true)}
        />
      )}
      {dialogue?.type === 'version' && (
        <FormDialog
          label="Save version"
          field="Version name"
          initial=""
          submit="Save"
          onClose={() => setDialogue(null)}
          onSubmit={async (name): Promise<Outcome> => {
            const result = await call(() => request<{ number: number } | ErrorBody>('POST', `/api/layouts/${layout.id}/versions`, { name }));
            if (!result) return { ok: false, message: '' };
            if (result.status !== 201) return { ok: false, message: (result.body as ErrorBody).message ?? '' };
            announce(versionSaved((result.body as { number: number }).number));
            return { ok: true };
          }}
        />
      )}
      {dialogue?.type === 'versions' && (
        <VersionsDrawer
          layoutId={layout.id}
          revision={layout.revision}
          call={call}
          onClose={() => setDialogue(null)}
          onRestore={(number) => submit(() => ({ kind: 'restore_version', number }), true)}
        />
      )}
      {dialogue?.type === 'share' && <ShareDialog layoutId={layout.id} initial={dialogue.share} announce={announce} call={call} onClose={() => setDialogue(null)} />}
    </div>
  );
}
