/**
 * Import file errors. Both published refusal reasons for an uploaded CSV are
 * field errors on `file`, answered with 422 and never exposing any internal
 * detail about why the file could not be read.
 */

export class ImportFileError extends Error {
  readonly fieldMessage: string;
  constructor(fieldMessage: string) {
    super(fieldMessage);
    this.fieldMessage = fieldMessage;
  }
}
