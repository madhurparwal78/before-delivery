// Clapstick's client: one page shell per route, one live region, one refresh
// loop, and the design's one motif. No framework, no external origin.

import { renderScreen, type ScreenContext } from "./screens/index";
import { Router } from "./lib/router";
import { Announcer } from "./lib/announce";
import { ClientStore } from "./lib/state";
import { Session } from "./lib/session";
import { prefersReducedMotion } from "./lib/motion";

const root = document.getElementById("root")!;

const announcer = new Announcer();
const router = new Router();
const store = new ClientStore();
const session = new Session();

const ctx: ScreenContext = {
  router,
  announcer,
  store,
  session,
  reload,
};

let refreshTimer: number | null = null;

async function reload(): Promise<void> {
  const path = location.pathname + location.search;
  const { title, heading, doc, refresh } = await renderScreen(ctx, path);
  document.title = title;
  root.replaceChildren(doc);
  heading.setAttribute("tabindex", "-1");
  if (prefersReducedMotion()) {
    heading.focus();
  } else {
    heading.focus();
  }
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
  if (refresh !== null) {
    refreshTimer = window.setInterval(() => {
      void refresh();
    }, 5000);
  }
}

router.onChange(async () => {
  await reload();
});

router.onPublicChange(async () => {
  await reload();
});

router.start();
