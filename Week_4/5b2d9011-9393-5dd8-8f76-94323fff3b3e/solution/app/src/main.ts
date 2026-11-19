import { api, ApiError } from "./api";
import { openDialog } from "./dialogs";
import { byId, h } from "./dom";
import { enterRoom } from "./game";
import { openNights } from "./nights";
import { failureCopy, heading, openCallsign, openHistory, openJoin, openSettings } from "./panels";
import { app, applyComfort, loadSession, notify, NOTICE_KEY, on, refreshStatus, saveSettings } from "./state";
import { createStage } from "./stage";
import { buildTitle, type TitleScreen } from "./title";
import type { RoomState } from "./types";

const STATUS_POLL_MS = 2000;
const ROOMS_OFFLINE = "Rooms are offline right now. Try again in a minute.";

let title: TitleScreen;

function showTitle(): void {
  title = buildTitle({
    start: (button) => gated(button, () => void createRoom("siege", button)),
    convoy: (button) => gated(button, () => void createRoom("convoy", button)),
    join: (button) => openJoinPanel(button, ""),
    nights: (button) => openNightsPanel(button),
    history: (button) => openHistory(button),
    settings: (button) => openSettings({ opener: button, scrim: true }),
    callsign: (button) => openCallsign(button),
  });
  byId("world").replaceChildren(title.root);
}

/** Session-gated actions open the Callsign panel first, then continue. */
function gated(opener: HTMLElement, action: () => void): void {
  if (app.session) action();
  else openCallsign(opener, action);
}

function alreadyIn(error: ApiError): string {
  return `You're already in room ${String(error.extra.room_code)}.`;
}

async function createRoom(mode: "siege" | "convoy", button: HTMLElement): Promise<void> {
  button.toggleAttribute("disabled", true);
  notify("Starting room…");
  try {
    const state = await api<RoomState>("POST", "/api/rooms", { mode });
    notify(`Room ${state.code} is open.`);
    enterRoom(state);
  } catch (error) {
    if (error instanceof ApiError && error.code === "rooms_unavailable") notify(ROOMS_OFFLINE);
    else if (error instanceof ApiError && error.code === "already_in_room") {
      notify(alreadyIn(error));
      await rejoin(String(error.extra.room_code));
    } else notify(failureCopy(error));
  } finally {
    button.toggleAttribute("disabled", false);
  }
}

async function rejoin(code: string): Promise<void> {
  try {
    enterRoom(await api<RoomState>("GET", `/api/rooms/${code}`));
  } catch {
    return;
  }
}

const JOIN_ERRORS = (code: string): Record<string, string> => ({
  room_not_found: `No room with code ${code}.`,
  room_full: `Room ${code} is full.`,
  match_in_progress: `Room ${code} is mid-match. Ask the host for the next one.`,
  invite_expired: "This invite expired. Ask the host for a new room.",
  seat_released: `Your seat in ${code} was released.`,
  rooms_unavailable: ROOMS_OFFLINE,
});

function openJoinPanel(opener: HTMLElement | null, code: string): void {
  openJoin(opener, code, async (entered, dialog) => {
    notify(`Joining ${entered}…`);
    try {
      const joined = await api<{ seat: number; state: RoomState }>("POST", `/api/rooms/${entered}/join`, undefined);
      notify(`Joined room ${entered} — seat ${joined.seat}.`);
      dialog.close();
      enterRoom(joined.state);
    } catch (error) {
      if (error instanceof ApiError && error.code === "already_in_room") {
        notify(alreadyIn(error));
        dialog.close();
        await rejoin(String(error.extra.room_code));
      } else notify(error instanceof ApiError && JOIN_ERRORS(entered)[error.code] ? JOIN_ERRORS(entered)[error.code] : failureCopy(error));
    }
  }, (then) => openCallsign(opener, then));
}

function openNightsPanel(opener: HTMLElement | null): void {
  history.replaceState(null, "", "/nights");
  openNights(opener, () => history.replaceState(null, "", "/"));
}

/** The pre-match notice panel: offered once, before anything else is interactive. */
function openNotice(after: () => void): void {
  const calm = h("button", { type: "button", class: "btn btn-ghost" }, "Calm effects");
  const enter = h("button", { type: "button", class: "btn btn-primary" }, "Enter");
  const choose = (choice: "standard" | "calm"): void => {
    localStorage.setItem(NOTICE_KEY, choice);
    if (choice === "calm") void saveSettings({ ...app.settings, reduce_effects: true }, false);
    handle.close();
    after();
  };
  calm.addEventListener("click", () => choose("calm"));
  enter.addEventListener("click", () => choose("standard"));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const handle = openDialog({
    name: "Before you play", className: "panel-notice", scrim: true, opener: title.startBar,
    onEscape: () => choose("standard"),
    content: [
      heading("Before you play"),
      h("p", {}, "Matches use bright flashes, screen shake and numbers that roll and split while they count."),
      h("p", {}, "Calm effects holds the stage still and swaps every number at once. You can change this later in Settings."),
      h("div", { class: "row-end" }, calm, enter),
    ],
    initialFocus: () => (reduced ? calm : enter),
  });
}

function routedPanels(): void {
  const path = location.pathname;
  const room = /^\/room\/([A-Za-z0-9]+)$/.exec(path);
  if (path === "/nights") openNightsPanel(null);
  else if (room) openJoinPanel(null, room[1]);
}

async function boot(): Promise<void> {
  applyComfort();
  createStage(byId<HTMLCanvasElement>("stage"));
  await Promise.all([loadSession(), refreshStatus()]);
  window.setInterval(() => void refreshStatus(), STATUS_POLL_MS);
  showTitle();
  on("left", () => {
    showTitle();
    title.startBar.focus();
  });
  if (localStorage.getItem(NOTICE_KEY) === null) openNotice(routedPanels);
  else routedPanels();
}

void boot();
