let id = '';

export function setCopyId(value: string): void {
  id = value;
}

/** This copy's random id, which its queues, index and object keys all carry. */
export function copyId(): string {
  return id;
}
