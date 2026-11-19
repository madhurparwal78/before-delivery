import { api, ApiError, SERVER_ERROR_COPY } from "./api";
import { clear, glyph, h, uid } from "./dom";
import { openDialog, type DialogHandle } from "./dialogs";
import { ACTIONS, DEFAULT_BINDINGS, dayMonth, clockAbbr, formatLap, keyLabel, studioDayYear } from "./format";
import { app, emit, isReduced, notify, rememberSession, saveSettings, syncSettingsAfterSignIn } from "./state";
import type { HistoryMatch, LapRow, Player, Settings } from "./types";

// ---- shared form pieces

export function field(label: string, control: HTMLElement, id: string): { wrap: HTMLElement; error: (message: string) => void; clear: () => void } {
  const errorEl = h("p", { class: "field-error", id: `${id}-error` });
  control.id = id;
  const wrap = h("div", { class: "field" }, h("label", { for: id }, label), control, errorEl);
  return {
    wrap,
    error(message: string) {
      errorEl.textContent = message;
      control.setAttribute("aria-describedby", errorEl.id);
      control.setAttribute("aria-invalid", "true");
    },
    clear() {
      errorEl.textContent = "";
      control.removeAttribute("aria-describedby");
      control.removeAttribute("aria-invalid");
    },
  };
}

export function textInput(attrs: Record<string, unknown> = {}): HTMLInputElement {
  return h("input", { type: "text", autocomplete: "off", spellcheck: "false", ...attrs });
}

export function heading(text: string): HTMLElement {
  return h("h2", { class: "panel-title" }, text);
}

export function closeButton(close: () => void): HTMLButtonElement {
  return h("button", { type: "button", class: "btn btn-ghost", onclick: close }, "Close");
}

/** Maps a failed request to its short copy line. */
export function failureCopy(error: unknown): string {
  if (error instanceof ApiError && error.status < 500) return error.message;
  return SERVER_ERROR_COPY;
}

// ---- Callsign

export function openCallsign(opener: HTMLElement | null, onSaved?: () => void): DialogHandle {
  const callsign = textInput({ name: "callsign", maxlength: "40", value: app.session?.callsign ?? "" });
  const key = textInput({ name: "studio_key", type: "password", autocomplete: "off" });
  const callsignField = field("Callsign", callsign, uid("callsign"));
  const keyField = field("Studio key", key, uid("studio-key"));
  const save = h("button", { type: "button", class: "btn btn-primary" }, "Save callsign");
  let handle: DialogHandle;
  const submit = async (): Promise<void> => {
    callsignField.clear();
    keyField.clear();
    save.setAttribute("disabled", "");
    notify("Saving callsign…");
    try {
      const body: Record<string, string> = { callsign: callsign.value };
      if (key.value) body.studio_key = key.value;
      const made = await api<{ player: Player }>("POST", "/api/sessions", body);
      app.session = made.player;
      rememberSession();
      await syncSettingsAfterSignIn();
      notify(key.value ? "Studio key accepted — founder tools unlocked." : `Callsign saved — you're ${made.player.callsign}.`);
      emit("session");
      handle.close();
      onSaved?.();
    } catch (error) {
      if (error instanceof ApiError && error.code === "studio_key_invalid") keyField.error("That studio key isn't right.");
      else if (error instanceof ApiError && error.fields.callsign) callsignField.error(error.fields.callsign);
      else {
        notify(failureCopy(error));
        return;
      }
      notify("");
    } finally {
      save.removeAttribute("disabled");
    }
  };
  save.addEventListener("click", () => void submit());
  const form = h("form", { onsubmit: (event: Event) => { event.preventDefault(); void submit(); } },
    callsignField.wrap, keyField.wrap, h("div", { class: "row-end" }, closeButton(() => handle.close()), save));
  handle = openDialog({ name: "Callsign", scrim: true, opener, content: [heading("Callsign"), form] });
  return handle;
}

// ---- Join by code

