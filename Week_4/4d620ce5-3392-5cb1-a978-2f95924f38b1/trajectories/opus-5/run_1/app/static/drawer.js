// The thread drawer: work card, sign-off chain, revision history and role controls.

import { announceError, closeLayer, element, medium, narrow, openLayer } from "./a11y.js";
import * as api from "./client.js";
import { MODEL_LABELS, PENDING, SUCCESS } from "./copy.js";
import { markSelected } from "./board.js";
import { directiveById, hooks, isClerk, isEngineer, isInspector, isPlanner,
  runAction, state } from "./store.js";

let layer = null;
let node = null;
let heading = null;
let pressKeys = {};

export function drawerNode() {
  return node;
}

export async function openDrawer(threadId, opener) {
  const sameDrawer = Boolean(node);
  state.openThreadId = threadId;
  pressKeys = {};
  markSelected(threadId);
  if (!sameDrawer) {
    node = element("div", {
      class: "drawer sliding",
      role: "dialog",
      "aria-label": "Thread",
      tabindex: "-1",
    });
    document.querySelector(".body").append(node);
    layer = openLayer({
      node,
      modal: narrow(),
      opener,
      kind: "drawer",
      onClose: () => {
        node = null;
        layer = null;
        state.openThreadId = null;
        state.thread = null;
        markSelected(null);
      },
    });
    document.querySelector(".body").classList.add("with-drawer");
    bindSwipe(node);
  }
  await loadThread(threadId);
  if (heading) heading.focus();
}

export function closeDrawer() {
  if (layer) {
    const current = layer;
    layer = null;
    document.querySelector(".body").classList.remove("with-drawer");
    closeLayer(current);
  }
}

export async function loadThread(threadId) {
  const response = await api.get(`/api/threads/${encodeURIComponent(threadId)}`);
  if (!response.ok) {
    if (response.status === 404) closeDrawer();
    return;
  }
  state.thread = response.body.thread;
  renderDrawer();
}

/** Refetch in place, keeping typed values, focus and caret where they still exist. */
export async function refreshDrawer() {
  if (!state.openThreadId) return;
  await loadThread(state.openThreadId);
}

function keepTyped() {
  const typed = {};
  if (!node) return typed;
  for (const field of node.querySelectorAll("textarea,input[type='text']")) {
    if (field.dataset.name) typed[field.dataset.name] = field.value;
  }
  return typed;
}

function focusMemo() {
  if (!node || !node.contains(document.activeElement)) return null;
  const active = document.activeElement;
  return {
    name: active.dataset ? active.dataset.control || active.dataset.name : null,
    start: active.selectionStart,
    end: active.selectionEnd,
  };
}

function restoreFocus(memo) {
  if (!memo || !memo.name) return;
  const target = node.querySelector(
    `[data-control="${memo.name}"],[data-name="${memo.name}"]`
  );
  if (target) {
    target.focus();
    if (memo.start !== null && memo.start !== undefined && target.setSelectionRange) {
      try {
        target.setSelectionRange(memo.start, memo.end);
      } catch (error) {
        /* a control without a text caret */
      }
    }
  } else if (heading) {
    heading.focus();
  }
}

function renderDrawer() {
  if (!node || !state.thread) return;
  const thread = state.thread;
  const typed = keepTyped();
  const memo = focusMemo();
  const title = `Thread ${thread.registration} ${thread.directive}`;
  node.setAttribute("aria-label", title);
  node.textContent = "";
  heading = element("h2", { tabindex: "-1", text: title, "data-control": "drawer-heading" });
  node.append(heading);
  node.append(stateSection(thread));
  node.append(limitsSection(thread));
  node.append(wordingSection(thread));
  node.append(workCardSection(thread));
  node.append(chainSection(thread));
  node.append(historySection(thread));
  node.append(controlsSection(thread, typed));
  node.append(
    element("button", {
      text: "Close thread panel",
      "aria-label": "Close thread panel",
      onclick: () => closeDrawer(),
    })
  );
  syncModality();
  restoreFocus(memo);
}

/** The drawer is modal only where it opens full screen, which is 375 wide. */
export function syncModality() {
  if (!node) return;
  const modal = narrow();
  if (layer) layer.modal = modal;
  if (modal) node.setAttribute("aria-modal", "true");
  else node.removeAttribute("aria-modal");
}

