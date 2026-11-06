// Browser entry: render the shell, load the device's notebook, register the offline service worker.
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { boot } from "./sync.ts";
import "../styles/app.css";

createRoot(document.getElementById("root") as HTMLElement).render(<App />);

// When focus drops to the page without a pointer press (a closed panel, a removed control), the
// next Tab starts again from the top bar, so Tab always follows the visual order.
let pressing = false;
document.addEventListener("mousedown", () => { pressing = true; }, true);
document.addEventListener("mouseup", () => { pressing = false; }, true);
const start = document.getElementById("focus-start") as HTMLElement;
document.addEventListener("focusout", (event) => {
  if (event.relatedTarget || pressing || event.target === start) return;
  queueMicrotask(() => {
    if (document.activeElement !== document.body) return;
    start.focus({ preventScroll: true });
    start.blur();
  });
});
void boot();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
