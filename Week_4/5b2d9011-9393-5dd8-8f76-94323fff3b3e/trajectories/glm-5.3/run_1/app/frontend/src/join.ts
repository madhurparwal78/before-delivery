// Join by code panel.
import { api, type RoomState } from "./api";
import { el, openDialog } from "./ui";
import type { App } from "./main";
import { errorText } from "./main";
import { openRoomHUD } from "./hud";

export function openJoinPanel(app: App, presetCode?: string): void {
  openDialog({
    label: "Join by code",
    build(root): void {
      root.append(el("h2", { text: "Join by code" }));
      const field = el("div", { class: "field" });
      const input = el("input", { type: "text", "autocomplete": "off", "maxlength": "6", "aria-label": "Room code" });
      input.setAttribute("style", "text-transform:uppercase;letter-spacing:0.2em;font-family:var(--font-display);font-size:18px");
      if (presetCode) input.value = presetCode;
      field.append(el("label", { class: "label", text: "Room code" }), input);
      const join = el("button", { class: "btn btn-mint", text: "Join room" });
      root.append(field, el("div", { class: "btn-row" }, join));

      async function submit(): Promise<void> {
        const code = input.value.trim().toUpperCase();
        if (!code) return;
        app.setNotices(`Joining ${code}…`);
        const res = await api.post<{ seat: number; state: RoomState }>(`/rooms/${encodeURIComponent(code)}/join`);
        if (res.status === 200 && res.body) {
          app.setNotices(`Joined room ${code} — seat ${res.body.seat}.`);
          const dialog = root.closest(".scrim");
          openRoomHUD(app, code, res.body.state);
          dialog?.remove();
          return;
        }
        if (res.error) {
          app.setNotices("");
          app.toast(errorText(res.error, {
            room_not_found: `No room with code ${code}.`,
            room_full: `Room ${code} is full.`,
            match_in_progress: `Room ${code} is mid-match. Ask the host for the next one.`,
            invite_expired: "This invite expired. Ask the host for a new room.",
            seat_released: `Your seat in ${code} was released.`,
            rooms_unavailable: "Rooms are offline right now. Try again in a minute.",
          }));
        }
      }

      join.addEventListener("click", () => void submit());
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") void submit(); });
    },
  });
}