function stateSection(thread) {
  return element("section", {}, [
    element("div", { class: "state-line" }, [
      element("strong", { text: thread.label }),
      element("span", {
        class: "cell-governs",
        text: thread.governing ? `${thread.governing} governs` : "no limit governs",
      }),
      element("span", { class: "tag", text: thread.revision }),
      thread.pinned_revision
        ? element("span", { class: "pinned-tab", style: "position:static",
            text: `signed under ${thread.pinned_revision}` })
        : null,
    ]),
  ]);
}

function limitsSection(thread) {
  const limits = thread.limits;
  return element("section", {}, [
    element("h3", { text: "Limits in force" }),
    element("dl", {}, [
      element("dt", { text: "Effective date" }),
      element("dd", { text: limits.effective_date }),
      element("dt", { text: "Deadline date" }),
      element("dd", { text: limits.deadline_date }),
      element("dt", { text: "Flight-hours threshold" }),
      element("dd", { text: limits.fh_threshold.toFixed(1) }),
      element("dt", { text: "Deferral" }),
      element("dd", {
        text: limits.deferred
          ? `applies — ${thread.deferral ? thread.deferral.reason : ""}`
          : "none",
      }),
    ]),
  ]);
}

function wordingSection(thread) {
  return element("section", {}, [
    element("h3", { text: `Method of compliance — ${thread.governing_revision}` }),
    element("p", { text: thread.wording.title }),
    element("p", { text: thread.wording.method }),
  ]);
}

function workCardSection(thread) {
  const card = thread.work_card;
  const rows = thread.evidence.map((item) =>
    element("li", {}, [
      element("span", { text: `${item.content_type} ` }),
      element("span", { class: "mono", text: `${item.bytes} bytes ` }),
      element("span", { class: "mono", text: item.sha256 }),
    ])
  );
  return element("section", { role: "region", "aria-label": "Work card" }, [
    element("h3", { text: "Work card" }),
    element("dl", {}, [
      element("dt", { text: "Card" }),
      element("dd", { text: card.id }),
      element("dt", { text: "Holder" }),
      element("dd", { text: card.holder ? card.holder.display_name : "unheld" }),
      element("dt", { text: "Claimed" }),
      element("dd", { text: card.claimed_at || "—" }),
    ]),
    element("h3", { text: `Evidence (${thread.evidence.length})` }),
    element("ul", { "aria-label": "Evidence" }, rows.length ? rows : [
      element("li", { text: "No evidence attached." }),
    ]),
  ]);
}

function chainSection(thread) {
  const items = thread.signatures.map((signature) =>
    element("li", { class: signature.status === "void" ? "void" : "" }, [
      element("span", {
        text:
          `${signature.kind} — ${signature.signer ? signature.signer.display_name : signature.signer_text}` +
          `${signature.signer && signature.signer.licence ? ` (${signature.signer.licence})` : ""}`,
      }),
      element("span", { class: "mono", text: ` ${signature.revision} ` }),
      element("span", { class: "mono", text: signature.committed_at }),
      element("span", {
        text:
          ` ${signature.timeliness === "overdue" ? "overdue" : signature.timeliness === "on_time"
            ? "on time" : ""} ${signature.status}` +
          `${signature.void_reason ? ` — ${signature.void_reason}` : ""}`,
      }),
    ])
  );
  const certifier = thread.certifier;
  if (certifier.status === "awaiting_countersignature" && certifier.assigned) {
    items.push(
      element("li", { text: `awaiting countersignature — ${certifier.assigned.display_name}` })
    );
  } else if (certifier.status === "awaiting_certifier") {
    items.push(element("li", { text: "awaiting certifier" }));
  } else if (certifier.assigned) {
    items.push(element("li", { text: `certifier — ${certifier.assigned.display_name}` }));
  }
  return element("section", {}, [
    element("h3", { text: "Sign-off chain" }),
    element("ul", { "aria-label": "Sign-off chain" }, items.length ? items : [
      element("li", { text: "No signatures yet." }),
    ]),
  ]);
}

