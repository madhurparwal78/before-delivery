import { apiJson, getMe, parseQuery } from "./api.js";
import { renderSignIn } from "./signin.js";
import { renderFleet } from "./fleet.js";
import { renderVessel } from "./vessel.js";
import { renderLog } from "./log.js";
import { renderVoyage } from "./voyage.js";
import { renderInspect } from "./inspect.js";

async function route(): Promise<void> {
  const path = window.location.pathname;
  if (path === "/" || path === "") {
    const me = await getMe();
    if (me?.role === "owner_master") {
      window.location.replace("/fleet");
      return;
    }
    if (me?.role === "crew") {
      window.location.replace("/log");
      return;
    }
    renderSignIn();
    return;
  }
  if (path === "/fleet") {
    const me = await requireSignedIn();
    if (me) renderFleet();
    return;
  }
  if (path.startsWith("/vessels/")) {
    const me = await requireSignedIn();
    if (me) renderVessel(path.slice("/vessels/".length));
    return;
  }
  if (path === "/log") {
    const me = await requireSignedIn();
    if (me) renderLog(parseQuery().get("date") ?? undefined);
    return;
  }
  if (path.startsWith("/voyage/")) {
    const me = await requireSignedIn();
    if (me) {
      const rest = path.slice("/voyage/".length).split("/");
      renderVoyage(rest[0] ?? "", rest[1] ?? "", parseQuery().get("start"), parseQuery().get("date"));
    }
    return;
  }
  if (path.startsWith("/inspect/")) {
    renderInspect(path.slice("/inspect/".length));
    return;
  }
  notFound();
}

async function requireSignedIn(): Promise<Awaited<ReturnType<typeof getMe>>> {
  const me = await getMe();
  if (me) return me;
  // Offline: the shell still opens, so the last identity keeps its page.
  const stored = localStorage.getItem("sixbell-me");
  if (stored && !navigator.onLine) {
    try {
      return JSON.parse(stored) as Awaited<ReturnType<typeof getMe>>;
    } catch {
      return null;
    }
  }
  window.location.replace("/");
  return null;
}

function notFound(): void {
  document.title = "Sixbell Rest Log";
  const main = document.getElementById("app")!;
  main.textContent = "";
  const heading = document.createElement("h1");
  heading.textContent = "We couldn't find that page.";
  main.append(heading);
  window.history.replaceState({}, "", window.location.href);
}

void route();
