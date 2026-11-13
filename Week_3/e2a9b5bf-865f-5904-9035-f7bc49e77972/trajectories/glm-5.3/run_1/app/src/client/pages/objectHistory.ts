// Object history: every observation of one object, newest first (DP-26, DP-27).
import { app, navigate, persist } from "../app.js";
import { el } from "../dom.js";
import { apiGet } from "../api.js";
import { renderConnection, shell } from "./shell.js";
import { catalogue } from "../../shared/catalogue.js";
import { formatAperture } from "../../shared/optics.js";
import type { ObjectHistory } from "../../shared/api.js";
import { connectionSentences } from "../../shared/sentences.js";

export async function renderObjectHistory(root: HTMLElement, objectId: string): Promise<void> {
  const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null)!;
  const store = app.state.stores[accountId];
  const object = catalogue.find((o) => o.id === objectId);
  interface MutableHistory {
    object: ObjectHistory["object"];
    observations: import("../../shared/api.js").Observation[];
  }
  let history: MutableHistory | null = null;
  const stored = store?.histories[objectId] ?? null;
  if (stored) history = { object: stored.object, observations: [...stored.observations] };
  if ((!history || history.observations.length === 0) && navigator.onLine) {
    try {
      const fetched = await apiGet.history(objectId);
      history = { object: fetched.object, observations: [...fetched.observations] };
      const accountStore = app.state.stores[accountId] ??= {
        kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
        histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
      };
      accountStore.histories[objectId] = fetched;
      persist();
    } catch {
      history = history ?? null;
    }
  }
  if (!history && !store?.histories[objectId]) {
    if (!object) {
      const parts = shell("Not found", []);
      parts.column.append(el("p", { class: "notfound", text: "We couldn't find that here." }));
      root.append(parts.column);
      return;
    }
    const parts = shell(`${object.designation} — ${object.name}`, []);
    parts.connection.append(el("p", { class: "banner", text: connectionSentences.notOnDevice }));
    root.append(parts.column);
    return;
  }
  const resolved: MutableHistory = history ?? { object: store!.histories[objectId]!.object, observations: [...store!.histories[objectId]!.observations] };
  const title = `${resolved.object.designation} — ${resolved.object.name}`;
  const parts = shell(title, []);
  const column = parts.column;

  const list = el("ul", { class: "rows", role: "list", "aria-label": `Observations of ${resolved.object.designation}` });
  resolved.observations.forEach((observation, index) => {
    const open = el("a", {
      class: "row-ink link", text: "Open", href: `/sessions/${observation.session_id}?observation=${observation.id}`,
      onclick: (event: MouseEvent) => {
        event.preventDefault();
        navigate(`/sessions/${observation.session_id}?observation=${observation.id}`);
      },
    });
    const remove = el("button", { class: "button ghost", text: "Delete" });
    remove.addEventListener("click", () => {
      openDialog(`Delete observation?`, "Delete", "Keep observation", async () => {
        const { queueChangeLocal } = await import("../app.js");
        queueChangeLocal(accountId, {
          client_op_id: crypto.randomUUID(),
          kind: "observation.delete",
          observation_id: observation.id,
          base_version: observation.version,
        }, "observation.delete");
        // The row leaves the device's history copy at once.
        resolved.observations = resolved.observations.filter((o) => o.id !== observation.id);
        renderObjectHistory(root, objectId).then(() => {
          const rows = document.querySelectorAll('[role="list"] li');
          const nextRow = rows[Math.min(index, rows.length - 1)];
          if (nextRow) {
            (nextRow.querySelector("a") as HTMLElement | null)?.focus();
          } else {
            (document.querySelector('nav a[href="/tonight"]') as HTMLElement | null)?.focus();
          }
        });
      }, () => remove.focus(), `Delete ${observation.designation} from ${observation.evening_date}?`);
    });
    const muted = observation.observed_at
      ? `${observation.evening_date} · ${observation.local_time} local, UTC${observation.local_offset} · ${formatAperture(observation.derived.aperture_mm)} mm · ${observation.derived.magnification}×`
      : `${observation.evening_date} · ${formatAperture(observation.derived.aperture_mm)} mm · ${observation.derived.magnification}×`;
    list.append(el("li", { class: "row" },
      el("span", { class: "row-ink", text: observation.designation }),
      el("span", { class: "row-muted", text: muted }),
      observation.description ? el("p", { class: "row-description", text: observation.description }) : null,
      el("div", { class: "row-actions" }, open, remove),
    ));
  });

  column.append(list);
  root.append(column);
  renderConnection(parts.connection);
}

interface DialogContext {
  open: boolean;
}

let dialogState: DialogContext = { open: false };

function openDialog(label: string, confirmText: string, cancelText: string, onConfirm: () => Promise<void> | void, onCancelFocus: () => void, text: string): void {
  dialogState = { open: true };
  const confirmButton = el("button", { class: "button primary", text: confirmText });
  const cancelButton = el("button", { class: "button", text: cancelText });
  const dialog = el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": label },
    el("p", { class: "dialog-text", text }),
    el("div", { class: "dialog-actions" }, cancelButton, confirmButton),
  );
  const close = (focusTarget: () => void): void => {
    dialogState = { open: false };
    dialog.remove();
    focusTarget();
  };
  confirmButton.addEventListener("click", async () => {
    close(() => confirmButton.blur());
    await onConfirm();
  });
  cancelButton.addEventListener("click", () => close(onCancelFocus));
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(onCancelFocus);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const buttons = [cancelButton, confirmButton];
      const index = buttons.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index === buttons.length - 1 ? 0 : index + 1);
      buttons[next]!.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      (document.activeElement as HTMLElement).click();
    }
  });
  document.body.append(dialog);
  cancelButton.focus();
}
