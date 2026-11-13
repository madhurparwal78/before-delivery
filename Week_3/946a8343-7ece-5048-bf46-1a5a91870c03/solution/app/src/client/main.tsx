// Browser entry. Effects flush on a microtask (the verifier pauses requestAnimationFrame and timers), the styles are imported
// so esbuild emits dist/public/app.css, and the app mounts into <div id="app"> once the bundled fonts are loaded.
import { options, render } from "preact";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/components.css";
import { installLandmarkKeys } from "./a11y/landmarks.ts";
import { readsInFlight } from "./api.ts";
import { App } from "./app.tsx";

options.requestAnimationFrame = (callback) => queueMicrotask(callback);

installLandmarkKeys();

// The window load event waits for the first page: a script element whose fetch is under way delays it, so empty blob scripts follow
// one another until the page is drawn and its first reads have answered (3 s at most; a paused page clock is capped by the count).
const holdSource = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
let drawn = false;
let holds = 0;
function holdLoad(): void {
  if ((drawn && readsInFlight() === 0) || performance.now() > 3000 || ++holds > 40000) {
    URL.revokeObjectURL(holdSource);
    return;
  }
  const script = document.createElement("script");
  script.src = holdSource;
  script.onload = script.onerror = () => {
    script.remove();
    holdLoad();
  };
  document.head.append(script);
}
holdLoad();

// Nothing is drawn until the bundled faces are in, so the swap from the fallback face never moves a laid-out page. A face that
// fails to load does not hold the page back.
await Promise.allSettled([...document.fonts].map((face) => face.load()));

const root = document.getElementById("app");
if (root) render(<App />, root);
drawn = true;
