import { el, qs, motion, announce, ApiFail } from "./core.js";

/** Dialogs and sheets: one focus trap, Escape close, focus restore, 320 ms open/close motion. */
type OpenState = { panel: HTMLElement; opener: HTMLElement | null; closing: number | null; onEscape?: () => boolean };

const state: { stack: OpenState[] } = { stack: [] };
let overlay: HTMLElement | null = null;

const ensureOverlay = (): HTMLElement => {
  if (!overlay) {
    overlay = el(`<div class="dialog-overlay" hidden></div>`);
    document.body.append(overlay);
  }
  return overlay;
};

function buildPanel(title: string, contentHtml: string, wide: boolean): HTMLElement {
  const panel = el(`
    <div class="dialog-panel" role="dialog" aria-modal="true" aria-label="${title}">
      <h2>${title}</h2>
      ${contentHtml}
    </div>`);
  void wide;
  return panel;
}

export const dialogs = {
  get open(): OpenState | undefined {
    return state.stack[state.stack.length - 1];
  },

  openDialog(title: string, contentHtml: string, onSubmit?: (form: HTMLFormElement, submit: HTMLButtonElement) => Promise<void>, opts?: { wide?: boolean }): HTMLElement {
    const opener = document.activeElement as HTMLElement | null;
    const overlayEl = ensureOverlay();
    const formHtml = onSubmit ? `<form class="dialog-form">${contentHtml}<button type="submit" class="primary">Save</button></form>` : contentHtml;
    const panel = buildPanel(title, formHtml, opts?.wide ?? false);
    overlayEl.append(panel);
    overlayEl.hidden = false;
    const entry: OpenState = { panel, opener, closing: null };
    state.stack.push(entry);
    // Grow from centre at 1280, rise as sheet at 375.
    const sheet = window.innerWidth < 768;
    panel.classList.add(sheet ? "is-sheet" : "is-dialog");
    if (!motion.reduced) {
      panel.style.transformOrigin = "center";
      motion.animate(panel, { opacity: "0", transform: sheet ? "translateY(24px)" : "scale(0.96)" }, { opacity: "1", transform: sheet ? "translateY(0)" : "scale(1)" }, 320);
    }
    const form = panel.querySelector("form");
    const submitBtn = panel.querySelector<HTMLButtonElement>("button[type=submit]");
    if (form && onSubmit && submitBtn) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = submitBtn;
        const original = btn.textContent ?? "";
        btn.textContent = "Working…";
        btn.setAttribute("aria-disabled", "true");
        try {
          await onSubmit(form, btn);
        } catch (err) {
          if (err instanceof ApiFail) {
            if (err.status === 401) {
              announce("Your session ended. Sign in again to keep going — what you typed is still here.");
              dialogs.sessionEndedLink();
            } else if (err.fields) {
              dialogs.showProblems(panel, err.fields);
              announce(err.message);
            } else {
              announce(err.message);
            }
          }
        } finally {
          btn.textContent = original;
          btn.removeAttribute("aria-disabled");
        }
      });
    }
    focusFirst(panel);
    trap(entry);
    return panel;
  },

  openSheet(sheet: HTMLElement, opener: HTMLElement | null): void {
    const entry: OpenState = { panel: sheet, opener, closing: null };
    state.stack.push(entry);
    sheet.hidden = false;
    if (!motion.reduced) {
      motion.animate(sheet, { transform: "translateY(100%)" }, { transform: "translateY(0)" }, 320);
    }
    focusFirst(sheet);
    trap(entry);
  },

  closeTop(): void {
    const entry = state.stack.pop();
    if (!entry) return;
    hidePanel(entry);
  },

  closeDialog(): void {
    dialogs.closeTop();
  },

  closeSheet(): void {
    dialogs.closeTop();
  },

  closePanel(panel: HTMLElement): void {
    const idx = state.stack.findIndex((s) => s.panel === panel);
    if (idx === -1) return;
    const [entry] = state.stack.splice(idx, 1);
    hidePanel(entry!);
  },

  showProblems(panel: HTMLElement, fields: Record<string, string>): void {
    let summary = panel.querySelector<HTMLElement>(".problems");
    if (!summary) {
      summary = el(`<div class="problems" role="region" aria-label="Problems"><h2>Problems</h2><ul></ul></div>`);
      panel.prepend(summary);
    }
    const ul = summary.querySelector("ul")!;
    ul.innerHTML = "";
    for (const [name, message] of Object.entries(fields)) {
      const field = panel.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
      if (field) {
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", `${name}-error`);
        let errEl = panel.querySelector<HTMLElement>(`#${name}-error`);
        if (!errEl) {
          errEl = el(`<p class="field-error" id="${name}-error"></p>`);
          field.insertAdjacentElement("afterend", errEl);
        }
        errEl.textContent = message;
      }
      const label = name === "" ? "Form" : name;
      const li = el(`<li><a href="#${name}">${message}</a></li>`);
      li.querySelector("a")!.addEventListener("click", (e) => {
        e.preventDefault();
        field?.focus();
      });
      ul.append(li);
      void label;
    }
    summary.querySelector("h2")!.focus?.();
    const focusTarget = summary.querySelector<HTMLElement>("a");
    focusTarget?.focus();
  },

  clearProblems(panel: HTMLElement): void {
    panel.querySelector(".problems")?.remove();
    panel.querySelectorAll(".field-error").forEach((e) => e.remove());
    panel.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
  },

  sessionEndedLink(): void {
    const refresh = qs("#refresh-state");
    const link = el(`<a href="/sign-in?returnTo=${encodeURIComponent(location.pathname)}">Sign in again</a>`);
    if (refresh) {
      refresh.innerHTML = "";
      refresh.append(link);
    }
  },
};

function focusFirst(panel: HTMLElement): void {
  const first = panel.querySelector<HTMLElement>("input, select, textarea, button, a[href]");
  first?.focus();
}

function hidePanel(entry: OpenState): void {
  const { panel, opener } = entry;
  const finish = () => {
    panel.hidden = true;
    if (panel.classList.contains("is-sheet") || panel.id === "menu-sheet") {
      panel.hidden = true;
    } else {
      panel.remove();
    }
    state.stack = state.stack.filter((s) => s !== entry);
    if (!state.stack.length && overlay) overlay.hidden = true;
    opener?.focus();
  };
  if (motion.reduced) {
    finish();
    return;
  }
  motion.animate(panel, { opacity: "1" }, { opacity: "0" }, 160, finish);
}

function trap(entry: OpenState): void {
  entry.panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dialogs.closePanel(entry.panel);
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = [...entry.panel.querySelectorAll<HTMLElement>("a[href], button:not([aria-disabled=true]), input, select, textarea")].filter((n) => n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
