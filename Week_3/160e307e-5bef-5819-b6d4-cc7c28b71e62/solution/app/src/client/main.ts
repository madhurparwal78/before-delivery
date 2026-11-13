import { loadConfig, startHealthWatch } from "./app";
import { route, startRouter } from "./router";
import { navigateOnClick } from "./ui/shell";
import { syncPendingLocal } from "./pages/local";

route(/^\/welcome$/, "welcome", () => import("./pages/welcome"));
route(/^\/$/, "home", () => import("./pages/home"));
route(/^\/play\/local$/, "local", () => import("./pages/local"));
route(/^\/room\/([A-Za-z0-9]+)$/, "room", () => import("./pages/room"));
route(/^\/join$/, "join", () => import("./pages/join").then((m) => ({ default: m.joinByCode })));
route(/^\/join\/([A-Za-z0-9]+)$/, "join", () => import("./pages/join").then((m) => ({ default: m.joinByLink })));
route(/^\/queue\/(casual|ranked)$/, "queue", () => import("./pages/queue"));
route(/^\/match\/([A-Za-z0-9-]+)$/, "match", () => import("./pages/match"));
route(/^\/profile\/([^/]+)$/, "profile", () => import("./pages/profile"));
route(/^\/shop$/, "shop", () => import("./pages/shop"));
route(/^\/leaderboard$/, "leaderboard", () => import("./pages/leaderboard"));
route(/^\/auth\/link\/[^/]+$/, "denied", () => import("./pages/expired"));
route(/^.*$/, "denied", () => import("./pages/expired").then((m) => ({ default: m.notFound })));

async function boot(): Promise<void> {
  await Promise.all([loadConfig().catch(() => undefined), startHealthWatch()]);
  navigateOnClick();
  startRouter();
  void syncPendingLocal();
  window.setInterval(() => void syncPendingLocal(), 30000);
}

void boot();
