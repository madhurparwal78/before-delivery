// The thread drawer (brief: Screens, right drawer) and the tail panel.

import { get, request } from "./api.js";
import { cellInner } from "./board.js";
import { glyph, icon } from "./glyphs.js";
import {
  bytes, esc, focusables, h, hours, ICON_CLOSE, MODEL_LABELS, modal, narrow, popLayer, pushLayer, reducedMotion, when,
} from "./ui.js";

const OUTCOME = { added: "Re-entered effectivity", retargeted: "Retargeted", kept: "Kept (credited)",
  removed: "Left effectivity", current: "Current" };

function field(label, control, hint) {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h("div", { class: "field" }, h("label", { for: id, class: "field__label" }, label), control,
    hint ? h("p", { class: "field__hint" }, hint) : null);
}

function limitsList(l) {
  const row = (k, v, num = true) => [h("dt", {}, k), h("dd", { class: num ? "num" : "" }, v)];
  return h("dl", { class: "facts" },
    row("Effective date", l.effective_date), row("Deadline date", l.deadline_date),
    row("Calendar limit", `${l.calendar_days} days`), row("Hours threshold", `${hours(l.fh_threshold)} FH`),
    row("Hours baseline", `${hours(l.fh_baseline)} FH`), row("Flight-hours limit", `${hours(l.fh_interval)} FH`),
    row("Deferral", l.deferred ? "Applies (+7 days, +25.0 FH)" : "None", false), row("Due", when(l.due_at)));
}

function signatureItem(s) {
  const who = s.signer ? s.signer.display_name : s.signer_text || "—";
  const licence = s.signer ? s.signer.licence || "—" : "legacy record";
  const kind = { inspection: "Inspection", countersignature: "Countersignature", legacy: "Legacy record" }[s.kind];
  return h("li", { class: `sig sig--${s.status}` },
    h("div", { class: "sig__head" }, h("span", { class: "sig__kind" }, kind), h("span", { class: "sig__status" },
      s.status, s.void_reason ? ` — ${s.void_reason}` : "")),
    h("div", { class: "sig__who" }, who, " ", h("span", { class: "num muted" }, licence)),
    h("div", { class: "sig__meta" }, h("span", { class: "tag" }, s.revision), " ", h("span", { class: "num" }, when(s.committed_at)),
      " · ", s.timeliness === "overdue" ? "overdue" : s.timeliness === "on_time" ? "on time" : "—"),
    s.method_ref || s.findings ? h("div", { class: "sig__notes muted" }, [s.method_ref, s.findings].filter(Boolean).join(" — ")) : null);
}

function historyItem(entry) {
  const legacy = entry.legacy_records.map((r) => h("p", { class: "legacy" },
    h("span", { class: "legacy__label" }, "Legacy record"), ` ${r.status} · inspected ${r.inspected_on || "—"} by `,
    r.inspector || "—", ` · certified ${r.certified_on || "—"} by `, r.certifier || "—", r.notes ? ` · ${r.notes}` : ""));
  return h("li", { class: `hist hist--${entry.outcome}` },
    h("div", { class: "hist__head" }, h("span", { class: "tag tag--lg" }, entry.revision),
      h("span", { class: "hist__outcome" }, OUTCOME[entry.outcome])),
    h("p", { class: "hist__wording" }, entry.wording.title),
    h("p", { class: "hist__limits num" }, `Deadline ${entry.limits.deadline_date} · ${hours(entry.limits.fh_threshold)} FH`,
      entry.limits.deferred ? " · deferral applied" : ""),
    h("p", { class: "hist__when muted num" }, `${when(entry.entered_at)} → ${entry.left_at ? when(entry.left_at) : "now"}`),
    ...legacy);
}

// A drawer control's identity across re-renders: a button by its text, a field by its label.
function controlName(control) {
  const name = control.matches("button") ? control.textContent : control.closest(".field")?.querySelector("label")?.textContent;
  return name ? `${control.tagName}:${name}` : null;
}

