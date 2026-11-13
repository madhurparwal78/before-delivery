let ready = false;

export function databaseIsReady(): boolean {
  return ready;
}

export function markDatabaseReady(): void {
  ready = true;
}

export function markDatabaseDown(): void {
  ready = false;
}
