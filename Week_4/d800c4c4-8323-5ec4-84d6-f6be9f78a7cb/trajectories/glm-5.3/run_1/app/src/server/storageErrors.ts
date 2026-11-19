// Storage failure: raised when object storage is unreachable.
export class StorageDown extends Error {
  constructor(readonly cause: unknown) {
    super('storage down');
    this.name = 'StorageDown';
  }
}
