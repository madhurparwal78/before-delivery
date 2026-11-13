import { useEffect, useMemo, useRef, useState } from 'react';
import { ACCESS_REVOKED, PROMPT_READY, VERSION_STATE_LABEL, roleNow } from '../../shared/copy.ts';
import { viewOnlyRefusal } from '../../shared/rules.ts';
import type { DimStyle, DrawingDocument, Role, VersionDocument, VersionSummary } from '../../shared/types.ts';
import { CommandBar } from '../drawing/chrome/CommandBar.tsx';
import type { CommandHandlers } from '../drawing/chrome/CommandBar.tsx';
import { FindBar } from '../drawing/chrome/FindBar.tsx';
import { Pane } from '../drawing/chrome/Pane.tsx';
import { ZoomChip } from '../drawing/chrome/ZoomChip.tsx';
import { CompareBar } from '../drawing/compare/CompareBar.tsx';
import { useCompare } from '../drawing/compare/useCompare.ts';
import { CanvasPane } from '../drawing/canvas/index.ts';
import type { IssuePin } from '../drawing/canvas/index.ts';
import { EntitiesPanel } from '../drawing/entities/EntitiesPanel.tsx';
import { FocusTargetsProvider, useFocusTargetsRegistry } from '../drawing/focusTargets.tsx';
import { useKeyboardMap } from '../drawing/keyboard/useKeyboardMap.ts';
import { LayerList } from '../drawing/layers/LayersPanel.tsx';
import { useDrawingRegion } from '../drawing/useDrawingRegion.ts';
import { useFocusRequests } from '../drawing/useFocusRequests.ts';
import { PanelRegion } from '../drawing/workspace/PanelRegion.tsx';
import { PanelsButton } from '../drawing/workspace/PanelsButton.tsx';
import { usePanels } from '../drawing/workspace/usePanels.ts';
import type { PanelName } from '../drawing/workspace/usePanels.ts';
import { WorkspaceFrame } from '../drawing/workspace/WorkspaceFrame.tsx';
import type { PanelContent } from '../drawing/workspace/WorkspaceFrame.tsx';
import { ReviewStore, SceneStoreProvider, browserSceneEnv } from '../store/index.ts';
import { Button, Chip, NotAvailable, pushToast, useMediaLayout } from '../ui/index.ts';
import { DrawingFeed } from './liveFeed.ts';
import { IssuesPanel } from './IssuesPanel.tsx';
import { MarkupsPanel } from './MarkupsPanel.tsx';
import { ReviewDataProvider, useReviewData } from './reviewData.tsx';
import { VersionsPanel } from './VersionsPanel.tsx';
import { restoreVersion } from './restoreVersion.ts';
import { useReviewActions } from './useReviewActions.tsx';

const REVIEW_PANELS: readonly PanelName[] = ['Entities', 'Layers', 'Versions', 'Issues', 'Markups'];

function refusingHandlers(store: ReviewStore, phone: boolean): CommandHandlers {
  return {
    enter: () => store.setPrompt(viewOnlyRefusal(phone)),
    space: () => false,
    escape: () => store.setPrompt(PROMPT_READY),
    undoAtReady: () => false,
  };
}

interface ReviewWorkspaceProps {
  store: ReviewStore;
  dimStyles: Readonly<Record<string, DimStyle>>;
  version: VersionDocument;
  drawing: DrawingDocument;
  role: Role;
  feed: DrawingFeed;
  me: string | null;
}

