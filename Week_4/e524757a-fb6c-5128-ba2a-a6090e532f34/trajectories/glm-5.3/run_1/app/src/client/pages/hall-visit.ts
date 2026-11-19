// A read-only walk-through hall beside the hung photos.

import { el, qs, announce, ensureStatusRegion, api, ApiCallError, setFigure, likesText, reducedMotion } from "../ui/core";
import { onLive } from "../live";
import { stepOf, Explorer } from "../../shared/movement";
import { isHallFloor, HALL_W, Heading } from "../../shared/world";

interface HallVisitAnswer { hall: { handle: string; owner_name: string; frames: { frame: number; caption: string; photo: string; likes: number; liked_by_me: boolean }[] } }

export function mountHallVisit(): void {
  ensureStatusRegion("Gallery status", "last5");
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  void build(main);
}

async function build(main: HTMLElement): Promise<void> {
  const handle = location.pathname.split("/").pop() ?? "";
  const answer = await api<HallVisitAnswer>("GET", `/api/halls/${encodeURIComponent(handle)}`).catch((err: unknown) => err instanceof ApiCallError ? err : null);
  const page = el("div", { class: "hall-page" });
  if (!answer || answer instanceof ApiCallError) {
    page.append(el("h1", {}, "No gallery here"));
    main.append(page);
    return;
  }
  const hall = answer.hall;
  page.append(el("h1", {}, `${hall.owner_name}'s hall`));

  const columns = el("div", { class: "hall-columns" });
  const walkSection = el("section", { "aria-label": "Gallery hall" });
  const stage = el("div", { class: "gallery-stage" });
  const view = el("div", {
    id: "hall-view",
    role: "application",
    tabindex: "0",
    "aria-label": "Gallery hall",
    "data-step": "0", "data-tile": "2,13", "data-heading": "N", "data-gait": "idle",
    "data-preset": "full", "data-state": "ready"
  });
  stage.append(view);
  walkSection.append(stage);
  const hint = el("p", { class: "notice", text: "Walk with W, A, S and D. The walls stop you." });
  walkSection.append(hint);
  columns.append(walkSection);

  const right = el("section", { "aria-label": "Hung photos" });
  right.append(el("h2", {}, "Hung photos"));
  const list = el("ul", { class: "hung-photos", role: "list", "aria-label": "Hung photos" });
  for (const frame of hall.frames) {
    const li = el("li", {});
    const head = el("div", { class: "hp-head" });
    head.append(el("h3", {}, `Frame ${frame.frame}`));
    const likes = el("figure", { "data-figure": "likes", "aria-hidden": "true", text: likesText(frame.likes) });
    head.append(likes);
    li.append(head);
    li.append(el("img", { src: `/api/photos/${frame.photo}/image`, alt: `Hung photo, frame ${frame.frame}` }));
    if (frame.caption) li.append(el("p", {}, frame.caption));
    const viewBtn = el("button", { text: "View photo" });
    viewBtn.addEventListener("click", () => openViewer(frame.photo, frame.frame));
    const likeBtn = el("button", { text: "Like photo", "aria-pressed": frame.liked_by_me ? "true" : "false" });
    likeBtn.addEventListener("click", async () => {
      const pressed = likeBtn.getAttribute("aria-pressed") === "true";
      try {
        const res = await api<{ likes: number; liked: boolean }>(pressed ? "DELETE" : "PUT", `/api/photos/${frame.photo}/like`, {});
        likeBtn.setAttribute("aria-pressed", res.liked ? "true" : "false");
        setFigure(likes, res.likes, likesText);
        announce("Gallery status", res.liked ? "Liked photo." : "Like removed from photo.");
      } catch (err) {
        if (err instanceof ApiCallError) {
          if (err.code === "not_signed_in") {
            const next = encodeURIComponent(location.pathname);
            location.href = `/signin?next=${next}`;
            return;
          }
          announce("Gallery status", err.message);
        }
      }
    });
    li.append(viewBtn, likeBtn);
    list.append(li);
  }
  if (hall.frames.length === 0) {
    const li = el("li", {});
    li.append(el("p", {}, "No photos hung yet."));
    list.append(li);
  }
  right.append(list);
  columns.append(right);
  page.append(columns);
  main.append(page);

  const viewer = el("dialog", { id: "photo-viewer", "aria-label": "Photo viewer", "data-zoom": "1" });
  const body = el("div", { class: "dialog-body" });
  body.append(el("h3", {}, "Photo viewer"));
  const img = el("img", { id: "viewer-img", alt: "Photo", style: "width:100%;border-radius:4px" });
  body.append(img);
  viewer.append(body);
  main.append(viewer);
  viewer.addEventListener("keydown", ev => {
    const zoom = Number(viewer.getAttribute("data-zoom") || "1");
    if (ev.key === "+" || ev.key === "=") viewer.setAttribute("data-zoom", String(Math.min(4, zoom + 1)));
    else if (ev.key === "-") viewer.setAttribute("data-zoom", String(Math.max(1, zoom - 1)));
    else if (ev.key === "Escape") {
      viewer.close();
      qs<HTMLElement>("#hall-view")?.focus();
    }
    img.style.transform = `scale(${viewer.getAttribute("data-zoom")})`;
  });

  function openViewer(photoId: string, frame: number): void {
    img.src = `/api/photos/${photoId}/image`;
    img.alt = `Photo, frame ${frame}`;
    viewer.setAttribute("data-zoom", "1");
    img.style.transform = "scale(1)";
    viewer.showModal();
    viewer.focus();
  }

  // Hall walking: same movement rule, position not saved.
  const explorer: Explorer = { tile: [2, 13], heading: "N", gait: "idle" };
  let stepCount = 0;
  const keys = new Map<string, boolean>();
  view.addEventListener("keydown", ev => {
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    keys.set(k, true);
    if (["w", "a", "s", "d", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", " "].includes(k)) ev.preventDefault();
  });
  view.addEventListener("keyup", ev => {
    keys.delete(ev.key.length === 1 ? ev.key.toLowerCase() : ev.key);
  });

  let counter = 0;
  setInterval(() => {
    if (document.activeElement !== view) return;
    let dir: Heading | null = null;
    if (keys.get("w") || keys.get("ArrowUp")) dir = "N";
    else if (keys.get("a") || keys.get("ArrowLeft")) dir = "W";
    else if (keys.get("s") || keys.get("ArrowDown")) dir = "S";
    else if (keys.get("d") || keys.get("ArrowRight")) dir = "E";
    const res = stepOf(explorer, 1, { direction: dir, running: false, jumpQueued: false }, (_island, x, y) => isHallFloor(x, y) || (x >= -0 && x < HALL_W && y >= 0 && y < 14), counter, 0);
    if (res.moved) counter++;
    explorer.tile = res.tile;
    explorer.heading = res.heading;
    explorer.gait = dir ? "walk" : "idle";
    view.dataset.tile = `${explorer.tile[0]},${explorer.tile[1]}`;
    view.dataset.heading = explorer.heading;
    view.dataset.gait = explorer.gait;
    stepCount++;
    view.dataset.step = String(stepCount);
  }, reducedMotion() ? 100 : 100);

  onLive(ev => {
    const p = ev.payload as Record<string, unknown>;
    if (ev.kind === "like") {
      const photoId = String(p.photo_id);
      const li = list.children[hall.frames.findIndex((f: { photo: string }) => f.photo === photoId)];
      const fig = li?.querySelector("[data-figure='likes']");
      if (fig) setFigure(fig as HTMLElement, Number(p.likes), likesText);
    }
  });
}
