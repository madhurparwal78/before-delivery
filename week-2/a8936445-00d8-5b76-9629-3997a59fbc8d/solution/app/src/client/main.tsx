import { options, render } from "preact";
import { App } from "./app";
import "./styles.css";

// Run effects right after each commit instead of after the next animation frame, so data loads and
// subscriptions start even when frames are throttled (background tabs, paused page clocks).
options.requestAnimationFrame = (callback) => queueMicrotask(callback);

const root = document.getElementById("root");
if (root) render(<App />, root);
