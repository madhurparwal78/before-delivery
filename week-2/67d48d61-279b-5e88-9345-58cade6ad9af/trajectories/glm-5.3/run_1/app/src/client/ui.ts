import { requestRender } from "./render.js";
/** Rendering the prompt-book look: header, rail, grids, detail, screens. */
import {
  CYCLE_KEYS, DEPT_ORDER, STATUS_ORDER, countdownText, crewName, cycleName, departmentName,
  labelName, priorityName, statusName, taskWord,
  type ActivityJson, type AttachmentJson, type RequestJson, type TaskJson,
} from "./domain.js";
import {
  store, view, rowIds, pushAddress, focusRow, setCurrent,
  toggleSelect, openDetail, closeDetail, undo, removeLink, patchTask, uploadAttachment,
  type Dialog,
} from "./app.js";
import { openDialog, wireDialog, wireDrawer, focusDrawer } from "./dialogs.js";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function layoutMode(): "wide" | "mid" | "phone" {
  const w = window.innerWidth;
  if (w >= 1200) return "wide";
  if (w >= 768) return "mid";
  return "phone";
}

export function render(): void {
  const app = document.getElementById("app")!;
  if (!store.production || !store.snapshot) {
    app.innerHTML = `<div class="boot" role="status">Loading Promptside…</div>`;
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const focusRowId = active?.getAttribute("data-task-id") ?? "";
  const focusId = active?.id ?? "";
  app.innerHTML = "";
  if (view.path === "/notfound") { renderNotFound(app); return }
  const shell = document.createElement("div");
  shell.className = `layout layout-${layoutMode()}`;
  shell.innerHTML = `
    ${headerHtml()}
    ${layoutMode() === "phone" ? `<button id="drawer-btn" class="btn btn-secondary">Departments</button>` : ""}
    <div class="layout-row">
      <aside class="rail-area" ${layoutMode() === "phone" ? "hidden" : ""}>${railHtml()}</aside>
      <main class="main-area">
        <div class="service-status" role="region" aria-label="Service status">${serviceStatusHtml()}</div>
        <div id="notices" class="notices" role="status" aria-live="polite">${store.notice ? `<p>${esc(store.notice)}</p>` : ""}</div>
        ${view.path === "/tasks" ? toolbarHtml() + gridAreaHtml() : ""}
        ${view.path === "/triage" ? triageAreaHtml() : ""}
        ${view.path === "/requests" ? requestsAreaHtml() : ""}
      </main>
      ${store.detail && layoutMode() !== "phone" ? `<aside class="detail-area">${detailHtml()}</aside>` : ""}
    </div>
    ${store.detail && layoutMode() === "phone" ? phoneSheetHtml() : ""}
    ${store.drawer ? drawerHtml() : ""}
    ${dialogHtml()}`;
  app.appendChild(shell);
  wireShell(shell);
  restoreFocus(focusId, focusRowId);
}

function restoreFocus(focusId: string, focusRowId: string): void {
  if (store.dialog || store.drawer) return;
  if (focusRowId) {
    const el = document.querySelector(`[data-task-id="${focusRowId}"]`) as HTMLElement | null;
    if (el) { el.focus(); return }
  }
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLElement | null;
    if (el) { el.focus(); return }
  }
  if (document.activeElement === document.body) focusRow(store.current);
}

// ---------- header ----------

function headerHtml(): string {
  const prod = store.production!;
  return `
    <header role="banner">
      <h1>${esc(prod.show)}</h1>
      <div class="header-meta">
        <span class="theatre">${esc(prod.theatre)}</span>
        <span class="countdown">${esc(countdownText(prod.days_to_opening))}</span>
        <a id="blocked-link" href="/tasks?blocked=1"><span id="blocked-count" class="num">${store.snapshot!.blocked}</span> blocked</a>
      </div>
    </header>`;
}

// ---------- rail ----------