function historySection(thread) {
  const items = thread.history.map((entry) =>
    element("li", {}, [
      element("span", { class: "tag", text: entry.revision }),
      element("span", { text: ` ${entry.outcome} — ${entry.wording.title}` }),
      element("span", {
        class: "mono",
        text: ` deadline ${entry.limits.deadline_date} / FH ${entry.limits.fh_threshold.toFixed(1)}`,
      }),
      entry.legacy_records.length
        ? element("ul", {}, entry.legacy_records.map((record) =>
            element("li", {
              text:
                `legacy ${record.status} — ${record.inspector || "unknown"}` +
                `${record.inspected_on ? ` ${record.inspected_on}` : ""}` +
                `${record.notes ? ` — ${record.notes}` : ""}`,
            })
          ))
        : null,
    ])
  );
  return element("section", {}, [
    element("h3", { text: "Revision history" }),
    element("ul", { "aria-label": "Revision history" }, items),
  ]);
}

// ------------------------------------------------------------------ controls

function controlsSection(thread, typed) {
  const controls = element("div", { class: "controls" });
  const directive = directiveById(thread.directive_id);
  const withdrawn = directive && directive.status === "withdrawn";
  const holder = thread.work_card.holder;
  const mine = holder && state.user && holder.id === state.user.id;
  if (state.prior && state.prior.directiveId === thread.directive_id) {
    return element("section", {}, [controls]);
  }

  if (isInspector() && !withdrawn) {
    if (!holder && ["open", "deferred", "reopened", "superseded_retargeted"].includes(
      thread.stage)) {
      controls.append(button("Claim work card", () => claim(thread)));
    }
    if (mine) {
      controls.append(button("Release work card", () => release(thread)));
      controls.append(fileField("Attach evidence", (file) => attachEvidence(thread, file)));
      controls.append(textField("Method reference", typed, "method_ref"));
      controls.append(textField("Findings", typed, "findings", true));
      controls.append(button("Sign inspection", () => signInspection(thread)));
    }
  }
  if (isEngineer() && !withdrawn && thread.stage === "inspected") {
    controls.append(button("Countersign", () => countersign(thread)));
  }
  if (isPlanner() && !withdrawn) {
    if (thread.stage === "open") {
      controls.append(textField("Deferral reason", typed, "deferral_reason"));
      controls.append(button("Defer", () => defer(thread)));
    }
    if (thread.stage === "superseded_retargeted") {
      controls.append(textField("Effectivity reason", typed, "effectivity_reason"));
      controls.append(button("Confirm effectivity", () => decide(thread, "confirmed")));
      controls.append(button("Mark not applicable", () => decide(thread, "not_applicable")));
    }
  }
  if (isClerk() && !withdrawn && thread.stage === "certified") {
    controls.append(textField("Reopen reason", typed, "reopen_reason"));
    controls.append(button("Reopen thread", () => reopen(thread)));
  }
  return element("section", {}, [controls]);
}

function button(label, onclick) {
  return element("button", {
    text: label,
    "aria-label": label,
    dataset: { control: label },
    onclick,
  });
}

function textField(label, typed, name, multiline = false) {
  const field = element(multiline ? "textarea" : "input", {
    type: multiline ? null : "text",
    "aria-label": label,
    dataset: { name, control: label },
    rows: multiline ? "2" : null,
  });
  field.value = typed[name] || "";
  return element("label", {}, [label, field]);
}

function fileField(label, onpick) {
  const input = element("input", {
    type: "file",
    "aria-label": label,
    dataset: { control: label },
    onchange: (event) => {
      const [file] = event.currentTarget.files;
      if (file) onpick(file);
      event.currentTarget.value = "";
    },
  });
  return element("label", {}, [label, input]);
}

function value(name) {
  const field = node.querySelector(`[data-name="${name}"]`);
  return field ? field.value.trim() : "";
}

function keyFor(name) {
  if (!pressKeys[name]) pressKeys[name] = api.newKey();
  return pressKeys[name];
}

function clearKey(name) {
  delete pressKeys[name];
}

function context(thread) {
  return {
    directive: thread.directive,
    current: thread.revision,
    card: thread.work_card.id,
  };
}

