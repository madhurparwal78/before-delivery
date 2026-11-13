import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VersionSummary } from '../../shared/types.ts';
import { IssuesPanel } from '../review/IssuesPanel.tsx';
import { MarkupsPanel } from '../review/MarkupsPanel.tsx';
import { ReviewDataProvider, useReviewData } from '../review/reviewData.tsx';
import { restoreVersion } from '../review/restoreVersion.ts';
import { useReviewActions } from '../review/useReviewActions.tsx';
import { VersionsPanel } from '../review/VersionsPanel.tsx';
import type { VersionGroup } from '../review/VersionsPanel.tsx';
import { useDrawingSlice, useDrawingStore, useMay, useSceneSlice } from '../store/index.ts';
import type { DocumentInfo, DrawingStore } from '../store/index.ts';
import { Button, Chip, useMediaLayout } from '../ui/index.ts';
import { CanvasPane } from './canvas/index.ts';
import type { IssuePin } from './canvas/index.ts';
import { CommandBar } from './chrome/CommandBar.tsx';
import type { CommandHandlers } from './chrome/CommandBar.tsx';
import { ConnectionChip } from './chrome/ConnectionChip.tsx';
import { FindBar } from './chrome/FindBar.tsx';
import { LayoutsChip } from './chrome/LayoutsChip.tsx';
import { StorageNotice, XrefNotice } from './chrome/Notices.tsx';
import { Pane } from './chrome/Pane.tsx';
import { PeopleList } from './chrome/PeopleList.tsx';
import { ZoomChip } from './chrome/ZoomChip.tsx';
import { CompareBar } from './compare/CompareBar.tsx';
import { useCompare } from './compare/useCompare.ts';
import { ExportDialog } from './dialogs/ExportDialog.tsx';
import { ImportDialog } from './dialogs/ImportDialog.tsx';
import { NewSheetDialog } from './dialogs/NewSheetDialog.tsx';
import { UnderlayDialog } from './dialogs/UnderlayDialog.tsx';
import { editAndSettle } from './editAndSettle.ts';
import { EntitiesPanel } from './entities/EntitiesPanel.tsx';
import { FocusTargetsProvider, useFocusTargetsRegistry } from './focusTargets.tsx';
import { useKeyboardMap } from './keyboard/useKeyboardMap.ts';
import { LayersPanel } from './layers/LayersPanel.tsx';
import { ParametersPanel } from './parameters/ParametersPanel.tsx';
import { PropertiesPanel } from './properties/PropertiesPanel.tsx';
import { useDrawingRegion } from './useDrawingRegion.ts';
import { useFocusRequests } from './useFocusRequests.ts';
import { useStorageActions } from './useStorageActions.ts';
import { PanelRegion } from './workspace/PanelRegion.tsx';
import { PanelsButton } from './workspace/PanelsButton.tsx';
import { PANEL_ORDER, usePanels } from './workspace/usePanels.ts';
import { WorkspaceFrame } from './workspace/WorkspaceFrame.tsx';
import type { PanelContent } from './workspace/WorkspaceFrame.tsx';
import { XrefsPanel } from './xrefs/XrefsPanel.tsx';

type Modal = 'export' | 'import' | 'underlay' | 'sheet';

function commandHandlers(store: DrawingStore): CommandHandlers {
  return {
    enter: (text) => store.commandEnter(text),
    space: (text) => store.commandSpace(text),
    escape: () => store.commandEscape(),
    undoAtReady: () => {
      if (store.getSnapshot().command.active) return false;
      void store.undo();
      return true;
    },
  };
}

