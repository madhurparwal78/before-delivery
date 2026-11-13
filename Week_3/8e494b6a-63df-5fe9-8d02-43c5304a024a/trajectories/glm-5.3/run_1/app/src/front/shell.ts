/**
 * Shared layout pieces: ingest status bar, workspace header, tabs, announcements and footer.
 */
import { effect, h, signal, text, animate } from "./core";
import { api, displayTime, me, refreshTime, serverNow, setNotice, showNotice, startLive } from "./api";
import { isValidTimeZone } from "../shared/tz";

export const currentRoute = signal<string>(location.pathname + location.search);

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  currentRoute.set(path + "");
  void refreshTime();
}

export function goToStreamPath(path: string): void {
  navigate(path);
}

const TABS: [label: string, path: string][] = [
  ["Explore", "/explore"],
  ["Pipes", "/pipes"],
  ["Streams", "/streams"],
  ["Pipelines", "/pipelines"],
  ["Alerts", "/alerts"],
  ["Inbox", "/inbox"],
  ["Cases", "/cases"],
  ["Traces", "/traces"],
  ["Objectives", "/objectives"],
  ["Spaces", "/spaces"],
  ["Keys", "/keys"],
];

export const main = h("main", {});
main.style.position = "relative";
main.style.paddingTop = "160px";
main.style.minHeight = "calc(100vh - 200px)";

/** The signed-in workspace shell: everything above and below the view. */
export function buildShell(root: HTMLElement, view: HTMLElement, signedIn: boolean): void {
  if (!signedIn) {
    main.style.paddingTop = "20px";
    root.replaceChildren(main);
    main.append(view);
    const authFooter = h("footer", { role: "contentinfo", class: "workspace-footer" });
    authFooter.style.background = "var(--footer)";
    authFooter.style.color = "var(--footer-ink)";
    authFooter.style.padding = "18px 14px";
    const footerBrand = h("span", { class: "mono" }, "Spoorline");
    authFooter.append(footerBrand);
    root.append(authFooter);
    return;
  }
  const ingest = h("div", { class: "ingest-bar", role: "region", "aria-label": "Ingest status" });
  ingest.style.position = "fixed";
  ingest.style.top = "0";
  ingest.style.left = "0";
  ingest.style.right = "0";
  ingest.style.height = "24px";
  ingest.style.zIndex = "40";
  ingest.style.background = "var(--footer)";
  ingest.style.color = "var(--footer-ink)";
  ingest.style.display = "flex";
  ingest.style.alignItems = "center";
  ingest.style.fontSize = "12px";
  ingest.style.fontFamily = "var(--mono)";
  ingest.style.padding = "0 14px";

  const header = h("header", { role: "banner", class: "workspace-header" });
  header.style.position = "fixed";
  header.style.top = "24px";
  header.style.left = "0";
  header.style.right = "0";
  header.style.height = "44px";
  header.style.zIndex = "39";
  header.style.background = "var(--paper)";
  header.style.borderBottom = "1px solid var(--hairline)";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "14px";
  header.style.padding = "0 14px";

  const brand = h("span", { class: "brand mono" }, "Spoorline");
  brand.style.fontWeight = "700";
  brand.style.fontSize = "15px";

  const serverTimeEl = h("span", { class: "mono muted" });
  serverTimeEl.style.fontSize = "12px";

  const spacer = h("span", {});
  spacer.style.flex = "1";

  const spaceBtn = h("button", { class: "btn", "aria-haspopup": "menu" }, me()?.space.name ?? "");
  const accountBtn = h("button", { class: "btn" }, "Account");

  header.append(brand, serverTimeEl, spacer, spaceBtn, accountBtn);

  const tabs = h("nav", { role: "navigation", "aria-label": "Workspace", class: "tab-strip" });
  tabs.style.position = "fixed";
  tabs.style.top = "68px";
  tabs.style.left = "0";
  tabs.style.right = "0";
  tabs.style.height = "40px";
  tabs.style.zIndex = "38";
  tabs.style.background = "var(--paper)";
  tabs.style.borderBottom = "1px solid var(--hairline)";
  tabs.style.display = "flex";
  tabs.style.alignItems = "center";
  tabs.style.gap = "2px";
  tabs.style.overflowX = "auto";
  tabs.style.padding = "0 8px";
  tabs.style.whiteSpace = "nowrap";

  const underline = h("div", { class: "tab-underline" });
  underline.style.position = "absolute";
  underline.style.height = "2px";
  underline.style.background = "var(--accent)";
  underline.style.bottom = "0";
  underline.style.transition = "none";

  const tabEls: Record<string, HTMLAnchorElement> = {};
  let lastActive: string | null = null;
  for (const [label, path] of TABS) {
    const a = document.createElement("a");
    a.href = path;
    a.textContent = label;
    a.style.padding = "8px 12px";
    a.style.textDecoration = "none";
    a.style.color = "var(--ink)";
    a.style.fontFamily = "var(--sans)";
    a.style.fontSize = "14px";
    a.style.minHeight = "36px";
    a.style.display = "inline-flex";
    a.style.alignItems = "center";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(path);
    });
    tabEls[path] = a;
    tabs.append(a);
  }
  tabs.style.position = "fixed";
  tabs.append(underline);

  effect(() => {
    const path = currentRoute().split("?")[0];
    for (const [p, el] of Object.entries(tabEls)) {
      const active = p === path || (p !== "/explore" && path.startsWith(p + "/")) || (p === "/explore" && path === "/explore");
      if (p === path || path.startsWith(p + "/") || (p === "/explore" && (path === "/" || path === "/explore"))) {
        el.setAttribute("aria-current", "page");
        el.style.color = "var(--accent)";
        el.style.fontWeight = "600";
        if (lastActive !== p) {
          if (lastActive !== null) {
            const from = tabEls[lastActive];
            const to = tabEls[p];
            if (from && to) {
              underline.style.left = `${to.offsetLeft}px`;
              underline.style.width = `${to.offsetWidth}px`;
              animate(underline, "tab-slide", [
                { left: `${from.offsetLeft}px`, width: `${from.offsetWidth}px` },
                { left: `${to.offsetLeft}px`, width: `${to.offsetWidth}px` },
              ], { duration: 240, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "none" });
            }
          } else {
            underline.style.left = `${el.offsetLeft}px`;
            underline.style.width = `${el.offsetWidth}px`;
          }
          lastActive = p;
        }
      } else {
        el.removeAttribute("aria-current");
        el.style.color = "var(--ink)";
        el.style.fontWeight = "400";
      }
    }
  });

  const announcements = h("div", { role: "status", "aria-live": "polite", "aria-label": "Announcements", class: "announcements" });
  announcements.style.position = "fixed";
  announcements.style.top = "108px";
  announcements.style.left = "0";
  announcements.style.right = "0";
  announcements.style.height = "26px";
  announcements.style.zIndex = "37";
  announcements.style.background = "var(--wash)";
  announcements.style.borderBottom = "1px solid var(--hairline)";
  announcements.style.display = "flex";
  announcements.style.alignItems = "center";
  announcements.style.fontSize = "13px";
  announcements.style.color = "var(--ink-2)";
  announcements.style.padding = "0 14px";
  announcements.style.whiteSpace = "nowrap";
  announcements.style.overflow = "hidden";
  announcements.style.textOverflow = "ellipsis";
  const annText = h("span", {});
  announcements.append(annText);

  const noticeEl = h("div", { class: "notice" });
  noticeEl.style.position = "fixed";
  noticeEl.style.top = "134px";
  noticeEl.style.left = "0";
  noticeEl.style.right = "0";
  noticeEl.style.zIndex = "36";
  noticeEl.style.background = "var(--healthy)";
  noticeEl.style.color = "#fff";
  noticeEl.style.fontSize = "13px";
  noticeEl.style.padding = "6px 14px";
  noticeEl.style.display = "none";
  const noticeSpan = h("span", {});
  noticeEl.append(noticeSpan);

  main.append(view);
  const footer = h("footer", { role: "contentinfo", class: "workspace-footer" });
  footer.style.background = "var(--footer)";
  footer.style.color = "var(--footer-ink)";
  footer.style.padding = "18px 14px";
  footer.style.display = "flex";
  footer.style.alignItems = "center";
  footer.style.justifyContent = "space-between";
  const footerBrand = h("span", { class: "mono" }, "Spoorline");
  const rulesLink = h("a", { href: "/rules" }, "Published rules");
  rulesLink.style.color = "var(--footer-ink)";
  rulesLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/rules");
  });
  footer.append(footerBrand, rulesLink);

  root.replaceChildren(ingest, header, tabs, announcements, noticeEl, main, footer);

  // Account dialog wiring is provided by the caller.
  effect(() => {
    const t = serverNow();
    text(serverTimeEl as HTMLElement, `Server time ${displayTime(t)}`);
  });
}

