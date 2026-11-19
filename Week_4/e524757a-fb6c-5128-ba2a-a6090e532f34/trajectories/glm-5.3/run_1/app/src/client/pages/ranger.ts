// The ranger queue: approve or decline pending notes.

import { el, announce, ensureStatusRegion, api, ApiCallError } from "../ui/core";
import { onLive } from "../live";

interface WaitingNote { id: string; text: string; author_name: string; status: string }
interface NotesAnswer { notes: WaitingNote[] }
interface MeAnswer { player: { ranger: boolean } }

export function mountRanger(): void {
  ensureStatusRegion("Notes status", "last5");
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  void build(main);
}

async function build(main: HTMLElement): Promise<void> {
  const me = await api<MeAnswer>("GET", "/api/me").catch(() => null);
  const page = el("div", { class: "board-page" });
  page.append(el("h1", {}, "Ranger queue"));
  main.append(page);

  if (!me) {
    location.href = "/signin?next=%2Franger";
    return;
  }
  if (!me.player.ranger) {
    page.append(el("p", { class: "error-band", text: "Only rangers can do that." }));
    return;
  }

  const list = el("ul", { class: "note-list", role: "list", "aria-label": "Waiting notes", id: "waiting-notes" });
  page.append(list);

  const declineDialog = el("dialog", { id: "decline-dialog", "aria-label": "Decline note" });
  const body = el("div", { class: "dialog-body" });
  body.append(el("h3", {}, "Decline note"));
  const group = el("div", { role: "radiogroup", "aria-label": "Reason", class: "radiogroup" });
  for (const reason of ["Not about the islands", "Unkind", "Shares personal details"]) {
    const label = el("label", {});
    const radio = el("input", { type: "radio", name: "reason", value: reason });
    radio.setAttribute("aria-label", reason);
    label.append(radio, document.createTextNode(reason));
    group.append(label);
  }
  body.append(group);
  const actions = el("div", { class: "dialog-actions" });
  const confirm = el("button", { class: "action", id: "confirm-decline", text: "Decline note" });
  actions.append(confirm);
  body.append(actions);
  declineDialog.append(body);
  page.append(declineDialog);

  const redraw = async () => {
    const notes = await api<NotesAnswer>("GET", "/api/ranger/notes").catch(() => null);
    if (!notes) return;
    list.innerHTML = "";
    for (const note of notes.notes) {
      const li = el("li", {});
      li.append(el("p", { text: note.text }));
      li.append(el("p", { class: "waiting", text: note.author_name }));
      const approve = el("button", { class: "action", text: "Approve" });
      approve.addEventListener("click", async () => {
        try {
          await api("POST", `/api/notes/${note.id}/approve`, {});
          announce("Notes status", "Note approved.");
          void redraw();
        } catch (err) {
          if (err instanceof ApiCallError) announce("Notes status", err.message);
        }
      });
      const decline = el("button", { text: "Decline" });
      decline.addEventListener("click", () => {
        const radios = Array.from(declineDialog.querySelectorAll<HTMLInputElement>("input[name='reason']"));
        for (const r of radios) r.checked = false;
        declineDialog.showModal();
        declineDialog.dataset.noteId = note.id;
        declineDialog.dataset.openerId = "";
        radios[0]?.focus();
      });
      li.append(approve, decline);
      list.append(li);
    }
    if (notes.notes.length === 0) {
      list.append(el("li", {}, el("p", {}, "No notes waiting.")));
    }
  };
  void redraw();

  declineDialog.addEventListener("keydown", ev => {
    if (ev.key === "Escape") {
      declineDialog.close();
      const noteId = declineDialog.dataset.noteId;
      const li = Array.from(list.children).find(li => (li as HTMLElement).dataset.noteId === noteId);
      (li?.querySelector("button:nth-of-type(2)") as HTMLElement | undefined)?.focus();
    }
  });

  confirm.addEventListener("click", async () => {
    const noteId = declineDialog.dataset.noteId;
    const checked = declineDialog.querySelector<HTMLInputElement>("input[name='reason']:checked");
    if (!noteId || !checked) {
      announce("Notes status", "Choose a reason.");
      return;
    }
    try {
      await api("POST", `/api/notes/${noteId}/decline`, { reason: checked.value });
      announce("Notes status", "Note declined.");
      declineDialog.close();
      void redraw();
    } catch (err) {
      if (err instanceof ApiCallError) announce("Notes status", err.message);
    }
  });

  onLive(ev => {
    if (ev.kind === "note") void redraw();
  });
}
