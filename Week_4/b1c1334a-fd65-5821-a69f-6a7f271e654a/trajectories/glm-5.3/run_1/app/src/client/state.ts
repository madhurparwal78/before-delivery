/** The workspace state and the published copy, shared by the client modules. */
import { TableRead, DocumentRead, TableSummary } from './api.js';

export const COPY_TEXT = {
  emptyDocument: 'This document has no tables yet.',
  emptyTable: 'This table has no rows yet.',
  readOnly: 'You can view this document but not change it.',
  pickerNoMatch: 'No matching rows.',
  cellConflict: (current: string) =>
    current === ''
      ? 'Someone else changed this cell. It now shows blank. Your edit was not saved.'
      : `Someone else changed this cell. It now shows ${current}. Your edit was not saved.`,
  rowConflict: 'Someone else changed this row first. It was not deleted.',
  rowGone: 'This row no longer exists. Your change was not saved.',
  rowsHidden: (n: number) => (n === 1 ? '1 row is no longer shown to you.' : `${n} rows are no longer shown to you.`),
  columnConflict: 'Someone else changed this column first. Your change was not saved.',
  tableConflict: 'Someone else renamed this table first. Your change was not saved.',
  circular: 'This change makes a formula depend on itself. Affected cells show #CIRC!.',
  pasteNoFit: 'The pasted block does not fit here. Nothing was changed.',
  undoConflict: 'This undo no longer applies because the cells changed since. Nothing was changed.',
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  permissionLost: 'You no longer have permission to change this document.',
  connectionLost: 'Could not reach Tallyframe. Your last change was not saved.',
  createdDoc: (name: string) => `Created document ${name}.`,
  createdTable: (name: string) => `Created table ${name}.`,
  createdSummary: (name: string) => `Created summary ${name}.`,
  addedColumn: (name: string) => `Added column ${name}.`,
  copied: (n: number) => (n === 1 ? 'Copied 1 cell.' : `Copied ${n} cells.`),
  deletedRow: (display: string) => `Deleted row ${display}.`,
  restoredRow: (display: string) => `Restored row ${display}.`,
  writing: (name: string) => `Writing ${name}`,
  ready: (name: string) => `${name} is ready.`,
  exportFailed: 'Export failed: the file could not be stored. Your edits are safe. Try again later.',
  downloaded: (name: string) => `${name} downloaded.`,
  downloadNotReady: 'This file is not ready to download yet.',
  downloadUnreachable: 'Download failed: the file store is unreachable. Try again later.',
  downloadRefused: 'This file no longer matches what was exported. Export again.',
  inviteSent: (email: string) => `Invite sent to ${email}.`,
  mailOutage: 'Invite not sent: the mail server is unreachable. The share is saved. Press Resend when mail is back.',
  resendFailing: 'Still not sent: the mail server is unreachable. Try Resend again later.',
  alreadySent: 'This invite was already sent.',
  noRowsPreview: 'Add a row to see a preview.',
  pending: 'Saving changes',
};

export interface WorkspaceState {
  documentId: string;
  document: DocumentRead | null;
  tables: TableSummary[];
  shownTableId: string | null;
  table: TableRead | null;
  tableAccess: { role: string; row_scope: string } | null;
  stacks: { undo_count: number; redo_count: number };
  readOnly: boolean;
  activeRow: number;
  activeCol: number;
  anchor: { row: number; col: number } | null;
  rangeEnd: { row: number; col: number } | null;
  deletedStatus: { display: string; rowId: string; remainingMs: number; column: number } | null;
  exportStatus: Record<string, string>;
  exportProgress: Record<string, boolean>;
  docRevision: number;
  appliedAccess: { role: string; row_scope: string } | null;
  rollPlaying: boolean;
  lastRowCount: number;
  pendingCells: Map<string, { display: string }>;
}

export const state: WorkspaceState = {
  documentId: '',
  document: null,
  tables: [],
  shownTableId: null,
  table: null,
  tableAccess: null,
  stacks: { undo_count: 0, redo_count: 0 },
  readOnly: false,
  activeRow: 0,
  activeCol: 0,
  anchor: null,
  rangeEnd: null,
  deletedStatus: null,
  exportStatus: {},
  exportProgress: {},
  docRevision: 0,
  appliedAccess: null,
  rollPlaying: false,
  lastRowCount: 0,
  pendingCells: new Map(),
};

export const layout = (): 'wide' | 'medium' | 'narrow' => {
  const w = window.innerWidth;
  if (w >= 1280) return 'wide';
  if (w >= 768) return 'medium';
  return 'narrow';
};

export const roleWord = (role: string): string =>
  role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : 'Viewer';

export const rowDisplayOf = (row: { cells: Record<string, { display: string }> }, table: TableRead): string => {
  const first = table.columns[0];
  const display = first ? row.cells[first.id]?.display ?? '' : '';
  return display === '' ? '(blank)' : display;
};
