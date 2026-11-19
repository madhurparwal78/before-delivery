import { api, announce, ApiFail, el, qs, qsa, focusHeading, setTitle, motion } from "./core.js";
import { dialogs } from "./dialogs.js";
import { screens } from "./screens/index.js";
import { installWorkPanel, installHeaderScroll, installEnquiryForm, installAuthForms, installCaseRail, installKindFilter, installCaseNavigation } from "./public.js";

const sessionEndedCode = "Your session ended. Sign in again to keep going — what you typed is still here.";

async function boot(): Promise<void> {
  const body = document.body;
  if (body.dataset.clientPage === "true") {
    const { installClientPage } = await import("./client-page.js");
    installClientPage();
    return;
  }
  if (body.dataset.desk === "true") {
    const root = qs("#screen-root > [data-screen]");
    const screen = root?.dataset.screen;
    installDeskShell();
    if (screen && screen in screens) {
      await screens[screen as keyof typeof screens](root as HTMLElement);
    }
    return;
  }
  // Public site behaviour.
  installHeaderScroll();
  installWorkPanel();
  installCaseNavigation();
  installKindFilter();
  installCaseRail();
  installEnquiryForm();
  installAuthForms();
}

function installDeskShell(): void {
  const searchForm = qs("#desk-search");
  const input = qs("#search-input") as HTMLInputElement | null;
  const results = qs("#search-results");
  let timer: number | undefined;
  let latestQuery = "";
  input?.addEventListener("input", () => {
    window.clearTimeout(timer);
    const value = input.value.trim();
    latestQuery = value;
    timer = window.setTimeout(async () => {
      if (value === "") {
        results!.hidden = true;
        results!.innerHTML = "";
        return;
      }
      try {
        const data = await api<{ results: { kind: string; id: string; label: string; href: string }[] }>(`/api/search?q=${encodeURIComponent(value)}`);
        if (input.value.trim() !== latestQuery) return;
        results!.innerHTML = "";
        for (const r of data.results) {
          const li = el(`<li role="option"><a href="${r.href}">${r.label}</a></li>`);
          results!.appendChild(li);
        }
        results!.hidden = false;
      } catch (e) {
        if (e instanceof ApiFail && e.status === 503) announce("Search is unavailable right now. The full list is still here.");
      }
    }, 300);
  });
  searchForm?.addEventListener("submit", (e) => e.preventDefault());
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      results!.hidden = true;
    }
  });
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest?.("#desk-search")) results!.hidden = true;
  });

  qs("#sign-out")?.addEventListener("click", async () => {
    await api("/api/session", { method: "DELETE" });
    window.location.href = "/sign-in";
  });
  qs("#menu-sign-out")?.addEventListener("click", async () => {
    await api("/api/session", { method: "DELETE" });
    window.location.href = "/sign-in";
  });
  const openMenu = qs("#menu-button");
  openMenu?.addEventListener("click", () => {
    const sheet = qs("#menu-sheet")!;
    dialogs.openSheet(sheet, openMenu as HTMLElement);
  });
  qs("#menu-close")?.addEventListener("click", () => dialogs.closeSheet());

  const changePassword = (opener: HTMLElement) => {
    dialogs.openDialog(
      `Change password`,
      `<label>Current password<input type="password" name="currentPassword" autocomplete="current-password"></label>
       <label>New password<input type="password" name="newPassword" autocomplete="new-password"></label>
       <button type="submit" class="primary">Change password</button>`,
      async (form, submit) => {
        await withBusy(submit, async () => {
          await api("/api/password", { method: "POST", json: { currentPassword: (form.elements.namedItem("currentPassword") as HTMLInputElement).value, newPassword: (form.elements.namedItem("newPassword") as HTMLInputElement).value } });
          announce("Password changed.");
          dialogs.closeDialog();
        });
      }
    );
  };
  qs("#change-password")?.addEventListener("click", (e) => changePassword(e.currentTarget as HTMLElement));
  qs("#menu-change-password")?.addEventListener("click", () => {
    dialogs.closeSheet();
    changePassword(qs("#menu-change-password") as HTMLElement);
  });
}

export async function withBusy(button: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  if (button.getAttribute("aria-disabled") === "true") return;
  const original = button.textContent ?? "";
  button.textContent = "Working…";
  button.setAttribute("aria-disabled", "true");
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiFail) {
      if (e.status === 401 && (e.code === "sessionEnded" || e.code === "notSignedIn")) {
        announce(sessionEndedCode);
        dialogs.sessionEndedLink();
      } else {
        announce(e.message);
      }
    }
  } finally {
    button.textContent = original;
    button.removeAttribute("aria-disabled");
  }
}

void qsa;
void focusHeading;
void setTitle;
void motion;

boot().catch(() => undefined);
