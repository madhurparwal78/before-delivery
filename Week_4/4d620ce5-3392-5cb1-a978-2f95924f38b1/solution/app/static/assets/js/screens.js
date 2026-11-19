// The Packs, People and Audit screens.

import { get, keyed } from "./api.js";
import { openEraseDialog, openScopeDialog } from "./dialogs.js";
import { dname, h, MODEL_LABELS, ROLE_LABELS, when } from "./ui.js";

const SERVICE = { object_storage: "object storage", mail: "mail" };

function table(label, headers, rows, empty) {
  return h("div", { class: "table-wrap", tabindex: "0" }, h("table", { class: "table", "aria-label": label },
    h("thead", {}, h("tr", {}, headers.map(([title, cls]) => h("th", { scope: "col", class: cls || "" }, title)))),
    h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: headers.length, class: "muted" }, empty)))));
}

export async function sendPack(app, directiveId, button) {
  const d = app.state.board.directives.find((x) => x.id === directiveId);
  return app.run({
    button, pending: "Preparing pack…",
    call: () => keyed("POST", "/api/packs", { json: { directive_id: directiveId } }, { onRetry: app.retrying }),
    success: (r) => (r.body.pack.status === "transmitted" ? "Pack transmitted to the authority."
      : `Pack queued: ${SERVICE[r.body.pack.waiting_for]} is unavailable. It will go out automatically.`),
    errors: { pack_already_queued: () => `A pack for ${dname(d)} is already queued.` },
  });
}

const PACK_POLL_MS = 5000;  // brief: the Packs screen reads GET /api/packs again every 5 seconds while it is shown
let packPoll = null;

export async function renderPacks(app, root) {
  const { packs } = await get("/api/packs");
  const directives = app.state.board?.directives || (await get("/api/board")).directives;
  const byId = Object.fromEntries(directives.map((d) => [d.id, d]));
  const head = h("div", { class: "screen__head" }, h("h1", {}, "Compliance packs"),
    h("p", { class: "muted" }, "Signed packs for the authority, stored by content and emailed with their checksums."));
  if (app.state.user.role === "records_clerk") {
    const picker = h("select", { class: "select", "aria-label": "Pack directive" },
      directives.map((d) => h("option", { value: d.id }, `${dname(d)} ${d.revision}`)));
    if (app.state.packDirective) picker.value = app.state.packDirective;
    picker.addEventListener("change", () => { app.state.packDirective = picker.value; });
    const send = h("button", { type: "button", class: "btn btn--primary" }, "Send compliance pack");
    send.addEventListener("click", async () => {
      app.state.packDirective = picker.value;
      if (await sendPack(app, picker.value, send)) app.refresh();
    });
    head.append(h("div", { class: "toolbar" }, picker, send));
  }
  const rowsOf = (list) => list.map((p) => {
    const d = byId[p.directive_id];
    const status = p.status === "transmitted" ? "Transmitted" : "Queued";
    return h("tr", { class: `pack pack--${p.status}` },
      h("td", {}, d ? dname(d) : p.directive_id), h("td", { class: "tag-cell" }, h("span", { class: "tag" }, p.revision)),
      h("td", {}, h("span", { class: "pill" }, status),
        p.waiting_for ? h("span", { class: "muted small" }, ` waiting for ${SERVICE[p.waiting_for]}`) : null),
      h("td", { class: "num" }, when(p.requested_at)), h("td", { class: "num" }, when(p.transmitted_at)),
      h("td", { class: "num sha" }, p.pdf_sha256
        ? [h("a", { href: `/api/packs/${p.id}/pdf`, download: "", title: p.pdf_sha256 }, `${p.pdf_sha256.slice(0, 16)}…`),
          " ", h("a", { href: `/api/packs/${p.id}/csv`, download: "", class: "small" }, "CSV")]
        : "—"));
  });
  const packTable = (list) => table("Compliance packs", [["Directive"], ["Revision"], ["Status"], ["Requested", "num"],
    ["Transmitted", "num"], ["PDF checksum", "num"]], rowsOf(list), "No packs yet.");
  let shown = packTable(packs);
  let seen = JSON.stringify(packs);
  root.replaceChildren(head, shown);
  clearInterval(packPoll);
  packPoll = setInterval(async () => {
    if (app.state.screen !== "packs" || !shown.isConnected) {
      clearInterval(packPoll);
      return;
    }
    try {
      const { packs: latest } = await get("/api/packs");
      const text = JSON.stringify(latest);
      if (text !== seen && shown.isConnected) {  // only the table changes, so the picker and focus stay put
        const next = packTable(latest);
        shown.replaceWith(next);
        shown = next;
        seen = text;
      }
    } catch {
      // the next tick tries again
    }
  }, PACK_POLL_MS);
}

