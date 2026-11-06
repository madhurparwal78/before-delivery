// The app's two live regions: Announcements (everywhere) and Passage updates (planner only).
type Listener = (text: string) => void;

function channel() {
  const listeners = new Set<Listener>();
  let current = "";
  return {
    get current() {
      return current;
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Writes the text at once; the same text again is cleared first so it is announced again. */
    say(text: string) {
      const write = () => {
        current = text;
        for (const listener of listeners) listener(text);
      };
      if (text === current) {
        current = "";
        for (const listener of listeners) listener("");
        queueMicrotask(write);
      } else {
        write();
      }
    },
  };
}

export const announcements = channel();
export const passageUpdates = channel();

export function announce(text: string): void {
  announcements.say(text);
}
