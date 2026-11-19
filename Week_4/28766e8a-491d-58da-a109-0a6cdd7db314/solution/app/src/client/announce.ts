// The one polite announcer (brief: Polite announcer). Messages made in the same task are joined
// into one update; a repeat of the current text is cleared first so it is read again. Nothing here
// waits on a timer, so an announcement is never lost to a reload.

let buffer: string[] = [];
let scheduled = false;

export function announce(text: string): void {
  buffer.push(text);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const message = buffer.join(" ");
    buffer = [];
    const region = document.getElementById("announcer");
    if (!region) return;
    if (region.textContent !== message) {
      region.textContent = message;
      return;
    }
    region.textContent = "";
    queueMicrotask(() => {
      region.textContent = message;
    });
  });
}