export function openJoin(opener: HTMLElement | null, code: string, joinRoom: (code: string, dialog: DialogHandle) => Promise<void>, needSession: (then: () => void) => void): DialogHandle {
  const input = textInput({ name: "room_code", maxlength: "6", value: code.toUpperCase(), autocapitalize: "characters" });
  const codeField = field("Room code", input, uid("room-code"));
  const join = h("button", { type: "button", class: "btn btn-primary" }, "Join room");
  let handle: DialogHandle;
  const submit = (): void => {
    const run = (): void => {
      join.setAttribute("disabled", "");
      void joinRoom(input.value.trim().toUpperCase(), handle).finally(() => join.removeAttribute("disabled"));
    };
    if (app.session) run();
    else needSession(run);
  };
  join.addEventListener("click", submit);
  const form = h("form", { onsubmit: (event: Event) => { event.preventDefault(); submit(); } },
    codeField.wrap, h("div", { class: "row-end" }, closeButton(() => handle.close()), join));
  handle = openDialog({ name: "Join by code", scrim: true, opener, content: [heading("Join by code"), form] });
  return handle;
}

// ---- Settings and pause menu

type SectionId = "game" | "controls" | "audio" | "comfort";

interface SettingsOptions {
  pause?: { resume: () => void; leave: () => void };
  opener: HTMLElement | null;
  scrim: boolean;
}

let capturing: { action: string; button: HTMLButtonElement } | null = null;

export function remapActive(): boolean {
  return capturing !== null;
}

window.addEventListener("keydown", (event) => {
  if (!capturing) return;
  const { action, button } = capturing;
  const finish = (): void => {
    capturing = null;
    button.textContent = keyLabel(app.settings.bindings[action]);
  };
  if (event.code === "Tab") {
    finish();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.code === "Escape") {
    finish();
    return;
  }
  const conflict = ACTIONS.find((a) => a.id !== action && app.settings.bindings[a.id] === event.code);
  finish();
  if (conflict) {
    notify(`${keyLabel(event.code)} is already bound to ${conflict.label}.`);
    return;
  }
  button.textContent = keyLabel(event.code);
  void saveSettings({ ...app.settings, bindings: { ...app.settings.bindings, [action]: event.code } });
}, true);

export function openSettings(options: SettingsOptions): DialogHandle {
  const sections: { id: SectionId; title: string; body: () => HTMLElement }[] = [];
  if (options.pause) {
    const { resume, leave } = options.pause;
    sections.push({ id: "game", title: "Game", body: () => h("div", { class: "section-body" },
      h("button", { type: "button", class: "btn btn-primary", onclick: resume }, "Resume"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: leave }, "Leave room")) });
  }
  sections.push({ id: "controls", title: "Controls", body: controlsBody });
  sections.push({ id: "audio", title: "Audio", body: audioBody });
  sections.push({ id: "comfort", title: "Comfort", body: comfortBody });
  let open: SectionId = options.pause ? "game" : "comfort";
  const root = h("div", { class: "accordion" });
  const render = (): void => {
    clear(root);
    for (const section of sections) {
      const expanded = section.id === open;
      const panelId = uid("section");
      const header = h("button", {
        type: "button", class: "accordion-header", "aria-expanded": String(expanded), "aria-controls": panelId,
        onclick: () => { open = section.id; render(); (root.querySelector(`[data-section="${section.id}"]`) as HTMLElement | null)?.focus(); },
        "data-section": section.id,
      }, h("span", {}, section.title), glyph(expanded ? ["M5 15l7-7 7 7"] : ["M5 9l7 7 7-7"], 14));
      const body = h("div", { id: panelId, class: "accordion-body", role: "region", "aria-label": `${section.title} settings` });
      if (expanded) body.append(section.body());
      else body.hidden = true;
      root.append(h("section", { class: "accordion-section" }, header, body));
    }
  };
  render();
  const handle = openDialog({
    name: options.pause ? "Paused" : "Settings", scrim: options.scrim, opener: options.opener,
    content: [heading(options.pause ? "Paused" : "Settings"), root, options.pause ? null : h("div", { class: "row-end" }, closeButton(() => handle.close()))],
  });
  return handle;
}

