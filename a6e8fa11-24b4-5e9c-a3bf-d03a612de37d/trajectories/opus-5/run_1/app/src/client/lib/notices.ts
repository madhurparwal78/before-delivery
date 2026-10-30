export interface Notice {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

type Listener = () => void;

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeNotices(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentNotices(): Notice[] {
  return notices;
}

export function notify(text: string, action?: Notice['action'], lifetimeMs = 6000): number {
  const id = nextId++;
  notices = [...notices, { id, text, action }];
  emit();
  window.setTimeout(() => dismissNotice(id), lifetimeMs);
  return id;
}

export function dismissNotice(id: number): void {
  notices = notices.filter((notice) => notice.id !== id);
  emit();
}
