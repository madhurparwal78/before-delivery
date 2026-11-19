// The play page: mounts the world, HUD, panels and dialogs, then runs the loop.

import { el, qs, qsa, announce, ensureStatusRegion, api, reducedMotion, param, framesText, stampsText, setFigure } from "../ui/core";
import { initLive, onLive, LiveEvent } from "../live";
import { IslandScene } from "../three/island";
import { islandName } from "../../shared/copy";
import { SPOTS, Heading, HEADING_ANGLE } from "../../shared/world";
import { Game, WorldAnswer, MeAnswer, setSceneRef, currentScene } from "./play-state";
import { simulate, updateHooks, updateCameraHook, updateFrameGuide, STEP_MS, KeyRecord, walkTo, tileFromClick, normYaw, setJoystickDir } from "./play-sim";
import { enterPhotoMode, leavePhotoMode, stepZoom, cycleFocus, takePhoto, turnTo, sendPostcard } from "./play-photo";
import { openPanel, closePanel, wireMap, refreshAlbums, refillFilm, startSafari, joinByCode, touchVisible } from "./play-panels";
import { toggleSound } from "../ui/sound";

export function mountPlay(): void {
  ensureStatusRegion("World status", "last5");
  ensureStatusRegion("Photo status", "last5");
  ensureStatusRegion("Frame guide");
  ensureStatusRegion("Safari status", "last5");
  ensureStatusRegion("Postcard status");
  ensureStatusRegion("Settings status");
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  void startPlay(main);
}

