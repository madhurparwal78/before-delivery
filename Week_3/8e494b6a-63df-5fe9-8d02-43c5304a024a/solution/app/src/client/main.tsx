import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// The first render waits (at most 1.5s) for the five faces, so no text rewraps under the reader when a late face swaps in.
const FACES = ["400 16px Inter", "500 16px Inter", "600 16px Inter", "400 16px 'JetBrains Mono'", "500 16px 'JetBrains Mono'"];
const faces = Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined);
const cap = new Promise((resolve) => setTimeout(resolve, 1500));

void Promise.race([faces, cap]).then(() => {
  createRoot(document.getElementById("root") as HTMLElement).render(<App />);
});
