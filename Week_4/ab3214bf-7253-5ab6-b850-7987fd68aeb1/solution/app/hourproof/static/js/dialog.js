// Dialogs on top of the native <dialog>: focus to the first field, Tab kept inside, Escape records nothing,
// focus returned to the control that held it before the dialog opened.
import { focusables } from "./dom.js";

const overlays = () => document.getElementById("overlays");
const stack = [];

export function openDialog(dialog, { opener, onClose, initial } = {}) {
  const returnTo = opener || document.activeElement;
  overlays().append(dialog);
  dialog.dataset.motionMs = document.documentElement.dataset.motion === "reduced" ? "0" : "200";
  let closed = false;

  const close = ({ restore = true } = {}) => {
    if (closed) return;
    closed = true;
    const index = stack.indexOf(handle);
    if (index >= 0) stack.splice(index, 1);
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (restore && returnTo && returnTo.isConnected && !returnTo.disabled) returnTo.focus({ preventScroll: true });
    if (onClose) onClose();
  };

  const onCancel = (event) => { event.preventDefault(); close(); };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusTargets = focusables(dialog);
    if (!focusTargets.length) { event.preventDefault(); return; }
    const first = focusTargets[0];
    const last = focusTargets[focusTargets.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
  };

  const handle = { dialog, close };
  stack.push(handle);
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  dialog.showModal();
  const first = initial || focusables(dialog)[0];
  (first || dialog).focus({ preventScroll: true });
  return handle;
}

export function closeAllDialogs() {
  for (const handle of [...stack]) handle.close({ restore: false });
}
