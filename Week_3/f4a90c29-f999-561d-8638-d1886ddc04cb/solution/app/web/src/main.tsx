import { render } from "preact";
import { App } from "./app";
import { syncClock } from "./time";

// Sora arrives before the first draw, so no text reflows when it swaps in; a slow font never holds the page past a second.
const fonts = Promise.allSettled(["300 16px Sora", "400 16px Sora"].map((font) => document.fonts.load(font)));
const limit = new Promise((resolve) => setTimeout(resolve, 1000));
// The server clock is read before the first draw, so the device clock never decides today or the now line.
const clock = syncClock().catch(() => undefined);
void Promise.all([Promise.race([fonts, limit]), clock]).then(() => render(<App />, document.getElementById("app") as HTMLElement));
