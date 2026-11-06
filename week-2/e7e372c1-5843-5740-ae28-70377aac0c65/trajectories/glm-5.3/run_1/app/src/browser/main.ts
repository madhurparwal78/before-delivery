// The browser entry point: injects the styles, clones the page template for
// the current route and mounts the right controller on it.

import { css } from "./styles.js";
import { mountBoard } from "./board.js";
import { mountCitation } from "./citation.js";
import { handleSignIn, mountEditor, mountOperator, mountRestatementList } from "./staff.js";
import { apiJson, FIGURE_LABELS, type StaffUser } from "./app.js";

type PageName = "board" | "citation" | "sign-in" | "restatement-list" | "editor" | "operator";

function routeFor(path: string): { page: PageName; params: string[] } {
  if (path === "/") return { page: "board", params: [] };
  if (path.startsWith("/cite/")) {
    return { page: "citation", params: [decodeURIComponent(path.split("/")[2] ?? ""), decodeURIComponent(path.split("/")[3] ?? "")] };
  }
  if (path === "/staff") return { page: "sign-in", params: [] };
  if (path === "/staff/restatements") return { page: "restatement-list", params: [] };
  if (path.startsWith("/staff/restatements/")) return { page: "editor", params: [path.split("/")[3] ?? ""] };
  if (path === "/operator") return { page: "operator", params: [] };
  return { page: "board", params: [] };
}

async function main(): Promise<void> {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const { page, params } = routeFor(window.location.pathname);
  const root = document.getElementById("app-root");
  if (!root) return;

  // Staff pages need the signed-in user's roles to render the right actions.
  if (page !== "board" && page !== "citation") {
    try {
      const session = await apiJson<{ user: StaffUser }>("GET", "/api/session");
      document.documentElement.dataset.staffUser = JSON.stringify(session.user);
    } catch {
      delete document.documentElement.dataset.staffUser;
      if (page !== "sign-in") {
        window.location.href = "/staff";
        return;
      }
    }
  }

  const template = document.querySelector<HTMLTemplateElement>(`template[data-page="${page}"]`);
  if (!template) return;
  root.replaceChildren(template.content.cloneNode(true));
  const main = root.firstElementChild instanceof HTMLElement ? root : root;
  void main;

  if (page === "board") {
    mountBoard(root);
    return;
  }

  if (page === "citation") {
    const figure = params[0] ?? "";
    const date = params[1] ?? "";
    const heading = root.querySelector<HTMLElement>("[data-citation-heading]");
    if (heading) heading.textContent = FIGURE_LABELS[figure] ? `${FIGURE_LABELS[figure]} as of the end of ${date}` : "";
    mountCitation(root, figure, date);
    return;
  }

  if (page === "sign-in") {
    const signedIn = document.documentElement.dataset.staffUser !== undefined;
    if (signedIn) {
      window.location.href = "/staff/restatements";
      return;
    }
    const form = root.querySelector<HTMLFormElement>("[data-signin-form]");
    if (form) {
      void handleSignIn(form, () => {
        window.location.href = "/staff/restatements";
      });
    }
    return;
  }

  if (page === "restatement-list") {
    mountRestatementList(root, (id) => {
      window.location.href = `/staff/restatements/${id}`;
    });
    return;
  }

  if (page === "editor") {
    const id = params[0] ?? "";
    const addEvent = root.querySelector<HTMLButtonElement>("[data-action='add-event']");
    addEvent?.addEventListener("click", () => {
      const events = root.querySelector<HTMLElement>("[data-events]");
      if (!events) return;
      const row = document.createElement("div");
      row.className = "event-row";
      const kind = document.createElement("select");
      kind.setAttribute("aria-label", "Event type");
      kind.dataset.eventKind = "1";
      for (const pair of [
        ["atm_settlement", "ATM settlement"],
        ["warrant_exercise", "Warrant exercise"],
        ["buyback", "Buyback"],
      ] as const) {
        const option = document.createElement("option");
        option.value = pair[0];
        option.textContent = pair[1];
        kind.appendChild(option);
      }
      row.appendChild(kind);
      const shares = document.createElement("input");
      shares.setAttribute("aria-label", "Shares");
      shares.dataset.eventShares = "1";
      shares.className = "num";
      row.appendChild(shares);
      const dateInput = document.createElement("input");
      dateInput.setAttribute("aria-label", "Effective date");
      dateInput.dataset.eventDate = "1";
      dateInput.placeholder = "YYYY-MM-DD";
      row.appendChild(dateInput);
      const remove = document.createElement("button");
      remove.textContent = "Remove event";
      remove.dataset.removeEvent = "1";
      remove.addEventListener("click", () => row.remove());
      row.appendChild(remove);
      events.appendChild(row);
    });
    mountEditor(root, id);
    return;
  }

  if (page === "operator") {
    mountOperator(root);
    return;
  }
}

void main();
