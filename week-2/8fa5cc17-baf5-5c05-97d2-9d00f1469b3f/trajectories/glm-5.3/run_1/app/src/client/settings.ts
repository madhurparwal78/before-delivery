// Settings: home clock, theme, device sessions, password change, sign out.

import { api, apiFail, ApiFailure, type SessionJson, getCsrfToken } from "./api.js";
import { h, clearChildren, openDialog, announce, alertMessage, clearAlert, dateTimeShort } from "./dom.js";
import { state, screens, mainEl, updateTopbarTitle } from "./app.js";

export function applyTheme(theme: "paper" | "lamplight"): void {
  document.documentElement.dataset.theme = theme;
}

const ZONES = Intl.supportedValuesOf("timeZone");

export function openSettingsScreen(): void {
  const onEvent = (ev: Event): void => {
    const detail = (ev as CustomEvent).detail as { event: string };
    if (detail.event === "sessions.changed") {
      void loadSessions();
    }
  };
  document.addEventListener("quire-event", onEvent);
  screens.current = { dispose: () => document.removeEventListener("quire-event", onEvent) };
  const main = mainEl();
  clearChildren(main);
  clearAlert();
  updateTopbarTitle("Settings");
  main.append(h("h1", { text: "Settings" }));

  // home clock
  const zoneSel = h("select", { "aria-label": "Home clock" });
  for (const zone of ZONES) {
    zoneSel.append(h("option", { value: zone, selected: zone === state.app?.homeTimeZone }, zone));
  }
  const saveZone = h("button", {}, "Save home clock");
  saveZone.addEventListener("click", async () => {
    try {
      const res = await api<{ home_time_zone: string }>("PUT", "/api/settings", { home_time_zone: zoneSel.value });
      if (state.app !== null) state.app.homeTimeZone = res.home_time_zone;
      announce(`Home clock set to ${res.home_time_zone}. Today's note now follows it.`);
    } catch (e) {
      alertMessage(apiFail(e, "home_time_zone"));
    }
  });
  main.append(h("section", { "aria-label": "Home clock" }, h("h2", { text: "Home clock" }), zoneSel, saveZone));

  // theme
  const themeSel = h("select", { "aria-label": "Theme" });
  themeSel.append(h("option", { value: "paper" }, "Paper"), h("option", { value: "lamplight" }, "Lamplight"));
  themeSel.value = state.app?.theme ?? "paper";
  themeSel.addEventListener("change", async () => {
    const theme = themeSel.value === "lamplight" ? "lamplight" : "paper";
    try {
      await api("PUT", "/api/settings", { theme });
      if (state.app !== null) state.app.theme = theme;
      applyTheme(theme);
      announce(`Theme set to ${theme === "paper" ? "Paper" : "Lamplight"}.`);
    } catch (e) {
      alertMessage(apiFail(e, "theme"));
      themeSel.value = state.app?.theme ?? "paper";
    }
  });
  main.append(h("section", { "aria-label": "Theme" }, h("h2", { text: "Theme" }), themeSel));

  // device sessions
  const sessionsHeading = h("h2", { id: "sessions-heading", tabindex: "-1" }, "Device sessions");
  const sessionsList = h("ul", { class: "sessions", "aria-label": "Device sessions", id: "sessions-list" });
  const zone = state.app?.homeTimeZone ?? "UTC";
  const buildItem = (s: SessionJson): HTMLElement => {
    const label = `${s.label}, signed in ${dateTimeShort(new Date(s.created_at), zone)}${s.current ? " (This device)" : ""}`;
    const item = h("li", { class: "session-item" }, h("span", {}, label));
    if (!s.current) {
      const signOut = h("button", { "aria-label": `Sign out ${s.label}, signed in ${dateTimeShort(new Date(s.created_at), zone)}` }, "Sign out device");
      signOut.addEventListener("click", () => confirmSignOut(s, signOut));
      item.append(signOut);
    }
    return item;
  };
  async function loadSessions(): Promise<void> {
    let sessions: SessionJson[] = [];
    try {
      const res = await api<{ sessions: SessionJson[] }>("GET", "/api/sessions");
      sessions = res.sessions;
    } catch {
      return;
    }
    const focusedHandle = document.activeElement?.getAttribute("aria-label") ?? "";
    sessionsList.replaceChildren(...sessions.map(buildItem));
    // keep focus on the button that came after a vanished item
    if (focusedHandle.startsWith("Sign out ")) {
      const gone = !Array.from(sessionsList.querySelectorAll("button")).some((b) => b.getAttribute("aria-label") === focusedHandle);
      if (gone) {
        const target = sessionsList.querySelector("button") as HTMLElement | null;
        if (target !== null) target.focus();
        else sessionsHeading.focus();
      } else {
        const btn = Array.from(sessionsList.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === focusedHandle);
        if (btn !== undefined) (btn as HTMLElement).focus();
      }
    }
  }
  main.append(h("section", { "aria-label": "Device sessions" }, sessionsHeading, sessionsList));
  void loadSessions();

  function confirmSignOut(s: SessionJson, opener: HTMLElement): void {
    const confirmBtn = h("button", { class: "danger" }, "Sign out device");
    const cancel = h("button", {}, "Cancel");
    const dialog = h("div", { role: "alertdialog", "aria-label": "Sign out this device?", class: "dialog" },
      h("h2", { text: "Sign out this device?" }),
      confirmBtn,
      cancel
    );
    const overlay = h("div", { class: "dialog-overlay" }, dialog);
    document.body.append(overlay);
    const handle = openDialog(overlay, opener);
    // the dialog stays open through sessions.changed events
    dialog.addEventListener("dialog-close", () => {
      overlay.remove();
      handle.close();
    });
    cancel.addEventListener("click", () => dialog.dispatchEvent(new CustomEvent("dialog-close")));
    confirmBtn.addEventListener("click", async () => {
      try {
        await api("DELETE", `/api/sessions/${s.id}`);
        announce(`Signed out ${s.label}.`);
        dialog.dispatchEvent(new CustomEvent("dialog-close"));
        void loadSessions();
      } catch (e) {
        if (e instanceof ApiFailure && e.body.error === "not_found") {
          alertMessage("That device is already signed out.");
        } else {
          alertMessage(apiFail(e, "id"));
        }
        dialog.dispatchEvent(new CustomEvent("dialog-close"));
        void loadSessions();
      }
    });
    confirmBtn.focus();
  }

  // password change
  const currentInput = h("input", { type: "password", "aria-label": "Current password" });
  const newInput = h("input", { type: "password", "aria-label": "New password" });
  const changeBtn = h("button", {}, "Change password");
  changeBtn.addEventListener("click", async () => {
    try {
      await api("POST", "/api/account/password", { current_password: currentInput.value, new_password: newInput.value });
      announce("Password changed. Your other devices are signed out.");
      void loadSessions();
    } catch (e) {
      alertMessage(apiFail(e, "current_password"));
    }
  });
  main.append(h("section", { "aria-label": "Password" }, h("h2", { text: "Password" }),
    h("label", {}, "Current password ", currentInput),
    h("label", {}, "New password ", newInput),
    changeBtn
  ));

  // sign out
  const signOut = h("button", { class: "danger" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await api("POST", "/api/auth/sign-out").catch(() => undefined);
    window.__quireSync?.stop();
    location.replace("/sign-in");
  });
  main.append(signOut);
}
