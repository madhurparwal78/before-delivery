// The app shell: routing, session, the title screen and global banners.
import { api, type Player, type Session, type StatusBody } from "./api";
import { el, clear, openDialog, type DialogHandle } from "./ui";
import { showNotice, noticeChoice } from "./notice";
import { createStage, type StageHandle } from "./stage";

import { openNightsPanel } from "./nights";
import { openHistoryPanel } from "./history";
import { openSettingsPanel, openPauseMenu, type SettingsCtx } from "./settings";
import { openJoinPanel } from "./join";
import { openRoomHUD } from "./hud";
import { wordmarkSVG } from "./wordmark";

export interface App {
  me: Player | null;
  settings: SettingsCtx["settings"] | null;
  status: StatusBody | null;
  stage: StageHandle;
  root: HTMLElement;
  setNotices: (text: string) => void;
  refreshStatus: () => Promise<void>;
  openCallsign: (then?: () => void) => void;
  ensureSession: (action: () => void) => void;
  startRoom: (mode: "siege" | "convoy") => Promise<void>;
  enterRoom: (code: string) => Promise<void>;
  toast: (text: string) => void;
  saveSettings: (s: SettingsCtx["settings"]) => Promise<void>;
  activeRoomCode: string | null;
}

let app: App;

function route(): { screen: string; code?: string } {
  const p = location.pathname;
  if (p === "/nights") return { screen: "nights" };
  if (p.startsWith("/room/")) return { screen: "join", code: decodeURIComponent(p.slice(6)) };
  return { screen: "title" };
}

async function main(): Promise<void> {
  const root = document.getElementById("app")!;
  const stageRoot = document.getElementById("stage")!;
  const stage = createStage(stageRoot);

  const noticesEl = el("div", { role: "status", "aria-label": "Notices", style: "display:none" });
  noticesEl.className = "notices";
  const bannerEl = el("div", { role: "status", "aria-label": "Service status", style: "display:none" });
  bannerEl.className = "banner";
  document.body.append(bannerEl, noticesEl);

  const state: App = {
    me: null,
    settings: null,
    status: null,
    stage,
    root,
    activeRoomCode: null,
    setNotices: undefined as never,
    refreshStatus: undefined as never,
    openCallsign: undefined as never,
    ensureSession: undefined as never,
    startRoom: undefined as never,
    enterRoom: undefined as never,
    toast: undefined as never,
    saveSettings: undefined as never,
  };
  app = state;

  state.setNotices = (text: string): void => {
    if (text) {
      noticesEl.style.display = "block";
      noticesEl.textContent = text;
    } else {
      noticesEl.style.display = "none";
    }
  };
  state.refreshStatus = async (): Promise<void> => {
    const res = await api.get<StatusBody>("/status");
    if (res.body) {
      state.status = res.body;
      const lines: string[] = [];
      if (res.body.services.valkey === "down") lines.push("Rooms offline — the room registry is reconnecting. Nights and sign-ups still work.");
      if (res.body.services.mail === "down") lines.push("Mail delayed — emails are queued and send when mail is back.");
      if (res.body.services.postgres === "down") lines.push("Storage offline — sign-ups, prices, settings and history are unavailable.");
      if (lines.length) {
        bannerEl.style.display = "flex";
        clear(bannerEl);
        for (const l of lines) bannerEl.append(el("div", { class: "line", text: l }));
      } else {
        bannerEl.style.display = "none";
      }
    }
  };
  app.openCallsign = (then?: () => void): void => {
    openCallsignPanel(then);
  };
  app.ensureSession = (action: () => void): void => {
    if (app.me) action();
    else app.openCallsign(action);
  };
  app.toast = (text: string): void => {
    app.setNotices(text);
    if (text) setTimeout(() => { if (noticesEl.textContent === text) app.setNotices(""); }, 4000);
  };
  app.saveSettings = async (s: SettingsCtx["settings"]): Promise<void> => {
    const res = await api.put("/me/settings", s);
    if (res.status === 200) {
      app.settings = s;
      applyComfort(s);
      app.toast("Settings saved.");
    }
  };
  state.startRoom = async (mode: "siege" | "convoy"): Promise<void> => {
    const res = await api.post<{ code: string }>("/rooms", { mode });
    if (res.error) {
      state.toast(errorText(res.error, {
        rooms_unavailable: "Rooms are offline right now. Try again in a minute.",
        already_in_room: `You're already in room ${String(res.error.extra?.code ?? "")}.`,
      }));
      return;
    }
    if (res.body) {
      state.toast(`Room ${res.body.code} is open.`);
      await state.enterRoom(res.body.code);
    }
  };
  state.enterRoom = async (code: string): Promise<void> => {
    openRoomHUD(state, code);
  };

  // Session bootstrap.
  const me = await api.get<{ player: Player }>("/me");
  if (me.body) app.me = me.body.player;
  const settingsRes = await api.get<SettingsCtx["settings"]>("/me/settings");
  if (settingsRes.body) {
    app.settings = settingsRes.body;
    applyComfort(app.settings);
  }

  await app.refreshStatus();
  setInterval(() => { void app.refreshStatus(); }, 2500);

  renderTitle();
  const r = route();
  if (r.screen === "nights") openNightsPanel(app);
  if (r.screen === "join" && r.code) openJoinPanel(app, r.code);

  if (!noticeChoice()) {
    showNotice((choice) => {
      document.body.classList.toggle("calm", choice === "calm");
      if (choice === "calm" && app.settings) {
        const s = { ...app.settings, reduce_effects: true, screen_shake: false, camera_bob: false };
        void app.saveSettings(s);
      }
      (document.querySelector(".start-bar") as HTMLElement | null)?.focus();
    });
  } else if (noticeChoice() === "calm") {
    document.body.classList.add("calm");
  }
}

