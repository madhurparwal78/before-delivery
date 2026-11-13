import { hydrate } from "preact";
import { parseRoomUrl } from "../shared/derive.js";
import type { Boot } from "../shared/types.js";
import { App } from "./app.js";
import { announceLoaded, initRoom, reidentify } from "./live.js";
import { resetMine, refreshMine } from "./mine.js";
import { initRouter } from "./router.js";
import { initSession, session, sessionEndedOnLoad } from "./session.js";
import { seedStage } from "./stage.js";
import "./styles.css";

const boot = JSON.parse(document.getElementById("boot")?.textContent ?? "{}") as Boot;
const url = parseRoomUrl(location.search);
initRouter(location.pathname, location.search);
initSession(boot);
seedStage(url);
initRoom({ hub: url.hub, model: url.model, finish: url.finish }, boot.reading);

let identity = session.get().identity;
session.subscribe(() => {
  const s = session.get();
  if (s.identity === identity) return;
  identity = s.identity;
  const keep = s.user === null && s.prompt === "ended";
  if (!keep) resetMine();
  reidentify();
  void refreshMine();
});

hydrate(<App boot={boot} />, document.getElementById("app-root") as HTMLElement);
document.documentElement.classList.add("js-focus");
announceLoaded();
if (boot.ended && (location.pathname === "/garage" || location.pathname === "/hub")) sessionEndedOnLoad();