function railHtml(): string {
  const snap = store.snapshot!;
  const deptCounts = new Map<string, number>();
  for (const t of store.tasks.values()) {
    if (["backlog", "todo", "in_progress"].includes(t.status)) {
      deptCounts.set(t.department, (deptCounts.get(t.department) ?? 0) + 1);
    }
  }
  const links = [
    `<a class="rail-link${view.path === "/tasks" && !view.dept && !view.cycle ? " current" : ""}" href="/tasks">All tasks</a>`,
    `<a class="rail-link" href="/triage">Triage <span class="num">${snap.triage}</span></a>`,
    `<a class="rail-link" href="/requests">Requests</a>`,
    ...DEPT_ORDER.map((d) => `<a class="rail-link${view.dept === d ? " current" : ""}" href="/tasks?dept=${d}">
      <span class="tape tape-${d}">${esc(departmentName(d))}</span> <span class="num">${deptCounts.get(d) ?? 0}</span></a>`),
  ].join("");
  const cycles = snap.cycles.map((c) => `
    <a class="cycle-item${view.cycle === c.key ? " current" : ""}" href="/tasks?cycle=${c.key}">
      <span class="cycle-name">${esc(c.name)}</span>
      <span class="progress-line" role="progressbar" aria-label="${esc(c.name)} progress"
        aria-valuenow="${c.done}" aria-valuemin="0" aria-valuemax="${c.total}"
        style="--pct:${c.total === 0 ? 0 : Math.round((c.done / c.total) * 100)}%"><span class="progress-fill"></span></span>
      <span class="progress-text"><span class="num">${c.done}</span> of <span class="num">${c.total}</span> done</span>
    </a>`).join("");
  const actor = store.production!.crew.map((c) =>
    `<option value="${c.handle}"${store.actor === c.handle ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  return `
    <nav aria-label="Departments" class="rail">
      <div class="rail-links">${links}</div>
      <div class="rail-cycles">${cycles}</div>
      <div class="rail-actor">
        <label class="sr-only" for="actor-select">Working as</label>
        <select id="actor-select" aria-label="Working as">${actor}</select>
      </div>
    </nav>`;
}

function serviceStatusHtml(): string {
  const alerts: string[] = [];
  if (store.intakeDown) alerts.push(`<div class="service-alert" role="alert">Request intake is unreachable. New requests reach triage when it is back, and decisions are paused.</div>`);
  if (store.storageDown) alerts.push(`<div class="service-alert" role="alert">Plot storage is unreachable. Attachments can't be uploaded or opened right now; everything else still works.</div>`);
  return alerts.join("");
}

// ---------- toolbar ----------

function toolbarHtml(): string {
  const sel = store.selection.size;
  return `
    <div class="toolbar" role="toolbar" aria-label="Task tools">
      <button id="view-list" class="btn btn-secondary${view.view === "list" ? " pressed" : ""}" aria-pressed="${view.view === "list"}">List view</button>
      <button id="view-board" class="btn btn-secondary${view.view === "board" ? " pressed" : ""}" aria-pressed="${view.view === "board"}">Board view</button>
      <label class="toolbar-field">Group by
        <select id="group-select" aria-label="Group by"${view.view === "board" ? " hidden" : ""}>
          <option value="status"${view.group === "status" ? " selected" : ""}>Status</option>
          <option value="cycle"${view.group === "cycle" ? " selected" : ""}>Cycle</option>
          <option value="department"${view.group === "department" ? " selected" : ""}>Department</option>
          <option value="owner"${view.group === "owner" ? " selected" : ""}>Owner</option>
        </select></label>
      <label class="toolbar-field"><input type="checkbox" id="blocked-only" aria-label="Blocked only"${view.blocked ? " checked" : ""}> Blocked only</label>
      <label class="toolbar-field">Cycle
        <select id="cycle-select" aria-label="Cycle">
          <option value="">All cycles</option>
          ${CYCLE_KEYS.map((k) => `<option value="${k}"${view.cycle === k ? " selected" : ""}>${esc(cycleName(k))}</option>`).join("")}
        </select></label>
      <button id="new-task-btn" class="btn btn-secondary">New task</button>
      <button id="undo-btn" class="btn btn-secondary">Undo</button>
      <button id="commands-btn" class="btn btn-primary">Commands</button>
      <span id="selection-text" class="selection-text${sel > 0 ? "" : " hidden"}">${sel} selected</span>
      <span id="saving-text" class="saving-text${store.saving ? "" : " hidden"}">Saving</span>
    </div>`;
}

// ---------- grid ----------

interface Group { key: string; name: string; ids: string[] }

function groups(): Group[] {
  const ids = rowIds();
  const mk = (key: string, name: string): Group => ({
    key, name, ids: ids.filter((id) => groupKeyFor(id) === key),
  });
  if (view.view === "board") {
    // board view shows four columns; Cancelled tasks are not shown
    return ["backlog", "todo", "in_progress", "done"].map((s) => ({
      key: s, name: statusName(s), ids: ids.filter((id) => store.tasks.get(id)!.status === s),
    }));
  }
  if (view.group === "cycle") return [...CYCLE_KEYS.map((k) => mk(k, cycleName(k))), mk("none", "No cycle")];
  if (view.group === "department") return DEPT_ORDER.map((k) => mk(k, departmentName(k)));
  if (view.group === "owner") {
    const handles = store.production!.crew.map((c) => c.handle);
    return [...handles.map((h) => mk(h, crewName(h)!)), mk("none", "No owner")];
  }
  return STATUS_ORDER.map((k) => mk(k, statusName(k)));
}

function groupKeyFor(id: string): string {
  const t = store.tasks.get(id)!;
  if (view.group === "cycle") return t.cycle ?? "none";
  if (view.group === "department") return t.department;
  if (view.group === "owner") return t.owner ?? "none";
  return t.status;
}

function sortedIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ta = store.tasks.get(a)!, tb = store.tasks.get(b)!;
    if (ta.priority !== tb.priority) return ta.priority - tb.priority;
    return ta.number - tb.number;
  });
}