function controlsBody(): HTMLElement {
  const rows = ACTIONS.map((action) => {
    const button = h("button", { type: "button", class: "btn btn-key", "aria-label": `Remap ${action.label}` }, keyLabel(app.settings.bindings[action.id]));
    button.addEventListener("click", () => {
      if (capturing) capturing.button.textContent = keyLabel(app.settings.bindings[capturing.action]);
      capturing = { action: action.id, button };
      button.textContent = "Press a key…";
      notify(`Press a key for ${action.label}. Escape cancels.`);
    });
    return h("li", { class: "remap-row" }, h("span", {}, action.label), button);
  });
  const reset = h("button", { type: "button", class: "btn btn-ghost", onclick: () => {
    capturing = null;
    void saveSettings({ ...app.settings, bindings: { ...DEFAULT_BINDINGS } });
    rows.forEach((row, i) => { (row.querySelector("button") as HTMLButtonElement).textContent = keyLabel(DEFAULT_BINDINGS[ACTIONS[i].id]); });
  } }, "Reset to defaults");
  return h("div", { class: "section-body" }, h("ul", { class: "remap-list" }, ...rows), reset);
}

function slider(label: string, key: "master_volume" | "effects_volume"): HTMLElement {
  const input = h("input", { type: "range", min: "0", max: "100", step: "1", value: String(app.settings[key]), "aria-label": label });
  const value = h("output", {}, String(app.settings[key]));
  input.addEventListener("input", () => { value.textContent = input.value; });
  input.addEventListener("change", () => void saveSettings({ ...app.settings, [key]: Number(input.value) }));
  return h("label", { class: "slider-row" }, h("span", {}, label), input, value);
}

function audioBody(): HTMLElement {
  return h("div", { class: "section-body" }, slider("Master volume", "master_volume"), slider("Effects volume", "effects_volume"));
}

function switchRow(label: string, key: "reduce_effects" | "screen_shake" | "camera_bob", rerender: () => void): HTMLElement {
  const forcedOff = key !== "reduce_effects" && isReduced();
  const checked = forcedOff ? false : app.settings[key];
  const toggle = h("button", { type: "button", role: "switch", class: "switch", "aria-checked": String(checked), "aria-label": label, disabled: forcedOff }, h("span", { class: "knob" }));
  toggle.addEventListener("click", () => {
    const next: Settings = { ...app.settings, [key]: !app.settings[key] };
    void saveSettings(next);
    rerender();
    (document.querySelector(`[role="switch"][aria-label="${label}"]`) as HTMLElement | null)?.focus();
  });
  return h("div", { class: "switch-row" }, h("span", {}, label), toggle);
}

function comfortBody(): HTMLElement {
  const body = h("div", { class: "section-body" });
  const rerender = (): void => {
    clear(body);
    body.append(switchRow("Reduce effects", "reduce_effects", rerender), switchRow("Screen shake", "screen_shake", rerender), switchRow("Camera bob", "camera_bob", rerender));
  };
  rerender();
  return body;
}

// ---- History

