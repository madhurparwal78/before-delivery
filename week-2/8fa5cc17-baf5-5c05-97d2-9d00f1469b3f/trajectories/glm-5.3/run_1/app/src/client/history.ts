// Block history: revisions, the word diff and restore.

import { api, apiFail, ApiFailure, type BlockJson } from "./api.js";
import { h, openDialog, announce, alertMessage, clearAlert, dateTimeShort } from "./dom.js";
import { state } from "./app.js";

interface Revision {
  version: number;
  body: string;
  plain: string;
  label: string;
  created_at: string;
}

interface DiffOp {
  op: "equal" | "delete" | "insert";
  text: string;
}

export function openHistoryDialog(blockId: string): void {
  void run(blockId);
}

async function run(blockId: string): Promise<void> {
  let revisions: Revision[] = [];
  try {
    const res = await api<{ revisions: Revision[] }>("GET", `/api/blocks/${blockId}/revisions`);
    revisions = res.revisions;
  } catch {
    // a deleted note's history answers not found: the dialog never opens
    return;
  }
  const originId = blockId;
  const list = h("ul", { role: "listbox", "aria-label": "Revisions", class: "history-list" });
  const fromSel = h("select", { "aria-label": "Compare from" });
  const toSel = h("select", { "aria-label": "Compare to" });
  const changes = h("div", { role: "region", "aria-label": "Changes", class: "history-changes" });
  const restoreBtn = h("button", {}, "Restore this version");

  const zone = state.app?.homeTimeZone ?? "UTC";
  const versionLabel = (r: Revision): string => `Version ${r.version}, ${r.label}, ${dateTimeShort(new Date(r.created_at), zone)}`;

  let fromVersion = revisions.length > 1 ? revisions[1].version : revisions[0].version;
  let toVersion = revisions[0].version;

  const fillSelects = (): void => {
    fromSel.replaceChildren();
    toSel.replaceChildren();
    for (const r of revisions) {
      fromSel.append(h("option", { value: String(r.version) }, versionLabel(r)));
      toSel.append(h("option", { value: String(r.version) }, versionLabel(r)));
    }
    fromSel.value = String(fromVersion);
    toSel.value = String(toVersion);
  };

  const refreshDiff = async (): Promise<void> => {
    try {
      const res = await api<{ ops: DiffOp[] }>("GET", `/api/blocks/${originId}/diff?from=${fromVersion}&to=${toVersion}`);
      changes.replaceChildren();
      for (const op of res.ops) {
        if (op.op === "equal") changes.append(h("span", { class: "diff-equal" }, op.text));
        else if (op.op === "delete") changes.append(h("span", { class: "diff-delete" }, op.text));
        else changes.append(h("span", { class: "diff-insert" }, op.text));
      }
      if (res.ops.length === 0) changes.append(h("span", { class: "diff-equal" }, "These versions are the same."));
    } catch {
      changes.replaceChildren(h("span", { class: "diff-equal" }, "The diff is unavailable right now."));
    }
  };

  const refreshList = (): void => {
    list.replaceChildren();
    for (const r of revisions) {
      const item = h("li", { role: "option", "aria-selected": String(r.version === fromVersion), tabindex: "-1", class: r.version === fromVersion ? "history-item active" : "history-item" }, versionLabel(r));
      item.addEventListener("click", () => {
        fromVersion = r.version;
        fromSel.value = String(fromVersion);
        refreshList();
        void refreshDiff();
      });
      list.append(item);
    }
  };

  fillSelects();
  refreshList();
  void refreshDiff();

  fromSel.addEventListener("change", () => {
    fromVersion = Number(fromSel.value);
    refreshList();
    void refreshDiff();
  });
  toSel.addEventListener("change", () => {
    toVersion = Number(toSel.value);
    void refreshDiff();
  });

  const dialog = h("div", { role: "dialog", "aria-label": "Block history", class: "dialog history-dialog" },
    h("h2", { text: "Block history" }),
    list,
    h("div", { class: "history-compare" },
      h("label", {}, "Compare from ", fromSel),
      h("label", {}, "Compare to ", toSel)
    ),
    changes,
    restoreBtn
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, document.activeElement as HTMLElement | null);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
  });
  restoreBtn.addEventListener("click", async () => {
    // the restore names the version the block has on screen as its base
    const { blockById } = await import("./object.js");
    const bs = blockById(originId);
    if (bs === null) return;
    try {
      const res = await api<BlockJson>("POST", `/api/blocks/${originId}/restore`, { version: fromVersion, base_version: bs.version });
      bs.committed = res.body ?? bs.committed;
      bs.draft = bs.committed;
      bs.version = res.version;
      announce(`Restored version ${fromVersion}. Saved as version ${res.version}.`);
      // the new revision joins the list in place
      const restored = revisions.find((r) => r.version === fromVersion);
      if (restored !== undefined) {
        revisions.unshift({ version: res.version, body: res.body ?? restored.body, plain: restored.plain, label: bs === null ? "You" : "You", created_at: new Date().toISOString() });
        revisions = revisions.map((r) => (r.version === res.version ? { ...r, label: "You" } : r));
        fillSelects();
        refreshList();
      }
    } catch (e) {
      if (e instanceof ApiFailure && e.body.error === "version_conflict") {
        alertMessage("This block changed since you opened its history.");
      } else {
        alertMessage(apiFail(e, "version"));
      }
    }
  });
  const first = dialog.querySelector("button, select") as HTMLElement | null;
  if (first !== null) first.focus();
}