function DrawingWorkspace({ info }: { info: DocumentInfo }) {
  const store = useDrawingStore();
  const data = useReviewData();
  const layout = useMediaLayout();
  const panels = usePanels(layout, PANEL_ORDER);
  const targets = useFocusTargetsRegistry();
  const commandRef = useRef<HTMLInputElement>(null);
  const { paneRef, drawingRegion } = useDrawingRegion();

  const sheets = useDrawingSlice((snapshot) => snapshot.sheets);
  const canEdit = useDrawingSlice((snapshot) => snapshot.canEdit);
  const mayPublish = useMay('publish');
  const dimStyles = useDrawingSlice((snapshot) => snapshot.state.dim_styles);
  const exportJob = useDrawingSlice((snapshot) => snapshot.exportJob);
  const commandRunning = useDrawingSlice((snapshot) => snapshot.command.active);
  const activeSheet = useSceneSlice((snapshot) => snapshot.sheet);
  const role = info.role;

  const [modal, setModal] = useState<Modal | null>(null);
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);

  useEffect(() => store.setPhone(layout === 'phone'), [store, layout]);

  // ---- versions: the shown sheet's, or every sheet's on the Model layout
  const groups: VersionGroup[] = (activeSheet ? [activeSheet] : sheets)
    .map((sheet) => ({ sheet, versions: data.versionsOf(sheet.id) }))
    .filter((group) => group.versions.length > 0);
  const allVersions = groups.flatMap((group) => group.versions);
  const targetId = allVersions.find((version) => version.id === pickedVersion)?.id ?? allVersions[allVersions.length - 1]?.id ?? null;
  const compareSheet = activeSheet ?? groups[0]?.sheet ?? null;
  const compare = useCompare(compareSheet?.id ?? null, info.id, compareSheet ? data.versionsOf(compareSheet.id) : [], dimStyles);

  const { loadMarkups } = data;
  useEffect(() => {
    if (targetId) loadMarkups(targetId);
  }, [targetId, loadMarkups]);

  const pins = useMemo<IssuePin[]>(() => data.issues.map((issue) => ({ id: issue.id, x: issue.x, y: issue.y, title: issue.title })), [data.issues]);
  const markups = targetId ? data.markupsOf(targetId) : [];

  const edit = useMemo(
    () => ({
      undo: () => void store.undo(),
      redo: () => void store.redo(),
      erase: () => store.eraseSelection(),
      hasSelection: () => store.getSnapshot().selection.size > 0,
    }),
    [store],
  );
  useFocusRequests({ panels, targets, command: commandRef, drawingRegion });
  useKeyboardMap({ edit, store, panels, command: commandRef, drawingRegion });
  const actions = useReviewActions({ store, panels, drawingRegion, paneRef, versionId: targetId, role, folderId: info.folderId, me: info.username });
  const handlers = useMemo(() => commandHandlers(store), [store]);

  const storage = useStorageActions(store, info.id, activeSheet, exportJob);
  const restore = (version: VersionSummary): Promise<void> => restoreVersion((command, ops) => editAndSettle(store, command, ops), version);

  // ---- panels
  const content: PanelContent = {
    Entities: <EntitiesPanel stopRef={panels.stopRef('Entities')} />,
    Layers: <PanelRegion name="Layers" panels={panels}><LayersPanel /></PanelRegion>,
    Properties: <PanelRegion name="Properties" panels={panels}><PropertiesPanel /></PanelRegion>,
    Parameters: <PanelRegion name="Parameters" panels={panels}><ParametersPanel /></PanelRegion>,
    Xrefs: <PanelRegion name="Xrefs" panels={panels}><XrefsPanel /></PanelRegion>,
    Versions: (
      <PanelRegion name="Versions" panels={panels}>
        <VersionsPanel groups={groups} targetId={targetId} onSelect={setPickedVersion} role={role} onRestore={restore} />
      </PanelRegion>
    ),
    Issues: <PanelRegion name="Issues" panels={panels}><IssuesPanel versionId={null} role={role} onCreateRfi={(issue) => void actions.createRfi(issue)} /></PanelRegion>,
    Markups: <PanelRegion name="Markups" panels={panels}><MarkupsPanel versionId={targetId} role={role} /></PanelRegion>,
  };

  const phone = layout === 'phone';
  const merge = (importId: string, entities: number): Promise<void> => {
    setModal(null);
    return storage.merge(importId, entities);
  };
  const pane = (
    <Pane
      paneRef={paneRef}
      canvas={
        <CanvasPane
          store={store}
          live={store}
          compare={compare.layers}
          pins={pins}
          markups={markups}
          onTap={actions.onTap}
          onLongPress={actions.onLongPress}
          onEntityActivate={compare.showHistory}
          onSwipeChange={compare.setSwipe}
        />
      }
      top={
        <>
          <LayoutsChip onNewSheet={() => setModal('sheet')} />
          <Chip className="chip--group">
            {phone ? null : <PeopleList me={info.username} />}
            {mayPublish && !phone ? <Button primary disabled={activeSheet === null || storage.publishing} onClick={() => void storage.publish()}>Publish sheet</Button> : null}
            <Button onClick={() => compare.setOpen(!compare.open)}>Compare</Button>
            {phone ? null : <Button onClick={() => setModal('export')}>Export</Button>}
            {canEdit && !phone ? <Button onClick={() => setModal('import')}>Import</Button> : null}
            {canEdit && !phone ? <Button onClick={() => setModal('underlay')}>Add underlay</Button> : null}
            <PanelsButton panels={panels} />
          </Chip>
        </>
      }
      middle={
        <>
          <XrefNotice />
          <FindBar />
          {compare.open ? <CompareBar compare={compare} /> : null}
        </>
      }
      bottom={
        <>
          <ConnectionChip />
          <ZoomChip />
        </>
      }
    />
  );

  return (
    <FocusTargetsProvider targets={targets}>
      <WorkspaceFrame
        panels={panels}
        content={content}
        pane={pane}
        footer={
          <div className="footer">
            <StorageNotice />
            <CommandBar inputRef={commandRef} handlers={handlers} running={commandRunning} />
          </div>
        }
      />
      {modal === 'export' ? <ExportDialog job={exportJob} onStart={(format) => void storage.startExport(format)} onRetry={() => void storage.retryExport()} onClose={() => setModal(null)} /> : null}
      {modal === 'import' ? <ImportDialog drawingId={info.id} notify={(text) => store.setStorageNotice(text)} onMerge={merge} onClose={() => setModal(null)} /> : null}
      {modal === 'underlay' ? <UnderlayDialog drawingId={info.id} notify={(text) => store.setStorageNotice(text)} onClose={() => setModal(null)} /> : null}
      {modal === 'sheet' ? <NewSheetDialog drawingId={info.id} onClose={() => setModal(null)} /> : null}
      {actions.overlays}
    </FocusTargetsProvider>
  );
}

/** The Drawing screen for a loaded document: panels, pane, command bar and dialogs around the live store. */
export function DrawingScreen({ info }: { info: DocumentInfo }) {
  const store = useDrawingStore();
  const sheets = useDrawingSlice((snapshot) => snapshot.sheets);
  const sheetIds = useMemo(() => sheets.map((sheet) => sheet.id), [sheets]);
  const subscribe = useCallback((listener: Parameters<DrawingStore['onLive']>[0]) => store.onLive(listener), [store]);
  return (
    <ReviewDataProvider drawingId={info.id} sheetIds={sheetIds} subscribe={subscribe}>
      <DrawingWorkspace info={info} />
    </ReviewDataProvider>
  );
}

