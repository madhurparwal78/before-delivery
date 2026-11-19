import { api, ApiError } from "./api";
import { clear, h } from "./dom";
import { Fuse } from "./fuse";
import { failureCopy } from "./panels";
import { notify } from "./state";
import type { RoomState } from "./types";

const READY_ERRORS: Record<string, string> = { wrong_phase: "The match has already started." };
const START_ERRORS: Record<string, string> = { not_all_ready: "Everyone must be ready first.", not_host: "Only the host can start." };

/** The lobby panel: room code, Invite expires timer, seats and the lobby buttons. */
export class Lobby {
  readonly root: HTMLElement;
  private readonly title = h("h2", { class: "panel-title" });
  private readonly seats = h("ul", { class: "seats", "aria-label": "Seats" });
  private readonly invite = h("p", { class: "invite" });
  private readonly ready: HTMLButtonElement;
  private readonly start: HTMLButtonElement;
  private fuse: Fuse | null = null;
  private seatText = "";

  constructor(private readonly code: string, private readonly playerId: string, onLeave: () => void) {
    this.ready = h("button", { type: "button", class: "btn btn-primary", "aria-pressed": "false" }, "Ready");
    this.start = h("button", { type: "button", class: "btn btn-primary", disabled: true, hidden: true }, "Start match");
    const copy = h("button", { type: "button", class: "btn btn-ghost" }, "Copy invite");
    const leave = h("button", { type: "button", class: "btn btn-ghost" }, "Leave room");
    this.title.replaceChildren("Room ", h("span", { class: "room-code" }, code));
    this.ready.addEventListener("click", () => void this.toggleReady());
    this.start.addEventListener("click", () => void this.startMatch());
    copy.addEventListener("click", () => void this.copyInvite());
    leave.addEventListener("click", onLeave);
    this.root = h("section", { class: "panel lobby", role: "region", "aria-label": "Lobby" },
      this.title, this.invite, this.seats, h("div", { class: "button-row" }, this.ready, this.start, copy, leave));
  }

  private async toggleReady(): Promise<void> {
    const next = this.ready.getAttribute("aria-pressed") !== "true";
    try {
      await api("POST", `/api/rooms/${this.code}/ready`, { ready: next });
      notify(next ? "You're ready." : "You're not ready.");
    } catch (error) {
      notify(error instanceof ApiError && READY_ERRORS[error.code] ? READY_ERRORS[error.code] : failureCopy(error));
    }
  }

  private async startMatch(): Promise<void> {
    this.start.disabled = true;
    notify("Starting match…");
    try {
      await api("POST", `/api/rooms/${this.code}/start`);
      notify("Match starting.");
    } catch (error) {
      notify(error instanceof ApiError && START_ERRORS[error.code] ? START_ERRORS[error.code] : failureCopy(error));
    }
  }

  private async copyInvite(): Promise<void> {
    const link = `${location.origin}/room/${this.code}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const area = h("textarea", { class: "sr-only", "aria-hidden": "true" }, link);
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    notify("Invite copied.");
  }

  update(state: RoomState): void {
    const me = state.players.find((p) => p.id === this.playerId);
    const host = state.host === this.playerId;
    const lines = state.players.map((p) =>
      `Seat ${p.seat} · ${p.callsign} · ${p.ready ? "Ready" : "Not ready"}${state.host === p.id ? " · Host" : ""}${p.connection === "disconnected" ? " · Disconnected" : ""}`);
    const text = lines.join("\n");
    if (text !== this.seatText) {
      this.seatText = text;
      clear(this.seats);
      lines.forEach((line) => this.seats.append(h("li", {}, line)));
    }
    this.ready.setAttribute("aria-pressed", String(me?.ready === true));
    this.start.hidden = !host;
    this.start.disabled = !host || !state.players.every((p) => p.ready);
    if (state.invite_remaining_ms !== null) {
      if (!this.fuse) {
        this.fuse = new Fuse({ name: "Invite expires", outcome: "expired", onResolve: () => notify("Invite expires — expired") });
        this.invite.append(h("span", { class: "cap" }, "Invite expires "), this.fuse.el);
      }
      this.fuse.set(state.invite_remaining_ms);
    } else if (this.fuse && !this.fuse.resolved) this.fuse.resolve();
  }
}
