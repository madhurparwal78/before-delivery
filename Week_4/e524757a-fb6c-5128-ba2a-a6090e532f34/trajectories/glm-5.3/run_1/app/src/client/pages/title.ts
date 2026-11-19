// The title screen: the live viewfinder holding Wump, the reel, and the islands.

import { el, qs, announce, ensureStatusRegion, reducedMotion, api } from "../ui/core";
import { WumpScene } from "../three/wump";

export function mountTitle(): void {
  ensureStatusRegion("Guide status", "last5");
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  main.append(buildTitle());
  wireGuide();
  void loadAccount();
}

function buildTitle(): HTMLElement {
  const page = el("div", { class: "title-screen" });

  const top = el("header", { class: "title-top" });
  top.append(el("a", { class: "wordmark", href: "/", text: "Hushfoot" }));
  const nav = el("nav", { "aria-label": "Site" });
  nav.append(el("a", { href: "#islands", text: "Islands" }));
  nav.append(el("a", { href: "/text-world", text: "Text world" }));
  const accountSlot = el("span", { id: "account-slot" });
  const account = el("span", { id: "account-signed-out" });
  account.append(el("a", { href: "/signin", text: "Sign in" }));
  accountSlot.append(account);
  nav.append(accountSlot);
  nav.append(el("a", { class: "action", href: "/play", text: "Start walking" }));
  top.append(nav);
  page.append(top);

  const hero = el("section", { class: "hero-split" });
  const left = el("div", { class: "hero-left" });
  left.append(el("h1", { class: "hero-headline", text: "Walk softly" }));
  const right = el("div", { class: "hero-right" });
  right.append(el("p", { class: "hero-headline", text: "and bring film." }));

  // The live viewfinder is the guide creature: focus it to play with Wump.
  const viewfinder = el("div", {
    class: "viewfinder",
    id: "viewfinder",
    role: "application",
    tabindex: "0",
    "aria-roledescription": "Guide creature",
    "aria-label": "Guide creature",
    "data-spin": "0",
    "data-zoom": "1.00",
    "data-stretch": "0.00",
    "data-nudges": "0",
    "data-state": "ready"
  });
  viewfinder.setAttribute("id", "guide-creature");
  const corners = el("div", { class: "vf-corners", "aria-hidden": "true" });
  corners.append(el("span"), el("span"), el("span"), el("span"));
  viewfinder.append(corners);
  viewfinder.append(el("span", { class: "sr-only", text: "Wump, the guide creature. Use arrow keys to spin, plus and minus to zoom, space to nudge." }));

  const heroMid = el("div", {});
  heroMid.append(viewfinder);

  const controls = el("div", { class: "guide-controls" });
  controls.append(el("button", { id: "reset-view", text: "Reset view" }));
  const sound = el("button", { id: "sound", "aria-pressed": "false", text: "Sound" });
  controls.append(sound);
  controls.append(slider("Demo zoom", "demo-zoom", 50, 200, 100));
  controls.append(slider("Demo focus", "demo-focus", 50, 200, 100));
  heroMid.append(controls);
  hero.append(left, heroMid, right);
  page.append(hero);

  page.append(buildReel());
  page.append(buildSequence());
  page.append(buildIslands());
  page.append(el("footer", { class: "title-foot", text: "Hushfoot is a family wildlife photography game. Creatures are only photographed, never caught or harmed." }));
  return page;
}

function slider(name: string, id: string, min: number, max: number, value: number): HTMLElement {
  return el("input", { type: "range", id, min, max, value, step: "25", "aria-label": name });
}

function buildReel(): HTMLElement {
  const reel = el("section", { class: "fragment-reel", "aria-label": "Working fragments" });
  const f1 = el("figure", { class: "fragment", "data-ui": "zoom-readout" });
  f1.append(el("div", { class: "fragment-frame" }, el("img", { src: "/assets/coast-1.png", alt: "Zoom fragment: a coastal path" })));
  f1.append(el("figcaption", {}, "Zoom 2.0 — frame the tide-newt without stepping closer."));

  const f2 = el("figure", { class: "fragment", "data-ui": "score-breakdown" });
  const rows = el("div", { class: "fragment-rows" });
  rows.append(row("Size", "30"));
  rows.append(row("Centring", "25"));
  rows.append(row("Facing", "25"));
  rows.append(row("Sharpness", "20"));
  const total = el("p", { style: "font-weight:700" }, "100 / 100");
  f2.append(el("div", { class: "fragment-frame" }, rows));
  f2.append(el("figcaption", {}, total));
  f2.append(el("figcaption", {}, "The server scores every photo. Four figures, one total."));

  const f3 = el("figure", { class: "fragment", "data-ui": "album-page" });
  const page = el("div", { class: "fragment-frame" }, el("img", { src: "/assets/album-fragment.png", alt: "Album fragment: a filled tide-newt page" }));
  f3.append(page);
  f3.append(el("figcaption", {}, "Mossback newt — 4 of 4 pages"));
  reel.append(f1, f2, f3);
  return reel;
}

