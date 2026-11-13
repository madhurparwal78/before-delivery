// The capacity table with revisions, dirty cells, live refresh and the
// conflict dialog; the restriction page.
import { api, errorOf, fieldErrorsOf, isNotSignedIn } from "./api.ts";
import type { WindowRecord, CapacityCell, RevisionRecord, ChannelRecord } from "./types.ts";
import { h, clear, text, dec, statusRegion, group } from "./html.ts";
import { currentUser, goSignIn, startPolling, topBar, route, navigate } from "./app.ts";

const root = () => document.getElementById("root")!;

route("/channels/<channelId>/capacity", async (m) => {
  const channelId = m.params.channelId!;
  const me = currentUser()!;
  const editable = me.role === "dispatcher";
  const rootEl = root();
  clear(rootEl);
  const statusEl = statusRegion("Capacity status", "capacity-status");
  const tableWrap = h("div");
  const revWrap = h("div");
  rootEl.append(topBar(`/channels/${channelId}/capacity`), h("div", { class: "page" },
    h("h1", null, "Capacity table"),
    h("div", { class: "cap-layout" },
      h("div", null, tableWrap, editable ? h("div", { style: "margin-top:12px" }, h("button", { id: "save-table", class: "primary", onclick: () => void save() }, "Save table")) : null, statusEl),
      h("div", null, h("h2", null, "Revisions"), h("ul", { class: "revisions", role: "list", "aria-label": "Revisions" }, revWrap)),
    ),
  ));

  type CellState = { windowId: string; label: string; remaining: string; savedCap: string; typed: string | null; closed: boolean; committed: string };
  let cells: CellState[] = [];
  let baseRevision = 0;
  let currentRevision = 0;
  let typedSticky = new Map<string, string>();
  let saving = false;
  let conflictOpen = false;
  let keepSettledPending = false;

  async function refresh(): Promise<void> {
    try {
      const [cap, windows, channels] = await Promise.all([
        api<{ revision: number; cells: CapacityCell[]; revisions: RevisionRecord[] }>("GET", `/api/channels/${channelId}/capacity`),
        api<{ windows: WindowRecord[] }>("GET", `/api/windows?channel=${channelId}`),
        api<{ channels: ChannelRecord[] }>("GET", "/api/channels"),
      ]);
      const rev = cap.revision;
      const capByWindow = new Map(cap.cells.map((c) => [c.window_id, c.cap_ml_day]));
      const prevSaved = new Map(cells.map((c) => [c.windowId, c.savedCap]));
      cells = windows.windows.map((w) => {
        const prev = cells.find((c) => c.windowId === w.id);
        return {
          windowId: w.id,
          label: w.label,
          remaining: w.remaining_ml,
          savedCap: capByWindow.get(w.id) ?? "0.000",
          typed: prev?.typed ?? null,
          closed: w.status === "closed",
          committed: w.committed_ml,
        };
      });
      if (baseRevision === 0) baseRevision = rev;
      currentRevision = rev;
      renderTable();
      renderRevisions(cap.revisions);
    } catch (e) {
      if (isNotSignedIn(e)) await goSignIn(location.pathname);
    }
  }

  function renderTable(): void {
    clear(tableWrap);
    const table = h("table", { "aria-label": `Capacity table ${channelName()}`, class: "stacked-capacity" },
      h("thead", null, h("tr", null,
        h("th", null, "Window"), h("th", { class: "num" }, "Remaining (ML)"),
        h("th", { class: "num" }, "Cap (ML/day)"), h("th", { class: "num" }, "Cap volume (ML)"), h("th", { class: "num" }, "Committed (ML)"),
      )));
    const tbody = h("tbody");
    for (const c of cells) {
      const input = h("input", {
        type: "text",
        "aria-label": `Cap for ${c.label} (ML/day)`,
        value: c.savedCap,
        readonly: !editable || c.closed || null,
        oninput: () => {
          c.typed = (input as HTMLInputElement).value;
        },
      }) as HTMLInputElement;
      const capVolume = cellCapVolume(c.typed ?? c.savedCap, c.windowId);
      const row = h("tr", null,
        h("td", null, c.label),
        h("td", { class: "num" }, dec(c.remaining)),
        h("td", null, input,
          c.typed && c.typed !== c.savedCap ? h("div", { class: "hint" }, `Saved cap now ${c.savedCap} ML/day`) : null,
          keepSettledPending && typedSticky.has(c.windowId) ? h("div", { class: "hint" }, `You typed ${typedSticky.get(c.windowId)}`) : null),
        h("td", { class: "num" }, dec(capVolume)),
        h("td", { class: "num" }, dec(c.committed)),
      );
      tbody.append(row);
    }
    table.append(tbody);
    tableWrap.append(table);
  }

  const capVolumeCache = new Map<string, string>();
  function cellCapVolume(cap: string, windowId: string): string {
    const w = latestWindows.get(windowId);
    if (!w) return "0.000";
    // client-side display only; the server recomputes and answers the truth
    const key = `${windowId}|${cap}`;
    if (capVolumeCache.has(key)) return capVolumeCache.get(key)!;
    // the API does not expose per-cap preview; approximate by hours ratio
    const capNum = Number(cap);
    const hours = w.hours;
    const value = (capNum * hours / 24).toFixed(3);
    capVolumeCache.set(key, value);
    return value;
  }
  let latestWindows = new Map<string, WindowRecord>();
  const baseRefresh = refresh;
  async function refreshWithWindows(): Promise<void> {
    const windows = await api<{ windows: WindowRecord[] }>("GET", `/api/windows?channel=${channelId}`);
    latestWindows = new Map(windows.windows.map((w) => [w.id, w]));
    return baseRefresh();
  }

  function channelName(): string {
    const ch = latestChannels.find((c) => c.id === channelId);
    return ch?.name ?? channelId;
  }
  let latestChannels: ChannelRecord[] = [];

  function renderRevisions(revisions: RevisionRecord[]): void {
    clear(revWrap);
    for (const r of revisions) {
      const li = h("li", null,
        h("span", { class: "meta" },
          `Revision ${r.revision} · ${r.saved_by} · ${r.saved_at}${r.restored_from !== null ? ` · restored from ${r.restored_from}` : ""}`,
        ),
        editable && r.revision < currentRevision && me.role === "dispatcher"
          ? h("button", { "aria-label": `Restore revision ${r.revision}`, onclick: () => void restore(r.revision) }, "Restore revision " + r.revision)
          : null,
      );
      revWrap.append(li);
    }
  }

  async function save(): Promise<void> {
    if (saving) return;
    const dirty = cells.filter((c) => c.typed !== null && c.typed !== c.savedCap);
    if (dirty.length === 0) return;
    saving = true;
    clear(statusEl);
    statusEl.append(text("Saving."));
    try {
      const r = await api<{ revision: number; cells: CapacityCell[] }>("PUT", `/api/channels/${channelId}/capacity`, {
        base_revision: baseRevision,
        cells: dirty.map((c) => ({ window_id: c.windowId, cap_ml_day: c.typed })),
      });
      baseRevision = r.revision;
      clear(statusEl);
      statusEl.append(text(`Revision ${r.revision} saved.`));
      for (const c of cells) c.typed = null;
      keepSettledPending = false;
      typedSticky.clear();
      await refresh();
    } catch (e) {
      const shape = errorOf(e);
      const fields = fieldErrorsOf(e);
      clear(statusEl);
      if (shape.code === "revision_conflict") {
        statusEl.append(text("Another dispatcher saved first. Each cap settled to the lower value."));
        openConflictDialog(shape.extra as { revision: number; cells: CapacityCell[]; submitted: CapacityCell[] });
      } else if (Object.keys(fields).length > 0) {
        statusEl.append(text("Some caps are not allowed."));
        await refresh();
      } else {
        statusEl.append(text("Something went wrong."));
      }
    } finally {
      saving = false;
    }
  }

  function openConflictDialog(extra: { revision: number; cells: CapacityCell[]; submitted: CapacityCell[] }): void {
    if (conflictOpen) return;
    conflictOpen = true;
    const table = h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Your numbers"), h("th", null, "Settled caps"))));
    const tbody = h("tbody");
    const settledByWindow = new Map(extra.cells.map((c) => [c.window_id, c.cap_ml_day]));
    for (const s of extra.submitted) {
      tbody.append(h("tr", null,
        h("td", { class: "num" }, dec(s.cap_ml_day)),
        h("td", { class: "num" }, dec(settledByWindow.get(s.window_id) ?? "0.000")),
      ));
    }
    table.append(tbody);
    const keepBtn = h("button", { class: "primary" }, "Keep settled caps");
    const dlg = h("dialog", { class: "alert-dialog", "aria-label": "Capacity table conflict" },
      h("div", { class: "dialog-body" },
        h("h2", null, "Capacity table conflict"),
        h("p", null, "Another dispatcher saved first. Each cap settled to the lower value."),
        table,
      ),
      h("div", { class: "dialog-actions" }, keepBtn),
    ) as HTMLDialogElement;
    document.body.append(dlg);
    dlg.showModal();
    const opener = document.getElementById("save-table") as HTMLButtonElement | null;
    keepBtn.addEventListener("click", () => {
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      conflictOpen = false;
      baseRevision = extra.revision;
      keepSettledPending = true;
      typedSticky = new Map(extra.submitted.map((s) => [s.window_id, s.cap_ml_day]));
      for (const c of cells) {
        const settled = extra.cells.find((x) => x.window_id === c.windowId);
        if (settled) c.savedCap = settled.cap_ml_day;
      }
      for (const c of cells) c.typed = null;
      void refresh();
      opener?.focus();
    });
  }

  async function restore(revision: number): Promise<void> {
    clear(statusEl);
    statusEl.append(text("Restoring."));
    try {
      const r = await api<{ revision: number; restored_from: number }>(
        "POST", `/api/channels/${channelId}/capacity/revisions/${revision}/restore`, {},
      );
      clear(statusEl);
      statusEl.append(text(`Revision ${revision} restored as revision ${r.revision}.`));
      baseRevision = r.revision;
      await refresh();
    } catch (e) {
      const shape = errorOf(e);
      clear(statusEl);
      statusEl.append(text(shape.code === "restore_below_committed"
        ? `Restoring revision ${revision} would cut below what is already committed.`
        : "Something went wrong."));
    }
  }

  // load channels for the table's accessible name
  await (async () => {
    const c = await api<{ channels: ChannelRecord[] }>("GET", "/api/channels");
    latestChannels = c.channels;
  })().catch(() => undefined);
  await refreshWithWindows();
  startPolling(refreshWithWindows, 4000);
});

