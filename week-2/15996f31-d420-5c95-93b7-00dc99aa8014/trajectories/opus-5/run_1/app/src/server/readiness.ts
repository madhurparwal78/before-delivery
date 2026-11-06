let ready = false;

export function databaseReady(): boolean {
  return ready;
}

export function markDatabaseReady(): void {
  ready = true;
}
