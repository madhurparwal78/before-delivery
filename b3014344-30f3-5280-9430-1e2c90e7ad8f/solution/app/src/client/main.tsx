import "./fonts.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Router } from "./lib/router";
import { SessionProvider } from "./session";

history.scrollRestoration = "manual";

/** Every face the pages set; mounting after they load keeps a fallback-to-webfont swap from shifting the layout. */
const FACES = ['500 1em "Bricolage Grotesque"', '700 1em "Bricolage Grotesque"', '400 1em "IBM Plex Sans"',
  '500 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];

void Promise.all(FACES.map((face) => document.fonts.load(face)))
  .catch(() => undefined)
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <SessionProvider>
        <Router>
          <App />
        </Router>
      </SessionProvider>,
    );
  });
