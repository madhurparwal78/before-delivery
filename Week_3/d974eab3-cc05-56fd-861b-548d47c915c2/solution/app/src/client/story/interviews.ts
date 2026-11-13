import type { InterviewCategory, InterviewSummary } from "../../shared/content.js";
import { interviewHref } from "../../shared/titles.js";
import { announce } from "../announce.js";
import { portrait } from "../art/portrait.js";
import { INTERVIEWS_TITLE, PROFILE_NOTE } from "../copy.js";
import { h } from "../dom.js";
import { icon } from "../icons.js";
import { createRadioGroup } from "../radios.js";

type Filter = "all" | InterviewCategory;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "expert", label: "Experts" },
  { value: "everyday", label: "Everyday" },
];

const CATEGORY_LABEL: Record<InterviewCategory, string> = { expert: "Expert", everyday: "Everyday" };

function isFilter(value: string): value is Filter {
  return FILTERS.some((filter) => filter.value === value);
}

function interviewCard(interview: InterviewSummary): HTMLLIElement {
  return h("li", {},
    h("article", { class: "card" },
      portrait(interview.hue, interview.slug),
      h("div", { class: "card-body" },
        h("h3", {}, interview.name),
        h("p", { class: "role" }, interview.role),
        h("p", { class: "tag" }, CATEGORY_LABEL[interview.category]),
        h("p", { class: "lede" }, interview.lede),
        h("a", { class: "text-link", href: interviewHref(interview.slug) },
          "Read the interview", h("span", { class: "visually-hidden" }, ` with ${interview.name}`), icon("arrow")))));
}

/** The Interviews chapter: a filter and the list, in published order. */
export function createInterviews(interviews: InterviewSummary[], reveal: (heading: HTMLElement) => void): HTMLElement {
  const list = h("ul", { class: "interview-list", role: "list", "aria-label": "Interviews" });
  const show = (filter: Filter): number => {
    const shown = interviews.filter((interview) => filter === "all" || interview.category === filter);
    list.replaceChildren(...shown.map(interviewCard));
    return shown.length;
  };
  show("all");
  const group = createRadioGroup({
    label: "Show interviews",
    name: "interview-filter",
    className: "segmented",
    options: FILTERS,
    checked: "all",
    onChange(value) {
      if (!isFilter(value)) return;
      const count = show(value);
      announce(count === 1 ? "Showing 1 interview." : `Showing ${count} interviews.`);
    },
  });
  const title = h("h2", { id: "interviews-title", tabindex: "-1" }, INTERVIEWS_TITLE);
  reveal(title);
  return h("section", { "data-chapter": "interviews", class: "chapter chapter-interviews paper", "aria-labelledby": "interviews-title" },
    h("div", { class: "spread" },
      title,
      h("p", { class: "note" }, PROFILE_NOTE),
      group.element,
      list));
}
