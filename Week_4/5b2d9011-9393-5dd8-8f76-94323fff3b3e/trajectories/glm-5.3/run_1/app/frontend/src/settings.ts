// Settings and the pause menu: Controls, Audio and Comfort, with key
// remapping.
import { api, type RoomState, type Settings } from "./api";
import { el, clear, openDialog } from "./ui";
import { keyLabel, actionName } from "./format";
import type { App } from "./main";

export interface SettingsCtx {
  settings: Settings;
}

export const DEFAULT_BINDINGS: Record<string, string> = {
  move_up: "KeyW", move_down: "KeyS", move_left: "KeyA", move_right: "KeyD",
  aim_left: "KeyQ", aim_right: "KeyE", fire: "Space", reload: "KeyR",
  grenade: "KeyG", revive: "KeyF", shop: "KeyB", timers: "KeyT",
};

const ACTION_ORDER = [
  "move_up", "move_down", "move_left", "move_right",
  "aim_left", "aim_right", "fire", "reload", "grenade", "revive", "shop", "timers",
];

function buildAccordion(
  app: App,
  root: HTMLElement,
  sections: { id: string; title: string; build: (body: HTMLElement) => void }[],
  openIndex: number,
): void {
  const acc = el("div", { class: "accordion" });
  const bodies: HTMLElement[] = [];
  const headers: HTMLElement[] = [];
  let current = openIndex;

  function show(idx: number): void {
    bodies.forEach((b, i) => {
      b.hidden = i !== idx;
      headers[i].setAttribute("aria-expanded", String(i === idx));
    });
    current = idx;
  }

  sections.forEach((sec, i) => {
    const header = el("button", { "aria-expanded": String(i === openIndex), text: sec.title });
    header.style.fontSize = "12px";
    header.style.letterSpacing = "0.12em";
    header.style.textTransform = "uppercase";
    header.append(el("span", { class: "chev", text: "›" }));
    const body = el("div", { class: "body" });
    body.hidden = i !== openIndex;
    sec.build(body);
    header.addEventListener("click", () => show(i));
    const section = el("div", { class: "section" }, header, body);
    acc.append(section);
    bodies.push(body);
    headers.push(header);
  });
  root.append(acc);
  show(openIndex);
}

export function openSettingsPanel(app: App): void {
  const s: Settings = app.settings ?? defaultSettings();
  openDialog({
    label: "Settings",
    build(root): void {
      root.append(el("h2", { text: "Settings" }));
      buildAccordion(app, root, [
        { id: "controls", title: "Controls", build: (body) => buildControls(app, s, body) },
        { id: "audio", title: "Audio", build: (body) => buildAudio(app, s, body) },
        { id: "comfort", title: "Comfort", build: (body) => buildComfort(app, s, body) },
      ], 0);
    },
  });
}

export function openPauseMenu(app: App, _state: RoomState | null, hooks: { onResume: () => void; onLeave: () => void }): void {
  const s: Settings = app.settings ?? defaultSettings();
  openDialog({
    label: "Paused",
    build(root): void {
      root.append(el("h2", { text: "Paused" }));
      buildAccordion(app, root, [
        {
          id: "game", title: "Game",
          build: (body): void => {
            const resume = el("button", { class: "btn btn-mint", text: "Resume", style: "width:100%;margin-bottom:8px" });
            resume.addEventListener("click", () => { hooks.onResume(); root.closest(".scrim")?.remove(); });
            const leave = el("button", { class: "btn btn-ghost", text: "Leave room", style: "width:100%" });
            leave.addEventListener("click", () => { hooks.onLeave(); root.closest(".scrim")?.remove(); });
            body.append(resume, leave);
          },
        },
        { id: "controls", title: "Controls", build: (body) => buildControls(app, s, body) },
        { id: "audio", title: "Audio", build: (body) => buildAudio(app, s, body) },
        { id: "comfort", title: "Comfort", build: (body) => buildComfort(app, s, body) },
      ], 0);
    },
  });
}

