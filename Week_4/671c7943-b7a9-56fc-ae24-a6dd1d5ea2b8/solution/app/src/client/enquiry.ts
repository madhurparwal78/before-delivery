import { BUDGET_NAMES, FORM_COPY, PROJECT_TYPE_NAMES, STATUS } from "../shared/copy.js";
import { characterCount, checkEnquiry, firstName, formatNumber, trimmedValues } from "../shared/rules.js";
import type { BudgetId, EnquiryAnswer, EnquiryErrors, EnquiryField, EnquiryValues, ProjectTypeId } from "../shared/types.js";
import { announce, must, newSubmissionId } from "./dom.js";

const FIELD_ORDER: EnquiryField[] = ["name", "email", "project_type", "budget", "description"];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function controlOf(form: HTMLFormElement, field: EnquiryField): HTMLElement {
  if (field === "project_type") return must<HTMLElement>(form, '[role="radiogroup"]');
  return must<HTMLElement>(form, `[name="${field}"]`);
}

function focusTarget(form: HTMLFormElement, field: EnquiryField): HTMLElement {
  return field === "project_type" ? must<HTMLElement>(form, 'input[name="project_type"]') : controlOf(form, field);
}

function readValues(form: HTMLFormElement): EnquiryValues {
  const data = new FormData(form);
  return trimmedValues(Object.fromEntries(data.entries()));
}

function showErrors(form: HTMLFormElement, alerts: HTMLElement, errors: EnquiryErrors): void {
  for (const field of FIELD_ORDER) {
    const control = controlOf(form, field);
    const message = must<HTMLElement>(form, `#field-${field}-error`);
    const text = errors[field];
    if (text === undefined) {
      control.removeAttribute("aria-invalid");
      message.hidden = true;
      message.textContent = "";
    } else {
      control.setAttribute("aria-invalid", "true");
      message.hidden = false;
      message.textContent = text;
    }
  }
  const failed = FIELD_ORDER.filter((field) => errors[field] !== undefined);
  if (failed.length === 0) {
    alerts.replaceChildren();
    return;
  }
  const box = element("div", "error-box");
  box.tabIndex = -1;
  const heading = element("h3", "", FORM_COPY.errorHeading);
  const list = element("ul", "");
  for (const field of failed) {
    const entry = element("li", "");
    const link = element("a", "", errors[field]);
    link.href = `#field-${field}`;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      focusTarget(form, field).focus();
    });
    entry.append(link);
    list.append(entry);
  }
  box.append(heading, list);
  alerts.replaceChildren(box);
  box.focus();
}

function alertBox(text: string): HTMLElement {
  const box = element("div", "alert");
  box.setAttribute("role", "alert");
  box.append(element("p", "", text));
  return box;
}

function thanksPanel(values: EnquiryValues, answer: EnquiryAnswer, onAnother: () => void): HTMLElement {
  const panel = element("div", "thanks");
  const heading = element("h3", "", FORM_COPY.thanksHeading(firstName(values.name)));
  heading.tabIndex = -1;
  panel.append(heading);
  if (answer.mail === "not_sent") panel.append(alertBox(FORM_COPY.delayAlert(answer.reference)));
  panel.append(element("p", "", FORM_COPY.thanksLine(answer.reference)));
  const group = element("div", "");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", FORM_COPY.listLabel);
  const list = element("dl", "");
  const typeName = PROJECT_TYPE_NAMES[values.project_type as ProjectTypeId];
  const budgetName = BUDGET_NAMES[values.budget as BudgetId];
  const terms = FORM_COPY.listTerms;
  const rows: [string, string][] = [
    [terms.reference, answer.reference],
    [terms.name, values.name],
    [terms.email, values.email],
    [terms.projectType, typeName],
    [terms.budget, budgetName],
    [terms.description, values.description],
  ];
  for (const [term, value] of rows) {
    const row = element("div", "");
    const detail = element("dd", "");
    value.split("\n").forEach((line, position) => {
      if (position > 0) detail.append(document.createElement("br"));
      detail.append(document.createTextNode(line));
    });
    row.append(element("dt", "", term), detail);
    list.append(row);
  }
  group.append(list);
  const actions = element("div", "actions");
  const download = element("a", "text-link", FORM_COPY.download);
  download.href = answer.brief_url;
  const another = element("button", "", FORM_COPY.another);
  another.type = "button";
  another.addEventListener("click", onAnother);
  actions.append(download, another);
  panel.append(group, actions);
  return panel;
}

/** The enquiry form: published checks, one request per submission id, and the thank-you panel. */
export function initEnquiry(container: HTMLElement): void {
  const alerts = must<HTMLElement>(container, "[data-alerts]");
  const studioEmail = container.dataset["studioEmail"] ?? "";
  const blank = must<HTMLFormElement>(container, "form").cloneNode(true) as HTMLFormElement;
  let submissionId = newSubmissionId();
  let pending = false;

  const bind = (form: HTMLFormElement): void => {
    const description = must<HTMLTextAreaElement>(form, "#field-description");
    const counter = must<HTMLElement>(form, "#field-description-count");
    description.addEventListener("input", () => {
      counter.textContent = FORM_COPY.counter(formatNumber(characterCount(description.value)));
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submit(form);
    });
  };

  const submit = async (form: HTMLFormElement): Promise<void> => {
    if (pending) return;
    const values = readValues(form);
    const errors = checkEnquiry(values);
    showErrors(form, alerts, errors);
    if (Object.keys(errors).length > 0) return;
    const send = must<HTMLElement>(form, "[data-send]");
    pending = true;
    send.setAttribute("aria-disabled", "true");
    announce(STATUS.sending);
    try {
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: submissionId, ...values }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { fields: EnquiryErrors };
        announce("");
        showErrors(form, alerts, body.fields);
      } else if (response.ok) {
        const answer = (await response.json()) as EnquiryAnswer;
        const panel = thanksPanel(values, answer, again);
        alerts.replaceChildren();
        form.replaceWith(panel);
        must<HTMLElement>(panel, "h3").focus();
        announce(answer.mail === "sent" ? STATUS.sent(answer.reference) : STATUS.saved(answer.reference));
      } else {
        throw new Error(String(response.status));
      }
    } catch {
      announce("");
      alerts.replaceChildren(alertBox(FORM_COPY.notSaved(studioEmail)));
    } finally {
      pending = false;
      send.removeAttribute("aria-disabled");
    }
  };

  const again = (): void => {
    const fresh = blank.cloneNode(true) as HTMLFormElement;
    submissionId = newSubmissionId();
    must<HTMLElement>(container, ".thanks").replaceWith(fresh);
    bind(fresh);
    must<HTMLElement>(fresh, "#field-name").focus();
    announce("");
  };

  bind(must<HTMLFormElement>(container, "form"));
}
