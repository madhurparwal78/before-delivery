import type { AlignSide, DistributeAxis } from '../../shared/geometry.js';
import type { Port, ShapeKind } from '../../shared/document.js';

export type InspectorField = 'x' | 'y' | 'w' | 'h';

/** Every command the workspace screens can run. */
export interface Actions {
  render(): void;
  say(message: string): void;

  openPage(pageId: string): void;
  addPage(): void;
  renamePage(pageId: string, name: string): void;
  reorderPage(pageId: string, direction: 'up' | 'down'): void;
  deletePage(pageId: string): void;
  nextPage(step: 1 | -1): void;

  addLayer(): void;
  renameLayer(layerId: string, name: string): void;
  reorderLayer(layerId: string, direction: 'up' | 'down'): void;
  setLayerFlag(layerId: string, flag: 'visible' | 'locked', value: boolean): void;
  moveSelectionToLayer(layerId: string): void;

  insertShape(kind: ShapeKind): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  reorderSelection(direction: 'forward' | 'backward'): void;
  groupSelection(): void;
  ungroupSelection(): void;
  align(side: AlignSide): void;
  distribute(axis: DistributeAxis): void;
  nudge(dx: number, dy: number): void;
  commitInspector(field: InspectorField, value: number): void;
  commitLabel(shapeId: string, label: string): void;

  select(ids: readonly string[]): void;
  toggleSelected(id: string): void;
  clearSelection(): void;
  focusShape(id: string | null): void;
  selectAll(): void;

  startConnect(): void;
  moveConnectHighlight(step: 1 | -1): void;
  setConnectPort(port: Port): void;
  commitConnect(): void;
  cancelConnect(): void;

  undo(): void;
  redo(): void;

  toggleSnap(): void;
  zoomStep(step: 1 | -1): void;
  resetZoom(): void;
  toggleInspector(): void;
  toggleLeftRail(force?: boolean): void;
  openSheet(sheet: 'layers' | 'inspector' | 'comments' | 'history' | null, opener?: HTMLElement): void;
  setInspectorTab(tab: 'inspector' | 'comments' | 'history'): void;
  toggleOutline(force?: boolean, opener?: HTMLElement): void;

  openShare(opener?: HTMLElement): void;
  openExport(opener?: HTMLElement): void;
  openSaveVersion(opener?: HTMLElement): void;
  openDeletePage(pageId: string, opener?: HTMLElement): void;
  openShapeActions(anchor: { x: number; y: number }, opener?: HTMLElement): void;
  openAlignMenu(opener: HTMLElement): void;
  openInsertMenu(opener: HTMLElement): void;

  commentOnShape(shapeId: string): void;
  postComment(shapeId: string, text: string, parent: string | null): void;
  resolveThread(commentId: string): void;
  openPin(commentId: string): void;

  previewVersion(versionId: string): void;
  backToLatest(): void;
  restoreVersion(versionId: string): void;
  saveVersion(name: string | null): void;

  requestExport(settings: {
    page: string;
    format: 'png' | 'svg';
    scale: 1 | 2;
    background: 'white' | 'transparent';
  }): void;
  retryExport(exportId: string): void;

  invite(email: string, role: 'editor' | 'viewer'): void;
  resendInvite(inviteId: string): void;
  removeInvite(inviteId: string): void;
  setMemberRole(userId: string, role: 'editor' | 'viewer'): void;
  removeMember(userId: string): void;

  signInAgain(password: string, onError: (message: string) => void): void;
}
