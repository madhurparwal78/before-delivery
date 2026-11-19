// Labels: create, rename, delete, close, bring back, change password.

import { announce, api, el, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { handleSessionEnd } from "./app.js";
import { STATE_NAMES, UI } from "./copy.js";
import { overlayClose, overlayOpen } from "./overlay.js";

interface LabelRow {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  state: string;
  closedAt: string | null;
  eraseAt: string | null;
}

export function registerLabelsScreen(ctx: RouteCtx): () => void {
  const main = ctx.main;
  const h1 = el("h1", {}, "Labels");
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);
  const frame = el("div", { class: "table-frame", role: "region", "aria-label": "Labels table", tabindex: "0" });
  const table = el("table");
  const tbody = el("tbody");
  table.append(el("thead", {}, el("tr", {}, ...["Name", "State", "Contact"].map((x) => el("th", {}, x)))), tbody);
  frame.append(table);

  const newBtn = el("button", { class: "btn btn-primary" }, "New label");
  newBtn.addEventListener("click", () => void openNew(newBtn));
  const passBtn = el("button", { class: "btn" }, "Change password");
  passBtn.addEventListener("click", () => void openPassword(passBtn));

  const bar = el("div", { class: "bottom-bar" });
  bar.append(newBtn.cloneNode(true));
  main.append(h1, refreshLine, frame, el("div", { class: "row-controls" }, newBtn, passBtn), bar);

  async function load(): Promise<void> {
    try {
      const out = await api<{ labels: LabelRow[] }>("/api/labels");
      refreshLine.hidden = true;
      tbody.textContent = "";
      for (const label of out.labels) {
        const tr = el("tr");
        const link = el("a", { href: `/labels/${label.id}` }, label.name);
        const contact = label.state === "erased" ? "" : `${label.contactName} \u00B7 ${label.contactEmail}`;
        tr.append(el("td", {}, link), el("td", {}, STATE_NAMES[label.state] ?? label.state), el("td", {}, contact));
        tbody.append(tr);
      }
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  async function openNew(opener: HTMLElement): Promise<void> {
    const body = overlayOpen({ label: "New label", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const name = el("input", { type: "text", "aria-label": "Name" });
    const contact = el("input", { type: "text", "aria-label": "Contact name" });
    const email = el("input", { type: "email", "aria-label": "Contact email" });
    const save = el("button", { class: "btn btn-primary" }, "Save label");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(
      el("label", { class: "field" }, el("span", {}, "Name"), name),
      el("label", { class: "field" }, el("span", {}, "Contact name"), contact),
      el("label", { class: "field" }, el("span", {}, "Contact email"), email),
      el("div", { class: "dialog-foot" }, save, close),
    );
    save.addEventListener("click", async () => {
      await withWorking(save, UI.working, async () => {
        try {
          const out = await api<{ id: string; name: string }>("/api/labels", {
            method: "POST",
            body: JSON.stringify({ name: name.value, contactName: contact.value, contactEmail: email.value }),
          });
          announce(UI.labelAdded(out.name));
          overlayClose(dialog);
          location.href = `/labels/${out.id}`;
        } catch (err) {
          const failure = err as { message?: string; status?: number };
          if (failure.status === 401) handleSessionEnd();
          else announce(failure.message ?? `Give a value here.`);
        }
      });
    });
  }

  async function openPassword(opener: HTMLElement): Promise<void> {
    const body = overlayOpen({ label: "Change password", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const current = el("input", { type: "password", "aria-label": "Current password", autocomplete: "current-password" });
    const next = el("input", { type: "password", "aria-label": "New password", autocomplete: "new-password" });
    const save = el("button", { class: "btn btn-primary" }, "Save password");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(
      el("label", { class: "field" }, el("span", {}, "Current password"), current),
      el("label", { class: "field" }, el("span", {}, "New password"), next),
      el("div", { class: "dialog-foot" }, save, close),
    );
    save.addEventListener("click", async () => {
      await withWorking(save, UI.working, async () => {
        try {
          await api("/api/password", {
            method: "POST",
            body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }),
          });
          announce(UI.passwordChanged);
          overlayClose(dialog, opener);
        } catch (err) {
          const failure = err as { message?: string; status?: number };
          if (failure.status === 401) handleSessionEnd();
          else announce(failure.message ?? `Give a value here.`);
        }
      });
    });
  }

  void load();
  const timer = window.setInterval(() => void load(), 5000);
  return () => window.clearInterval(timer);
}

export function registerLabelScreen(ctx: RouteCtx): () => void {
  const labelId = location.pathname.split("/")[2];
  const main = ctx.main;
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);

  async function load(first: boolean): Promise<void> {
    try {
      const label = await api<LabelRow & { suppliers?: { id: string; name: string; townName: string; language: string; contactName: string; contactEmail: string }[] }>(`/api/labels/${labelId}`);
      refreshLine.hidden = true;
      if (first) {
        const h1 = el("h1", {}, label.name);
        main.append(h1, refreshLine);
        const stateLine = el("p", { class: "hint" }, STATE_NAMES[label.state] ?? label.state);
        if (label.state === "closed" && label.eraseAt) {
          stateLine.textContent = `${STATE_NAMES[label.state]} \u00B7 erases at ${label.eraseAt}`;
        }
        main.append(stateLine);
        const contact = el("p", {}, `${label.contactName} \u00B7 ${label.contactEmail}`);
        main.append(contact);

        const suppliers = el("section", { class: "panel", "aria-label": "Suppliers" });
        suppliers.append(el("h2", {}, "Suppliers"));
        for (const s of label.suppliers ?? []) {
          suppliers.append(el("p", {}, `${s.name} \u00B7 ${s.townName} \u00B7 ${s.contactName} \u00B7 ${s.contactEmail}`));
        }
        main.append(suppliers);

        const styles = el("section", { class: "panel", "aria-label": "Styles" });
        styles.append(el("h2", {}, "Styles"));
        main.append(styles);
        void api<{ styles: { id: string; name: string; labelId: string }[] }>("/api/styles").then((out) => {
          for (const style of out.styles.filter((s) => s.labelId === labelId)) {
            styles.append(el("p", {}, el("a", { href: `/styles/${style.id}` }, style.name)));
          }
        });

        const renameBtn = el("button", { class: "btn" }, "Rename label");
        renameBtn.addEventListener("click", () => void openRename(renameBtn, label.name));
        const deleteBtn = el("button", { class: "btn" }, "Delete label");
        deleteBtn.addEventListener("click", () => void openDelete(deleteBtn, label.name));
        const closeBtn = el("button", { class: "btn" }, "Close label");
        closeBtn.addEventListener("click", () => void openClose(closeBtn, label.name));
        const backBtn = el("button", { class: "btn" }, "Bring back");
        backBtn.addEventListener("click", () => void openBringBack(backBtn, label.name));
        main.append(el("div", { class: "row-controls" }, renameBtn, deleteBtn, closeBtn, backBtn));
      }
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  async function openRename(opener: HTMLElement, current: string): Promise<void> {
    const body = overlayOpen({ label: "Rename label", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const name = el("input", { type: "text", "aria-label": "Name" });
    name.value = current;
    const save = el("button", { class: "btn btn-primary" }, "Save name");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(el("label", { class: "field" }, el("span", {}, "Name"), name), el("div", { class: "dialog-foot" }, save, close));
    save.addEventListener("click", async () => {
      await withWorking(save, UI.working, async () => {
        try {
          await api(`/api/labels/${labelId}`, { method: "PATCH", body: JSON.stringify({ name: name.value }) });
          announce(UI.labelRenamed(name.value));
          overlayClose(dialog, opener);
          location.reload();
        } catch (err) {
          announce((err as { message?: string }).message ?? `Give a value here.`);
        }
      });
    });
  }

  async function openDelete(opener: HTMLElement, name: string): Promise<void> {
    const body = overlayOpen({ label: "Delete label", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const del = el("button", { class: "btn btn-primary" }, "Delete");
    const keep = el("button", { class: "btn" }, "Keep");
    keep.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(el("p", {}, `Delete ${name}?`), el("div", { class: "dialog-foot" }, del, keep));
    del.addEventListener("click", async () => {
      await withWorking(del, UI.working, async () => {
        try {
          await api(`/api/labels/${labelId}`, { method: "DELETE" });
          announce(UI.labelDeleted(name));
          overlayClose(dialog);
          location.href = "/labels";
        } catch (err) {
          announce((err as { message?: string }).message ?? `Something went wrong.`);
        }
      });
    });
  }

  async function openClose(opener: HTMLElement, name: string): Promise<void> {
    const body = overlayOpen({ label: "Close label", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const closeLabel = el("button", { class: "btn btn-primary" }, "Close this label");
    const keep = el("button", { class: "btn" }, "Keep open");
    keep.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(el("p", {}, `Close ${name}?`), el("div", { class: "dialog-foot" }, closeLabel, keep));
    closeLabel.addEventListener("click", async () => {
      await withWorking(closeLabel, UI.working, async () => {
        try {
          const out = await api<{ state: string; eraseAt: string }>(`/api/labels/${labelId}/close`, { method: "POST" });
          const dateText = new Date(out.eraseAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
          const timeText = new Date(out.eraseAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" });
          announce(UI.labelClosed(name, dateText, timeText));
          overlayClose(dialog);
          location.reload();
        } catch (err) {
          announce((err as { message?: string }).message ?? `Something went wrong.`);
        }
      });
    });
  }

  async function openBringBack(opener: HTMLElement, name: string): Promise<void> {
    const body = overlayOpen({ label: "Bring back", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const bring = el("button", { class: "btn btn-primary" }, "Bring back label");
    const keep = el("button", { class: "btn" }, "Keep closed");
    keep.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(el("p", {}, `Bring back ${name}?`), el("div", { class: "dialog-foot" }, bring, keep));
    bring.addEventListener("click", async () => {
      await withWorking(bring, UI.working, async () => {
        try {
          await api(`/api/labels/${labelId}/bring-back`, { method: "POST" });
          announce(UI.labelBack(name));
          overlayClose(dialog);
          location.reload();
        } catch (err) {
          announce((err as { message?: string }).message ?? `Something went wrong.`);
        }
      });
    });
  }

  void load(true);
  const timer = window.setInterval(() => void load(false), 5000);
  return () => window.clearInterval(timer);
}
