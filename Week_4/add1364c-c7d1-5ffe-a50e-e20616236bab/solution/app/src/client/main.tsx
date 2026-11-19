import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Router } from "./lib/router";
import { StoreProvider } from "./lib/store";
import "./styles.css";

// Paint the first frame in the published faces: text set in the fallback and then swapped re-wraps and shifts
// the page. The wait is short and capped, so a slow font never holds the desk back.
const FACES = ['400 16px "Funnel Sans"', '600 16px "Funnel Sans"', '700 16px "Funnel Display"'];

function fontsReady(capMs: number): Promise<unknown> {
  if (!("fonts" in document)) return Promise.resolve();
  const loads = Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined);
  return Promise.race([loads, new Promise((resolve) => window.setTimeout(resolve, capMs))]);
}

const root = document.getElementById("root");
if (root) {
  void fontsReady(800).then(() => {
    createRoot(root).render(
      <Router>
        <StoreProvider>
          <App />
        </StoreProvider>
      </Router>,
    );
  });
}
