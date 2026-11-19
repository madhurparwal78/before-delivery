// The notice board: pin a note, read approved notes, remove as ranger.

import { el, announce, ensureStatusRegion, api, ApiCallError } from "../ui/core";
import { onLive } from "../live";

interface Note { id: string; text: string; author_name: string; status: string; reason?: string | null }
interface NotesAnswer { notes: Note[] }
interface MeAnswer { player: { id: string; name: string; ranger: boolean } }

export function mountBoard(): void {
  ensureStatusRegion("Notes status", "last5");
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  void build(main);
}

async function build(main: HTMLElement): Promise<void> {
  const me = await api<MeAnswer>("GET", "/api/me").catch(() => null);
  const page = el("div", { class: "board-page" });
  page.append(el("h1", {}, "Notice board"));

  const form = el("form", { class: "note-form", novalidate: "true" });
  const input = el("textarea", { id: "note-input", "aria-label": "Your note", maxlength: "141", rows: "3" });
  const pin = el("button", { class: "action", id: "pin-note", text: "Pin note" });
  form.append(input, pin);
  page.append(form);

  const list = el("ul", { class: "note-list", role: "list", "aria-label": "Notice board", id: "notes-list" });
  page.append(list);

  const redraw = async () => {
    const notes = await api<NotesAnswer>("GET", "/api/notes").catch(() => null);
    if (!notes) return;
    list.innerHTML = "";
    for (const note of notes.notes) {
      const li = el("li", {});
      li.append(el("p", { text: note.text }));
      li.append(el("p", { class: "waiting", text: `${note.author_name}${note.status === "pending" ? ` · Waiting for a ranger` : ""}` }));
      if (note.status === "declined" && me?.player.id) {
        li.append(el("p", { class: "waiting", text: `Your note was declined: ${note.reason ?? ""}.` }));
      }
      if (me?.player.ranger && note.status === "approved") {
        const remove = el("button", { text: "Remove note" });
        remove.addEventListener("click", async () => {
          try {
            await api("DELETE", `/api/notes/${note.id}`);
            announce("Notes status", "Note removed.");
            void redraw();
          } catch (err) {
            if (err instanceof ApiCallError) announce("Notes status", err.message);
          }
        });
        li.append(remove);
      }
      list.append(li);
    }
    if (notes.notes.length === 0) {
      list.append(el("li", {}, el("p", {}, "No notes yet.")));
    }
  };
  void redraw();

  let pending = false;
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (pending) return;
    pending = true;
    const requestKey = `rk-${Math.random().toString(36).slice(2)}`;
    announce("Notes status", "Pinning…");
    try {
      await api("POST", "/api/notes", { text: input.value }, { headers: { "Request-Key": requestKey } });
      announce("Notes status", "Note pinned.");
      input.value = "";
      input.focus();
      void redraw();
    } catch (err) {
      if (err instanceof ApiCallError) announce("Notes status", err.message);
    } finally {
      pending = false;
    }
  });

  main.append(page);

  onLive(ev => {
    const p = ev.payload as Record<string, unknown>;
    if (ev.kind === "note") {
      void redraw();
      if (p.status === "approved") announce("Notes status", "New note on the board.");
    }
  });
}
