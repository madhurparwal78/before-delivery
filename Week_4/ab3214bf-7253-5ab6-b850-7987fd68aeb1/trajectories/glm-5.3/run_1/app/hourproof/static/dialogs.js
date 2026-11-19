/* Dialogs: focus trap, Escape, focus return, in-dialog refusals. */
"use strict";

const openDialogs = [];
let pendingReauth = null;   // {method, path, body, opts}
let refreshPaused = false;

function topDialog() { return openDialogs[openDialogs.length - 1] || null; }

function dialogShell(name, attrs = {}) {
  const dlg = el("dialog", {
    "aria-label": name,
    "data-motion-ms": attrs.motionMs === undefined ? 200 : attrs.motionMs,
    class: attrs.class || "",
  });
  const problems = el("div", { role: "alert", "aria-label": "Problems to fix", hidden: true });
  const close = () => closeDialog(dlg);
  dlg.append(problems);
  dlg.dataset.problems = "";
  return { dlg, problems };
}

function openDialog(dlg, opener) {
  dlg.dataset.opener = opener || "";
  document.body.append(dlg);
  dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "");
  openDialogs.push(dlg);
  const focusables = Array.from(dlg.querySelectorAll(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
    .filter((n) => !n.disabled && n.offsetParent !== null);
  const firstField = focusables.find((n) => ["INPUT", "TEXTAREA", "SELECT"].includes(n.tagName));
  (firstField || focusables[0] || dlg).focus();
}

function closeDialog(dlg) {
  const index = openDialogs.indexOf(dlg);
  if (index >= 0) openDialogs.splice(index, 1);
  const opener = dlg.dataset.opener ? document.getElementById(dlg.dataset.opener) : null;
  if (dlg.close) dlg.close(); else dlg.remove();
  if (opener && opener.isConnected) opener.focus();
}

function dialogFocusTrap(event) {
  const dlg = topDialog();
  if (!dlg) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeDialog(dlg);
    return;
  }
  if (event.key !== "Tab") return;
  const focusables = Array.from(dlg.querySelectorAll(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
    .filter((n) => !n.disabled && n.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", dialogFocusTrap, true);

function showProblems(dlg, err) {
  const box = dlg.querySelector('[role="alert"][aria-label="Problems to fix"]');
  box.hidden = false;
  box.replaceChildren();
  const entries = Object.entries(err.fields || {});
  if (entries.length) {
    for (const [field, message] of entries) {
      const link = el("a", { href: "#", text: message });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const target = dlg.querySelector(`[data-field="${field}"]`);
        if (target) target.focus();
      });
      box.append(link);
    }
  } else {
    box.append(document.createTextNode(err.message || "That can't be done now."));
  }
}

function clearProblems(dlg) {
  const box = dlg.querySelector('[role="alert"][aria-label="Problems to fix"]');
  box.hidden = true;
  box.replaceChildren();
}

/* Sign-in again: 401 opens this dialog over the current screen. */
function openSignInAgain(method, path, body, opts) {
  const existing = document.querySelector('dialog[aria-label="Sign in again"]');
  if (existing) return;
  pendingReauth = { method, path, body, opts };
  refreshPaused = true;
  const { dlg, problems } = dialogShell("Sign in again");
  const email = el("input", { type: "hidden", value: ME ? ME.email : "" });
  const password = el("input", {
    type: "password", id: nextId(), "aria-label": "Password", "data-field": "password",
  });
  const signIn = el("button", { text: "Sign in" });
  const cancel = el("button", { text: "Cancel" });
  const send = async () => {
    clearProblems(dlg);
    try {
      await api("POST", "/api/auth/sign-in", {
        email: ME.email, password: password.value,
      }, { noDialog: true });
      const { method: m, path: p, body: b, opts: o } = pendingReauth;
      pendingReauth = null;
      refreshPaused = false;
      closeDialog(dlg);
      await api(m, p, b, o).catch(() => {});
      renderRoute();
    } catch (err) {
      showProblems(dlg, err);
    }
  };
  signIn.addEventListener("click", send);
  password.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  cancel.addEventListener("click", () => { closeDialog(dlg); });
  const form = el("form", { onSubmit: (e) => e.preventDefault() },
    el("p", { text: "Your session ended. Sign in to finish." }),
    email, el("label", { text: "Password" }), password,
    signIn, cancel);
  form.addEventListener("submit", (e) => e.preventDefault());
  dlg.append(form);
  openDialog(dlg);
}

let idCounter = 0;
function nextId() { return `hp${++idCounter}`; }
