export interface FieldMessages {
  [field: string]: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: FieldMessages;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra) this.extra = extra;
  }
}

export function invalid(fields: FieldMessages, message = 'The request is invalid.'): ApiError {
  const e = new ApiError(422, 'invalid', message);
  e.fields = fields;
  return e;
}

export function invalidCode(code: string, fields: FieldMessages): ApiError {
  const e = new ApiError(422, code, 'The request is invalid.');
  e.fields = fields;
  return e;
}

export const errorBody = (err: ApiError): Record<string, unknown> => {
  const inner: Record<string, unknown> = { code: err.code, message: err.message };
  if (err.fields && Object.keys(err.fields).length > 0) inner.fields = err.fields;
  if (err.extra) Object.assign(inner, err.extra);
  return { error: inner };
};

export const SIGN_IN_FAILURE = 'Email or password is incorrect.';

export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);
export const forbidden = (message = 'You may not take this action.') => new ApiError(403, 'forbidden', message);
export const staleRevision = (extra: Record<string, unknown>, message = 'This changed while you were editing.') =>
  new ApiError(409, 'stale_revision', message, extra);

export const COPY = {
  textTooLong: 'Text can be at most 10,000 characters.',
  enterText: 'Enter text.',
  enterNumber: 'Enter a number with up to 15 digits before the decimal point.',
  enterDate: 'Enter a date as YYYY-MM-DD.',
  enterBool: 'Enter true or false.',
  enterReference: (tableName: string) => `Choose a row from ${tableName}.`,
  formulaCells: 'Formula cells are calculated. Edit the column formula instead.',
  ownRowsOnly: 'You can only assign rows to yourself.',
  docName: 'Use 1 to 80 characters without line breaks or control characters.',
  tableName: 'Use 1 to 40 letters, digits or underscores, starting with a letter.',
  tableDuplicate: 'A table with this name already exists.',
  summaryRename: 'Summary names follow their source table and columns.',
  columnName: 'Use 1 to 60 characters without square brackets.',
  columnDuplicate: 'A column with this name already exists.',
  typeCannotChange: "This column's type cannot be changed.",
  summaryNoEdit: 'Summary tables are calculated and cannot be edited.',
  sendCellRevision: "Send the cell's revision.",
  sendRowRevision: "Send the row's revision.",
  sendColumnRevision: "Send the column's revision.",
  sendTableRevision: "Send the table's revision.",
  pasteWrites: 'Send 1 to 500 cell writes.',
  pasteDuplicate: 'Each cell can be written once per paste.',
  chooseTextColumn: 'Choose a Text column.',
  chooseRow: 'Choose a row in this table.',
  emailInvalid: 'Enter a valid email address.',
  emailSelf: 'You already own this document.',
  idKeyMalformed: 'Send a key of 1 to 100 letters, digits, hyphens or underscores.',
  idKeyReused: 'This key was already used for a different change.',
  unreadableFormula: (n: number) => `Check the formula: it could not be read at character ${n}.`,
  formulaTooLong: 'Check the formula: use at most 2,000 characters.',
  formulaTooEarly: 'Check the formula: it ended too early.',
  tooltip: {
    DIV0: '#DIV/0! Division by zero.',
    TYPE: '#TYPE! A value has the wrong type for this operation.',
    NAME: '#NAME? This formula uses a name that does not exist.',
    REF: '#REF! This formula points at a row that was deleted.',
    CIRC: '#CIRC! This formula depends on itself.',
  } as Record<string, string>,
} as const;