function applyComfort(s: SettingsCtx["settings"]): void {
  document.body.classList.toggle("calm", !!s.reduce_effects);
}

export function errorText(err: { code: string; message: string }, overrides?: Record<string, string>): string {
  if (overrides && overrides[err.code]) return overrides[err.code];
  if (err.message) return err.message;
  return "Something went wrong on the server. Try again.";
}

function renderTitle(): void {
  const root = app.root;
  clear(root);
  const screen = el("div", { class: "title-screen" });

  const wm = el("div", { class: "wordmark" });
  wm.innerHTML = wordmarkSVG();
  wm.setAttribute("role", "img");
  wm.setAttribute("aria-label", "Holdfast Nights");

  const startBtn = el("button", { class: "start-bar", text: "START A ROOM" });
  startBtn.setAttribute("aria-label", "Start a room");
  startBtn.addEventListener("click", () => {
    app.ensureSession(() => {
      startBtn.setAttribute("disabled", "true");
      app.setNotices("Starting room…");
      void app.startRoom("siege").finally(() => startBtn.removeAttribute("disabled"));
    });
  });

  const convoy = el("button", { class: "link-btn", text: "→ CONVOY RACE", "aria-label": "Convoy race" });
  convoy.addEventListener("click", () => {
    app.ensureSession(() => {
      convoy.setAttribute("disabled", "true");
      app.setNotices("Starting room…");
      void app.startRoom("convoy").finally(() => convoy.removeAttribute("disabled"));
    });
  });
  const join = el("button", { class: "link-btn", text: "→ JOIN BY CODE", "aria-label": "Join by code" });
  join.addEventListener("click", () => { app.ensureSession(() => openJoinPanel(app)); });
  const nights = el("button", { class: "link-btn", text: "→ NIGHTS", "aria-label": "Nights" });
  nights.addEventListener("click", () => openNightsPanel(app));
  const history = el("button", { class: "link-btn", text: "→ HISTORY", "aria-label": "History" });
  history.addEventListener("click", () => openHistoryPanel(app));
  const settings = el("button", { class: "link-btn", text: "→ SETTINGS", "aria-label": "Settings" });
  settings.addEventListener("click", () => openSettingsPanel(app));
  const callsign = el("button", { class: "link-btn", text: "→ CALLSIGN", "aria-label": "Callsign" });
  callsign.addEventListener("click", () => openCallsignPanel());

  screen.append(
    wm,
    startBtn,
    el("div", { class: "title-links" },
      el("div", { class: "row" }, join, convoy, nights),
      el("div", { class: "row" }, history, settings, callsign),
    ),
  );
  root.append(screen);

  const stamp = el("div", { class: "build-stamp", role: "status", "aria-label": "Build" });
  stamp.textContent = app.status ? `build ${app.status.build} · ${app.status.tick_hz} Hz` : "build … · 20 Hz";
  document.body.append(stamp);
}