export function openHistory(opener: HTMLElement | null, onClose?: () => void): DialogHandle {
  let tab: "matches" | "laps" = "matches";
  const tabs = h("div", { role: "tablist", "aria-label": "History", class: "tabs" });
  const body = h("div", { class: "history-body" });
  const tabButtons = new Map<string, HTMLButtonElement>();
  const select = (next: "matches" | "laps", focus = false): void => {
    tab = next;
    for (const [id, button] of tabButtons) {
      button.setAttribute("aria-selected", String(id === tab));
      button.tabIndex = id === tab ? 0 : -1;
    }
    if (focus) tabButtons.get(next)?.focus();
    void load();
  };
  for (const [id, label] of [["matches", "Matches"], ["laps", "Lap board"]] as const) {
    const button = h("button", { type: "button", role: "tab", class: "tab", "aria-selected": String(id === tab), id: `tab-${id}`, "aria-controls": `tabpanel-${id}` }, label);
    button.tabIndex = id === tab ? 0 : -1;
    button.addEventListener("click", () => select(id));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const ids = [...tabButtons.keys()];
      const next = ids[(ids.indexOf(id) + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
      tabButtons.get(next)?.focus();
      for (const [other, b] of tabButtons) b.tabIndex = other === next ? 0 : -1;
    });
    tabButtons.set(id, button);
    tabs.append(button);
  }
  const load = async (): Promise<void> => {
    const mine = tab;
    clear(body);
    body.append(h("p", { class: "line" }, "Loading…"));
    try {
      const panel = mine === "matches" ? matchesTable(await api<{ matches: HistoryMatch[] }>("GET", "/api/history?limit=50")) : lapsTable(await api<{ laps: LapRow[] }>("GET", "/api/laps?limit=50"));
      if (tab !== mine) return;
      clear(body);
      body.append(h("div", { role: "tabpanel", id: `tabpanel-${mine}`, "aria-labelledby": `tab-${mine}`, class: "tabpanel" }, panel));
    } catch {
      if (tab !== mine) return;
      clear(body);
      body.append(h("p", { class: "line" }, "History is unavailable right now."),
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => void load() }, "Try again"));
    }
  };
  const handle = openDialog({
    name: "History", scrim: true, opener, className: "panel-wide", onClose,
    content: [heading("History"), tabs, body, h("div", { class: "row-end" }, closeButton(() => handle.close()))],
    initialFocus: () => tabButtons.get("matches") ?? null,
  });
  void load();
  return handle;
}

function matchesTable(data: { matches: HistoryMatch[] }): HTMLElement {
  if (data.matches.length === 0) return h("p", { class: "line" }, "No matches yet.");
  const zone = app.studioZone;
  const resultWord = (m: HistoryMatch): string => ({ victory: "Victory", defeat: "Defeat", ended: "Ended", finished: "Finished" }[m.result] ?? m.result);
  const squad = (m: HistoryMatch): (string | HTMLElement)[] => m.players.flatMap((p, i) => [
    ...(i > 0 ? [" · "] : []),
    h("span", { class: "squad-entry" }, `${p.callsign} ${m.mode === "siege" ? p.score : p.best_lap_ms === null ? "—" : formatLap(p.best_lap_ms)}`)]);
  const when = (instant: string): (string | HTMLElement)[] => [h("span", { class: "when-day" }, dayMonth(instant, zone)), " ", h("span", { class: "when-time" }, clockAbbr(instant, zone))];
  return h("table", { "aria-label": "Match history", class: "table" },
    h("thead", {}, h("tr", {}, h("th", { class: "col-started" }, "Started"), h("th", {}, "Ended"), h("th", { class: "col-room" }, "Room"), h("th", {}, "Mode"), h("th", {}, "Result"), h("th", {}, "Waves cleared"), h("th", {}, "Squad"))),
    h("tbody", {}, ...data.matches.map((m) => h("tr", {},
      h("td", { class: "col-started" }, ...when(m.started_at)), h("td", {}, ...when(m.ended_at)), h("td", { class: "col-room" }, m.code),
      h("td", {}, m.mode === "siege" ? "Siege" : "Convoy"), h("td", {}, resultWord(m)),
      h("td", {}, m.mode === "siege" ? String(m.waves_cleared) : "—"), h("td", {}, ...squad(m))))));
}

function lapsTable(data: { laps: LapRow[] }): HTMLElement {
  if (data.laps.length === 0) return h("p", { class: "line" }, "No laps yet.");
  return h("table", { "aria-label": "Lap board", class: "table" },
    h("thead", {}, h("tr", {}, h("th", {}, "Rank"), h("th", {}, "Callsign"), h("th", {}, "Best lap"), h("th", {}, "Set on"))),
    h("tbody", {}, ...data.laps.map((l) => h("tr", {}, h("td", {}, String(l.rank)), h("td", {}, l.callsign), h("td", {}, formatLap(l.lap_ms)), h("td", {}, studioDayYear(l.set_at, app.studioZone))))));
}

