import { options, render } from "preact";
import "./styles.css";
import { App } from "./App";

// Passive effects run on the next task, not on the next animation frame, so screens settle without a painted frame.
const channel = new MessageChannel();
const queued: (() => void)[] = [];
channel.port1.onmessage = () => {
  for (const run of queued.splice(0)) run();
};
options.requestAnimationFrame = (callback) => {
  queued.push(callback);
  if (queued.length === 1) channel.port2.postMessage(0);
};

// A field that takes focus behind a sticky bar scrolls until it sits fully above the bar.
document.addEventListener("focusin", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest("[data-sticky-bar]")) return;
  for (const bar of document.querySelectorAll<HTMLElement>("[data-sticky-bar]")) {
    const position = getComputedStyle(bar).position;
    const rect = bar.getBoundingClientRect();
    const stuck = (position === "sticky" || position === "fixed") && rect.height > 0 && rect.bottom >= innerHeight - 2;
    const box = target.getBoundingClientRect();
    if (stuck && box.bottom > rect.top - 8) window.scrollBy({ top: box.bottom - rect.top + 16, behavior: "instant" });
  }
});

// Scrolling into view keeps clear of a sticky bottom bar: its height is published as a CSS variable.
new ResizeObserver(() => {
  const bar = document.querySelector<HTMLElement>("[data-sticky-bar]");
  document.documentElement.style.setProperty("--sticky-bar-height", `${bar ? bar.offsetHeight : 0}px`);
}).observe(document.body);

render(<App />, document.getElementById("app")!);