async function claim(thread) {
  const key = keyFor("claim");
  const response = await runAction({
    pending: PENDING.claim(thread.work_card.id),
    run: () => api.post(`/api/threads/${thread.id}/claim`, {}, { key }),
    success: () => SUCCESS.claim(thread.work_card.id),
    context: context(thread),
  });
  if (response.ok) clearKey("claim");
  await afterAction(thread.id);
}

async function release(thread) {
  await runAction({
    pending: PENDING.release(thread.work_card.id),
    run: () => api.post(`/api/threads/${thread.id}/release`, {}),
    success: () => SUCCESS.release(thread.work_card.id),
    context: { ...context(thread), action: "release" },
  });
  await afterAction(thread.id);
}

async function attachEvidence(thread, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await runAction({
    pending: PENDING.evidence,
    run: () =>
      api.post(`/api/threads/${thread.id}/evidence`, bytes, {
        contentType: file.type || "application/pdf",
      }),
    success: () => SUCCESS.evidence,
    context: { ...context(thread), evidence: true },
  });
  await afterAction(thread.id);
}

async function signInspection(thread) {
  const key = keyFor("inspection");
  const evidenceIds = thread.evidence.map((item) => item.id);
  const response = await runAction({
    pending: PENDING.inspection,
    run: () =>
      api.post(
        `/api/threads/${thread.id}/inspection`,
        {
          revision: thread.revision,
          method_ref: value("method_ref"),
          findings: value("findings"),
          evidence_ids: evidenceIds,
        },
        { key }
      ),
    success: (result) =>
      SUCCESS.inspection(result.body.signature.revision, result.body.signature.timeliness),
    context: context(thread),
    onFields: (fields) => announceError(Object.values(fields)[0] || "Some fields need attention."),
  });
  if (response.ok) clearKey("inspection");
  await afterAction(thread.id);
}

async function countersign(thread) {
  const key = keyFor("countersign");
  const response = await runAction({
    pending: PENDING.countersign,
    run: () => api.post(`/api/threads/${thread.id}/countersign`,
      { revision: thread.revision }, { key }),
    success: () => SUCCESS.countersign(thread.revision),
    context: { ...context(thread), model: MODEL_LABELS[thread.model] },
  });
  if (response.ok) clearKey("countersign");
  await afterAction(thread.id);
}

async function defer(thread) {
  const key = keyFor("defer");
  const response = await runAction({
    pending: PENDING.defer,
    run: () =>
      api.post(`/api/threads/${thread.id}/deferral`, { reason: value("deferral_reason") },
        { key }),
    success: (result) => SUCCESS.defer(result.body.thread.limits.deadline_date),
    context: context(thread),
    onFields: (fields) => announceError(Object.values(fields)[0] || "A reason is needed."),
  });
  if (response.ok) clearKey("defer");
  await afterAction(thread.id);
}

async function decide(thread, decision) {
  await runAction({
    pending: PENDING.effectivity,
    run: () =>
      api.post(`/api/threads/${thread.id}/effectivity`, {
        decision,
        reason: value("effectivity_reason"),
      }),
    success: () => SUCCESS.effectivity(decision),
    context: { ...context(thread), action: "effectivity" },
    onFields: (fields) => announceError(Object.values(fields)[0] || "A reason is needed."),
  });
  await afterAction(thread.id);
}

async function reopen(thread) {
  await runAction({
    pending: PENDING.reopen,
    run: () => api.post(`/api/threads/${thread.id}/reopen`, { reason: value("reopen_reason") }),
    success: () => SUCCESS.reopen,
    context: { ...context(thread), action: "reopen" },
    onFields: (fields) => announceError(Object.values(fields)[0] || "A reason is needed."),
  });
  await afterAction(thread.id);
}

async function afterAction(threadId) {
  await loadThread(threadId);
  await hooks.refreshBoard();
}

function bindSwipe(target) {
  let startX = null;
  target.addEventListener("touchstart", (event) => {
    startX = event.touches[0].clientX;
  }, { passive: true });
  target.addEventListener("touchend", (event) => {
    if (startX === null || !medium()) return;
    const moved = event.changedTouches[0].clientX - startX;
    startX = null;
    if (moved > 60) closeDrawer();
  });
}
