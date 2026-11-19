// The text world: plain headings and lists for every island, creature and progress line.

import { el, qs, announce, ensureStatusRegion, api, framesText } from "../ui/core";
import { onLive } from "../live";
import { ISLANDS } from "../../shared/world";
import { creaturesOfIsland } from "../../shared/creatures";
import { islandName } from "../../shared/copy";

interface AlbumsAnswer {
  albums: { island: number; island_name: string; pages: { creature: string; creature_name: string; filled: boolean; photo_id: string | null; total: number }[]; pages_filled: number }[];
  stamps: number; lighthouse: "open" | "closed"; film: number;
}
interface MeAnswer {
  position: { island: number; tile: [number, number]; heading: string };
  film: number;
}

const PRESENT_TEXT: Record<string, string> = { always: "always", dusk: "dusk only", rain: "rain only" };

export function mountTextWorld(): Promise<void> {
  ensureStatusRegion("Text world status", "last5");
  const main = document.getElementById("main");
  if (!main) return Promise.resolve();
  main.innerHTML = "";
  const host = el("div", { class: "text-world", id: "text-world-root" });
  main.append(host);
  return renderTextWorld(host);
}

/** Renders the text world into any container; used by /text-world and the still fallback. */
export async function renderTextWorld(host: HTMLElement): Promise<void> {
  const albums = await api<AlbumsAnswer | null>("GET", "/api/me/albums").catch(() => null);
  if (!albums) {
    renderSignedOut(host);
    return;
  }
  const me = await api<MeAnswer>("GET", "/api/me").catch(() => null);
  renderSignedIn(host, albums, me);
  onLive(ev => {
    const p = ev.payload as Record<string, unknown>;
    if (ev.kind === "film" || ev.kind === "photo" || ev.kind === "restart" || ev.kind === "position" || ev.kind === "clock") {
      void rerender(host);
    }
    void p;
  });
}

async function rerender(host: HTMLElement): Promise<void> {
  const albums = await api<AlbumsAnswer>("GET", "/api/me/albums").catch(() => null);
  if (!albums) return;
  const me = await api<MeAnswer>("GET", "/api/me").catch(() => null);
  renderSignedIn(host, albums, me);
}

function renderSignedOut(host: HTMLElement): void {
  host.innerHTML = "";
  for (const island of ISLANDS) {
    host.append(el("h2", {}, island.name));
    const ul = el("ul", {});
    for (const c of creaturesOfIsland(island.id)) {
      ul.append(el("li", {}, `${c.name}: ${PRESENT_TEXT[c.presence]}`));
    }
    host.append(ul);
  }
  host.append(el("p", {}, "Sign in to see your progress."));
}

function renderSignedIn(host: HTMLElement, albums: AlbumsAnswer, me: MeAnswer | null): void {
  const focus = document.activeElement === host ? host : null;
  const scrollY = window.scrollY;
  host.innerHTML = "";
  const myIsland = me?.position.island ?? 1;
  for (const island of ISLANDS) {
    host.append(el("h2", {}, island.name));
    const album = albums.albums.find(a => a.island === island.id)!;
    const ul = el("ul", {});
    for (const page of album.pages) {
      const present = PRESENT_TEXT[creaturesOfIsland(island.id).find(c => c.id === page.creature)!.presence];
      const line = page.filled
        ? `${page.creature_name}: ${present}, photographed, best ${page.total} points`
        : `${page.creature_name}: ${present}, not photographed yet`;
      ul.append(el("li", {}, line));
    }
    host.append(ul);
    host.append(el("p", {}, `${album.pages_filled} of 4 album pages`));
    if (island.id !== myIsland) {
      const btn = el("button", { text: `Sail to ${island.name}`, "data-sail": String(island.id) });
      btn.addEventListener("click", async () => {
        await api("PUT", "/api/me/position", { island: island.id, tile: [3, 12], heading: "E" });
        announce("Text world status", `You are on ${island.name} at tile 3, 12.`);
        void rerender(host);
      });
      host.append(btn);
    }
  }
  const progress = el("section", {});
  const heading = el("h2", {}, "Your progress");
  progress.append(heading);
  const lines = el("div", { class: "progress-lines" });
  lines.append(el("p", {}, `Stamps: ${albums.stamps}`));
  lines.append(el("p", {}, `Lighthouse: ${albums.lighthouse}`));
  lines.append(el("p", {}, `Film: ${framesText(albums.film)}`));
  if (me) {
    const line = `You are on ${islandName(me.position.island)} at tile ${me.position.tile[0]}, ${me.position.tile[1]}.`;
    const p = el("p", { id: "location-line" }, line);
    lines.append(p);
  }
  progress.append(lines);
  const refill = el("button", { text: "Refill film", id: "refill-film" });
  refill.disabled = myIsland !== 1 || albums.film >= 36;
  refill.addEventListener("click", async () => {
    try {
      const res = await api<{ film: number }>("POST", "/api/me/refill", {});
      announce("Text world status", "Film refilled to 36 frames.");
      void rerender(host);
      void res;
    } catch {
      // announcement handled by the page's error region mapping
    }
  });
  progress.append(refill);
  host.append(progress);
  window.scrollTo(0, scrollY);
  if (focus) host.focus();
}

// Sail buttons live under each island heading other than the current one.
export function sailButtonsOf(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll("[data-sail]"));
}

export function locationLineOf(): string {
  const node = qs("#location-line");
  return node?.textContent ?? "";
}