function gridAreaHtml(): string {
  const ids = rowIds();
  if (ids.length === 0) {
    return `<section class="empty"><h2 id="empty-heading" tabindex="-1">No tasks match this view</h2></section>`;
  }
  const visible = view.view === "board" ? groups() : groups().filter((g) => g.ids.length > 0);
  const cols = visible.map((g) => {
    const sorted = sortedIds(g.ids);
    const header = view.view === "board"
      ? `<h3 class="col-header">${esc(g.name)}</h3>`
      : `<div class="group-header">${esc(g.name)} <span class="num">${sorted.length}</span></div>`;
    return `<div class="group" role="rowgroup" aria-label="${esc(g.name)}" data-group="${esc(g.key)}">
      ${header}
      ${sorted.map((id) => rowHtml(store.tasks.get(id)!)).join("")}
    </div>`;
  }).join("");
  return `
    <div class="grid-wrap${view.view === "board" ? " board" : ""}">
      <div id="cue-line" class="cue-line" aria-hidden="true"></div>
      <div id="task-grid" class="grid${view.view === "board" ? " grid-board" : ""}" role="grid" aria-label="Tasks">${cols}</div>
    </div>`;
}

function rowHtml(t: TaskJson): string {
  const selected = store.selection.has(t.id);
  const current = store.current === t.id;
  const badge = store.freedBadges.get(t.id);
  const meta = store.freedMeta.get(t.id);
  const owner = crewName(t.owner);
  const phone = layoutMode() === "phone";
  return `
    <div class="row${selected ? " selected" : ""}${current ? " current" : ""}"
         role="row" tabindex="0" aria-selected="${selected}" aria-current="${current}"
         aria-label="${esc(`${t.id} ${t.title}`)}" data-task-id="${t.id}"${store.busy.has(t.id) ? ' aria-busy="true"' : ""}
         ${meta ? `data-freed-order="${meta.order}" data-freed-depth="${meta.depth}"` : ""}>
      <span class="task-id num">${t.id}</span>
      <span class="tape tape-${t.department}">${esc(departmentName(t.department))}</span>
      <span class="row-title">${esc(t.title)}</span>
      <span class="chip chip-${t.status}">${esc(statusName(t.status))}</span>
      ${t.blocked ? `<span class="chip chip-blocked">Blocked</span>` : ""}
      ${badge ? `<span class="freed-badge">Freed by ${esc(badge)}</span>` : ""}
      ${phone ? "" : `<span class="row-priority">${esc(priorityName(t.priority))}</span>`}
      ${phone ? "" : `<span class="row-owner">${esc(owner ?? "—")}</span>`}
    </div>`;
}

// ---------- detail ----------

function fv(id: string, fallback = ""): string { return store.formValues.get(id) ?? fallback }

