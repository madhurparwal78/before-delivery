// Photo mode, the shot, and the result dialog.

import { el, qs, announce, clearRegion, setFigure, reducedMotion, framesText, stampsText, api, ApiCallError } from "../ui/core";
import { islandName } from "../../shared/copy";
import { Heading, HEADING_ANGLE } from "../../shared/world";
import { Game, currentScene } from "./play-state";
import { updateHooks, updateFrameGuide } from "./play-sim";

export interface PhotoAnswer {
  photo: {
    id: string; creature: string; creature_name: string; total: number; island: number;
    score: { size: number; centring: number; facing: number; sharpness: number; total: number };
    measures: { distance: number; best_distance: number; offset: number; focus_error: number; creature_facing: string };
    album: { page_filled: boolean; pages_filled: number; stamp_earned: boolean };
    film: number; image_url: string;
  };
}

export function enterPhotoMode(game: Game): void {
  game.mode = "photo";
  game.exploreYaw = game.yaw;
  game.yaw = HEADING_ANGLE[game.heading];
  game.zoom = 1;
  game.focus = 4;
  const view = qs<HTMLElement>("#world-view");
  qs("#hud-camera")?.setAttribute("aria-pressed", "true");
  const photoBtns = qs<HTMLElement>("#photo-buttons");
  if (photoBtns) photoBtns.hidden = false;
  const guide = qs("#frame-guide");
  if (guide) {
    guide.style.display = "block";
    if (reducedMotion()) {
      view?.setAttribute("data-guide", "drawn");
    } else {
      view?.setAttribute("data-guide", "drawing");
      window.setTimeout(() => view?.setAttribute("data-guide", "drawn"), 180);
    }
  }
  const readouts = qs("#photo-readouts");
  if (readouts) readouts.style.display = "flex";
  syncReadouts(game);
  const scene = currentScene();
  if (scene && reducedMotion()) scene.setCameraEye(game.tile, game.heading, game.zoom);
  updateHooks(game);
  updateFrameGuide(game);
}

export function leavePhotoMode(game: Game): void {
  game.mode = "explore";
  game.yaw = game.exploreYaw;
  game.zoom = game.exploreZoom;
  game.focus = 4;
  const view = qs<HTMLElement>("#world-view");
  qs("#hud-camera")?.setAttribute("aria-pressed", "false");
  const photoBtns = qs<HTMLElement>("#photo-buttons");
  if (photoBtns) photoBtns.hidden = true;
  const guide = qs("#frame-guide");
  if (guide) guide.style.display = "none";
  const readouts = qs("#photo-readouts");
  if (readouts) readouts.style.display = "none";
  view?.setAttribute("data-guide", "hidden");
  updateHooks(game);
  updateFrameGuide(game, true);
  currentScene()?.setCameraExplore(game.yaw, game.exploreZoom, game.tile, game.heading);
}

export function stepZoom(game: Game, delta: number): void {
  if (game.mode === "photo") {
    const steps = [1, 2, 4] as const;
    const i = steps.indexOf(game.zoom as 1 | 2 | 4);
    const next = steps[Math.min(steps.length - 1, Math.max(0, i + delta))];
    game.zoom = next;
    const scene = currentScene();
    scene?.setCameraEye(game.tile, game.heading, game.zoom);
  } else {
    game.exploreZoom = Math.min(4, Math.max(1, game.exploreZoom + delta));
  }
  updateHooks(game);
  syncReadouts(game);
}

export function cycleFocus(game: Game): void {
  const steps = [2, 4, 8, 16] as const;
  const i = steps.indexOf(game.focus as 2 | 4 | 8 | 16);
  game.focus = steps[(i + 1) % steps.length];
  updateHooks(game);
  syncReadouts(game);
}

function syncReadouts(game: Game): void {
  const z = qs("#zoom-readout");
  const f = qs("#focus-readout");
  if (z) z.textContent = String(game.mode === "photo" ? game.zoom : game.exploreZoom);
  if (f) f.textContent = String(game.focus);
}

export function turnTo(game: Game, dir: Heading): void {
  game.heading = dir;
  game.yaw = HEADING_ANGLE[dir];
  const scene = currentScene();
  scene?.setCameraEye(game.tile, game.heading, game.zoom);
  updateHooks(game);
  updateFrameGuide(game);
}

