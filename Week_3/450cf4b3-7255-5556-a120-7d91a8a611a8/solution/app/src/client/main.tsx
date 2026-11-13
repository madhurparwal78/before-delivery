import { options, render } from "preact";
import { App } from "./App.js";
import "./styles.css";
import "./board.css";
import "./screens.css";

// Run effects right after each commit rather than on the next animation frame, so data loading
// and focus moves never wait on a paint (or on a paused clock).
options.requestAnimationFrame = (callback: () => void) => {
  queueMicrotask(callback);
};

// The first paint waits (a moment at most) for the type faces, so text never reflows when they swap in.
const FACES = ['600 1em "Archivo Narrow"', '400 1em "IBM Plex Sans"', '500 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];
const faces = Promise.all(FACES.map((face) => document.fonts.load(face).catch(() => [])));
const root = document.getElementById("app");
if (root) {
  void Promise.race([faces, new Promise((done) => setTimeout(done, 1500))]).then(() => render(<App />, root));
}
