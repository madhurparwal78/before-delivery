import { formatNumber } from './format.ts';

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error';

export type SyncView = {
  syncing: boolean;
  online: boolean;
  serviceAvailable: boolean;
  waiting: number;
};

function itemCount(items: number): string {
  return items === 1 ? '1 item' : `${items} items`;
}

/** Always one row applies; the first match wins. */
export function syncStatus(view: SyncView): { state: SyncState; sentence: string } {
  const count = itemCount(view.waiting);
  if (view.syncing && !view.online) return { state: 'offline', sentence: `You are offline. ${count} waiting to sync.` };
  if (!view.syncing && !view.online) {
    return { state: 'offline', sentence: 'You are offline. This workspace is only on this device.' };
  }
  if (view.syncing && view.online && !view.serviceAvailable) {
    return { state: 'error', sentence: `Sync is unavailable. ${count} waiting to sync.` };
  }
  if (!view.syncing && !view.serviceAvailable) {
    return { state: 'error', sentence: 'Sync is unavailable. This workspace is only on this device.' };
  }
  if (!view.syncing) return { state: 'offline', sentence: 'This workspace is only on this device.' };
  if (view.waiting > 0) return { state: 'syncing', sentence: `Syncing ${count}.` };
  return { state: 'synced', sentence: 'All changes are synced.' };
}

export const DOCUMENT_STATE = {
  local: 'On this device',
  waiting: 'Waiting to sync',
  synced: 'Synced',
} as const;

export type DocumentStateName = keyof typeof DOCUMENT_STATE;

export const announce = {
  saved: 'Saved on this device.',
  indented: 'Indented.',
  outdented: 'Outdented.',
  blockMoved: (position: number) => `Moved block to position ${position}.`,
  canvasView: (cards: number) => `Canvas view. ${cards} cards.`,
  pageView: (blocks: number) => `Page view. ${blocks} blocks.`,
  cardMoved: (label: string, x: number, y: number) => `Moved ${label} to ${x}, ${y}.`,
  connected: 'Connected.',
  connectionRemoved: 'Connection removed.',
  documentCount: (shown: number, total: number) => `Showing ${shown} of ${total} documents.`,
  filterSaved: (name: string) => `Saved filter "${name}".`,
  rowCount: (shown: number, total: number) => `Showing ${shown} of ${total} rows.`,
  boardCardMoved: (rowTitle: string, option: string) => `Moved ${rowTitle} to ${option}.`,
  movedToTrash: (title: string) => `Moved "${title}" to trash.`,
  restored: (title: string) => `Restored "${title}".`,
  deletedForever: (title: string) => `Deleted "${title}" forever.`,
  attachmentWaiting: (name: string) => `${name} is waiting on this device.`,
  attachmentStored: (name: string) => `Stored ${name}.`,
  attachmentRefused: (name: string) => `Refused ${name}.`,
  signedIn: (email: string) => `Signed in as ${email}.`,
  signedOut: 'Signed out. This workspace stays on this device.',
  uploadFinished: 'Workspace uploaded.',
  keepChoice: 'Keeping this workspace on this device.',
  bothKeptResolved: 'Kept one version.',
  linkCreated: 'Link created.',
  linkRegenerated: 'New link created. The old link no longer works.',
  linkRevoked: 'Link revoked.',
  linkCopied: 'Link copied.',
  deviceRemoved: (name: string) => `Removed ${name}.`,
};

export const attachmentText = {
  waiting: 'Waiting. This file is only on this device.',
  stored: 'Stored.',
  refusedTooLarge: 'Refused. This file is larger than 5,000,000 bytes.',
  refusedAccountFull: 'Refused. Your account storage is full.',
};

export function rowWord(rows: number): string {
  return rows === 1 ? '1 row' : `${rows} rows`;
}

export function columnTotalLine(columnName: string, total: number): string {
  return `${columnName} total: ${formatNumber(total)}`;
}

export const notices = {
  storageUnavailable: 'Attachment storage is unavailable. Waiting files stay on this device.',
  deletedElsewhere: (title: string) =>
    `"${title}" was deleted forever on another device, so your changes to it were not kept.`,
  deviceRemoved: 'This device was removed from your account. Your work here stays on this device.',
};

export const bothKept = {
  block: 'Both kept. Two devices changed this block. Pick the one to keep.',
  cell: 'Both kept. Two devices changed this cell. Pick the one to keep.',
  marker: 'Both kept',
};

export const empty = {
  noDocuments: 'No documents yet.',
  noDocumentMatch: 'No documents match.',
  trashEmpty: 'Trash is empty.',
  noSlashMatch: 'No blocks match.',
  noRowMatch: 'No rows match.',
  noSelectColumn: 'Add a single select column to use the board.',
  documentNotFound: 'We could not find that document.',
  pageNotFound: 'We could not find that page.',
  backToDocuments: 'Back to documents',
  shareSignedOut: 'Sign in to share this document.',
  shareNotSynced: 'Sync this document before sharing it.',
  sharedFooter: 'Shared from Oddment. Read only.',
  deadLink: 'This link no longer works.',
  deleteDialogBody: (title: string) => `Delete "${title}" forever? This cannot be undone.`,
  uploadDialogBody: (documents: number) =>
    `This device holds ${documents} documents. Nothing leaves this device until you choose.`,
};

export const pending = {
  signingIn: 'Signing in...',
  creatingAccount: 'Creating account...',
  creatingLink: 'Creating link...',
  removing: 'Removing...',
};

export const signInCopy = {
  unreachable: 'We could not reach the server. Nothing has changed on this device.',
};

export const filterFields = {
  emptyName: 'Enter a filter name.',
  nameInUse: 'That filter name is already used.',
};

export const recordFields = {
  notANumber: 'Enter a number.',
  notADate: 'Enter a date as YYYY-MM-DD.',
  emptyColumnName: 'Enter a column name.',
  columnNameInUse: 'That column name is already used.',
  noOptions: 'Enter at least one option.',
};

export const csvCopy = {
  summary: (imported: number, skipped: number) => `Imported ${imported} rows. Skipped ${skipped} rows.`,
  badNumber: (row: number, column: string) => `Row ${row}: ${column} must be a number.`,
  badDate: (row: number, column: string) => `Row ${row}: ${column} must be a date as YYYY-MM-DD.`,
  badOption: (row: number, column: string) => `Row ${row}: ${column} must be one of the listed options.`,
  badCheckbox: (row: number, column: string) => `Row ${row}: ${column} must be true or false.`,
  wrongColumns: (names: string[]) => `The first row must match this table's columns: ${names.join(', ')}.`,
  tooLarge: 'That CSV is larger than 1,000,000 bytes.',
};

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulleted: 'Bulleted list',
  numbered: 'Numbered list',
  todo: 'To-do',
  quote: 'Quote',
  divider: 'Divider',
  image: 'Image',
  file: 'File',
  table: 'Record table',
  note: 'Note',
};

export const INSERT_OPTIONS = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulleted',
  'numbered',
  'todo',
  'quote',
  'divider',
  'image',
  'file',
  'table',
] as const;