function buildControls(app: App, s: Settings, body: HTMLElement): void {
  let capturing: { action: string; button: HTMLElement } | null = null;

  const finish = (newBindings: Record<string, string>): void => {
    s.bindings = newBindings;
    void app.saveSettings(s);
  };

  for (const action of ACTION_ORDER) {
    const row = el("div", { class: "switch-row" });
    const remap = el("button", { class: "btn btn-ghost", text: `Remap ${actionName(action)}`, "aria-label": `Remap ${actionName(action)}` });
    const keySpan = el("span", { class: "seat-note", text: keyLabel(s.bindings[action] ?? DEFAULT_BINDINGS[action]) });
    row.append(remap, keySpan);
    body.append(row);

    remap.addEventListener("click", () => {
      if (capturing) return;
      capturing = { action, button: remap };
      remap.textContent = "Press a key…";
      app.setNotices(`Press a key for ${actionName(action)}. Escape cancels.`);
    });
  }

  const reset = el("button", { class: "btn btn-ghost", text: "Reset to defaults", style: "width:100%;margin-top:8px" });
  reset.addEventListener("click", () => {
    finish({ ...DEFAULT_BINDINGS });
    clear(body);
    buildControls(app, { ...s, bindings: { ...DEFAULT_BINDINGS } }, body);
  });
  body.append(reset);

  const onKey = async (e: KeyboardEvent): Promise<void> => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, button } = capturing;
    if (e.key === "Escape") {
      capturing = null;
      button.textContent = `Remap ${actionName(action)}`;
      app.setNotices("");
      return;
    }
    if (e.key === "Tab") {
      // Tab leaves capture unchanged and moves focus.
      capturing = null;
      button.textContent = `Remap ${actionName(action)}`;
      return;
    }
    const code = e.code;
    if (code === "Escape") return;
    const bindings = { ...(s.bindings ?? { ...DEFAULT_BINDINGS }) };
    // A key already bound to another action is refused.
    for (const [a, c] of Object.entries(bindings)) {
      if (c === code && a !== action) {
        app.setNotices(`${keyLabel(code)} is already bound to ${actionName(a)}.`);
        capturing = null;
        button.textContent = `Remap ${actionName(action)}`;
        return;
      }
    }
    bindings[action] = code;
    capturing = null;
    button.textContent = `Remap ${actionName(action)}`;
    const keyLabelEl = button.parentElement?.querySelector(".seat-note");
    if (keyLabelEl) keyLabelEl.textContent = keyLabel(code);
    finish(bindings);
    app.setNotices("Settings saved.");
  };
  document.addEventListener("keydown", onKey, true);
}

function buildAudio(app: App, s: Settings, body: HTMLElement): void {
  const master = slider("Master volume", s.master_volume, (v) => { s.master_volume = v; void app.saveSettings(s); });
  const effects = slider("Effects volume", s.effects_volume, (v) => { s.effects_volume = v; void app.saveSettings(s); });
  body.append(master, effects);
}

function slider(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const row = el("div", { class: "slider-row" });
  const input = el("input", { type: "range", min: "0", max: "100", value: String(value) });
  input.setAttribute("role", "slider");
  input.setAttribute("aria-label", label);
  const val = el("span", { class: "seat-note", text: String(value) });
  input.addEventListener("input", () => {
    val.textContent = input.value;
    onChange(Number(input.value));
  });
  row.append(el("span", { class: "label", text: label }), input, val);
  return row;
}

function buildComfort(app: App, s: Settings, body: HTMLElement): void {
  const reduce = s.reduce_effects || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  body.append(
    toggleRow("Reduce effects", s.reduce_effects, async (v) => {
      s.reduce_effects = v;
      document.body.classList.toggle("calm", v);
      if (v) { s.screen_shake = false; s.camera_bob = false; }
      await app.saveSettings(s);
      clear(body);
      buildComfort(app, s, body);
    }),
    toggleRow("Screen shake", s.screen_shake, async (v) => { s.screen_shake = v; await app.saveSettings(s); }, reduce),
    toggleRow("Camera bob", s.camera_bob, async (v) => { s.camera_bob = v; await app.saveSettings(s); }, reduce),
  );
}

function toggleRow(label: string, checked: boolean, onChange: (v: boolean) => void, disabled = false): HTMLElement {
  const row = el("div", { class: "switch-row" });
  const sw = el("button", { class: "switch", role: "switch", "aria-checked": String(checked), "aria-label": label });
  if (disabled) sw.setAttribute("disabled", "true");
  sw.addEventListener("click", () => {
    if (disabled) return;
    const next = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  row.append(el("span", { class: "label", text: label }), sw);
  return row;
}

function defaultSettings(): Settings {
  return {
    bindings: { ...DEFAULT_BINDINGS },
    master_volume: 70,
    effects_volume: 70,
    reduce_effects: false,
    screen_shake: true,
    camera_bob: true,
  };
}
