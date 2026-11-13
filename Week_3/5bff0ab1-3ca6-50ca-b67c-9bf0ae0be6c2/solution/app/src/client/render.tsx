import { renderToString } from "preact-render-to-string";
import { parseRoomUrl } from "../shared/derive.js";
import type { Boot } from "../shared/types.js";
import { App } from "./app.js";
import { initRoom } from "./live.js";
import { route } from "./router.js";
import { session } from "./session.js";
import { seedStage } from "./stage.js";

/** Renders the whole screen to HTML for one request: the stores are set, read once and left for the next request to reset. */
export function renderApp(boot: Boot, path: string, search: string): string {
  const url = parseRoomUrl(search);
  route.set({ path, search });
  session.set({ user: boot.user, prompt: null });
  seedStage(url);
  initRoom({ hub: url.hub, model: url.model, finish: url.finish }, boot.reading);
  return renderToString(<App boot={boot} />);
}
