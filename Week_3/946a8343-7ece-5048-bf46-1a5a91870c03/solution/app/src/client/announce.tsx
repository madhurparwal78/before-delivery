// Announcements and toasts.
//   announce(text, tone?) plain function, callable from anywhere (handlers, live messages, API error paths). tone "error"
//                         only changes the toast accent.
//   <Announcer />         rendered ONCE by the shell, outside <main>: the polite `status "Announcements"` region (each
//                         announcement is appended as its own child, the last 10 are kept, never cleared on a timer) and
//                         the `region "Notifications"` of toasts, which repeat each announcement and leave after
//                         config.toastMs on page timers.
// Nothing here waits for a timer or frame before the text is in the DOM.
import { config } from "./config.ts";
import { createStore, useStore } from "./store.ts";

type AnnounceTone = "info" | "error";

interface Entry {
  id: number;
  text: string;
  tone: AnnounceTone;
}

const KEEP = 10;
let nextId = 1;
const announcements = createStore<readonly Entry[]>([]);
const toasts = createStore<readonly Entry[]>([]);

export function announce(text: string, tone: AnnounceTone = "info"): void {
  const entry: Entry = { id: nextId++, text, tone };
  announcements.update((list) => [...list, entry].slice(-KEEP));
  toasts.update((list) => [...list, entry]);
  setTimeout(() => {
    toasts.update((list) => list.filter((item) => item.id !== entry.id));
  }, config.toastMs);
}

export function Announcer() {
  const spoken = useStore(announcements);
  const shown = useStore(toasts);
  return (
    <>
      <div role="status" aria-label="Announcements" aria-live="polite" aria-atomic="false" class="sp-announcements sp-visually-hidden" data-never-inert="">
        {spoken.map((entry) => (
          <p key={entry.id}>{entry.text}</p>
        ))}
      </div>
      <section role="region" aria-label="Notifications" class="sp-toasts" data-never-inert="">
        {shown.map((entry) => (
          <div key={entry.id} class={`sp-toast sp-toast--${entry.tone}`}>
            {entry.text}
          </div>
        ))}
      </section>
    </>
  );
}