function detailHtml(): string {
  const d = store.detail!;
  const t = store.tasks.get(d.id);
  if (!t) return "";
  const labels = store.production!.departments.find((x) => x.key === t.department)?.labels ?? [];
  const subRoll = t.subtasks ? `${t.subtasks.done} of ${t.subtasks.total} sub-tasks done` : "";
  return `
    <div class="detail" role="complementary" aria-label="Task details">
      <div class="detail-head">
        <h2 id="detail-heading" tabindex="-1">${t.id} ${esc(t.title)}</h2>
        <button id="close-detail" class="btn btn-secondary">Close details</button>
      </div>
      <div class="detail-body">
        <div class="detail-props">
          ${errorSummaryHtml()}
          <label class="field">Title<input type="text" id="d-title" value="${esc(fv("d-title", t.title))}"></label>
          <label class="field">Details<textarea id="d-details" rows="3">${esc(fv("d-details", t.details))}</textarea></label>
          <label class="field">Status
            <select id="d-status">${STATUS_ORDER.map((s) => `<option value="${s}"${t.status === s ? " selected" : ""}>${statusName(s)}</option>`).join("")}</select></label>
          <label class="field">Priority
            <select id="d-priority">${[0, 1, 2, 3, 4].map((p) => `<option value="${p}"${t.priority === p ? " selected" : ""}>${priorityName(p)}</option>`).join("")}</select></label>
          <label class="field">Owner
            <select id="d-owner"><option value="">—</option>${store.production!.crew.map((c) => `<option value="${c.handle}"${t.owner === c.handle ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          <label class="field">Label
            <select id="d-label"><option value="">—</option>${labels.map((l) => `<option value="${l.key}"${t.label === l.key ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
          <label class="field">Cycle
            <select id="d-cycle"><option value="">—</option>${CYCLE_KEYS.map((k) => {
              const order = CYCLE_KEYS.indexOf(store.production!.current_cycle);
              return `<option value="${k}"${t.cycle === k ? " selected" : ""}${CYCLE_KEYS.indexOf(k) < order ? " disabled" : ""}>${esc(cycleName(k))}</option>`;
            }).join("")}</select></label>
          <dl class="props-list">
            <dt>Department</dt><dd><span class="tape tape-${t.department}">${esc(departmentName(t.department))}</span></dd>
            <dt>Parent</dt><dd>${t.parent ?? "—"}</dd>
          </dl>
          <div class="link-lists">
            <div>
              <h3>Blocked by</h3>
              <ul id="blocked-by-list" role="list">${t.blocked_by.length === 0 ? "<li>—</li>" : t.blocked_by.map((b) =>
                `<li><span class="num">${b}</span> <button class="btn btn-link" data-remove-link="${b}" aria-label="Remove link to ${b}">Remove link to ${b}</button></li>`).join("")}</ul>
              <button id="add-blocked-btn" class="btn btn-secondary">Add blocked task</button>
            </div>
            <div>
              <h3>Blocks</h3>
              <ul id="blocks-list" role="list">${t.blocks.length === 0 ? "<li>—</li>" : t.blocks.map((b) => `<li><span class="num">${b}</span></li>`).join("")}</ul>
            </div>
          </div>
          <div>
            <h3>Sub-tasks</h3>
            <p id="subtask-rollup">${subRoll || "—"}</p>
            <ul id="subtask-list" role="list">${subtasksOf(t).map((s) =>
              `<li><span class="num">${s.id}</span> ${esc(s.title)} <span class="chip chip-${s.status}">${statusName(s.status)}</span></li>`).join("")}</ul>
            <button id="add-subtask-btn" class="btn btn-secondary">Add sub-task</button>
          </div>
          <div>
            <h3>Attachments</h3>
            ${store.upload ? `<p class="uploading">Uploading ${esc(store.upload.name)}</p>
              <span class="progress-line" role="progressbar" aria-label="Upload progress" aria-valuenow="${store.upload.pct}" aria-valuemin="0" aria-valuemax="100" style="--pct:${store.upload.pct}%"><span class="progress-fill"></span></span>` : ""}
            <ul id="attachments-list" role="list">${attachmentsHtml(d.attachments)}</ul>
            <label class="field">Attach file<input type="file" id="attach-file" accept="application/pdf,image/png,image/jpeg"></label>
            <label class="field">Attachment kind
              <select id="attach-kind" aria-label="Attachment kind">
                <option value="sketch">Sketch</option>
                <option value="plot">Plot</option>
                <option value="rendering">Rendering</option>
              </select></label>
          </div>
        </div>
        <div class="detail-activity">
          <h3>Activity</h3>
          <ul id="activity-list" role="list">${activityHtml(d.activity)}</ul>
        </div>
      </div>
    </div>`;
}

function phoneSheetHtml(): string {
  return `
    <div class="overlay sheet-overlay" id="sheet-overlay">
      <div class="detail sheet" role="dialog" aria-modal="true" aria-label="Task details">${detailHtml()}</div>
    </div>`;
}

function subtasksOf(t: TaskJson): TaskJson[] {
  return [...store.tasks.values()].filter((x) => x.parent === t.id).sort((a, b) => a.number - b.number);
}

function attachmentsHtml(list: AttachmentJson[] | null): string {
  if (!list || list.length === 0) return `<li>No attachments yet.</li>`;
  return list.map((a) => `<li><a href="/api/attachments/${a.id}/download">${esc(a.file_name)}</a>
    <span class="att-kind">${esc(attKindName(a.kind))}</span>${a.current ? `<span class="chip chip-current">Current</span>` : ""}</li>`).join("");
}

function attKindName(kind: string): string {
  return kind === "sketch" ? "Sketch" : kind === "plot" ? "Plot" : kind === "rendering" ? "Rendering" : kind;
}

function activityHtml(list: ActivityJson[] | null): string {
  if (!list || list.length === 0) return "";
  return list.map((a) => {
    const who = a.actor ? esc(a.actor.name) : "Promptside";
    const time = new Date(a.at).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
    return `<li><span class="num">${a.task}</span> ${who} <span class="activity-kind">${esc(a.kind)}</span> <time>${esc(time)}</time></li>`;
  }).join("");
}

// ---------- triage ----------

function triageAreaHtml(): string {
  const rows = [...store.tasks.values()].filter((t) => t.status === "triage")
    .sort((a, b) => a.number - b.number);
  if (rows.length === 0) {
    return `<section class="empty"><h2 id="empty-heading" tabindex="-1">Triage is clear</h2>
      <p>Every request from the rehearsal room has an answer.</p></section>`;
  }
  const inner = rows.map((t) => `
    <div class="row${store.current === t.id ? " current" : ""}" role="row" tabindex="0"
         aria-selected="false" aria-current="${store.current === t.id}"
         aria-label="${esc(`${t.id} ${t.title}`)}" data-task-id="${t.id}"${store.busy.has(t.id) ? ' aria-busy="true"' : ""}>
      <span class="task-id num">${t.id}</span>
      <span class="row-title">${esc(t.title)}</span>
      <span class="row-requester">${esc(requesterFor(t))}</span>
      <span class="tape${t.department ? ` tape-${t.department}` : " tape-none"}">${t.department ? esc(departmentName(t.department)) : "—"}</span>
    </div>`).join("");
  return `
    <div class="grid-wrap">
      <div id="cue-line" class="cue-line" aria-hidden="true"></div>
      <div id="triage-grid" class="grid" role="grid" aria-label="Triage">${inner}</div>
    </div>`;
}

function requesterFor(t: TaskJson): string {
  return store.requests?.find((r) => r.id === t.request)?.requester ?? "";
}

// ---------- requests ----------

function requestsAreaHtml(): string {
  let table: string;
  if (store.requestsDown) {
    table = `<p class="outage-note">Request outcomes can't be shown until the intake is back.</p>`;
  } else if (store.requests === null) {
    table = `<p class="outage-note">Loading…</p>`;
  } else if (store.requests.length === 0) {
    table = `<p>No requests filed yet.</p>`;
  } else {
    table = `
      <div class="table-wrap">
        <table id="requests-table" aria-label="Requests">
          <thead><tr><th>Request</th><th>Requester</th><th>Date filed</th><th>Outcome</th><th>Task</th></tr></thead>
          <tbody>${store.requests.map((r) => requestRow(r)).join("")}</tbody>
        </table>
      </div>`;
  }
  const filing = store.dialog?.kind === "file-request";
  return `
    <h2 class="screen-title">Requests</h2>
    <button id="file-request-btn" class="btn btn-primary"${filing ? " disabled" : ""}>${filing ? "Filing" : "File a request"}</button>
    ${table}`;
}

function requestRow(r: RequestJson): string {
  const outcome = r.status === "pending" ? "Pending" : r.status === "accepted" ? "Accepted"
    : r.status === "declined" ? "Declined" : r.status === "merged" ? "Merged" : r.status;
  const date = new Date(r.created.replace(" ", "T")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `<tr>
    <td>${esc(r.title)}</td><td>${esc(r.requester)}</td>
    <td><time class="num">${esc(date)}</time></td><td>${outcome}</td>
    <td>${r.task ? `<span class="num">${r.task}</span>` : "Awaiting triage"}</td>
  </tr>`;
}

// ---------- not found ----------

function renderNotFound(app: HTMLElement): void {
  app.innerHTML = `
    <main class="notfound">
      <h1 tabindex="-1">This page isn't in the prompt book</h1>
      <a href="/tasks">Back to tasks</a>
    </main>`;
}

// ---------- dialogs (markup) ----------

function dialogHtml(): string {
  const d = store.dialog;
  if (!d) return "";
  switch (d.kind) {
    case "palette": return paletteHtml(d.filter);
    case "newtask": return newTaskHtml(d.parent);
    case "link": return linkHtml();
    case "triage-accept": return triageAcceptHtml(d.task, d.sending);
    case "triage-decline": return triageDeclineHtml(d.sending);
    case "triage-merge": return triageMergeHtml(d.sending);
    case "file-request": return fileRequestHtml(d.sending);
  }
}

export function paletteCommands(): { label: string; kind: string }[] {
  const cmds: { label: string; kind: string }[] = [];
  for (const c of store.production?.crew ?? []) cmds.push({ label: `Assign to ${c.name}`, kind: `owner:${c.handle}` });
  cmds.push({ label: "Unassign", kind: "owner:none" });
  for (const p of [1, 2, 3, 4, 0]) cmds.push({ label: `Set priority: ${priorityName(p)}`, kind: `priority:${p}` });
  for (const s of [...STATUS_ORDER]) cmds.push({ label: `Move to ${statusName(s)}`, kind: `status:${s}` });
  cmds.push({ label: "Undo last change", kind: "undo" });
  cmds.push({ label: "New task", kind: "newtask" });
  cmds.push({ label: "File a request", kind: "filerequest" });
  cmds.push({ label: "Go to All tasks", kind: "goto:/tasks" });
  cmds.push({ label: "Go to Triage", kind: "goto:/triage" });
  cmds.push({ label: "Go to Requests", kind: "goto:/requests" });
  for (const dep of DEPT_ORDER) cmds.push({ label: `Go to ${departmentName(dep)}`, kind: `goto:/tasks?dept=${dep}` });
  cmds.push({ label: "Group by Status", kind: "group:status" });
  cmds.push({ label: "Group by Cycle", kind: "group:cycle" });
  cmds.push({ label: "Group by Department", kind: "group:department" });
  cmds.push({ label: "Group by Owner", kind: "group:owner" });
  cmds.push({ label: "Show blocked only", kind: "blocked:1" });
  cmds.push({ label: "Show all", kind: "blocked:0" });
  cmds.push({ label: "List view", kind: "view:list" });
  cmds.push({ label: "Board view", kind: "view:board" });
  return cmds;
}

export function filteredCommands(filter: string): { label: string; kind: string }[] {
  const q = filter.trim().toLowerCase();
  return paletteCommands().filter((c) => q === "" || c.label.toLowerCase().includes(q));
}

function paletteHtml(filter: string): string {
  const opts = filteredCommands(filter);
  return `
    <div class="overlay" id="dialog-overlay">
      <div class="dialog palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input type="text" id="palette-input" role="combobox" aria-label="Command"
               aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
               value="${esc(filter)}" autocomplete="off">
        <ul id="palette-list" role="listbox" aria-label="Commands">
          ${opts.map((c, i) => `<li role="option" aria-selected="${i === 0}" data-kind="${esc(c.kind)}">${esc(c.label)}</li>`).join("")}
          ${opts.length === 0 ? `<li role="option" aria-disabled="true">No matching command</li>` : ""}
        </ul>
      </div>
    </div>`;
}

function newTaskHtml(parent?: string): string {
  const errors = store.formErrors ?? {};
  const err = (f: string) => errors[f] ? `<p class="field-error" id="err-${f}">${esc(errors[f])}</p>` : "";
  return `
    <div class="overlay" id="dialog-overlay">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="New task">
        ${errorSummaryHtml()}
        <h2>New task</h2>
        <label class="field">Title<input type="text" id="nt-title" value="${esc(fv("nt-title"))}">${err("title")}</label>
        <label class="field">Department
          <select id="nt-dept" aria-label="Department">${DEPT_ORDER.map((d) => `<option value="${d}">${esc(departmentName(d))}</option>`).join("")}</select>${err("department")}</label>
        <label class="field">Priority
          <select id="nt-priority" aria-label="Priority">${[0, 1, 2, 3, 4].map((p) => `<option value="${p}"${p === 0 ? " selected" : ""}>${priorityName(p)}</option>`).join("")}</select>${err("priority")}</label>
        <label class="field">Owner
          <select id="nt-owner" aria-label="Owner"><option value="">—</option>${store.production!.crew.map((c) => `<option value="${c.handle}">${esc(c.name)}</option>`).join("")}</select>${err("owner")}</label>
        ${parent ? `<p class="parent-note">Sub-task of <span class="num">${parent}</span></p>` : ""}
        <div class="dialog-actions">
          <button id="nt-create" class="btn btn-primary">Create task</button>
          <button id="nt-cancel" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>`;
}

function linkHtml(): string {
  const errors = store.formErrors ?? {};
  return `
    <div class="overlay" id="dialog-overlay">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Add blocked task">
        ${errorSummaryHtml()}
        <h2>Add blocked task</h2>
        <label class="field">Task
          <input type="text" id="link-task" placeholder="STG-13" autocomplete="off" value="${esc(fv("link-task"))}">${errors.blocks ? `<p class="field-error">${esc(errors.blocks)}</p>` : ""}</label>
        <div class="dialog-actions">
          <button id="link-add" class="btn btn-primary">Add link</button>
          <button id="link-cancel" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>`;
}

function triageAcceptHtml(taskId: string, sending: boolean): string {
  const t = store.tasks.get(taskId);
  const errors = store.formErrors ?? {};
  const suggested = t?.department !== undefined && DEPT_ORDER.includes(t.department) ? t.department : "carpentry";
  return `
    <div class="overlay" id="dialog-overlay">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Accept request">
        ${errorSummaryHtml()}
        <h2>Accept request</h2>
        <label class="field">Department
          <select id="ta-dept" aria-label="Department">${DEPT_ORDER.map((d) => `<option value="${d}"${d === suggested ? " selected" : ""}>${esc(departmentName(d))}</option>`).join("")}</select>${errors.department ? `<p class="field-error">${esc(errors.department)}</p>` : ""}</label>
        <label class="field">Priority
          <select id="ta-priority" aria-label="Priority">${[0, 1, 2, 3, 4].map((p) => `<option value="${p}"${p === 0 ? " selected" : ""}>${priorityName(p)}</option>`).join("")}</select>${errors.priority ? `<p class="field-error">${esc(errors.priority)}</p>` : ""}</label>
        <label class="field">Owner
          <select id="ta-owner" aria-label="Owner"><option value="">—</option>${store.production!.crew.map((c) => `<option value="${c.handle}">${esc(c.name)}</option>`).join("")}</select>${errors.owner ? `<p class="field-error">${esc(errors.owner)}</p>` : ""}</label>
        <label class="field">Label
          <select id="ta-label" aria-label="Label"><option value="">—</option></select>${errors.label ? `<p class="field-error">${esc(errors.label)}</p>` : ""}</label>
        <div class="dialog-actions">
          <button id="ta-accept" class="btn btn-primary"${sending ? " disabled" : ""}>${sending ? "Sending to intake" : "Accept"}</button>
          <button id="ta-cancel" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>`;
}

function triageDeclineHtml(sending: boolean): string {
  return `
    <div class="overlay" id="dialog-overlay">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Decline request">
        ${errorSummaryHtml()}
        <h2>Decline request</h2>
        <label class="field">Reason
          <input type="text" id="td-reason" value="${esc(fv("td-reason"))}">${store.formErrors?.reason ? `<p class="field-error">${esc(store.formErrors.reason)}</p>` : ""}</label>
        <div class="dialog-actions">
          <button id="td-decline" class="btn btn-primary"${sending ? " disabled" : ""}>${sending ? "Sending to intake" : "Decline"}</button>
          <button id="td-cancel" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>`;
}

function triageMergeHtml(sending: boolean): string {
  return `
    <div class="overlay" id="dialog-overlay">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Merge request">
        ${errorSummaryHtml()}
        <h2>Merge request</h2>
        <label class="field">Duplicate of
          <select id="tm-target" aria-label="Duplicate of">${mergeTargets().map((t) => `<option value="${t.id}">${t.id} ${esc(t.title)}</option>`).join("")}</select>${store.formErrors?.duplicate_of ? `<p class="field-error">${esc(store.formErrors.duplicate_of)}</p>` : ""}</label>
        <div class="dialog-actions">
          <button id="tm-merge" class="btn btn-primary"${sending ? " disabled" : ""}>${sending ? "Sending to intake" : "Merge"}</button>
          <button id="tm-cancel" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>`;
}

function mergeTargets(): TaskJson[] {
  return [...store.tasks.values()]
    .filter((t) => ["backlog", "todo", "in_progress", "done"].includes(t.status))
    .sort((a, b) => a.number - b.number);
}

function fileRequestHtml(sending: boolean): string {
  const errors = store.formErrors ?? {};
  return `
    <div class="overlay" id="dialog-overlay">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="File a request">
        ${errorSummaryHtml()}
        <h2>File a request</h2>
        <label class="field">Request<input type="text" id="fr-title" value="${esc(fv("fr-title"))}">${errors.title ? `<p class="field-error">${esc(errors.title)}</p>` : ""}</label>
        <label class="field">Details<textarea id="fr-details" rows="3">${esc(fv("fr-details"))}</textarea></label>
        <label class="field">Your name<input type="text" id="fr-name" value="${esc(fv("fr-name"))}">${errors.requester ? `<p class="field-error">${esc(errors.requester)}</p>` : ""}</label>
        <label class="field">Department
          <select id="fr-dept" aria-label="Department"><option value="">—</option>${DEPT_ORDER.map((d) => `<option value="${d}">${esc(departmentName(d))}</option>`).join("")}</select></label>
        <div class="dialog-actions">
          <button id="fr-submit" class="btn btn-primary"${sending ? " disabled" : ""}>${sending ? "Filing" : "File request"}</button>
          <button id="fr-cancel" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>`;
}

function errorSummaryHtml(): string {
  const errors = store.formErrors;
  if (!errors || Object.keys(errors).length === 0) return "";
  return `
    <div class="error-summary" role="alert">
      <h3>There is a problem</h3>
      <ul>${Object.entries(errors).map(([f, msg]) => `<li><a href="#f-${f}" data-focus-field="${f}">${esc(msg)}</a></li>`).join("")}</ul>
    </div>`;
}

// ---------- wiring ----------

function wireShell(root: HTMLElement): void {
  root.querySelectorAll("#actor-select").forEach((el) => el.addEventListener("change", (e) => {
    store.actor = (e.target as HTMLSelectElement).value;
    localStorage.setItem("promptside-actor", store.actor);
    store.selection.clear();
    requestRender();
  }));
  root.querySelectorAll("#drawer-btn").forEach((el) => el.addEventListener("click", () => {
    store.drawer = true;
    requestRender();
    focusDrawer();
  }));
  root.querySelectorAll("#view-list").forEach((el) => el.addEventListener("click", () => { view.view = "list"; pushAddress(); requestRender() }));
  root.querySelectorAll("#view-board").forEach((el) => el.addEventListener("click", () => { view.view = "board"; pushAddress(); requestRender() }));
  root.querySelectorAll("#group-select").forEach((el) => el.addEventListener("change", (e) => {
    view.group = (e.target as HTMLSelectElement).value as typeof view.group;
    pushAddress(); requestRender();
  }));
  root.querySelectorAll("#blocked-only").forEach((el) => el.addEventListener("change", (e) => {
    view.blocked = (e.target as HTMLInputElement).checked;
    pushAddress(); requestRender();
  }));
  root.querySelectorAll("#cycle-select").forEach((el) => el.addEventListener("change", (e) => {
    view.cycle = (e.target as HTMLSelectElement).value || null;
    pushAddress(); requestRender();
  }));
  root.querySelectorAll("#new-task-btn").forEach((el) => el.addEventListener("click", (e) =>
    openDialog({ kind: "newtask", opener: e.currentTarget as HTMLElement })));
  root.querySelectorAll("#undo-btn").forEach((el) => el.addEventListener("click", () => { void undo() }));
  root.querySelectorAll("#commands-btn").forEach((el) => el.addEventListener("click", (e) =>
    openDialog({ kind: "palette", filter: "", opener: e.currentTarget as HTMLElement })));
  root.querySelectorAll("#file-request-btn").forEach((el) => el.addEventListener("click", (e) =>
    openDialog({ kind: "file-request", opener: e.currentTarget as HTMLElement, sending: false })));
  root.querySelectorAll(".row").forEach((el) => {
    el.addEventListener("click", (e) => onRowClick(e as MouseEvent));
    el.addEventListener("focus", () => {
      const id = el.getAttribute("data-task-id")!;
      if (store.current !== id) setCurrent(id, true);
    });
  });
  root.querySelectorAll("#close-detail").forEach((el) => el.addEventListener("click", () => closeDetail()));
  root.querySelectorAll("[data-remove-link]").forEach((el) => el.addEventListener("click", (e) => {
    const blocker = (e.currentTarget as HTMLElement).getAttribute("data-remove-link")!;
    void removeLink(blocker, view.task!);
  }));
  root.querySelectorAll("#add-blocked-btn").forEach((el) => el.addEventListener("click", (e) =>
    openDialog({ kind: "link", task: view.task!, opener: e.currentTarget as HTMLElement })));
  root.querySelectorAll("#add-subtask-btn").forEach((el) => el.addEventListener("click", (e) =>
    openDialog({ kind: "newtask", opener: e.currentTarget as HTMLElement, parent: view.task ?? undefined })));
  root.querySelectorAll("#d-title").forEach((el) => {
    el.addEventListener("change", (e) => void patchTask(view.task!, { title: (e.target as HTMLInputElement).value }, "title"));
    el.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") (e.target as HTMLInputElement).blur() });
  });
  root.querySelectorAll("#d-details").forEach((el) => {
    el.addEventListener("change", (e) => void patchTask(view.task!, { details: (e.target as HTMLTextAreaElement).value }, "details"));
    el.addEventListener("keydown", (e) => { const ke = e as KeyboardEvent; if (ke.key === "Enter" && !ke.shiftKey) (e.target as HTMLTextAreaElement).blur() });
  });
  root.querySelectorAll("#d-status").forEach((el) => el.addEventListener("change", (e) => void patchTask(view.task!, { status: (e.target as HTMLSelectElement).value }, `status:${(e.target as HTMLSelectElement).value}`)));
  root.querySelectorAll("#d-priority").forEach((el) => el.addEventListener("change", (e) => void patchTask(view.task!, { priority: Number((e.target as HTMLSelectElement).value) }, `priority:${(e.target as HTMLSelectElement).value}`)));
  root.querySelectorAll("#d-owner").forEach((el) => el.addEventListener("change", (e) => void patchTask(view.task!, { owner: (e.target as HTMLSelectElement).value || null }, `owner:${(e.target as HTMLSelectElement).value || "none"}`)));
  root.querySelectorAll("#d-label").forEach((el) => el.addEventListener("change", (e) => void patchTask(view.task!, { label: (e.target as HTMLSelectElement).value || null }, "label")));
  root.querySelectorAll("#d-cycle").forEach((el) => el.addEventListener("change", (e) => void patchTask(view.task!, { cycle: (e.target as HTMLSelectElement).value || null }, "cycle")));
  root.querySelectorAll("#attach-file").forEach((el) => el.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    const kind = (document.getElementById("attach-kind") as HTMLSelectElement | null)?.value ?? "sketch";
    if (file) void uploadAttachment(file, kind);
    (e.target as HTMLInputElement).value = "";
  }));
  // typed text survives re-renders while it is being edited; it clears on save
  root.querySelectorAll(".dialog input[type=text], .dialog textarea, .detail input[type=text], .detail textarea").forEach((el) => {
    const id = el.id;
    el.addEventListener("input", () => store.formValues.set(id, (el as HTMLInputElement).value));
  });
  wireDialog(root);
  wireDrawer(root);
}

function onRowClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest("[data-task-id]") as HTMLElement | null;
  if (!el) return;
  const id = el.getAttribute("data-task-id")!;
  if (e.ctrlKey || e.metaKey) {
    toggleSelect(id);
    return;
  }
  setCurrent(id, true);
  if (view.path === "/triage") requestRender();
  else void openDetail(id, true);
}

export { headerHtml };

export function drawerHtml(): string {
  return `
    <div class="overlay" id="drawer-overlay">
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Departments">${railHtml()}</div>
    </div>`;
}
