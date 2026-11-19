import { createRoot } from "react-dom/client";
import { App } from "./app.js";

/** The first paint waits for the self-hosted fonts so text never reflows after it is shown. */
async function start(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('900 1em "Red Hat Display"'),
        document.fonts.load('400 1em "Red Hat Text"'),
        document.fonts.load('500 1em "Red Hat Text"'),
        document.fonts.load('700 1em "Red Hat Text"'),
      ]),
      new Promise((resolve) => window.setTimeout(resolve, 1500)),
    ]);
  } catch {
    // the system fallback stack renders instead
  }
  createRoot(document.getElementById("root")!).render(<App />);
}

void start();
