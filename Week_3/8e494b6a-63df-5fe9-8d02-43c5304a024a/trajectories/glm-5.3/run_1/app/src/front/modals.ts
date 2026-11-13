/**
 * Account dialog (time zone, sign out) and the space menu.
 */
import { h, animate } from "./core";
import { api, me, showNotice, type Me } from "./api";
import { navigate, currentRoute } from "./shell";
import { isValidTimeZone } from "../shared/tz";

const COMMON_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
];

/** Open a modal dialog with focus management and Escape/return handling. */
export function openModal(
  build: (close: () => void) => HTMLElement,
  opener: HTMLElement | null,
  label: string,
): void {
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = h("div", { class: "modal-overlay" });
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(20,32,26,0.35)";
  overlay.style.zIndex = "100";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "20px";
  const dialog = h("div", { role: "dialog", "aria-label": label, class: "card modal-dialog" });
  dialog.style.maxWidth = "520px";
  dialog.style.width = "100%";
  dialog.style.maxHeight = "80vh";
  dialog.style.overflow = "auto";
  const close = (): void => {
    overlay.remove();
    if (opener) opener.focus();
  };
  const content = build(close);
  dialog.append(content);
  overlay.append(dialog);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const focusables = dialog.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
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
    }
  });
  const focusable = dialog.querySelector<HTMLElement>("button, input, select, textarea, [href]");
  if (focusable) focusable.focus();
}

/** A bottom sheet on phone, a modal dialog otherwise. */
export function openSheet(
  build: (close: () => void) => HTMLElement,
  opener: HTMLElement | null,
  label: string,
): void {
  const isPhone = window.innerWidth < 768;
  if (!isPhone) {
    openModal(build, opener, label);
    return;
  }
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = h("div", { class: "modal-overlay" });
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(20,32,26,0.35)";
  overlay.style.zIndex = "100";
  overlay.style.display = "flex";
  overlay.style.alignItems = "flex-end";
  const dialog = h("div", { role: "dialog", "aria-label": label, class: "card" });
  dialog.style.width = "100%";
  dialog.style.maxHeight = "85vh";
  dialog.style.overflow = "auto";
  dialog.style.borderRadius = "10px 10px 0 0";
  dialog.style.borderBottom = "none";
  const close = (): void => {
    overlay.remove();
    if (opener) opener.focus();
  };
  dialog.append(build(close));
  overlay.append(dialog);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  animate(dialog, "sheet-rise", [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], {
    duration: 240,
    easing: "ease-in-out",
    fill: "forwards",
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
  const focusable = dialog.querySelector<HTMLElement>("button, input, select, textarea, [href]");
  if (focusable) focusable.focus();
}

/** The space menu behind button "Space". */
export function openSpaceMenu(button: HTMLElement): void {
  const existing = document.querySelector(".space-menu");
  if (existing) {
    (existing as HTMLElement).remove();
    button.focus();
    return;
  }
  const menu = h("div", { role: "menu", "aria-label": "Spaces", class: "space-menu" });
  menu.style.position = "fixed";
  menu.style.zIndex = "120";
  const rect = button.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.style.background = "var(--paper)";
  menu.style.border = "1px solid var(--border)";
  menu.style.borderRadius = "4px";
  menu.style.minWidth = "180px";
  menu.style.boxShadow = "0 4px 14px rgba(20,32,26,0.12)";
  const memberships = me()?.spaces ?? [];
  let first: HTMLElement | null = null;
  for (const sp of memberships) {
    const item = h("button", { role: "menuitemradio", "aria-checked": String(sp.slug === me()?.space.slug) }, sp.name);
    item.style.display = "block";
    item.style.width = "100%";
    item.style.textAlign = "left";
    item.style.padding = "10px 12px";
    item.style.minHeight = "44px";
    item.style.background = "transparent";
    item.style.border = "none";
    item.style.color = "var(--ink)";
    if (sp.slug === me()?.space.slug) item.setAttribute("aria-checked", "true");
    item.addEventListener("click", async () => {
      menu.remove();
      await api("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ space: sp.slug }),
        headers: { "Content-Type": "application/json" },
      });
      const m = await api<Me>("/api/me");
      me.set(m);
      // reload the current view for the new space
      navigate("/explore", true);
      location.reload();
    });
    menu.append(item);
    if (!first) first = item;
  }
  document.body.append(menu);
  if (first) first.focus();
  const dismiss = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node) && e.target !== button) {
      menu.remove();
      document.removeEventListener("mousedown", dismiss);
      button.focus();
    }
  };
  document.addEventListener("mousedown", dismiss);
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menu.remove();
      button.focus();
    }
  });
}

/** The account dialog: time zone and sign out. */
export function openAccountDialog(button: HTMLElement): void {
  openModal(
    (close) => {
      const box = h("div", {});
      const zoneLabel = h("label", { for: "acct-zone" }, "Time zone");
      const zone = h("select", { class: "input", id: "acct-zone", "aria-label": "Time zone" }) as HTMLSelectElement;
      for (const z of COMMON_ZONES) {
        const o = document.createElement("option");
        o.value = z;
        o.textContent = z;
        if (z === me()?.time_zone) o.selected = true;
        zone.append(o);
      }
      zone.style.width = "100%";
      const save = h("button", { class: "btn-main" }, "Save account");
      const signOut = h("button", { class: "btn" }, "Sign out");
      save.addEventListener("click", async () => {
        try {
          const m = await api<Me>("/api/me", {
            method: "PATCH",
            body: JSON.stringify({ time_zone: zone.value }),
            headers: { "Content-Type": "application/json" },
          });
          me.set(m);
          showNotice(`Time zone set to ${zone.value}.`);
          close();
        } catch {
          // leave the dialog open on failure
        }
      });
      signOut.addEventListener("click", async () => {
        await api("/api/signout", { method: "POST" });
        location.href = "/signin";
      });
      const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "14px" } });
      row.append(save, signOut);
      box.append(zoneLabel, zone, row);
      return box;
    },
    button,
    "Account",
  );
}
