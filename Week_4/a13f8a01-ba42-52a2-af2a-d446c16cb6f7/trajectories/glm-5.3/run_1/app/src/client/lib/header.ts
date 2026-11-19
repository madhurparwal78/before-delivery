// The site header: one on every page except the embed.
import { el, link, button, navigate } from "./dom.js";
import { me, signOut } from "./session.js";

export function buildHeader(container: HTMLElement, options: { dark?: boolean } = {}): void {
  container.innerHTML = "";
  const header = el("header", { class: "site-header" });
  const wordmark = link("/", "ashlar", { "aria-label": "ashlar home" });
  wordmark.style.fontWeight = "300";
  wordmark.style.fontSize = "1.5em";
  wordmark.style.textDecoration = "none";
  header.appendChild(wordmark);
  header.appendChild(el("span", { class: "spacer" }));

  const wideNav = el("nav", { class: "header-links wide-only" });
  const menuButton = button("Menu", { class: "narrow-only", "aria-haspopup": "dialog" }, () => {
    const dialog = document.getElementById("menu-dialog");
    if (dialog instanceof HTMLDialogElement) {
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>("a, button");
      first?.focus();
    }
  });

  const signedIn = !!meSync();
  if (signedIn) {
    wideNav.appendChild(link("/dashboard", "Dashboard"));
    wideNav.appendChild(link("/explore", "Explore"));
    wideNav.appendChild(link("/collections", "Collections"));
    wideNav.appendChild(link("/shelf", "The shelf"));
    header.appendChild(wideNav);
    header.appendChild(button("Start a pen", { class: "primary" }, () => {
      void startPen();
    }));
    header.appendChild(button("Sign out", {}, () => {
      void signOut().then(() => navigate("/"));
    }));
  } else {
    wideNav.appendChild(link("/explore", "Explore"));
    wideNav.appendChild(link("/collections", "Collections", { "data-signed-out": "collections" }));
    wideNav.appendChild(link("/shelf", "The shelf"));
    wideNav.appendChild(link("/signin", "Sign in"));
    header.appendChild(wideNav);
    const start = link("/signup", "Start a pen", { class: "start-link primary-like" });
    start.style.background = "var(--accent)";
    start.style.color = "#fff";
    start.style.padding = "8px 16px";
    start.style.borderRadius = "0";
    start.style.textDecoration = "none";
    header.appendChild(start);
  }
  header.appendChild(menuButton);
  container.appendChild(header);

  // Wide/narrow visibility is CSS-driven.
  applyHeaderClass(header);

  const dialog = el("dialog", { id: "menu-dialog", "aria-label": "Menu" });
  const list = el("ul");
  const items: Array<[string, string]> = signedIn
    ? [["/dashboard", "Dashboard"], ["/explore", "Explore"], ["/collections", "Collections"], ["/shelf", "The shelf"]]
    : [["/explore", "Explore"], ["/collections", "Collections"], ["/shelf", "The shelf"], ["/signin", "Sign in"]];
  for (const [href, label] of items) {
    const li = el("li");
    li.appendChild(link(href, label));
    list.appendChild(li);
  }
  dialog.appendChild(list);
  const close = button("Close", {}, () => dialog.close());
  dialog.appendChild(close);
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dialog.close();
  });
  container.appendChild(dialog);
}

function applyHeaderClass(header: HTMLElement): void {
  const style = document.createElement("style");
  style.textContent = `
    .wide-only { display: flex; gap: 4px; }
    .narrow-only { display: none; }
    @media (max-width: 767.98px) {
      .wide-only { display: none; }
      .narrow-only { display: inline-block; }
    }
  `;
  if (!document.getElementById("header-responsive-style")) {
    style.id = "header-responsive-style";
    document.head.appendChild(style);
  }
}

let cachedUser: import("./api.js").User | null = null;
let cachedPromise: Promise<import("./api.js").User | null> | null = null;

export function meSync(): import("./api.js").User | null {
  return cachedUser;
}

export async function primeSession(): Promise<void> {
  if (!cachedPromise) {
    cachedPromise = me();
  }
  cachedUser = await cachedPromise;
}

async function startPen(): Promise<void> {
  const { Api } = await import("./api.js");
  const pen = await Api.post<{ id: string }>("/api/pens", {});
  navigate(`/pen/${pen.id}`);
}
