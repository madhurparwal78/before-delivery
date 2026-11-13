// Adapted from kit/modules/a11y_dialog to the native TypeScript dialog API.
export function openDialog(
  dialog: HTMLDialogElement,
  opener: HTMLElement,
): void {
  dialog.showModal();
  let open = true;
  const focusable = (): HTMLElement[] =>
    [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
      ),
    ].filter((el) => !el.hidden);
  const items = focusable();
  (
    items.find((el) => el.hasAttribute("autofocus")) ||
    items[0] ||
    dialog
  ).focus();
  const cancelButtons = [
    ...dialog.querySelectorAll<HTMLElement>("[data-close-dialog]"),
  ];
  const finish = (): void => {
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    cancelButtons.forEach((button) =>
      button.removeEventListener("click", onCloseClick),
    );
    dialog.close();
    if (opener.isConnected) opener.focus();
  };
  const close = (): void => {
    if (!open) return;
    open = false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const duration = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--disclosure",
      ),
    );
    void dialog
      .animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(6px)" },
        ],
        { duration, easing: "ease-out" },
      )
      .finished.then(finish, finish);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const list = focusable();
      if (!list.length) {
        event.preventDefault();
        return;
      }
      const edge = event.shiftKey ? list[0] : list[list.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? list[list.length - 1] : list[0]).focus();
      }
    }
  };
  const onCancel = (event: Event): void => {
    event.preventDefault();
    close();
  };
  const onCloseClick = (event: Event): void => {
    event.preventDefault();
    close();
  };
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  cancelButtons.forEach((button) =>
    button.addEventListener("click", onCloseClick),
  );
}
