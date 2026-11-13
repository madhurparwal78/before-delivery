import type { InterviewDetail } from "../../shared/content.js";
import { PAGE_TITLES, interviewHref, interviewTitle } from "../../shared/titles.js";
import { ApiError, loadInterview } from "../api.js";
import { portrait } from "../art/portrait.js";
import { PROFILE_NOTE } from "../copy.js";
import { h } from "../dom.js";
import { contentAlert } from "./alerts.js";
import { notFound } from "./not-found.js";

function neighbourLink(label: string, link: { slug: string; name: string }): HTMLAnchorElement {
  return h("a", { class: "text-link", href: interviewHref(link.slug) }, h("span", { class: "nav-label" }, `${label}:`), " ", h("span", { class: "nav-name" }, link.name));
}

/** ArrowLeft opens the previous interview and ArrowRight the next one, whichever element has focus. */
function arrowKeys(detail: InterviewDetail, navigate: (path: string) => void, signal: AbortSignal): void {
  addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.key === "ArrowLeft" ? detail.previous : event.key === "ArrowRight" ? detail.next : null;
    if (target) navigate(interviewHref(target.slug));
  }, { signal });
}

/** An interview page, or the published page for an unknown interview. */
export async function renderInterview(
  main: HTMLElement, slug: string, navigate: (path: string) => void, setTitle: (title: string) => void, signal: AbortSignal,
): Promise<void> {
  let detail: InterviewDetail;
  try {
    detail = await loadInterview(slug);
  } catch (error) {
    if (signal.aborted) return;
    if (error instanceof ApiError && error.status === 404) {
      setTitle(PAGE_TITLES.notFound);
      main.replaceChildren(notFound(error.message, "All interviews", "/#interviews"));
    } else {
      main.replaceChildren(contentAlert());
    }
    return;
  }
  if (signal.aborted) return;
  setTitle(interviewTitle(detail.name));
  main.replaceChildren(h("article", { class: "page interview-page" },
    h("header", { class: "interview-head" },
      portrait(detail.hue, detail.slug),
      h("div", {},
        h("h1", { tabindex: "-1" }, detail.name),
        h("p", { class: "role" }, detail.role),
        h("p", { class: "lede" }, detail.lede))),
    h("div", { class: "answers" }, ...detail.answers.map((entry) => h("section", {}, h("h2", {}, entry.question), h("p", {}, entry.answer)))),
    h("p", { class: "note" }, PROFILE_NOTE),
    h("nav", { class: "interview-nav", "aria-label": "Interview pages" },
      detail.previous ? neighbourLink("Previous interview", detail.previous) : null,
      detail.next ? neighbourLink("Next interview", detail.next) : null),
    h("p", {}, h("a", { class: "text-link", href: "/#interviews" }, "All interviews"))));
  arrowKeys(detail, navigate, signal);
}
