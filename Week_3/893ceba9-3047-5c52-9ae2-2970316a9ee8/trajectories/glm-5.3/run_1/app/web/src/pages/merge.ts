import { PageCtx } from "../main";
import { h, clearEl, Dialog } from "../ui";
import { api, ProjectDetail, Conflict, MergePreview, Operation, statusWord } from "../api";

export async function renderMergePage(ctx: PageCtx, slug: string): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  window.__deskCurrentSlug = slug;
  const params = new URLSearchParams(location.search);
  let branch = params.get("branch") || "main";
  const detail = await api<ProjectDetail>(`/api/projects/${slug}`);
  const live = detail.branches.find((b) => b.name === branch && (b.state === "open" || b.state === "in_review"));
  if (!live) branch = "main";

  const container = h("div", { class: "container", style: "padding-bottom:60px" });
  const head = h("div", { class: "page-head" },
    h("div", null, h("h1", {}, `Merge ${branch} into main`)),
    h("a", { class: "btn btn-outline btn-sm", href: `/projects/${slug}?branch=${encodeURIComponent(branch)}` }, "Back to project"),
  );
  container.appendChild(head);

  const countsCard = h("div", { class: "card", style: "margin-top:20px" });
  const countsRow = h("div", { class: "stat-row" });
  countsCard.appendChild(countsRow);
  container.appendChild(countsCard);

  const conflictsCard = h("div", { class: "card", style: "margin-top:26px" });
  conflictsCard.appendChild(h("h3", { style: "font-size:1.15em" }, "Conflicts"));
  const conflictsHolder = h("div", { class: "mt-12" });
  conflictsCard.appendChild(conflictsHolder);
  container.appendChild(conflictsCard);

  const actionsCard = h("div", { class: "card", style: "margin-top:26px" });
  const actionsRow = h("div", { class: "row" });
  const reviewBtn = h("button", { class: "btn btn-outline" }, "Request review");
  const reopenBtn = h("button", { class: "btn btn-outline" }, "Reopen branch");
  const mergeBtn = h("button", { class: "btn btn-primary" }, "Merge into main");
  const abandonBtn = h("button", { class: "btn btn-outline" }, "Abandon branch");
  actionsRow.appendChild(reviewBtn);
  actionsRow.appendChild(reopenBtn);
  actionsRow.appendChild(mergeBtn);
  actionsRow.appendChild(abandonBtn);
  actionsCard.appendChild(actionsRow);
  container.appendChild(actionsCard);

  const opsCard = h("div", { class: "card", style: "margin-top:26px" });
  opsCard.appendChild(h("h3", { style: "font-size:1.15em" }, "Operations"));
  const opsHolder = h("div", { class: "mt-12" });
  opsCard.appendChild(opsHolder);
  container.appendChild(opsCard);

  main.appendChild(container);

  let preview: MergePreview | null = null;

  async function loadPreview(): Promise<void> {
    const res = await api<MergePreview>(`/api/projects/${slug}/branches/${encodeURIComponent(branch)}/merge-preview`);
    preview = res;
    clearEl(countsRow);
    const items: Array<[string, number]> = [
      ["New keys", res.new_keys], ["Edited keys", res.edited_keys],
      ["Deleted keys", res.deleted_keys], ["Conflicts", res.conflicts.filter((c) => !c.resolution).length],
    ];
    for (const [cap, val] of items) {
      countsRow.appendChild(h("div", { class: "stat-col" }, h("div", { class: "val num" }, String(val)), h("div", { class: "cap" }, cap)));
    }
    renderConflicts(res.conflicts);
    reviewBtn.disabled = branch === "main";
    reopenBtn.disabled = branch === "main";
    mergeBtn.disabled = branch === "main";
    abandonBtn.disabled = branch === "main";
  }

  function renderConflicts(conflicts: Conflict[]): void {
    clearEl(conflictsHolder);
    if (branch === "main" || conflicts.length === 0) {
      conflictsHolder.appendChild(h("p", { class: "muted" }, "No conflicts with main."));
      return;
    }
    const table = h("table", { class: "plain conflict-table" });
    table.appendChild(h("thead", null, h("tr", null,
      h("th", null, "Key"), h("th", null, "Field"), h("th", null, "Base"), h("th", null, "Main"), h("th", null, "Branch"), h("th", null, "Resolution"))));
    const tbody = h("tbody");
    for (const c of conflicts) {
      const resolved = !!c.resolution;
      const resolveBtn = h("button", { class: "btn btn-outline btn-sm", onclick: () => resolveConflict(c, resolveBtn) },
        resolved ? "Resolved" : `Resolve ${c.key} ${fieldShort(c.field)}`);
      tbody.appendChild(h("tr", null,
        h("td", { class: "mono" }, c.key),
        h("td", null, c.field),
        h("td", { class: "mono" }, c.base ?? "—"),
        h("td", { class: "mono" }, c.main ?? "—"),
        h("td", { class: "mono" }, c.branch ?? "—"),
        h("td", null, c.resolution ? `${c.resolution.choice}` : "—", " ", resolveBtn),
      ));
    }
    table.appendChild(tbody);
    const wrap = h("div", { class: "table-wrap" });
    wrap.appendChild(table);
    conflictsHolder.appendChild(wrap);
  }

  function fieldShort(f: string): string {
    if (f.startsWith("translation:")) return f.slice(12);
    return f;
  }

  async function loadOps(): Promise<void> {
    clearEl(opsHolder);
    try {
      const res = await api<{ operations: Operation[] }>(`/api/projects/${slug}/operations`);
      if (res.operations.length === 0) {
        opsHolder.appendChild(h("p", { class: "muted" }, "No operations yet."));
        return;
      }
      const table = h("table", { class: "plain" });
      table.appendChild(h("thead", null, h("tr", null, h("th", null, "Operation"), h("th", null, "At"), h("th", null, "Status"), h("th", null, ""))));
      const tbody = h("tbody");
      for (const op of res.operations) {
        const restoreBtn = h("button", { class: "btn btn-outline btn-sm", disabled: op.restorable ? undefined : "true" }, "Restore");
        restoreBtn.addEventListener("click", () => openRestoreDialog(ctx, slug, op, () => void loadAll()));
        tbody.appendChild(h("tr", null,
          h("td", null, op.label),
          h("td", null, new Date(op.at).toLocaleString()),
          h("td", null, op.restored_at ? "Restored" : "—"),
          h("td", null, restoreBtn),
        ));
      }
      table.appendChild(tbody);
      const wrap = h("div", { class: "table-wrap" });
      wrap.appendChild(table);
      opsHolder.appendChild(wrap);
    } catch (e: any) {
      opsHolder.appendChild(h("p", { class: "muted" }, "The desk couldn't reach the server. Check your connection and try again."));
    }
  }

  function branchStateWord(): string | null {
    const b = detail.branches.find((x) => x.name === branch);
    return b ? b.state : null;
  }

  reviewBtn.addEventListener("click", async () => {
    reviewBtn.disabled = true;
    ctx.fb.setStatus("Updating branch.");
    try {
      const b = await api(`/api/projects/${slug}/branches/${encodeURIComponent(branch)}/transitions`, { method: "POST", json: { to: "in_review" } });
      ctx.fb.setStatus(`Branch ${branch} is ${statusWord((b as any).state)}.`);
      await loadAll();
    } catch (e: any) {
      reviewBtn.disabled = false;
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    }
  });

  reopenBtn.addEventListener("click", async () => {
    reopenBtn.disabled = true;
    ctx.fb.setStatus("Updating branch.");
    try {
      const b = await api(`/api/projects/${slug}/branches/${encodeURIComponent(branch)}/transitions`, { method: "POST", json: { to: "open" } });
      ctx.fb.setStatus(`Branch ${branch} is ${statusWord((b as any).state)}.`);
      await loadAll();
    } catch (e: any) {
      reopenBtn.disabled = false;
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    }
  });

  mergeBtn.addEventListener("click", async () => {
    mergeBtn.disabled = true;
    ctx.fb.setStatus(`Merging ${branch} into main.`);
    try {
      await api(`/api/projects/${slug}/branches/${encodeURIComponent(branch)}/merge`, { method: "POST", json: {} });
      ctx.fb.setStatus(`Merged ${branch} into main.`);
      history.replaceState(null, "", `/projects/${slug}?branch=main`);
      await loadAll();
    } catch (e: any) {
      mergeBtn.disabled = false;
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    }
  });

  abandonBtn.addEventListener("click", () => {
    const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Abandon branch" });
    dlg.appendChild(h("h2", {}, "Abandon branch"));
    dlg.appendChild(h("p", { class: "sub" }, `Abandon ${branch}? This cannot be undone.`));
    const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
    const abandon = h("button", { class: "btn btn-primary" }, "Abandon");
    dlg.appendChild(h("div", { class: "actions-row" }, cancel, abandon));
    const dialog = new Dialog(dlg, abandonBtn);
    dialog.open();
    cancel.addEventListener("click", () => dialog.close(false));
    abandon.addEventListener("click", async () => {
      abandon.disabled = true;
      ctx.fb.setStatus("Updating branch.");
      try {
        const b = await api(`/api/projects/${slug}/branches/${encodeURIComponent(branch)}/transitions`, { method: "POST", json: { to: "abandoned" } });
        ctx.fb.setStatus(`Branch ${branch} is ${statusWord((b as any).state)}.`);
        dialog.close(true);
        history.replaceState(null, "", `/projects/${slug}?branch=main`);
        await loadAll();
      } catch (e: any) {
        abandon.disabled = false;
        ctx.fb.clearStatus();
        ctx.fb.setProblem(e.message);
      }
    });
  });

  function resolveConflict(c: Conflict, opener: HTMLElement): void {
    ctx.fb.setStatus("Holding conflict.");
    api<{ held_until: string }>(`/api/projects/${slug}/branches/${encodeURIComponent(branch)}/conflicts/${encodeURIComponent(c.id)}/hold`, { method: "POST", json: {} })
      .then((res) => {
        ctx.fb.setStatus(`Holding this conflict for you until ${hhmmLocal(res.held_until)}.`);
        openResolveDialog(ctx, slug, branch, c, () => void loadAll());
      })
      .catch((e: any) => {
        ctx.fb.clearStatus();
        let msg = e.message;
        if (e.code === "conflict_held" && e.details && e.details.held_until) msg = `This conflict is being resolved in another session until ${hhmmLocal(e.details.held_until as string)}.`;
        ctx.fb.setProblem(msg);
        void opener;
      });
  }

  async function loadAll(): Promise<void> {
    await loadPreview();
    await loadOps();
  }

  void branchStateWord;
  await loadAll();
}

function hhmmLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openRestoreDialog(ctx: PageCtx, slug: string, op: Operation, onDone: () => void): void {
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Restore" });
  dlg.appendChild(h("h2", {}, "Restore"));
  dlg.appendChild(h("p", { class: "sub" }, `Restore the state before this ${op.kind}?`));
  const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
  const restore = h("button", { class: "btn btn-primary" }, "Restore now");
  dlg.appendChild(h("div", { class: "actions-row" }, cancel, restore));
  const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
  dialog.open();
  cancel.addEventListener("click", () => dialog.close(false));
  restore.addEventListener("click", async () => {
    restore.disabled = true;
    ctx.fb.setStatus("Restoring.");
    try {
      await api(`/api/projects/${slug}/operations/${op.id}/restore`, { method: "POST", json: {} });
      ctx.fb.setStatus(`Restored the state before this ${op.kind}.`);
      dialog.close(true);
      onDone();
    } catch (e: any) {
      restore.disabled = false;
      ctx.fb.clearStatus();
      let msg = e.message;
      if (e.code === "restore_superseded") msg = "Later changes were made after this, so it can't be restored exactly.";
      if (e.code === "already_restored") msg = "This was already restored.";
      ctx.fb.setProblem(msg);
    }
  });
}

function openResolveDialog(ctx: PageCtx, slug: string, branch: string, c: Conflict, onDone: () => void): void {
  const choice = { value: "main" as "main" | "branch" | "custom" };
  const radios: HTMLElement[] = [];
  const newValue = h("input", { class: "control", "aria-label": "New value", disabled: true }) as HTMLInputElement;
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Resolve conflict" });
  dlg.appendChild(h("h2", {}, "Resolve conflict"));
  dlg.appendChild(h("p", { class: "sub" }, `${c.key} · ${c.field}`));
  const mkRadio = (label: string, val: "main" | "branch" | "custom") => {
    const input = h("input", { type: "radio", name: "choice", value: val, onchange: () => {
      choice.value = val;
      newValue.disabled = val !== "custom";
    } }) as HTMLInputElement;
    if (val === "main") input.checked = true;
    radios.push(input);
    return h("label", { class: "field row", style: "gap:10px" }, input, h("span", { class: "label", style: "margin:0" }, label));
  };
  dlg.appendChild(mkRadio("Keep main", "main"));
  dlg.appendChild(mkRadio("Keep branch", "branch"));
  dlg.appendChild(mkRadio("Write a new value", "custom"));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "New value"), newValue));
  const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
  const save = h("button", { class: "btn btn-primary" }, "Save resolution");
  dlg.appendChild(h("div", { class: "actions-row" }, cancel, save));
  const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
  dialog.open();
  cancel.addEventListener("click", () => dialog.close(false));
  save.addEventListener("click", async () => {
    save.disabled = true;
    ctx.fb.setStatus("Saving resolution.");
    const body: any = { choice: choice.value };
    if (choice.value === "custom") body.value = newValue.value;
    try {
      await api(`/api/projects/${slug}/branches/${encodeURIComponent(branch)}/conflicts/${encodeURIComponent(c.id)}`, { method: "PUT", json: body });
      ctx.fb.setStatus("Resolution saved.");
      dialog.close(true);
      onDone();
    } catch (e: any) {
      save.disabled = false;
      ctx.fb.clearStatus();
      let msg = e.message;
      if (e.code === "hold_required") msg = "Your hold on this conflict ran out. Hold it again to resolve it.";
      ctx.fb.setProblem(msg);
    }
  });
}