export function createDrawer(app) {
  const el = h("aside", { class: "drawer", role: "dialog", hidden: true });
  let layer = null;
  let current = null;
  let openerKey = null;
  let touchStart = null;

  el.addEventListener("touchstart", (e) => { touchStart = e.touches[0]; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    const end = e.changedTouches[0];
    if (touchStart && narrow() && end.clientX - touchStart.clientX > 70
        && Math.abs(end.clientY - touchStart.clientY) < 60) close();
    touchStart = null;
  });

  function controls(t) {
    const user = app.state.user;
    const readOnly = app.state.prior?.did === t.directive_id || t.stage === "withdrawn";
    if (readOnly) return null;
    const card = t.work_card;
    const mine = card.holder?.id === user.id;
    const box = h("section", { class: "dr-actions", "aria-label": "Actions" }, h("h3", {}, "Actions"));
    const row = (...kids) => h("div", { class: "dr-actions__row" }, ...kids);
    const button = (label, run, kind = "primary") => h("button", { type: "button", class: `btn btn--${kind}`,
      onclick: (e) => run(e.currentTarget) }, label);
    if (user.role === "licensed_inspector") {
      // Only an unheld card offers a claim: once anyone holds it, the Work card section names the holder instead
      // (brief: Interactions, the losing claimant sees the holder).
      if (!card.holder && ["open", "deferred", "reopened", "superseded_retargeted"].includes(t.stage)) {
        box.append(row(button("Claim work card", (b) => app.threadAction("claim", current, { button: b }))));
      }
      if (mine && ["claimed", "reopened", "superseded_retargeted"].includes(t.stage)) {
        const file = h("input", { type: "file", accept: "image/jpeg,image/png,application/pdf", class: "file",
          onchange: (e) => e.target.files[0] && app.threadAction("evidence", current, { file: e.target.files[0], input: e.target }) });
        const methodRef = h("input", { type: "text", class: "input", maxlength: "200", autocomplete: "off" });
        const findings = h("textarea", { class: "input", rows: "3", maxlength: "4000" });
        box.append(field("Attach evidence", file, "JPEG, PNG or PDF up to 5,000,000 bytes."),
          field("Method reference", methodRef), field("Findings", findings),
          row(button("Sign inspection", (b) => app.threadAction("inspection", current, { button: b, methodRef, findings, file })),
            ["claimed", "reopened"].includes(t.stage) ? button("Release work card", (b) => app.threadAction("release", current, { button: b }), "quiet") : null));
      }
    }
    if (user.role === "certifying_engineer" && t.stage === "inspected") {
      box.append(row(button("Countersign", (b) => app.threadAction("countersign", current, { button: b }))));
    }
    if (user.role === "compliance_planner" && t.stage === "open") {
      const reason = h("textarea", { class: "input", rows: "2", maxlength: "500" });
      box.append(field("Deferral reason", reason, "Extends the limits by 7 days and 25.0 FH, once per revision."),
        row(button("Defer", (b) => app.threadAction("deferral", current, { button: b, reason }))));
    }
    if (user.role === "compliance_planner" && t.stage === "superseded_retargeted") {
      const reason = h("textarea", { class: "input", rows: "2", maxlength: "500" });
      box.append(field("Effectivity reason", reason, `Review the ${t.revision} limits before confirming.`),
        row(button("Confirm effectivity", (b) => app.threadAction("confirmed", current, { button: b, reason })),
          button("Mark not applicable", (b) => app.threadAction("not_applicable", current, { button: b, reason }), "quiet")));
    }
    if (user.role === "records_clerk" && t.stage === "certified") {
      const reason = h("textarea", { class: "input", rows: "2", maxlength: "500" });
      box.append(field("Reopen reason", reason, "Signatures stay listed as void; the work card and evidence return."),
        row(button("Reopen thread", (b) => app.threadAction("reopen", current, { button: b, reason }))));
    }
    return box.childElementCount > 1 ? box : null;
  }

  function render(t) {
    const pinned = t.pinned_revision ? h("span", { class: "pin-tab" }, `signed under ${t.pinned_revision}`) : null;
    const live = app.cellOf(t.id);
    const gauge = live && !["Not applicable", "Withdrawn"].includes(t.label)
      ? h("div", { class: "dr-gauge", html: cellInner({ ...live, pinned_revision: null }) }) : null;
    const evidence = t.evidence.length
      ? h("ul", { class: "files", "aria-label": "Evidence" }, t.evidence.map((e) => h("li", {}, h("span", { html: icon("file") }),
        h("span", { class: "files__type" }, e.content_type), h("span", { class: "num" }, bytes(e.bytes)),
        h("span", { class: "files__sha num muted", title: e.sha256 }, e.sha256))))
      : h("p", { class: "muted" }, "No evidence attached.");
    const certifier = t.certifier.status
      ? h("li", { class: "sig sig--end" }, h("div", { class: "sig__head" }, h("span", { class: "sig__kind" }, "Certifier")),
        h("div", { class: "sig__who" }, t.certifier.assigned ? t.certifier.assigned.display_name : "No certifier in scope",
          " — ", t.certifier.status === "awaiting_countersignature" ? "awaiting countersignature" : "awaiting certifier"))
      : null;
    const chain = h("ol", { class: "chain", "aria-label": "Sign-off chain" }, t.signatures.map(signatureItem), certifier);
    if (!t.signatures.length && !certifier) chain.append(h("li", { class: "sig sig--none muted" }, "No signatures yet."));
    const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Close thread panel", onclick: close });
    closeBtn.innerHTML = ICON_CLOSE;
    const name = `${t.registration} ${t.directive}`;
    el.setAttribute("aria-label", `Thread ${name}`);
    const next = [
      h("header", { class: "dr-head" },
        h("div", {}, h("h2", { class: "dr-title", tabindex: "-1" }, h("span", { class: "dr-title__kind" }, "Thread"), " ",
          t.registration, " ", h("span", { class: "dr-title__dn" }, t.directive)),
          h("p", { class: "muted" }, `${MODEL_LABELS[t.model]} · MSN `, h("span", { class: "num" }, t.msn))),
        closeBtn),
      h("div", { class: "dr-body" },
        h("section", { class: "dr-state" },
          h("div", { class: "dr-state__line", html: `${glyph(t.label)}<span class="dr-state__label">${esc(t.label)}</span>` },
            h("span", { class: "tag tag--lg" }, t.revision), pinned),
          h("p", { class: "muted" }, t.governing ? `${t.governing} governs` : "No limit governs", " · rule in force ",
            h("span", { class: "tag" }, t.governing_revision)), gauge),
        h("section", {}, h("h3", {}, "Limits in force"), limitsList(t.limits),
          t.deferral ? h("p", { class: "muted" }, `Deferred by ${t.deferral.granted_by.display_name} on ${when(t.deferral.granted_at)}: ${t.deferral.reason}`) : null),
        h("section", { class: "dr-wording" }, h("h3", {}, "Method of compliance · ", h("span", { class: "tag" }, t.governing_revision)),
          h("p", { class: "dr-wording__title" }, t.wording.title), h("p", {}, t.wording.method)),
        h("section", { role: "region", "aria-label": "Work card", class: "dr-card" }, h("h3", {}, "Work card"),
          h("dl", { class: "facts" }, h("dt", {}, "Card"), h("dd", { class: "num" }, t.work_card.id),
            h("dt", {}, "Holder"), h("dd", {}, t.work_card.holder ? t.work_card.holder.display_name : "Unclaimed"),
            h("dt", {}, "Claimed"), h("dd", { class: "num" }, when(t.work_card.claimed_at))),
          h("h4", {}, "Evidence"), evidence),
        h("section", {}, h("h3", {}, "Sign-off chain"), chain),
        h("section", {}, h("h3", {}, "Revision history"),
          h("ol", { class: "history", "aria-label": "Revision history" }, t.history.map(historyItem))),
        controls(t))];
    keepUnchanged(el, next);
  }

  // A live refresh keeps every section whose markup did not change, so a control under the pointer or
  // holding focus stays the same element and in the same place.
  function keepUnchanged(host, next) {
    const oldHead = host.querySelector(":scope > .dr-head");
    const oldBody = host.querySelector(":scope > .dr-body");
    if (!oldHead || !oldBody || oldHead.outerHTML !== next[0].outerHTML) {
      host.replaceChildren(...next);
      return;
    }
    const was = [...oldBody.children];
    const now = [...next[1].children];
    now.forEach((section, i) => {
      if (was[i] && was[i].outerHTML === section.outerHTML) now[i] = was[i];
    });
    oldBody.replaceChildren(...now);
  }

  async function open(threadId, opener) {
    const t = (await get(`/api/threads/${threadId}`)).thread;
    const already = !el.hidden;
    current = t;
    openerKey = opener?.dataset?.key || null;
    render(t);
    app.state.selected = t.id;
    app.repaint();
    if (!already) {
      el.hidden = false;
      document.body.classList.add("has-drawer");
      // A short slide keeps every control under the pointer while the drawer settles.
      if (!reducedMotion()) el.animate([{ transform: "translateX(32px)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 250, easing: "cubic-bezier(.2,.8,.2,1)" });
      layer = pushLayer({ el, opener, trap: () => narrow(), close });
    } else if (layer) {
      layer.opener = opener;
    }
    if (narrow() || !already) (focusables(el)[0] || el).focus({ preventScroll: true });
  }

  function close() {
    if (el.hidden) return;
    const done = () => {
      el.hidden = true;
      document.body.classList.remove("has-drawer");
    };
    if (layer) {
      const target = openerKey && app.board.cell(openerKey);
      popLayer(layer, { restore: !target });
      if (target) target.focus();
      layer = null;
    }
    current = null;
    app.state.selected = null;
    app.repaint();
    if (reducedMotion()) done();
    else el.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(40%)", opacity: 0 }],
      { duration: 100, easing: "ease-in" }).finished.then(done);
  }

  async function refresh(threadIds) {
    if (!current || (threadIds && !threadIds.includes(current.id))) return;
    // A refresh is fire-and-forget: a failed read leaves the drawer as it is (an ended session already shows
    // Sign in, and the live feed reports an outage), so it never surfaces as an uncaught rejection.
    const t = await get(`/api/threads/${current.id}`).then((r) => r.thread, () => null);
    if (!t || !current || t.id !== current.id || JSON.stringify(t) === JSON.stringify(current)) return;
    const focused = el.contains(document.activeElement) ? document.activeElement : null;
    const focusedName = focused && controlName(focused);
    const caret = focused && "selectionStart" in focused ? [focused.selectionStart, focused.selectionEnd] : null;
    const typed = Object.fromEntries([...el.querySelectorAll(".field")].map((f) => [f.querySelector("label")?.textContent,
      f.querySelector("input:not([type=file]), textarea")?.value]).filter(([, v]) => v));
    const scrolled = el.querySelector(".dr-body")?.scrollTop || 0;
    current = t;
    render(t);
    el.querySelector(".dr-body").scrollTop = scrolled;
    for (const f of el.querySelectorAll(".field")) {
      const value = typed[f.querySelector("label")?.textContent];
      const input = f.querySelector("input:not([type=file]), textarea");
      if (value && input) input.value = value;
    }
    if (!focused || el.contains(document.activeElement)) return;
    // The focused control was rebuilt as a new element, or the new stage no longer offers it: then focus goes to
    // the drawer heading, never to the page body (brief: Interactions, DP-61 and DP-62).
    const same = focusedName && [...el.querySelectorAll("button, input, textarea")].find((c) => controlName(c) === focusedName);
    if (!same) return el.querySelector(".dr-title").focus({ preventScroll: true });
    same.focus({ preventScroll: true });
    if (caret && caret[0] !== null) same.setSelectionRange(...caret);
  }

  return { el, open, close, refresh, get thread() { return current; } };
}

// The tail panel ----------------------------------------------------------------------------------------------------

export function openTail(app, registration) {
  const tail = app.state.board.tails.find((t) => t.registration === registration);
  const dlg = modal({ label: `Tail ${registration}` });
  const total = h("dd", { class: "num" }, `${hours(tail.total_hours)} FH`);
  dlg.body.append(h("dl", { class: "facts" },
    h("dt", {}, "Model"), h("dd", {}, MODEL_LABELS[tail.model]), h("dt", {}, "MSN"), h("dd", { class: "num" }, tail.msn),
    h("dt", {}, "Total hours"), total,
    h("dt", {}, "Daily utilisation"), h("dd", { class: "num" }, `${hours(tail.daily_utilisation)} FH`)));
  if (app.state.user.role === "compliance_planner") {
    const input = h("input", { type: "number", class: "input", min: "0.1", max: "24", step: "0.1", inputmode: "decimal" });
    const submit = h("button", { type: "submit", class: "btn btn--primary" }, "Log hours");
    const form = h("form", { class: "form", novalidate: true }, field("Sector hours", input, "0.1 to 24.0 FH, one decimal."),
      h("div", { class: "form__actions" }, submit));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const result = await app.run({
        button: submit, pending: "Logging hours…", fields: { hours: input },
        call: () => request("POST", `/api/tails/${encodeURIComponent(registration)}/flight-hours`,
          { json: { hours: input.value === "" ? null : Number(input.value) } }),
        success: (r) => `${registration} now at ${hours(r.body.total_hours)} FH.`,
      });
      if (result) {
        total.textContent = `${hours(result.body.total_hours)} FH`;
        input.value = "";
      }
    });
    dlg.body.append(form);
  }
}

export { field };