/** Enter or Take photo: one request, one announcement, one result. */
export async function takePhoto(game: Game): Promise<void> {
  if (game.scoring) return;
  game.scoring = true;
  const view = qs<HTMLElement>("#world-view");
  const scene = currentScene();
  clearRegion("Photo status");
  announce("Photo status", "Scoring…");

  const shotKey = `sk-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const dataUrl = scene ? scene.captureCanvas() : null;

  const bars = qs("#shutter-bars");
  if (bars && !reducedMotion()) {
    view?.setAttribute("data-shutter", "moving");
    bars.style.display = "block";
    window.setTimeout(() => {
      bars.style.display = "none";
      view?.setAttribute("data-shutter", "idle");
    }, 210);
  }
  const thumb = qs<HTMLElement>("#scoring-thumb");
  const thumbImg = qs<HTMLImageElement>("#thumb-img");
  if (thumb && thumbImg && dataUrl) {
    thumbImg.src = dataUrl;
    thumb.hidden = false;
  }

  const pose = {
    island: game.island,
    tile: game.tile,
    camera: game.tile,
    heading: game.heading,
    zoom: game.zoom,
    focus: game.focus,
    tick: game.tick
  };

  try {
    const blob = dataUrl
      ? await (await fetch(dataUrl)).blob()
      : new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" });
    const form = new FormData();
    form.append("image", blob, "shot.png");
    form.append("pose", JSON.stringify(pose));
    const res = await fetch("/api/photos", { method: "POST", headers: { "Shot-Key": shotKey }, body: form });
    const body = await res.json();
    if (!res.ok) {
      announce("Photo status", (body as { message: string }).message);
      if (thumb) thumb.hidden = true;
      return;
    }
    showResult(game, body as PhotoAnswer);
  } catch {
    announce("Photo status", "Couldn't reach the islands. Try again.");
  } finally {
    game.scoring = false;
    if (thumb) window.setTimeout(() => { thumb.hidden = true; }, 250);
  }
}

export function showResult(game: Game, body: PhotoAnswer): void {
  const dialog = qs<HTMLDialogElement>("#photo-result");
  const rows = qs("#result-rows");
  if (!dialog || !rows) return;
  const photo = body.photo;
  rows.innerHTML = "";
  const defs: [string, string, number][] = [
    ["Size", String(photo.measures.distance), photo.score.size],
    ["Centring", String(photo.measures.offset), photo.score.centring],
    ["Facing", photo.measures.creature_facing, photo.score.facing],
    ["Sharpness", String(photo.measures.focus_error), photo.score.sharpness]
  ];
  for (const [name, measure, points] of defs) {
    const div = el("div", {});
    div.append(el("span", {}, `${name} ${measure}`));
    const fig = el("span", { "data-figure": `score-${name.toLowerCase()}`, text: "0" });
    div.append(fig);
    rows.append(div);
    setFigure(fig, points, n => String(n));
  }
  const totalRow = el("div", { class: "score-total" });
  totalRow.append(el("span", {}, "Total"));
  const total = el("span", { "data-figure": "score-total", text: "0 / 100" });
  totalRow.append(total);
  rows.append(totalRow);
  setFigure(total, photo.score.total, n => `${n} / 100`);

  const filmNode = qs("[data-figure='film']");
  if (filmNode) setFigure(filmNode, photo.film, framesText);

  dialog.showModal();
  qs("#result-close")?.focus();
  announce("Photo status", `${photo.creature_name}: ${photo.score.total} points. Size ${photo.score.size}, centring ${photo.score.centring}, facing ${photo.score.facing}, sharpness ${photo.score.sharpness}.`);
  if (photo.album.page_filled) {
    announce("Photo status", `Album page filled: ${photo.creature_name}.`);
  }
  if (photo.album.stamp_earned) {
    const stampsNode = qs("[data-figure='stamps']");
    if (stampsNode) setFigure(stampsNode, 3, stampsText);
    game.lighthouse = "open";
    updateHooks(game);
    announce("World status", `Stamp earned for ${islandName(game.island)}. You have 3 stamps.`);
    announce("World status", "The lighthouse at Lantern Point is open.");
  }
  const postcardBtn = qs<HTMLButtonElement>("#result-postcard");
  if (postcardBtn) postcardBtn.dataset.photoId = photo.id;
}

export function openPostcardDialog(photoId: string): void {
  const post = qs<HTMLButtonElement>("#postcard-post");
  if (post) post.dataset.photoId = photoId;
  const dlg = qs<HTMLDialogElement>("#postcard-dialog");
  dlg?.showModal();
  qs<HTMLInputElement>("#postcard-email")?.focus();
}

export async function sendPostcard(game: Game, email: HTMLInputElement, line: HTMLInputElement): Promise<void> {
  const post = qs<HTMLButtonElement>("#postcard-post");
  const photoId = post?.dataset.photoId ?? "";
  if (!photoId) return;
  if (post?.dataset.pending === "1") return;
  post?.setAttribute("data-pending", "1");
  const requestKey = `rk-${Math.random().toString(36).slice(2)}`;
  announce("Postcard status", "Posting…");
  try {
    await api("POST", "/api/postcards", { photo: photoId, recipient: email.value, line: line.value }, { headers: { "Request-Key": requestKey } });
    announce("Postcard status", "Postcard posted.");
    const dlg = qs<HTMLDialogElement>("#postcard-dialog");
    dlg?.close();
    email.value = "";
    line.value = "";
    qs("#hud-album")?.focus();
  } catch (err) {
    if (err instanceof ApiCallError) announce("Postcard status", err.message);
  } finally {
    post?.removeAttribute("data-pending");
  }
  void game;
}
