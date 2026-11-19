// The Packs, People and Audit screens.

import { element } from "./a11y.js";
import * as api from "./client.js";
import { ROLE_LABELS, MODEL_LABELS } from "./copy.js";
import { sendPack } from "./board.js";
import { openErase, openScope } from "./dialogs.js";
import { directiveLabel, hooks, isClerk, state } from "./store.js";

const PACK_POLL = 5000;
let packTimer = null;

function tableShell(label, columns) {
  const head = element("tr", {}, columns.map((column) =>
    element("th", { class: column.numeric ? "num" : "", text: column.label })));
  const bodyNode = element("tbody");
  const node = element("table", { "aria-label": label }, [
    element("caption", { text: label }),
    element("thead", {}, [head]),
    bodyNode,
  ]);
  return { node, bodyNode };
}

function directiveOptions() {
  return state.board
    ? state.board.directives.map((directive) => [
        directive.id,
        `${directiveLabel(directive)} ${directive.revision}`,
      ])
    : [];
}

function selectField(label, options) {
  return element(
    "select",
    { "aria-label": label, dataset: { field: label } },
    options.map(([value, text]) => element("option", { value, text }))
  );
}

// ------------------------------------------------------------------ packs

export function packsScreen() {
  const { node, bodyNode } = tableShell("Compliance packs", [
    { label: "Directive" },
    { label: "Revision" },
    { label: "Status" },
    { label: "Requested", numeric: true },
    { label: "Transmitted", numeric: true },
    { label: "PDF checksum", numeric: true },
  ]);
  const toolbar = element("div", { class: "toolbar" });
  if (isClerk()) {
    const picker = selectField("Pack directive", directiveOptions());
    const send = element("button", {
      class: "primary",
      text: "Send compliance pack",
      "aria-label": "Send compliance pack",
      onclick: async () => {
        const directive = state.board.directives.find(
          (entry) => entry.id === picker.value
        );
        if (directive) await sendPack(directive);
        await refresh();
      },
    });
    toolbar.append(picker, send);
  }
  const screen = element("div", { class: "screen" }, [
    element("h1", { text: "Compliance packs" }),
    toolbar,
    node,
  ]);

  async function refresh() {
    const response = await api.get("/api/packs");
    if (!response.ok) return;
    bodyNode.textContent = "";
    for (const pack of response.body.packs) {
      const directive = state.board
        ? state.board.directives.find((entry) => entry.id === pack.directive_id)
        : null;
      bodyNode.append(
        element("tr", {}, [
          element("td", { text: directive ? directiveLabel(directive) : pack.directive_id }),
          element("td", { class: "num", text: pack.revision }),
          element("td", { text: pack.status === "transmitted" ? "Transmitted" : "Queued" }),
          element("td", { class: "num", text: pack.requested_at }),
          element("td", { class: "num", text: pack.transmitted_at || "—" }),
          element("td", { class: "num wrap", text: pack.pdf_sha256 || "—" }),
        ])
      );
    }
    if (!response.body.packs.length) {
      bodyNode.append(element("tr", {}, [element("td", { colspan: "6", text: "No packs yet." })]));
    }
  }

  hooks.refreshPacks = refresh;
  refresh();
  clearInterval(packTimer);
  packTimer = setInterval(() => {
    if (state.route === "packs") refresh();
    else clearInterval(packTimer);
  }, PACK_POLL);
  return screen;
}

// ------------------------------------------------------------------ people

export function peopleScreen() {
  const { node, bodyNode } = tableShell("People", [
    { label: "Name" },
    { label: "Role" },
    { label: "Staff or contractor" },
    { label: "Licence", numeric: true },
    { label: "Scope" },
    { label: "Actions" },
  ]);
  const screen = element("div", { class: "screen" }, [
    element("h1", { text: "People" }),
    node,
  ]);

  async function refresh() {
    const response = await api.get("/api/people");
    if (!response.ok) return;
    bodyNode.textContent = "";
    for (const person of response.body.people) {
      const actions = element("td");
      if (isClerk() && person.contractor && !person.erased) {
        actions.append(
          element("button", {
            text: `Erase ${person.display_name}`,
            "aria-label": `Erase ${person.display_name}`,
            onclick: () => openErase(person),
          })
        );
      }
      if (isClerk() && person.role === "certifying_engineer") {
        actions.append(
          element("button", {
            text: `Edit scope ${person.display_name}`,
            "aria-label": `Edit scope ${person.display_name}`,
            onclick: () => openScope(person),
          })
        );
      }
      bodyNode.append(
        element("tr", {}, [
          element("td", { text: person.display_name }),
          element("td", { text: ROLE_LABELS[person.role] || "—" }),
          element("td", { text: person.contractor ? "contractor" : "staff" }),
          element("td", { class: "num", text: person.licence || "—" }),
          element("td", {
            text: (person.scope || []).map((code) => MODEL_LABELS[code]).join(", ") || "—",
          }),
          actions,
        ])
      );
    }
  }

  hooks.refreshPeople = refresh;
  refresh();
  return screen;
}

// ------------------------------------------------------------------ audit

export function auditScreen() {
  const { node, bodyNode } = tableShell("Audit trail", [
    { label: "Time", numeric: true },
    { label: "Actor" },
    { label: "Action" },
    { label: "Thread" },
    { label: "Detail" },
  ]);
  const picker = selectField("Audit directive", [["", "All directives"], ...directiveOptions()]);
  picker.addEventListener("change", () => refresh());
  const screen = element("div", { class: "screen" }, [
    element("h1", { text: "Audit trail" }),
    element("div", { class: "toolbar" }, [picker]),
    node,
  ]);

  async function refresh() {
    const query = picker.value ? `?directive_id=${encodeURIComponent(picker.value)}` : "";
    const response = await api.get(`/api/audit${query}`);
    if (!response.ok) return;
    bodyNode.textContent = "";
    for (const entry of response.body.entries) {
      const cell = state.board
        ? state.board.cells.find((item) => item.thread_id === entry.thread_id)
        : null;
      bodyNode.append(
        element("tr", {}, [
          element("td", { class: "num", text: entry.at }),
          element("td", { text: entry.actor ? entry.actor.display_name : "—" }),
          element("td", { text: entry.action }),
          element("td", { text: cell ? cell.registration : entry.thread_id || "—" }),
          element("td", { class: "wrap", text: entry.detail }),
        ])
      );
    }
  }

  hooks.refreshAudit = refresh;
  refresh();
  return screen;
}