function ReviewWorkspace({ store, dimStyles, version, drawing, role, feed, me }: ReviewWorkspaceProps) {
  const data = useReviewData();
  const layout = useMediaLayout();
  const panels = usePanels(layout, REVIEW_PANELS);
  const targets = useFocusTargetsRegistry();
  const commandRef = useRef<HTMLInputElement>(null);
  const { paneRef, drawingRegion } = useDrawingRegion();
  const sheet = version.snapshot.sheet;
  const compare = useCompare(version.sheet_id, drawing.id, data.versionsOf(version.sheet_id), dimStyles);

  const { loadMarkups } = data;
  useEffect(() => loadMarkups(version.id), [version.id, loadMarkups]);
  const pins = useMemo<IssuePin[]>(
    () => data.issues.filter((issue) => issue.version_id === version.id).map((issue) => ({ id: issue.id, x: issue.x, y: issue.y, title: issue.title })),
    [data.issues, version.id],
  );

  const handlers = useMemo(() => refusingHandlers(store, layout === 'phone'), [store, layout]);
  useFocusRequests({ panels, targets, command: commandRef, drawingRegion });
  useKeyboardMap({ edit: null, store, panels, command: commandRef, drawingRegion });
  const actions = useReviewActions({ store, panels, drawingRegion, paneRef, versionId: version.id, role, folderId: drawing.folder_id, me });

  const restore = (restored: VersionSummary): Promise<void> => restoreVersion(feed.submit, restored);

  const content: PanelContent = {
    Entities: <EntitiesPanel stopRef={panels.stopRef('Entities')} />,
    Layers: <PanelRegion name="Layers" panels={panels}><LayerList edit={null} /></PanelRegion>,
    Versions: (
      <PanelRegion name="Versions" panels={panels}>
        <VersionsPanel groups={[{ sheet, versions: data.versionsOf(version.sheet_id) }]} targetId={version.id} role={role} onRestore={restore} approveIsPrimary />
      </PanelRegion>
    ),
    Issues: <PanelRegion name="Issues" panels={panels}><IssuesPanel versionId={version.id} role={role} onCreateRfi={(issue) => void actions.createRfi(issue)} /></PanelRegion>,
    Markups: <PanelRegion name="Markups" panels={panels}><MarkupsPanel versionId={version.id} role={role} /></PanelRegion>,
  };

  return (
    <FocusTargetsProvider targets={targets}>
      <WorkspaceFrame
        panels={panels}
        content={content}
        pane={
          <Pane
            paneRef={paneRef}
            canvas={
              <CanvasPane
                store={store}
                compare={compare.layers}
                pins={pins}
                markups={data.markupsOf(version.id)}
                onTap={actions.onTap}
                onLongPress={actions.onLongPress}
                onEntityActivate={compare.showHistory}
                onSwipeChange={compare.setSwipe}
              />
            }
            top={
              <>
                <Chip>
                  <span className="chip-title">{`${sheet.name} v${version.number}`}</span>
                  <span className="chip-text">{VERSION_STATE_LABEL[version.state]}</span>
                </Chip>
                <Chip className="chip--group">
                  <Button onClick={() => compare.setOpen(!compare.open)}>Compare</Button>
                  <PanelsButton panels={panels} />
                </Chip>
              </>
            }
            middle={
              <>
                <FindBar />
                {compare.open ? <CompareBar compare={compare} /> : null}
              </>
            }
            bottom={<ZoomChip />}
          />
        }
        footer={<div className="footer"><CommandBar inputRef={commandRef} handlers={handlers} /></div>}
      />
      {actions.overlays}
    </FocusTargetsProvider>
  );
}

/** The Review screen for a loaded version: the version's model read-only with the review panels, kept current by the drawing's live messages. */
export function ReviewScreen({ version, drawing, me }: { version: VersionDocument; drawing: DrawingDocument; me: string }) {
  const [role, setRole] = useState<Role | null>(drawing.role);
  const dimStyles = useMemo<Readonly<Record<string, DimStyle>>>(() => Object.fromEntries(drawing.dim_styles.map((style) => [style.name, style])), [drawing]);
  const store = useMemo(() => new ReviewStore(version.snapshot.model, version.snapshot.sheet, browserSceneEnv(), dimStyles), [version, dimStyles]);
  const feed = useMemo(() => new DrawingFeed(drawing.id, drawing.seq, drawing.revision), [drawing]);
  const sheetIds = useMemo(() => [version.sheet_id], [version.sheet_id]);

  useEffect(() => {
    feed.open();
    const stop = feed.subscribe((message) => {
      if (message.type !== 'role' || message.data.username !== me) return;
      setRole(message.data.role);
      if (message.data.role === null) feed.close();
      else pushToast(roleNow(message.data.role));
    });
    return () => {
      stop();
      feed.close();
    };
  }, [feed, me]);

  if (role === null) return <NotAvailable sentences={[ACCESS_REVOKED]} />;
  return (
    <SceneStoreProvider store={store}>
      <ReviewDataProvider drawingId={drawing.id} sheetIds={sheetIds} subscribe={feed.subscribe}>
        <ReviewWorkspace store={store} dimStyles={dimStyles} version={version} drawing={drawing} role={role} feed={feed} me={me} />
      </ReviewDataProvider>
    </SceneStoreProvider>
  );
}