export async function renderPeople(app, root) {
  const { people } = await get("/api/people");
  const clerk = app.state.user.role === "records_clerk";
  const rows = people.map((p) => {
    const actions = [];
    if (clerk && p.contractor && !p.erased) {
      actions.push(h("button", { type: "button", class: "btn btn--quiet btn--small", onclick: () => openEraseDialog(app, p) },
        `Erase ${p.display_name}`));
    }
    if (clerk && p.role === "certifying_engineer") {
      actions.push(h("button", { type: "button", class: "btn btn--quiet btn--small", onclick: () => openScopeDialog(app, p) },
        `Edit scope ${p.display_name}`));
    }
    return h("tr", { id: `person-${p.id}`, class: app.state.highlight === p.id ? "is-highlight" : "" },
      h("th", { scope: "row" }, p.display_name, p.erased ? h("span", { class: "muted small" }, " erased") : null),
      h("td", {}, ROLE_LABELS[p.role]),
      h("td", {}, p.contractor === null ? "—" : p.contractor ? "Contractor" : "Staff"),
      h("td", { class: "mono" }, p.licence || "—"),
      h("td", {}, p.scope ? (p.scope.length ? p.scope.map((m) => MODEL_LABELS[m]).join(", ") : "None") : "—"),
      h("td", { class: "actions" }, actions));
  });
  root.replaceChildren(h("div", { class: "screen__head" }, h("h1", {}, "People"),
    h("p", { class: "muted" }, "Seeded staff and contractors with their licences and certification scopes.")),
  table("People", [["Name"], ["Role"], ["Staff or contractor"], ["Licence"], ["Scope"], [h("span", { class: "sr" }, "Actions"), "actions"]], rows, "No people."));
  if (app.state.highlight) document.getElementById(`person-${app.state.highlight}`)?.scrollIntoView({ block: "center" });
}

export async function renderAudit(app, root) {
  const board = app.state.board || (await get("/api/board"));
  const filter = app.state.auditDirective || "";
  const { entries } = await get(`/api/audit${filter ? `?directive_id=${encodeURIComponent(filter)}` : ""}`);
  const threads = Object.fromEntries(board.cells.map((c) => [c.thread_id, c]));
  const byId = Object.fromEntries(board.directives.map((d) => [d.id, d]));
  const picker = h("select", { class: "select", "aria-label": "Audit directive" }, h("option", { value: "" }, "All directives"),
    board.directives.map((d) => h("option", { value: d.id }, `${dname(d)} ${d.revision}`)));
  picker.value = filter;
  picker.addEventListener("change", () => {
    app.state.auditDirective = picker.value;
    renderAudit(app, root).catch(() => null);
  });
  const rows = entries.map((e) => {
    const t = threads[e.thread_id];
    const d = byId[e.directive_id];
    return h("tr", {}, h("td", { class: "num nowrap" }, when(e.at)), h("td", { class: "nowrap" }, e.actor.display_name),
      h("td", { class: "mono-small nowrap" }, e.action),
      h("td", { class: "nowrap" }, t ? `${t.registration} ${d ? dname(d) : ""}` : d ? dname(d) : "—"), h("td", {}, e.detail));
  });
  root.replaceChildren(h("div", { class: "screen__head" }, h("h1", {}, "Audit trail"),
    h("p", { class: "muted" }, "Every state change, newest first. Entries are append-only."), h("div", { class: "toolbar" }, picker)),
  table("Audit trail", [["Time", "num"], ["Actor"], ["Action"], ["Thread"], ["Detail"]], rows, "No entries."));
}
