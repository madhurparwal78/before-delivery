import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/live.css";
import { App } from "./App.js";
import { NavigationProvider } from "./router.js";
import { SessionProvider } from "./session.js";

const root = document.getElementById("root");
if (!root) throw new Error("the page has no #root");

/**
 * The faces every screen uses, preloaded by index.html. The first render waits for them (at most FONT_WAIT_MS) so no text
 * is laid out in a fallback face and then re-wrapped when the real one arrives: that re-wrap moves the whole page.
 */
const FACES = ['600 18px "Chakra Petch"', '400 15px "IBM Plex Sans"', '600 15px "IBM Plex Sans"', '400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"'];
const FONT_WAIT_MS = 2500;

const fontsReady = Promise.race([
  Promise.all(FACES.map((face) => document.fonts.load(face))),
  new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
]).catch(() => undefined);

void fontsReady.then(() => {
  createRoot(root).render(
    <StrictMode>
      <NavigationProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </NavigationProvider>
    </StrictMode>,
  );
});
