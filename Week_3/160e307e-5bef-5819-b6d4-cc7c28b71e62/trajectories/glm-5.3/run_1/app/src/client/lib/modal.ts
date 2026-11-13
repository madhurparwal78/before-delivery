/** Dialogs that keep Tab inside and return focus to their opener. */
export class Modal {
  private readonly dialog: HTMLDialogElement;
  private readonly opener: HTMLElement | null;
  private closed = false;

  constructor(
    label: string,
    build: (dialog: HTMLDialogElement, close: (result: boolean) => void) => HTMLElement,
    opener: HTMLElement | null
  ) {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", label);
    this.dialog = dialog;
    this.opener = opener;
    const body = build(dialog, (result) => this.close(result));
    dialog.appendChild(body);
    document.body.appendChild(dialog);
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = this.focusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener("close", () => this.close(false));
  }

  private focusables(): HTMLElement[] {
    return Array.from(
      this.dialog.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      )
    ).filter((f) => !f.hasAttribute("disabled"));
  }

  open(): void {
    this.dialog.showModal();
    const first = this.focusables()[0];
    if (first !== undefined) first.focus();
  }

  close(_result: boolean): void {
    if (this.closed) return;
    this.closed = true;
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
    if (this.opener !== null) this.opener.focus();
  }
}

/** A modal that cannot be dismissed by Escape. */
export class PersistentModal {
  private readonly dialog: HTMLDialogElement;

  constructor(label: string, build: (dialog: HTMLDialogElement) => HTMLElement) {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", label);
    this.dialog = dialog;
    dialog.appendChild(build(dialog));
    document.body.appendChild(dialog);
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  open(): void {
    this.dialog.showModal();
    const focusable = this.dialog.querySelector<HTMLElement>("button, [href]");
    if (focusable !== null) focusable.focus();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
  }
}
