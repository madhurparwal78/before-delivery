import { create } from 'zustand';

// The Announcements live region takes messages in order, each staying at least
// one second so none replaces another unread.
interface AnnounceState {
  queue: string[];
  current: string;
  enqueue(text: string): void;
  finishCurrent(): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useAnnouncer = create<AnnounceState>((set, get) => ({
  queue: [],
  current: '',
  enqueue(text) {
    set({ queue: [...get().queue, text] });
    advance(set, get);
  },
  finishCurrent() {
    set({ current: '' });
    advance(set, get);
  },
}));

type SetFn = (partial: Partial<AnnounceState>) => void;
type GetFn = () => AnnounceState;

function advance(set: SetFn, get: GetFn): void {
  const { current, queue } = get();
  if (current === '' && queue.length > 0) {
    const [next, ...rest] = queue;
    set({ current: next, queue: rest });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      useAnnouncer.getState().finishCurrent();
    }, 1000);
  }
}

export function announce(text: string): void {
  if (!text) return;
  useAnnouncer.getState().enqueue(text);
}

// An edit is durable on the device; the saved sentence is announced within a
// second after typing stops, once per burst.
let savedTimer: ReturnType<typeof setTimeout> | null = null;
export function announceSaved(): void {
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedTimer = null;
    announce('Saved on this device.');
  }, 900);
}
