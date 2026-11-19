// Keyboard-complete dialogs and polite announcements (adapted from kit/modules/a11y_dialog).

const FOCUSABLE = "a[href], button, input:not([type='hidden']), select, textarea, [tabindex]";

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.disabled && !el.closest("[hidden]") && el.getAttribute("tabindex") !== "-1" && el.getClientRects().length > 0,
  );
}

/** Open a native modal dialog: focus inside, Tab and Shift+Tab stay inside, Escape closes, focus returns. */
export function openDialog(dialog, opener = document.activeElement) {
  dialog.showModal();
  const items = focusables(dialog);
  (items.find((el) => el.hasAttribute("autofocus")) ?? items[0] ?? dialog).focus();

  const onKey = (event) => {
    if (event.key !== "Tab") return;
    const els = focusables(dialog);
    if (!els.length) return event.preventDefault();
    const edge = event.shiftKey ? els[0] : els[els.length - 1];
    if (document.activeElement === edge || !dialog.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? els[els.length - 1] : els[0]).focus();
    }
  };
  const onCancel = (event) => {
    event.preventDefault();
    close();
  };
  const onClick = (event) => {
    if (event.target.closest("[data-close]")) close();
  };
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    dialog.removeEventListener("click", onClick);
    dialog.close();
    if (opener && opener.isConnected) opener.focus();
  }
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("click", onClick);
  return { close };
}

/** Write a result into a polite live region that is already in the page; `tone` styles it. */
export function announce(region, text, tone = "") {
  region.classList.remove("is-error", "is-success", "is-outage");
  if (tone) region.classList.add(`is-${tone}`);
  region.textContent = text;
}
