import { useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { MINIMUM_ROLE, atLeast } from '../../shared/rules.ts';
import type { Issue, Point, Role } from '../../shared/types.ts';
import { getJson } from '../api.ts';
import { toastRefusal } from '../toastRefusal.ts';
import { NewIssueDialog } from '../drawing/dialogs/NewIssueDialog.tsx';
import { NewRfiDialog } from '../drawing/dialogs/NewRfiDialog.tsx';
import { SheetActionsMenu } from '../drawing/dialogs/SheetActionsMenu.tsx';
import type { SheetAction } from '../drawing/dialogs/SheetActionsMenu.tsx';
import type { Panels } from '../drawing/workspace/usePanels.ts';
import type { SceneStore } from '../store/index.ts';
import { useReviewData } from './reviewData.tsx';

interface ReviewActionsInput {
  store: SceneStore;
  panels: Panels;
  /** the element of `region "Drawing"`, which gets focus back from the dialogs and the menu */
  drawingRegion: () => HTMLElement | null;
  /** the pane, to turn a pane point into a window point */
  paneRef: RefObject<HTMLElement | null>;
  /** the version a new issue is pinned to; null when there is none */
  versionId: string | null;
  role: Role;
  folderId: string;
  /** the signed-in username: the asker of an RFI */
  me: string | null;
}

interface ReviewActions {
  onTap: (world: Point) => void;
  onLongPress: (world: Point, screen: Point) => void;
  /** Create RFI: asks who can be addressed, then opens `dialog "New RFI"` */
  createRfi: (issue: Issue) => Promise<void>;
  /** `dialog "New issue"`, `menu "Sheet actions"` and `dialog "New RFI"` while they are open */
  overlays: ReactNode;
}

/** The phone review gestures and the dialogs they and the Issues panel open: tap and Pin issue here, the long-press menu, Create RFI. */
export function useReviewActions({ store, panels, drawingRegion, paneRef, versionId, role, folderId, me }: ReviewActionsInput): ReviewActions {
  const data = useReviewData();
  const opener = useRef<HTMLElement | null>(null);
  const [newIssueAt, setNewIssueAt] = useState<Point | null>(null);
  const [menu, setMenu] = useState<{ world: Point; client: { x: number; y: number } } | null>(null);
  const [rfi, setRfi] = useState<{ issue: Issue; addressees: readonly string[] } | null>(null);

  function onTap(world: Point): void {
    if (versionId === null || !atLeast(role, MINIMUM_ROLE.raiseIssue)) return;
    opener.current = drawingRegion();
    setNewIssueAt(world);
  }

  function onLongPress(world: Point, screen: Point): void {
    const box = paneRef.current?.getBoundingClientRect();
    opener.current = drawingRegion();
    setMenu({ world, client: { x: (box?.left ?? 0) + screen[0], y: (box?.top ?? 0) + screen[1] } });
  }

  function choose(action: SheetAction): void {
    const chosen = menu;
    setMenu(null);
    if (!chosen) return;
    if (action === 'Pin issue here') setNewIssueAt(chosen.world);
    else if (action === 'Measure from here') store.startMeasure(chosen.world);
    else panels.openSheet('Versions');
  }

  async function createRfi(issue: Issue): Promise<void> {
    await toastRefusal(async () => {
      const { roles } = await getJson<{ roles: { username: string }[] }>(`/api/folders/${folderId}/roles`);
      setRfi({ issue, addressees: roles.map((entry) => entry.username).filter((name) => name !== me) });
    });
  }

  const overlays = (
    <>
      {newIssueAt && versionId ? (
        <NewIssueDialog versionId={versionId} at={newIssueAt} opener={opener} onCreated={data.addIssue} onClose={() => setNewIssueAt(null)} />
      ) : null}
      {menu ? <SheetActionsMenu at={menu.client} opener={opener} onChoose={choose} onClose={() => setMenu(null)} /> : null}
      {rfi ? <NewRfiDialog issueId={rfi.issue.id} addressees={rfi.addressees} onCreated={data.addRfi} onClose={() => setRfi(null)} /> : null}
    </>
  );

  return { onTap, onLongPress, createRfi, overlays };
}
