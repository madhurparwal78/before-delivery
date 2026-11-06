import { options, render } from "preact";
import { App } from "./shell.js";
import { context } from "./store.js";
import type { KitchenInfo, SessionInfo } from "./types.js";

// Effects run right after each commit instead of waiting for the next animation frame, so data
// loads and focus moves never depend on frame timing.
options.requestAnimationFrame = (callback) => queueMicrotask(callback);

// A page restored from the back-forward cache reloads from the server instead of showing what it held.
addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});

/**
 * The signed-in context the server embedded in this screen document (what GET /api/session and
 * GET /api/kitchen answer; null when signed out), so the frame draws on load. It is read once and
 * removed, so nothing of it outlives a sign-out in this tab.
 */
const boot = document.getElementById("boot");
boot?.remove();
context.set(boot ? (JSON.parse(boot.textContent ?? "null") as { session: SessionInfo; kitchen: KitchenInfo } | null) : null);

render(<App />, document.getElementById("root")!);
