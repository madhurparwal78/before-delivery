/** Published copy. Every string renders and is announced character for character. */

export const copy = {
  signInHeading: 'Sign in to Tallyframe',
  signInFailure: 'Email or password is incorrect.',

  emptyDocument: 'This document has no tables yet.',
  emptyTable: 'This table has no rows yet.',
  readOnlyNotice: 'You can view this document but not change it.',
  pickerNoMatch: 'No matching rows.',

  documentCreated: (name: string) => `Created document ${name}.`,
  tableCreated: (name: string) => `Created table ${name}.`,
  columnAdded: (name: string) => `Added column ${name}.`,
  summaryCreated: (name: string) => `Created summary ${name}.`,
  cellsCopied: (n: number) => (n === 1 ? 'Copied 1 cell.' : `Copied ${n} cells.`),
  rowDeleted: (display: string) => `Deleted row ${display}.`,
  rowRestored: (display: string) => `Restored row ${display}.`,

  saving: 'Saving changes',
  cellConflict: (current: string) =>
    `Someone else changed this cell. It now shows ${current}. Your edit was not saved.`,
  rowConflict: 'Someone else changed this row first. It was not deleted.',
  rowGone: 'This row no longer exists. Your change was not saved.',
  rowsHidden: (n: number) =>
    n === 1 ? '1 row is no longer shown to you.' : `${n} rows are no longer shown to you.`,
  columnConflict: 'Someone else changed this column first. Your change was not saved.',
  tableConflict: 'Someone else renamed this table first. Your change was not saved.',
  circularResult: 'This change makes a formula depend on itself. Affected cells show #CIRC!.',
  pasteNoFit: 'The pasted block does not fit here. Nothing was changed.',
  undoConflict: 'This undo no longer applies because the cells changed since. Nothing was changed.',
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  permissionLost: 'You no longer have permission to change this document.',
  connectionFailure: 'Could not reach Tallyframe. Your last change was not saved.',

  tooltipDivZero: '#DIV/0! Division by zero.',
  tooltipType: '#TYPE! A value has the wrong type for this operation.',
  tooltipName: '#NAME? This formula uses a name that does not exist.',
  tooltipRef: '#REF! This formula points at a row that was deleted.',
  tooltipCirc: '#CIRC! This formula depends on itself.',

  previewResult: (display: string) => `Result: ${display}`,
  formulaUnreadable: (n: number) => `Check the formula: it could not be read at character ${n}.`,
  formulaEndedEarly: 'Check the formula: it ended too early.',
  formulaTooLong: 'Check the formula: use at most 2,000 characters.',
  previewNoRows: 'Add a row to see a preview.',

  inviteSent: (email: string) => `Invite sent to ${email}.`,
  mailOutage:
    'Invite not sent: the mail server is unreachable. The share is saved. Press Resend when mail is back.',
  resendStillFailing: 'Still not sent: the mail server is unreachable. Try Resend again later.',
  inviteAlreadySent: 'This invite was already sent.',

  exportWriting: (fileName: string) => `Writing ${fileName}`,
  exportReady: (fileName: string) => `${fileName} is ready.`,
  exportFailed: 'Export failed: the file could not be stored. Your edits are safe. Try again later.',
  exportDownloaded: (fileName: string) => `${fileName} downloaded.`,
  downloadNotReady: 'This file is not ready to download yet.',
  downloadStoreUnreachable: 'Download failed: the file store is unreachable. Try again later.',
  downloadRefused: 'This file no longer matches what was exported. Export again.',

  recalcSentence: (count: number, tables: number) =>
    `Recalculated ${count} ${count === 1 ? 'cell' : 'cells'} in ${tables} ${
      tables === 1 ? 'table' : 'tables'
    }.`,
} as const;

export const fieldMessages = {
  documentName: 'Use 1 to 80 characters without line breaks or control characters.',
  tableName: 'Use 1 to 40 letters, digits or underscores, starting with a letter.',
  tableNameTaken: 'A table with this name already exists.',
  summaryRename: 'Summary names follow their source table and columns.',
  columnName: 'Use 1 to 60 characters without square brackets.',
  columnNameTaken: 'A column with this name already exists.',
  columnTypeFixed: "This column's type cannot be changed.",
  cellRevision: "Send the cell's revision.",
  rowRevision: "Send the row's revision.",
  columnRevision: "Send the column's revision.",
  tableRevision: "Send the table's revision.",
  summaryReadOnly: 'Summary tables are calculated and cannot be edited.',
  pasteCount: 'Send 1 to 500 cell writes.',
  pasteDuplicate: 'Each cell can be written once per paste.',
  text: 'Enter text.',
  textTooLong: 'Text can be at most 10,000 characters.',
  decimal: 'Enter a number with up to 15 digits before the decimal point.',
  date: 'Enter a date as YYYY-MM-DD.',
  bool: 'Enter true or false.',
  reference: (tableName: string) => `Choose a row from ${tableName}.`,
  formulaCell: 'Formula cells are calculated. Edit the column formula instead.',
  ownRowOnly: 'You can only assign rows to yourself.',
  ownerColumn: 'Choose a Text column.',
  email: 'Enter a valid email address.',
  ownDocument: 'You already own this document.',
  previewRow: 'Choose a row in this table.',
  idempotencyKeyMalformed: 'Send a key of 1 to 100 letters, digits, hyphens or underscores.',
  idempotencyKeyReused: 'This key was already used for a different change.',
} as const;

export type ErrorValue = '#DIV/0!' | '#TYPE!' | '#NAME?' | '#REF!' | '#CIRC!';

export function errorTooltip(value: ErrorValue): string {
  switch (value) {
    case '#DIV/0!':
      return copy.tooltipDivZero;
    case '#TYPE!':
      return copy.tooltipType;
    case '#NAME?':
      return copy.tooltipName;
    case '#REF!':
      return copy.tooltipRef;
    case '#CIRC!':
      return copy.tooltipCirc;
  }
}

export function isErrorValue(display: string): display is ErrorValue {
  return (
    display === '#DIV/0!' ||
    display === '#TYPE!' ||
    display === '#NAME?' ||
    display === '#REF!' ||
    display === '#CIRC!'
  );
}