async function startPlay(main: HTMLElement): Promise<void> {
  let me: MeAnswer;
  try {
    me = await api<MeAnswer>("GET", "/api/me");
  } catch {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/signin?next=${next}`;
    return;
  }

  let island = me.position.island;
  let tile: [number, number] = [...me.position.tile] as [number, number];
  let heading: Heading = me.position.heading;
  let unknownSpot = false;

  const linkIsland = param("island");
  const linkSpot = param("spot");
  if (linkIsland !== null || linkSpot !== null) {
    const n = Number(linkIsland);
    const m = Number(linkSpot);
    if (!Number.isInteger(n) || n < 1 || n > 5 || !Number.isInteger(m) || m < 1 || m > 4) {
      unknownSpot = true;
    } else {
      island = n;
      tile = [...SPOTS[m - 1].tile] as [number, number];
      heading = SPOTS[m - 1].heading;
      await api("PUT", "/api/me/position", { island, tile, heading }).catch(() => undefined);
    }
  }

  const gfxOverride = param("gfx");
  const preset = gfxOverride === "light" || gfxOverride === "balanced" || gfxOverride === "full"
    ? gfxOverride
    : me.settings.graphics;

  const game: Game = {
    island, tile, heading,
    gait: "idle", mode: "explore",
    yaw: HEADING_ANGLE[heading],
    exploreYaw: HEADING_ANGLE[heading],
    exploreZoom: 2, zoom: 2, focus: 4,
    tick: 0, hour: 10, minute: 0, weather: "clear", dusk: false,
    lighthouse: me.lighthouse,
    creatures: [],
    preset,
    running: false,
    jumpQueued: false, jumpSteps: 0, walkCounter: 0,
    walkGoal: null, walkPath: [],
    seenCreatures: new Set(),
    scoring: false,
    playerId: me.player.id
  };

  main.append(buildShell(game, me));

  const stage = qs<HTMLElement>("#world-stage");
  const view = qs<HTMLElement>("#world-view");
  if (!stage || !view) return;

  const scene = new IslandScene(stage, island, reducedMotion(), preset);
  if (!scene.ok) {
    mountStillFallback(main, island);
    return;
  }
  setSceneRef(scene);
  view.dataset.playerId = me.player.id;
  scene.setExplorer(tile[0], tile[1], heading);
  scene.setCameraExplore(game.yaw, game.exploreZoom, tile, heading);

  if (unknownSpot) {
    announce("World status", "That spot doesn't exist. You are at Saltmarsh Harbour, spot 1.");
    history.replaceState({}, "", "/play?island=1&spot=1");
  }

  await refreshWorld(game);
  await refreshAlbums(game);
  announce("World status", `You are on ${islandName(island)}. ${qsa(".album-page.filled").length} of 4 album pages filled.`);

  initLive();
  onLive(ev => handleLive(ev, game));

  const keys = new Map<string, KeyRecord>();
  installKeyboard(game, keys);
  installTouch(game);
  installPointer(game);

  let lastStep = performance.now();
  scene.start((time: number) => {
    let due = Math.floor((time - lastStep) / STEP_MS);
    if (due > 0) {
      lastStep += due * STEP_MS;
      if (due > 12) due = 12;
      for (let i = 0; i < due; i++) simulate(game, keys, time - (due - i) * STEP_MS);
    }
    scene.tick(16);
    updateCameraHook();
  });

  view.setAttribute("data-state", "ready");
  updateHooks(game);
  updateFrameGuide(game, true);
}

// ---------- shell ----------

function buildShell(game: Game, me: MeAnswer): HTMLElement {
  const page = el("div", { class: "play-page" });
  // The skip link, the World view, then the HUD: Tab order follows the published list,
  // while CSS keeps the HUD bar on top of the screen.
  const skip = el("a", { class: "skip-link", href: "#still-content", text: "Skip to the text world" });

  const view = el("div", {
    id: "world-view",
    role: "application",
    tabindex: "0",
    "aria-label": "World view",
    "data-step": "0", "data-tick": "0", "data-island": "1", "data-tile": `${game.tile[0]},${game.tile[1]}`,
    "data-heading": game.heading, "data-gait": "idle", "data-mode": "explore",
    "data-yaw": String(HEADING_ANGLE[game.heading]), "data-zoom": "2", "data-focus": "",
    "data-in-view": "", "data-creatures": "", "data-world-hour": "10", "data-weather": "clear",
    "data-lighthouse": "closed", "data-preset": game.preset, "data-state": "loading",
    "data-camera": "", "data-guide": "hidden", "data-shutter": "idle",
    "data-host-island": "", "data-host-tile": ""
  });
  const stage = el("div", { id: "world-stage", class: "world-stage" });
  stage.append(view);

  const hud = el("div", { class: "hud", role: "toolbar", "aria-label": "Play controls" });
  page.append(skip, stage, hud);
  buildHud(hud, game, me);
  buildOverlays(stage);
  buildSheets(page, game);
  buildDialogs(page, game);
  return page;
}

function buildHud(hud: HTMLElement, game: Game, me: MeAnswer): void {
  const camera = el("button", { id: "hud-camera", "aria-pressed": "false", text: "Camera" });
  camera.addEventListener("click", () => {
    if (game.mode === "explore") enterPhotoMode(game);
    else leavePhotoMode(game);
  });
  hud.append(camera);

  const photoBtns = el("span", { id: "photo-buttons", hidden: "", role: "group", "aria-label": "Photo controls" });
  const zoomIn = el("button", { text: "Zoom in" });
  zoomIn.addEventListener("click", () => stepZoom(game, 1));
  const zoomOut = el("button", { text: "Zoom out" });
  zoomOut.addEventListener("click", () => stepZoom(game, -1));
  const focus = el("button", { text: "Focus" });
  focus.addEventListener("click", () => cycleFocus(game));
  const take = el("button", { class: "action", text: "Take photo" });
  take.addEventListener("click", () => void takePhoto(game));
  photoBtns.append(zoomIn, zoomOut, focus, take);
  hud.append(photoBtns);

  const mapBtn = el("button", { id: "hud-map", text: "Map" });
  mapBtn.addEventListener("click", () => openPanel("map", mapBtn));
  const albumBtn = el("button", { id: "hud-album", text: "Album" });
  albumBtn.addEventListener("click", () => openPanel("album", albumBtn));
  hud.append(mapBtn, albumBtn);

  const figures = el("span", { class: "hud-figures" });
  const filmFig = el("figure", { "data-figure": "film", "aria-hidden": "true", text: framesText(me.film) });
  const stampsFig = el("figure", { "data-figure": "stamps", "aria-hidden": "true", text: stampsText(me.stamps) });
  figures.append(filmFig, stampsFig);
  hud.append(figures);
  hud.append(el("span", { class: "spacer" }));

  const sound = el("button", { id: "sound", "aria-pressed": "false", text: "Sound" });
  sound.addEventListener("click", () => {
    const on = toggleSound();
    sound.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const settings = el("button", { id: "hud-settings", text: "Settings" });
  settings.addEventListener("click", () => openSettings(game, me));
  const restart = el("button", { id: "hud-restart", text: "Restart expedition" });
  restart.addEventListener("click", () => {
    const dlg = qs<HTMLDialogElement>("#restart-dialog");
    dlg?.setAttribute("data-opener-id", "hud-restart");
    dlg?.showModal();
    qs("#restart-confirm")?.focus();
  });
  hud.append(sound, settings, restart);

  const touch = el("div", { class: "touch-controls", id: "touch-controls" });
  const joystick = el("div", { class: "joystick", role: "group", "aria-label": "Joystick", id: "joystick" });
  joystick.append(el("span", { class: "knob", "aria-hidden": "true" }));
  const runJump = el("div", { class: "run-jump" });
  const run = el("button", { id: "run-btn", "aria-pressed": "false", text: "Run" });
  const jump = el("button", { id: "jump-btn", text: "Jump" });
  runJump.append(run, jump);
  touch.append(joystick, runJump);
  // After the HUD so Run and Jump come last in the tab order; positioned over the stage.
  hud.append(touch);
  syncTouch(touch);
  window.matchMedia("(max-width: 767.98px)").addEventListener("change", () => syncTouch());
}

function syncTouch(node?: HTMLElement): void {
  const touch = node ?? qs<HTMLElement>("#touch-controls");
  if (touch) touch.style.display = touchVisible() ? "flex" : "none";
}

function buildOverlays(stage: HTMLElement): void {
  const guide = el("div", { class: "frame-guide", id: "frame-guide", "aria-hidden": "true" });
  guide.append(el("div", { class: "guide-box" }));
  for (let i = 1; i <= 4; i++) guide.append(el("span", { class: `gc gc-${i}` }));
  guide.append(el("span", { class: "frame-label", id: "frame-label", text: "" }));
  stage.append(guide);

  const shutter = el("div", { class: "shutter-bars", id: "shutter-bars", "aria-hidden": "true" });
  shutter.append(el("i"), el("i"));
  stage.append(shutter);

  const readouts = el("div", { class: "photo-readouts", id: "photo-readouts" });
  readouts.append(el("span", { id: "zoom-readout", text: "1" }), el("span", { id: "focus-readout", text: "4" }));
  stage.append(readouts);

  const thumb = el("figure", { class: "scoring-thumb", id: "scoring-thumb", hidden: "" });
  thumb.append(el("img", { id: "thumb-img", alt: "" }));
  thumb.append(el("figcaption", {}, "Scoring"));
  stage.append(thumb);

  const safariStrip = el("section", { class: "safari-strip", id: "safari-strip", hidden: "", role: "region", "aria-label": "Safari" });
  stage.append(safariStrip);
}

function buildSheets(page: HTMLElement, game: Game): void {
  const modal = el("div", { class: "panel-modal", id: "panel-modal" });
  const sheet = el("div", { class: "sheet", id: "map-album-sheet", role: "dialog", "aria-label": "Map" });

  const mapPane = el("div", { class: "map-pane", id: "map-pane" });
  const mapHead = el("header", {});
  mapHead.append(el("h3", {}, "Island map"));
  const closeMap = el("button", { id: "close-map", text: "Close map" });
  mapHead.append(closeMap);
  mapPane.append(mapHead);
  const mapApp = el("div", { id: "island-map", role: "application", tabindex: "0", "aria-label": "Island map", "data-cursor": "3,12", "data-tile-size": "16" });
  mapPane.append(mapApp);
  const sailRow = el("div", { class: "album-links" });
  for (const island of [1, 2, 3, 4, 5]) {
    if (island === game.island) continue;
    const btn = el("button", { class: "sail-btn", text: `Sail to ${islandName(island)}`, "data-island": String(island) });
    btn.addEventListener("click", () => void sailTo(island));
    sailRow.append(btn);
  }
  const startSafariBtn = el("button", { id: "start-safari", text: "Start a shared safari" });
  startSafariBtn.addEventListener("click", () => void startSafari(game));
  const joinSafariBtn = el("button", { id: "join-safari", text: "Join a safari" });
  joinSafariBtn.addEventListener("click", () => {
    const dlg = qs<HTMLDialogElement>("#join-safari-dialog");
    dlg?.setAttribute("data-opener-id", "join-safari");
    dlg?.showModal();
    qs<HTMLInputElement>("#safari-code-input")?.focus();
  });
  sailRow.append(startSafariBtn, joinSafariBtn, el("a", { href: "/board", text: "Notice board" }));
  mapPane.append(sailRow);
  closeMap.addEventListener("click", closePanel);

  const albumPane = el("div", { class: "album-pane", id: "album-pane" });
  const albumHead = el("header", {});
  albumHead.append(el("h3", {}, "Album"));
  const closeAlbum = el("button", { id: "close-album", text: "Close album" });
  albumHead.append(closeAlbum);
  albumPane.append(albumHead);
  albumPane.append(el("div", { class: "island-tabs", role: "tablist", "aria-label": "Islands", id: "album-tabs" }));
  albumPane.append(el("figure", { "data-figure": "album-pages", "aria-hidden": "true", text: "0 of 4 pages" }));
  albumPane.append(el("ul", { class: "album-pages-list", id: "album-pages", role: "list", "aria-label": "Album pages" }));
  const albumLinks = el("div", { class: "album-links" });
  const refill = el("button", { id: "refill-film", text: "Refill film" });
  refill.addEventListener("click", () => void refillFilm(game));
  albumLinks.append(refill, el("a", { href: "/hall", text: "Your hall" }), el("a", { href: "/boards/1", text: "Challenge board" }));
  albumPane.append(albumLinks);
  closeAlbum.addEventListener("click", closePanel);

  const sep = el("div", {
    class: "pane-sep", role: "separator", "aria-label": "Resize map and album",
    tabindex: "0", "aria-valuenow": "50", "aria-valuemin": "30", "aria-valuemax": "70"
  });

  const panes = el("div", { class: "panes" });
  panes.append(mapPane, sep, albumPane);
  sheet.append(panes);
  modal.append(sheet);
  page.append(modal);

  if (window.matchMedia("(min-width: 1200px)").matches) {
    modal.classList.add("open");
    modal.style.position = "absolute";
    modal.style.pointerEvents = "none";
    sheet.style.pointerEvents = "auto";
  }

  wireMap(game, mapApp);
  wireSep(sep);
}

function wireSep(sep: HTMLElement): void {
  let dragging = false;
  const apply = (v: number) => {
    sep.setAttribute("aria-valuenow", String(v));
    const mapPane = qs<HTMLElement>("#map-pane");
    if (mapPane) mapPane.style.flexBasis = `${v}%`;
  };
  sep.addEventListener("pointerdown", ev => { dragging = true; sep.setPointerCapture(ev.pointerId); });
  sep.addEventListener("pointermove", ev => {
    if (!dragging) return;
    const sheet = qs<HTMLElement>("#map-album-sheet");
    if (!sheet) return;
    const pct = Math.min(70, Math.max(30, (ev.clientX - sheet.getBoundingClientRect().left) / sheet.clientWidth * 100));
    apply(Math.round(pct));
  });
  const up = () => { dragging = false; };
  sep.addEventListener("pointerup", up);
  sep.addEventListener("pointercancel", up);
  sep.addEventListener("keydown", ev => {
    let v = Number(sep.getAttribute("aria-valuenow") || "50");
    if (ev.key === "ArrowLeft") v = Math.max(30, v - 5);
    else if (ev.key === "ArrowRight") v = Math.min(70, v + 5);
    else if (ev.key === "Home") v = 30;
    else if (ev.key === "End") v = 70;
    else return;
    ev.preventDefault();
    apply(v);
  });
}

async function sailTo(island: number): Promise<void> {
  history.pushState({}, "", `/play?island=${island}&spot=1`);
  location.reload();
}

function buildDialogs(page: HTMLElement, game: Game): void {
  const result = el("dialog", { id: "photo-result", "aria-label": "Photo result" });
  const rbody = el("div", { class: "dialog-body" });
  rbody.append(el("h3", {}, "Photo result"));
  rbody.append(el("div", { class: "score-rows", id: "result-rows" }));
  const ractions = el("div", { class: "dialog-actions" });
  const close = el("button", { id: "result-close", text: "Close" });
  close.addEventListener("click", () => {
    qs<HTMLDialogElement>("#photo-result")?.close();
    qs("#world-view")?.focus();
  });
  const postcard = el("button", { id: "result-postcard", text: "Send as postcard" });
  postcard.addEventListener("click", () => {
    const photoId = postcard.dataset.photoId ?? "";
    qs<HTMLDialogElement>("#photo-result")?.close();
    void import("./play-photo.js").then(m => m.openPostcardDialog(photoId));
  });
  ractions.append(close, postcard);
  rbody.append(ractions);
  result.append(rbody);

  const restart = el("dialog", { id: "restart-dialog", role: "alertdialog", "aria-label": "Restart the expedition?" });
  const body2 = el("div", { class: "dialog-body" });
  body2.append(el("h3", {}, "Restart the expedition?"));
  body2.append(el("p", {}, "Start the whole expedition again?"));
  const actions2 = el("div", { class: "dialog-actions" });
  const confirm = el("button", { class: "action", id: "restart-confirm", text: "Restart" });
  confirm.addEventListener("click", () => void doRestart(game));
  const keep = el("button", { id: "restart-keep", text: "Keep playing" });
  keep.addEventListener("click", () => {
    qs<HTMLDialogElement>("#restart-dialog")?.close();
    qs("#hud-restart")?.focus();
  });
  actions2.append(confirm, keep);
  body2.append(actions2);
  restart.append(body2);

  const join = el("dialog", { id: "join-safari-dialog", "aria-label": "Join a safari" });
  const jbody = el("div", { class: "dialog-body" });
  jbody.append(el("h3", {}, "Join a safari"));
  const code = el("input", { type: "text", id: "safari-code-input", "aria-label": "Safari code", autocomplete: "off", maxlength: "6" });
  jbody.append(code);
  const jactions = el("div", { class: "dialog-actions" });
  const joinBtn = el("button", { class: "action", id: "join-btn", text: "Join" });
  jactions.append(joinBtn);
  jbody.append(jactions);
  join.append(jbody);
  code.addEventListener("keydown", ev => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void joinByCode(game, code, join);
    }
  });
  joinBtn.addEventListener("click", () => void joinByCode(game, code, join));

  const settings = el("dialog", { id: "settings-dialog", "aria-label": "Settings" });
  const sbody = el("div", { class: "dialog-body" });
  sbody.append(el("h3", {}, "Settings"));
  const sliders = el("div", { class: "settings-sliders" });
  const musicLabel = el("label", {}, "Music volume");
  const music = el("input", { type: "range", id: "music-slider", min: "0", max: "100", step: "5", value: "60" });
  musicLabel.append(music);
  const effectsLabel = el("label", {}, "Effects volume");
  const effects = el("input", { type: "range", id: "effects-slider", min: "0", max: "100", step: "5", value: "80" });
  effectsLabel.append(effects);
  const graphics = el("div", { role: "radiogroup", "aria-label": "Graphics", class: "radiogroup" });
  for (const g of ["full", "balanced", "light"] as const) {
    const label = el("label", {});
    const radio = el("input", { type: "radio", name: "graphics", value: g, id: `gfx-${g}` });
    radio.setAttribute("aria-label", g[0].toUpperCase() + g.slice(1));
    if (g === game.preset) radio.checked = true;
    label.append(radio, document.createTextNode(g[0].toUpperCase() + g.slice(1)));
    graphics.append(label);
  }
  sliders.append(musicLabel, effectsLabel, graphics);
  sbody.append(sliders);
  const sactions = el("div", { class: "dialog-actions" });
  const save = el("button", { class: "action", id: "save-settings", text: "Save settings" });
  sactions.append(save);
  sbody.append(sactions);
  settings.append(sbody);

  const postcardDlg = el("dialog", { id: "postcard-dialog", "aria-label": "Send postcard" });
  const pbody = el("div", { class: "dialog-body" });
  pbody.append(el("h3", {}, "Send postcard"));
  const email = el("input", { type: "email", id: "postcard-email", "aria-label": "Recipient email", autocomplete: "email" });
  const line = el("input", { type: "text", id: "postcard-line", "aria-label": "Your line", maxlength: "140" });
  pbody.append(email, line);
  const pactions = el("div", { class: "dialog-actions" });
  const post = el("button", { class: "action", id: "postcard-post", text: "Post" });
  pactions.append(post);
  pbody.append(pactions);
  postcardDlg.append(pbody);
  post.addEventListener("click", () => void sendPostcard(game, email, line));

  page.append(result, restart, join, settings, postcardDlg);

  // Native Escape on a dialog also returns focus to its opener.
  for (const dlg of [result, restart, join, settings, postcardDlg]) {
    dlg.addEventListener("close", () => {
      const openerId = dlg.dataset.openerId;
      const opener = openerId ? document.getElementById(openerId) : null;
      (opener ?? qs("#world-view"))?.focus();
    });
  }
  result.dataset.openerId = "world-view";
}

function openSettings(game: Game, me: MeAnswer): void {
  const dlg = qs<HTMLDialogElement>("#settings-dialog");
  const music = qs<HTMLInputElement>("#music-slider");
  const effects = qs<HTMLInputElement>("#effects-slider");
  if (music) music.value = String(me.settings.music);
  if (effects) effects.value = String(me.settings.effects);
  const radio = qs<HTMLInputElement>(`#gfx-${game.preset}`);
  if (radio) radio.checked = true;
  dlg?.setAttribute("data-opener-id", "hud-settings");
  dlg?.showModal();
  music?.focus();
  const save = qs<HTMLButtonElement>("#save-settings");
  const onSave = async () => {
    const musicVal = Number(music?.value ?? 60);
    const effectsVal = Number(effects?.value ?? 80);
    const checked = qs<HTMLInputElement>("input[name='graphics']:checked");
    const graphicsVal = (checked?.value ?? game.preset) as "full" | "balanced" | "light";
    try {
      await api("PUT", "/api/me/settings", { music: musicVal, effects: effectsVal, graphics: graphicsVal });
      announce("Settings status", "Settings saved.");
      dlg?.close();
      qs("#hud-settings")?.focus();
    } catch {
      announce("Settings status", "Couldn't save settings. Try again.");
    }
    save?.removeEventListener("click", onSave);
  };
  save?.addEventListener("click", onSave);
}

async function doRestart(game: Game): Promise<void> {
  try {
    const res = await api<{ film: number; stamps: number; lighthouse: string; position: { island: number; tile: [number, number]; heading: Heading } }>("POST", "/api/me/restart", {});
    qs<HTMLDialogElement>("#restart-dialog")?.close();
    game.tile = [...res.position.tile] as [number, number];
    game.island = res.position.island;
    game.heading = res.position.heading;
    game.lighthouse = "closed";
    game.seenCreatures.clear();
    const filmNode = qs("[data-figure='film']");
    const stampsNode = qs("[data-figure='stamps']");
    if (filmNode) filmNode.textContent = framesText(res.film);
    if (stampsNode) stampsNode.textContent = stampsText(0);
    currentScene()?.setExplorer(game.tile[0], game.tile[1], game.heading);
    updateHooks(game);
    await refreshAlbums(game);
    announce("World status", "Expedition restarted. You are on Saltmarsh Harbour.");
    if (location.pathname !== "/play") history.replaceState({}, "", "/play");
  } catch {
    // keep the dialog open on failure
  }
}

// ---------- world + live ----------

async function refreshWorld(game: Game): Promise<void> {
  const w = await api<WorldAnswer>("GET", "/api/world");
  const prevWeather = game.weather;
  const prevDusk = game.dusk;
  const firstLoad = game.tick === 0 && game.creatures.length === 0;
  game.tick = w.tick;
  game.hour = w.hour;
  game.minute = w.minute;
  game.weather = w.weather;
  game.dusk = w.dusk;
  game.lighthouse = w.lighthouse;
  game.creatures = w.creatures.map(c => ({ ...c }));
  const scene = currentScene();
  scene?.setState({ hour: w.hour, weather: w.weather, dusk: w.dusk, lighthouse: w.lighthouse, preset: game.preset });
  scene?.updateCreatures(game.creatures.filter(c => c.island === game.island));
  updateHooks(game);
  updateFrameGuide(game, true);
  // Weather and dusk announcements arrive only on a change while the page is open.
  if (!firstLoad && prevWeather !== w.weather) {
    announce("World status", w.weather === "rain" ? "Rain begins on the islands." : "The rain stops.");
  }
  if (!firstLoad && prevDusk !== w.dusk) {
    announce("World status", w.dusk ? "Dusk falls on the islands." : "Dusk is over.");
  }
}

function handleLive(ev: LiveEvent, game: Game): void {
  const p = ev.payload as Record<string, unknown>;
  const view = qs<HTMLElement>("#world-view");
  const meId = view?.dataset.playerId ?? "";
  switch (ev.kind) {
    case "clock":
    case "tick":
      void refreshWorld(game);
      break;
    case "film":
      if (p.player_id === meId) {
        const node = qs("[data-figure='film']");
        if (node) node.textContent = framesText(Number(p.film));
      }
      break;
    case "restart":
      if (p.player_id === meId) {
        game.tile = [3, 12];
        game.island = 1;
        game.heading = "E";
        game.lighthouse = "closed";
        game.seenCreatures.clear();
        currentScene()?.setExplorer(3, 12, "E");
        updateHooks(game);
        void refreshAlbums(game);
        announce("World status", "Expedition restarted. You are on Saltmarsh Harbour.");
      }
      break;
    case "position": {
      const targetId = String(p.player_id);
      const island = Number(p.island);
      const tile = p.tile as [number, number];
      if (targetId === meId) {
        game.tile = [...tile];
        game.island = island;
        game.heading = p.heading as Heading;
        updateHooks(game);
      } else {
        view?.setAttribute("data-host-island", String(island));
        view?.setAttribute("data-host-tile", `${tile[0]},${tile[1]}`);
      }
      break;
    }
    case "photo": {
      const mine = p.player_id === meId;
      if (mine) {
        // The same player's photo in another tab: page, stamp, lighthouse and film follow live.
        const filmNode = qs("[data-figure='film']");
        if (filmNode && p.film !== undefined) setFigure(filmNode, Number(p.film), framesText);
        const album = p.album as { page_filled?: boolean; stamp_earned?: boolean; pages_filled?: number } | undefined;
        if (album?.stamp_earned) {
          const stampsNode = qs("[data-figure='stamps']");
          if (stampsNode) setFigure(stampsNode, 3, stampsText);
          game.lighthouse = "open";
          updateHooks(game);
          announce("World status", `Stamp earned for ${islandName(game.island)}. You have 3 stamps.`);
          announce("World status", "The lighthouse at Lantern Point is open.");
        }
        void refreshAlbums(game);
        void refreshWorld(game);
        break;
      }
      const feed = qs("#safari-feed");
      if (feed) {
        const line = el("li", {}, `Host photographed ${String(p.creature_name)}: ${Number(p.total)} points.`);
        const img = el("img", {
          src: `/api/photos/${String(p.photo_id)}/image`,
          alt: `${String(p.creature_name)} photo by host`,
          style: "width:100%;border-radius:4px;display:block"
        });
        line.prepend(img);
        feed.append(line);
      }
      break;
    }
    case "sighting": {
      const list = qs("#sightings-list");
      const text = `Sighting at ${Number(p.x)}, ${Number(p.y)} by ${String(p.by)}`;
      if (list) list.append(el("li", {}, text));
      announce("Safari status", text);
      break;
    }
    case "safari": {
      if (p.joined && String(p.host_id) === meId) {
        announce("Safari status", `${String(p.joined)} joined your safari.`);
      }
      if (p.left && String(p.host_id) === meId) {
        announce("Safari status", `${String(p.left)} left. The guest seat is free.`);
      }
      break;
    }
    default:
      break;
  }
}

// ---------- input ----------

function installKeyboard(game: Game, keys: Map<string, KeyRecord>): void {
  window.addEventListener("keydown", ev => {
    const target = ev.target as HTMLElement;
    const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    const view = qs<HTMLElement>("#world-view");
    const viewFocused = document.activeElement === view;

    if (viewFocused && !inField) {
      const name = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      const rec = keys.get(name);
      if (rec) { rec.down = ev.timeStamp; rec.up = null; }
      else keys.set(name, { down: ev.timeStamp, up: null });
      handleGameKey(game, ev);
      return;
    }

    if (ev.key === "Escape") {
      const openDlg = qsa<HTMLDialogElement>("dialog[open]").pop();
      if (openDlg) {
        openDlg.close();
        const openerId = (openDlg as HTMLElement).dataset.openerId;
        const opener = openerId ? document.getElementById(openerId) : null;
        (opener ?? view)?.focus();
        return;
      }
      const modal = qs("#panel-modal");
      if (modal?.classList.contains("open") && !window.matchMedia("(min-width: 1200px)").matches) {
        closePanel();
        view?.focus();
      }
    }
  });
  window.addEventListener("keyup", ev => {
    const name = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const rec = keys.get(name);
    if (rec) rec.up = ev.timeStamp;
  });
}

function handleGameKey(game: Game, ev: KeyboardEvent): void {
  const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  const inPhoto = game.mode === "photo";
  switch (k) {
    case "w": case "ArrowUp": case "a": case "ArrowLeft": case "s": case "ArrowDown": case "d": case "ArrowRight": {
      if (inPhoto) {
        const dir: Heading = k === "w" || k === "ArrowUp" ? "N" : k === "a" || k === "ArrowLeft" ? "W" : k === "s" || k === "ArrowDown" ? "S" : "E";
        turnTo(game, dir);
      }
      ev.preventDefault();
      break;
    }
    case "r":
      game.running = !game.running;
      syncRun(game);
      ev.preventDefault();
      break;
    case " ":
      if (!inPhoto) game.jumpQueued = true;
      ev.preventDefault();
      break;
    case "q":
      if (inPhoto) turnTo(game, turnLeft(game.heading));
      else { game.yaw = normYaw(game.yaw - 90); updateHooks(game); }
      ev.preventDefault();
      break;
    case "e":
      if (inPhoto) turnTo(game, turnRight(game.heading));
      else { game.yaw = normYaw(game.yaw + 90); updateHooks(game); }
      ev.preventDefault();
      break;
    case "+": case "=":
      stepZoom(game, 1);
      ev.preventDefault();
      break;
    case "-": case "_":
      stepZoom(game, -1);
      ev.preventDefault();
      break;
    case "Home":
      if (inPhoto) {
        game.zoom = 1;
        game.focus = 4;
        turnTo(game, game.heading);
      } else {
        game.yaw = HEADING_ANGLE[game.heading];
        game.exploreZoom = 2;
        updateHooks(game);
      }
      ev.preventDefault();
      break;
    case "c":
      if (inPhoto) leavePhotoMode(game); else enterPhotoMode(game);
      ev.preventDefault();
      break;
    case "m":
      openPanel("map");
      ev.preventDefault();
      break;
    case "j":
      openPanel("album");
      ev.preventDefault();
      break;
    case "f":
      if (inPhoto) cycleFocus(game);
      ev.preventDefault();
      break;
    case "Enter":
      if (inPhoto) void takePhoto(game);
      ev.preventDefault();
      break;
    case "Escape":
      if (inPhoto) leavePhotoMode(game);
      ev.preventDefault();
      break;
    default:
      break;
  }
}

function turnLeft(h: Heading): Heading { return { N: "W", W: "S", S: "E", E: "N" }[h] as Heading; }
function turnRight(h: Heading): Heading { return { N: "E", E: "S", S: "W", W: "N" }[h] as Heading; }

function syncRun(game: Game): void {
  const run = qs<HTMLButtonElement>("#run-btn");
  run?.setAttribute("aria-pressed", game.running ? "true" : "false");
}

function installTouch(game: Game): void {
  const joystick = qs<HTMLElement>("#joystick");
  if (joystick) {
    let active: { id: number; x: number; y: number } | null = null;
    joystick.addEventListener("pointerdown", ev => {
      active = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      joystick.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    joystick.addEventListener("pointermove", ev => {
      if (!active || ev.pointerId !== active.id) return;
      const dx = ev.clientX - active.x;
      const dy = ev.clientY - active.y;
      if (Math.hypot(dx, dy) >= 16) {
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "E" : "W") : (dy > 0 ? "S" : "N");
        if (game.mode === "photo") turnTo(game, dir);
        else setJoystickDir(dir);
      }
    });
    const up = () => { active = null; setJoystickDir(null); };
    joystick.addEventListener("pointerup", up);
    joystick.addEventListener("pointercancel", up);
  }
  qs("#run-btn")?.addEventListener("click", () => {
    game.running = !game.running;
    syncRun(game);
  });
  qs("#jump-btn")?.addEventListener("click", () => { game.jumpQueued = true; });
}

function installPointer(game: Game): void {
  const stage = qs<HTMLElement>("#world-stage");
  if (!stage) return;
  let down: { x: number; y: number; startYaw: number } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let gestureStartDist = 0;
  let gestureStartZoom = 0;

  stage.addEventListener("pointerdown", ev => {
    if (ev.pointerType === "mouse") {
      down = { x: ev.clientX, y: ev.clientY, startYaw: game.yaw };
      return;
    }
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      gestureStartDist = Math.hypot(a.x - b.x, a.y - b.y);
      gestureStartZoom = game.mode === "photo" ? game.zoom : game.exploreZoom;
    }
  });

  stage.addEventListener("pointermove", ev => {
    if (ev.pointerType === "mouse") {
      if (!down) return;
      if (game.mode === "explore") {
        game.yaw = normYaw(down.startYaw + Math.ceil(ev.clientX - down.x) / 2);
        updateHooks(game);
      }
      return;
    }
    const t = touches.get(ev.pointerId);
    if (!t) return;
    t.x = ev.clientX;
    t.y = ev.clientY;
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const steps = Math.trunc((dist - gestureStartDist) / 40);
      const maxZoom = game.mode === "photo" ? 4 : 4;
      const minZoom = 1;
      let target = Math.max(minZoom, Math.min(maxZoom, gestureStartZoom + steps));
      if (game.mode === "photo" && target === 3) target = 4;
      if (game.mode === "photo") game.zoom = target as 1 | 2 | 4;
      else game.exploreZoom = target;
      updateHooks(game);
    }
  });

  const clear = (ev: PointerEvent) => {
    if (ev.pointerType === "mouse") {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 6) {
        const target = tileFromClick(game, ev.clientX, ev.clientY);
        if (target) walkTo(game, target);
      }
      down = null;
      return;
    }
    touches.delete(ev.pointerId);
  };
  stage.addEventListener("pointerup", clear);
  stage.addEventListener("pointercancel", clear);
  stage.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    if (game.mode === "explore") enterPhotoMode(game);
    else leavePhotoMode(game);
  });
}

// ---------- still fallback ----------

function mountStillFallback(main: HTMLElement, island: number): void {
  const view = qs<HTMLElement>("#world-view");
  view?.setAttribute("data-state", "still");
  const wrap = el("div", { class: "still-fallback", id: "still-content" });
  const name = islandName(island);
  wrap.append(el("h2", {}, name));
  wrap.append(el("img", { class: "still-map", src: `/assets/still-map-${island}.png`, alt: `Still map of ${name}` }));
  wrap.append(el("p", { class: "notice error-band", text: "3D is not available here. The text world below has everything." }));
  const text = el("div", { id: "text-world-content" });
  wrap.append(text);
  main.append(wrap);
  void import("./text-world.js").then(m => m.renderTextWorld(text));
}