/** The load-failed alert with Retry. */
export function loadFailedAlert(message: string, onRetry: () => void): HTMLElement {
  const box = h("div", { class: "error-box", role: "alert" });
  const label = h("div", {}, message);
  const retry = h("button", { class: "btn" }, "Retry");
  retry.addEventListener("click", onRetry);
  box.append(label, retry);
  return box;
}

/** The empty state band with one line and one action. */
export function emptyBand(line: string, action: HTMLElement): HTMLElement {
  const band = h("div", { class: "empty-band", role: "region", "aria-label": "Empty" });
  band.append(h("div", {}, line), action);
  return band;
}

/** A form error alert listing field errors as links. */
export function formError(fields: Record<string, string> | undefined, message: string): HTMLElement {
  const box = h("div", { class: "error-box", role: "alert", "aria-label": "Error" });
  box.append(h("div", {}, message));
  if (fields) {
    for (const [field, msg] of Object.entries(fields)) {
      const link = h("a", { href: "#" }, msg);
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.querySelector(`[name="${field}"]`) as HTMLElement | null;
        if (target) target.focus();
      });
      box.append(h("div", {}, link));
    }
  }
  return box;
}

/** The standard error alert used by named places. */
export function namedAlert(label: string, message: string, extra?: HTMLElement): HTMLElement {
  const box = h("div", { class: "error-box", role: "alert", "aria-label": label });
  box.append(h("div", {}, message));
  if (extra) box.append(extra);
  return box;
}