// --- restriction page ------------------------------------------------------------

route("/restrictions/<id>", async (m) => {
  const id = m.params.id!;
  const rootEl = root();
  clear(rootEl);
  const statusEl = statusRegion("Board status", "board-status");
  const content = h("div");
  rootEl.append(topBar(""), h("div", { class: "page" }, content, statusEl));

  async function refresh(): Promise<void> {
    try {
      const r = await api<{
        restriction: { id: number; window_id: string; cap_ml_day: string; reason: string; effective_at: string };
        window: WindowRecord;
        moved_orders: string[];
      }>("GET", `/api/restrictions/${id}`);
      const r2 = r;
      clear(content);
      content.append(
        h("h1", null, "Restriction"),
        h("div", { class: "lead-counter" },
          group("Remaining ML", h("div", { class: "value num" }, dec(r2.window.remaining_ml))),
        ),
        h("dl", null,
          h("div", null, h("dt", null, "Channel"), h("dd", null, r2.window.channel_name)),
          h("div", null, h("dt", null, "Window"), h("dd", null, r2.window.label)),
          h("div", null, h("dt", null, "Cap"), h("dd", { class: "num" }, dec(r2.restriction.cap_ml_day), " ML/day")),
          h("div", null, h("dt", null, "Reason"), h("dd", null, r2.restriction.reason)),
          h("div", null, h("dt", null, "Effective"), h("dd", null, r2.restriction.effective_at)),
          h("div", null, h("dt", null, "Pro-rated cap volume"), h("dd", { class: "num" }, dec(r2.window.cap_volume_ml), " ML")),
        ),
        h("h2", null, "Moved orders"),
        r2.moved_orders.length
          ? h("ul", null, r2.moved_orders.map((n) => h("li", null, h("a", { href: `/orders/${n}` }, n))))
          : h("p", { class: "hint" }, "No orders were moved."),
      );
      statusEl.append(text(`Restriction published for ${r2.window.channel_name}, ${r2.window.label}. ${r2.moved_orders.length} orders moved to requested.`));
    } catch (e) {
      if (isNotSignedIn(e)) await goSignIn(location.pathname);
    }
  }
  await refresh();
  startPolling(refresh, 4000);
});