function row(name: string, value: string): HTMLElement {
  const div = el("div", {});
  div.append(el("span", {}, name));
  div.append(el("span", {}, value));
  return div;
}

function buildSequence(): HTMLElement {
  const seq = el("section", { class: "statement-sequence", "aria-label": "How it works" });
  const s1 = el("section", {});
  s1.append(el("h2", {}, "Set the zoom"));
  s1.append(el("p", {}, "Step the lens through 1, 2 and 4 to size the creature without chasing it."));
  const s2 = el("section", {});
  s2.append(el("h2", {}, "Hold the focus"));
  s2.append(el("p", {}, "Cycle focus at 2, 4, 8 and 16 so the newt lands sharp at its distance."));
  const s3 = el("section", {});
  s3.append(el("h2", {}, "Read the score"));
  s3.append(el("p", {}, "The server reads your pose and answers with four figures out of one hundred."));
  seq.append(s1, s2, s3);
  return seq;
}

function buildIslands(): HTMLElement {
  const wrap = el("section", { class: "islands-section", id: "islands", "aria-label": "Islands" });
  wrap.append(el("h2", {}, "Five islands"));
  const grid = el("div", { class: "island-grid" });
  const islands: [string, string][] = [
    ["Saltmarsh Harbour", "The dock, the pond, and the notice board."],
    ["Fernhollow", "Fern paths and a stag that keeps its own route."],
    ["Driftglass Reef", "Tide pools that flash like bottle glass."],
    ["Mistcrown Fells", "Goat crags above the mist line."],
    ["Lantern Point", "The lighthouse that opens for three stamps."]
  ];
  for (const [name, blurb] of islands) {
    const card = el("div", { class: "panel island-card" });
    card.append(el("h3", {}, name));
    card.append(el("p", {}, blurb));
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

// ---------- guide creature ----------

interface GuideState { spin: number; zoom: number; stretch: number; nudges: number }

let state: GuideState = { spin: 0, zoom: 1, stretch: 0, nudges: 0 };
let scene: WumpScene | null = null;

function wireGuide(): void {
  const host = qs<HTMLElement>("#viewfinder");
  const app = qs<HTMLElement>("#guide-creature");
  if (host) {
    scene = new WumpScene(host, reducedMotion());
    scene.start();
  }

  if (app) {
    app.addEventListener("keydown", (ev) => {
      const key = ev.key;
      let handled = true;
      switch (key) {
        case "ArrowLeft": case "q": case "Q": bumpSpin(-15); break;
        case "ArrowRight": case "e": case "E": bumpSpin(15); break;
        case "+": case "=": setZoom(state.zoom + 0.25); break;
        case "-": case "_": setZoom(state.zoom - 0.25); break;
        case " ": nudge(); break;
        case "Home": resetView(); break;
        default: handled = false;
      }
      if (handled) ev.preventDefault();
    });

    let pointer: { id: number; x: number; y: number } | null = null;
    app.addEventListener("pointerdown", (ev) => {
      pointer = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      app.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    app.addEventListener("pointermove", (ev) => {
      if (!pointer || ev.pointerId !== pointer.id) return;
      const dx = ev.clientX - pointer.x;
      const dist = Math.hypot(dx, ev.clientY - pointer.y);
      const steps = Math.round(dx / 20);
      if (steps !== 0) {
        setSpin(state.spin + steps * 15);
        pointer.x = ev.clientX;
      }
      setStretch(Math.min(1, dist / 200), true);
    });
    const release = () => {
      if (!pointer) return;
      pointer = null;
      springBack();
    };
    app.addEventListener("pointerup", release);
    app.addEventListener("pointercancel", release);
  }

  qs<HTMLButtonElement>("#reset-view")?.addEventListener("click", resetView);

  const soundBtn = qs<HTMLButtonElement>("#sound");
  soundBtn?.addEventListener("click", () => {
    const on = toggleSound();
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  const zoom = qs<HTMLInputElement>("#demo-zoom");
  zoom?.addEventListener("input", () => setZoom(Number(zoom.value) / 100));
  const focus = qs<HTMLInputElement>("#demo-focus");
  focus?.addEventListener("input", () => {
    if (scene) scene.setFocus(Number(focus.value) / 100);
  });
}

function bumpSpin(delta: number): void {
  setSpin(state.spin + delta);
  announce("Guide status", `Wump faces ${state.spin} degrees.`);
}

function setSpin(deg: number): void {
  state.spin = ((Math.round(deg / 15) * 15) % 360 + 360) % 360;
  qs<HTMLElement>("#guide-creature")?.setAttribute("data-spin", String(state.spin));
  scene?.setSpin(state.spin);
}

function setZoom(z: number): void {
  const clamped = Math.min(2, Math.max(0.5, Math.round(z * 4) / 4));
  if (clamped === state.zoom) return;
  state.zoom = clamped;
  qs<HTMLElement>("#guide-creature")?.setAttribute("data-zoom", state.zoom.toFixed(2));
  scene?.setZoom(state.zoom);
  const zoomInput = qs<HTMLInputElement>("#demo-zoom");
  if (zoomInput) zoomInput.value = String(state.zoom * 100);
  announce("Guide status", `Wump at ${Math.round(state.zoom * 100)} percent.`);
}

function setStretch(v: number, hold: boolean): void {
  state.stretch = Math.min(1, Math.max(0, v));
  qs<HTMLElement>("#guide-creature")?.setAttribute("data-stretch", state.stretch.toFixed(2));
  scene?.setStretch(state.stretch);
  if (!hold) springBack();
}

function springBack(): void {
  if (reducedMotion()) {
    setStretch(0, true);
    return;
  }
  const start = performance.now();
  const from = state.stretch;
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / 600);
    setStretch(from * (1 - t), true);
    if (t < 1 && state.stretch > 0) requestAnimationFrame(step);
    else setStretch(0, true);
  };
  requestAnimationFrame(step);
}

function nudge(): void {
  state.nudges += 1;
  qs<HTMLElement>("#guide-creature")?.setAttribute("data-nudges", String(state.nudges));
  announce("Guide status", "Wump hops.");
  if (!reducedMotion()) scene?.hop();
  window.setTimeout(() => announce("Guide status", "Wump is back at rest."), 450);
}

function resetView(): void {
  setSpin(0);
  state.zoom = 1;
  qs<HTMLElement>("#guide-creature")?.setAttribute("data-zoom", "1.00");
  scene?.setZoom(1);
  const zoomInput = qs<HTMLInputElement>("#demo-zoom");
  if (zoomInput) zoomInput.value = "100";
  setStretch(0, true);
  announce("Guide status", "Wump is back at rest.");
}

async function loadAccount(): Promise<void> {
  try {
    const me = await api<{ player: { name: string; handle: string }; film: number }>("GET", "/api/me");
    const slot = qs("#account-slot");
    if (slot) {
      slot.innerHTML = "";
      const btn = el("button", { id: "account-btn", text: "Account" });
      const menu = el("div", { role: "menu", "aria-label": "Account", id: "account-menu" });
      menu.hidden = true;
      const hall = el("a", { role: "menuitem", href: "/hall", text: "Your hall" });
      const signOut = el("button", { role: "menuitem", id: "sign-out", text: "Sign out" });
      const filmLine = el("span", { "data-figure": "film", role: "menuitem", text: `${me.film} frames` });
      menu.append(hall, signOut, filmLine);
      btn.addEventListener("click", () => { menu.hidden = !menu.hidden; });
      signOut.addEventListener("click", async () => {
        await api("DELETE", "/api/session");
        location.href = "/";
      });
      slot.append(btn, menu);
    }
  } catch {
    // signed out: keep the sign-in link
  }
}

// Sound is shared with the play page; a tiny module-level graph lives in ui/sound.
import { toggleSound } from "../ui/sound";
