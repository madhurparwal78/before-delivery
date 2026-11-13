// The client entry: font faces, sign-in screen, router and the shared shell.

import { el, icon } from "./dom.js";
import { Client, routes, landingRoute } from "./api.js";
import type { User } from "../shared/domain.js";
import { renderDeskScreen } from "./desk.js";
import { renderRentalsScreen } from "./rentals.js";
import { renderSectionScreen } from "./section.js";
import { renderFolderListScreen, renderFolderScreen } from "./folder.js";

const client = new Client();

function mountFonts(): void {
  const style = document.createElement("style");
  style.textContent = `
    @font-face { font-family: "Fraunces"; src: url("/fonts/Fraunces.ttf") format("truetype"); font-weight: 100 900; font-display: swap; }
    @font-face { font-family: "IBM Plex Sans"; src: url("/fonts/IBMPlexSans.ttf") format("truetype"); font-weight: 100 700; font-display: swap; }
    @font-face { font-family: "IBM Plex Mono"; src: url("/fonts/IBMPlexMono.ttf") format("truetype"); font-weight: 400; font-display: swap; }
  `;
  document.head.append(style);
}

// ------------------------------------------------------------------ sign in

function renderSignIn(root: HTMLElement): void {
  root.replaceChildren();
  const form = el("form", { class: "sign-in", "aria-label": "Sign in" });
  const title = el("h1", { class: "brand-title" }, "Quirewell Stand Desk");
  const alert = el("div", { class: "field-error", role: "alert" });
  const email = el("input", {
    type: "text", id: "email", autocomplete: "username", name: "email",
  }) as HTMLInputElement;
  const emailLabel = el("label", { for: "email" }, "Email");
  const passcode = el("input", {
    type: "password", id: "passcode", autocomplete: "current-password", name: "passcode",
  }) as HTMLInputElement;
  const passcodeLabel = el("label", { for: "passcode" }, "Passcode");
  const submit = el("button", { type: "submit", class: "primary" }, "Sign in");

  const emailField = el("div", { class: "field" }, emailLabel, email);
  const passcodeField = el("div", { class: "field" }, passcodeLabel, passcode);
  form.append(title, alert, emailField, passcodeField, submit);
  const wrap = el("div", { class: "sign-in-wrap" }, form);
  root.append(wrap);

  const submitOnce = async (): Promise<void> => {
    submit.textContent = "Signing in";
    submit.setAttribute("aria-disabled", "true");
    try {
      const user = await client.signIn(email.value.trim(), passcode.value);
      submit.textContent = "Sign in";
      submit.removeAttribute("aria-disabled");
      location.assign(landingRoute(user));
    } catch (error) {
      submit.textContent = "Sign in";
      submit.removeAttribute("aria-disabled");
      alert.textContent =
        (error as { body?: { message?: string } }).body?.message ??
        "That email and passcode don't match.";
      email.focus();
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitOnce();
  });
}

// ------------------------------------------------------------------- shell

export interface Shell {
  main: HTMLElement;
  banners: HTMLElement;
  storageUp: () => boolean;
  mailUp: () => boolean;
}

function renderShell(root: HTMLElement, user: User): Shell {
  root.replaceChildren();
  const shell = el("div", { class: "app-shell" });
  const nav = el("nav", { "aria-label": "Library" });
  const links: [string, string][] = [];
  if (user.role === "principal_librarian" || user.role === "assistant_librarian") {
    links.push(["Programme desk", routes.desk()], ["Rentals", routes.rentals]);
  }
  if (user.role === "section_principal") {
    links.push(["Section desk", routes.section], ["Folders", routes.folderList]);
  }
  if (user.role === "player") {
    links.push(["Folders", routes.folderList]);
  }
  for (const [label, href] of links) {
    nav.append(el("a", { href }, label));
  }
  const spacer = el("span", { class: "spacer" });
  const who = el("span", { class: "who" }, `${user.name}`);
  const signOut = el("button", {}, "Sign out");
  signOut.addEventListener("click", () => {
    void client.signOut().finally(() => location.assign("/"));
  });
  const brand = el("span", { class: "brand" }, "Quirewell Stand Desk");
  const topbar = el("div", { class: "topbar" }, brand, nav, spacer, who, signOut);

  const banners = el("div", { class: "banners" });
  const main = el("div", { class: "main" });
  shell.append(topbar, banners, main);
  root.append(shell);

  let storage = true;
  let mail = true;
  const refresh = (status: { storage: "up" | "down"; mail: "up" | "down" }): void => {
    storage = status.storage === "up";
    mail = status.mail === "up";
    const children: HTMLElement[] = [];
    if (!storage) {
      children.push(
        el("div", {
          class: "banner warn", role: "alert",
        },
        icon("triangle-alert"),
        "The score store is offline. Scans can't be uploaded or opened right now. Catalogue, counts and cuts still work.")
      );
    }
    const librarianScreens = user.role !== "player";
    if (!mail && librarianScreens) {
      children.push(
        el("div", {
          class: "banner warn", role: "alert",
        },
        icon("mail"),
        "Mail is offline. Notices are queued and will be sent when it's back.")
      );
    }
    banners.replaceChildren(...children);
  };
  client.readStatus().then((status) => {
    if (status) refresh(status);
  });

  return {
    main,
    banners,
    storageUp: () => storage,
    mailUp: () => mail,
  };
}

// ------------------------------------------------------------------ router

interface RouteMatch {
  screen: "desk" | "rentals" | "section" | "folder" | "folderList" | "signIn";
  programmeId?: string;
  partId?: string;
  workId?: string;
}

export function parseRoute(path: string, query: URLSearchParams): RouteMatch {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (parts.length === 0) return { screen: "signIn" };
  switch (parts[0]) {
    case "desk":
      return {
        screen: "desk",
        programmeId: parts[1],
        workId: query.get("work") ?? undefined,
      };
    case "rentals":
      return { screen: "rentals" };
    case "section":
      return { screen: "section" };
    case "folder":
      if (parts.length === 1) return { screen: "folderList" };
      return { screen: "folder", programmeId: parts[1], partId: parts[2] };
    default:
      return { screen: "signIn" };
  }
}

async function route(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  const match = parseRoute(location.pathname, new URLSearchParams(location.search));

  if (match.screen === "signIn") {
    renderSignIn(root);
    return;
  }
  const user = await client.readSession();
  if (!user) {
    location.replace("/");
    return;
  }

  const allowed: Record<RouteMatch["screen"], boolean> = {
    desk: user.role === "principal_librarian" || user.role === "assistant_librarian",
    rentals: user.role === "principal_librarian" || user.role === "assistant_librarian",
    section: user.role === "section_principal",
    folder: user.role === "player" || user.role === "section_principal",
    folderList: user.role === "player" || user.role === "section_principal",
    signIn: false,
  };
  if (!allowed[match.screen]) {
    location.replace(landingRoute(user));
    return;
  }

  const shell = renderShell(root, user);
  switch (match.screen) {
    case "desk":
      await renderDeskScreen(shell, client, user, match.programmeId, match.workId);
      break;
    case "rentals":
      await renderRentalsScreen(shell, client, user);
      break;
    case "section":
      await renderSectionScreen(shell, client, user);
      break;
    case "folderList":
      await renderFolderListScreen(shell, client, user);
      break;
    case "folder":
      await renderFolderScreen(shell, client, user, match.programmeId ?? "", match.partId);
      break;
  }
}

mountFonts();
void route();
