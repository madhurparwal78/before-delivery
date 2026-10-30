/** The inspector page: one tenant's current documents, from a link, without an account. */

import type { InspectView } from "../../shared/api-types.js";
import { DOCUMENT_KIND_LABELS } from "../../shared/api-types.js";
import { ApiClientError, apiJson } from "../api.js";
import type { Feedback } from "../feedback.js";
import { clearActivity, showActivity } from "../feedback.js";

interface ScreenDeps {
  user: unknown;
  feedback: Feedback;
  navigate(path: string): void;
}

export async function renderInspect(root: HTMLElement, deps: ScreenDeps, token: string): Promise<void> {
  const wrap = document.createElement("div");
  wrap.className = "inspector-wrap";
  root.replaceChildren(wrap);

  showActivity(deps.feedback, "Loading documents…");
  let view: InspectView | null = null;
  let dead = false;
  try {
    view = await apiJson<InspectView>("GET", `/api/inspect/${encodeURIComponent(token)}`);
  } catch (e) {
    if (e instanceof ApiClientError && (e.detail.status === 410 || e.detail.status === 404)) {
      dead = true;
    }
  }
  clearActivity(deps.feedback);

  if (view === null) {
    const heading = document.createElement("h1");
    heading.textContent = "This inspection link is no longer valid";
    wrap.appendChild(heading);
    return;
  }

  const heading = document.createElement("h1");
  heading.textContent = view.business_name;
  const subheading = document.createElement("p");
  subheading.textContent = `Current documents at ${view.kitchen_name}`;
  const list = document.createElement("ul");
  list.className = "doc-list";
  list.setAttribute("aria-label", "Current documents");
  for (const doc of view.documents) {
    const li = document.createElement("li");
    const label =
      doc.kind === "food_handler_card"
        ? `Open ${DOCUMENT_KIND_LABELS[doc.kind]}, ${doc.holder_name ?? ""}`
        : `Open ${DOCUMENT_KIND_LABELS[doc.kind]}`;
    const link = document.createElement("a");
    link.href = doc.file_url;
    link.textContent = label;
    const expires = document.createElement("span");
    expires.className = "expiry-line";
    expires.textContent = doc.expires_on;
    li.append(link, expires);
    list.appendChild(li);
  }
  const expiry = document.createElement("p");
  expiry.className = "expiry-line";
  expiry.textContent = `This link expires ${view.expires_at.slice(0, 16).replace("T", " ")} kitchen time.`;
  wrap.append(heading, subheading, list, expiry);
}