// ---------- Callsign panel ----------

let callsignDialog: DialogHandle | null = null;

function openCallsignPanel(then?: () => void): void {
  if (callsignDialog) { callsignDialog.close(); callsignDialog = null; }
  const pending: { then?: () => void } = { then };
  callsignDialog = openDialog({
    label: "Callsign",
    build(root2): void {
      root2.append(el("h2", { text: "Callsign" }));

      const csField = el("div", { class: "field" });
      const csLabel = el("label", { class: "label", text: "Callsign", for: "cs-input" });
      const csInput = el("input", { id: "cs-input", type: "text", autocomplete: "off", maxlength: "16" });
      const csError = el("div", { class: "field-error", id: "cs-error", role: "none" });
      csError.style.display = "none";
      csInput.setAttribute("aria-describedby", "cs-error");
      csField.append(csLabel, csInput, csError);

      const keyField = el("div", { class: "field" });
      const keyLabel = el("label", { class: "label", text: "Studio key", for: "key-input" });
      const keyInput = el("input", { id: "key-input", type: "password", autocomplete: "off" });
      const keyError = el("div", { class: "field-error", id: "key-error" });
      keyError.style.display = "none";
      keyInput.setAttribute("aria-describedby", "key-error");
      keyField.append(keyLabel, keyInput, keyError);

      const save = el("button", { class: "btn btn-mint", text: "Save callsign" });
      const row = el("div", { class: "btn-row" }, save);
      root2.append(csField, keyField, row);

      async function submit(): Promise<void> {
        csError.style.display = "none";
        keyError.style.display = "none";
        csInput.setAttribute("aria-invalid", "false");
        const body: { callsign: string; studio_key?: string } = { callsign: csInput.value.trim() };
        if (keyInput.value) body.studio_key = keyInput.value;
        app.setNotices("Saving callsign…");
        const res = await api.post<Session>("/sessions", body);
        if (res.status === 201 && res.body) {
          app.me = res.body.player;
          app.setNotices(`Callsign saved — you're ${res.body.player.callsign}.`);
          if (body.studio_key) app.setNotices("Studio key accepted — founder tools unlocked.");
          callsignDialog?.close();
          callsignDialog = null;
          pending.then?.();
          return;
        }
        if (res.error) {
          if (res.error.code === "studio_key_invalid") {
            keyError.textContent = "That studio key isn't right.";
            keyError.style.display = "block";
          } else if (res.error.fields?.callsign) {
            csError.textContent = res.error.fields.callsign;
            csError.style.display = "block";
            csInput.setAttribute("aria-invalid", "true");
          } else {
            app.setNotices(errorText(res.error));
          }
        }
      }

      save.addEventListener("click", () => void submit());
      csInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void submit(); });
      keyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void submit(); });
    },
    onClose(): void { callsignDialog = null; },
  });
}

// Re-export for panels that need the pause menu.
export { openPauseMenu };

void main();
