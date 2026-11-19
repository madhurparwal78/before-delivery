import { announce } from "./util.js";
import { newSubmissionId, firstName, escapeText } from "./submission.js";

interface EnquiryValues {
  name: string;
  email: string;
  project_type: string;
  budget: string;
  description: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  nameEmpty: "Enter your name.",
  nameLength: "Name must be 2 to 80 characters.",
  emailEmpty: "Enter your email address.",
  emailForm: "Enter an email address like name@company.com.",
  projectType: "Choose a project type.",
  budget: "Choose a budget range.",
  descriptionEmpty: "Describe your project.",
  descriptionLength: "Description must be 40 to 2,000 characters.",
} as const;

const TYPE_NAMES: Record<string, string> = {
  "brand-identity": "Brand Identity",
  "website-design": "Website Design",
  "digital-product-design": "Digital Product Design",
  "not-sure": "Not sure yet",
};

const BUDGET_NAMES: Record<string, string> = {
  "under-10k": "Under €10,000",
  "10k-25k": "€10,000 to €25,000",
  "25k-50k": "€25,000 to €50,000",
  "over-50k": "Over €50,000",
};

const FIELD_ORDER: { key: keyof EnquiryValues; id: string }[] = [
  { key: "name", id: "name" },
  { key: "email", id: "email" },
  { key: "project_type", id: "project_type" },
  { key: "budget", id: "budget" },
  { key: "description", id: "description" },
];

function check(values: EnquiryValues): Partial<Record<keyof EnquiryValues, string>> {
  const errors: Partial<Record<keyof EnquiryValues, string>> = {};
  if (values.name.length < 2 || values.name.length > 80) {
    errors.name = values.name.length === 0 ? MESSAGES.nameEmpty : MESSAGES.nameLength;
  }
  if (values.email.length === 0) {
    errors.email = MESSAGES.emailEmpty;
  } else if (values.email.length > 254 || !EMAIL_RE.test(values.email)) {
    errors.email = MESSAGES.emailForm;
  }
  if (!values.project_type) errors.project_type = MESSAGES.projectType;
  if (!values.budget) errors.budget = MESSAGES.budget;
  if (values.description.length < 40 || values.description.length > 2000) {
    errors.description = values.description.length === 0 ? MESSAGES.descriptionEmpty : MESSAGES.descriptionLength;
  }
  return errors;
}

export function initEnquiryForm(): void {
  const container = document.getElementById("enquiry-container");
  if (!container) return;
  const formTemplate = container.innerHTML;
  let submissionId = newSubmissionId();

  const counter = container.querySelector<HTMLElement>("[data-counter]");
  const description = container.querySelector<HTMLTextAreaElement>("#description");

  const updateCounter = () => {
    if (!counter || !description) return;
    const length = Array.from(description.value).length;
    counter.textContent = `${length.toLocaleString("en-US")} of 2,000 characters`;
  };

  description?.addEventListener("input", updateCounter);
  updateCounter();

  container.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const sendButton = form.querySelector<HTMLButtonElement>(".send-button");
    if (!sendButton) return;
    if (sendButton.getAttribute("aria-disabled") === "true") return;

    const nameField = form.querySelector<HTMLInputElement>("#name");
    const emailField = form.querySelector<HTMLInputElement>("#email");
    const checkedType = form.querySelector<HTMLInputElement>('input[name="project_type"]:checked');
    const budgetField = form.querySelector<HTMLSelectElement>("#budget");
    const descriptionField = form.querySelector<HTMLTextAreaElement>("#description");
    if (!nameField || !emailField || !budgetField || !descriptionField) return;

    const values: EnquiryValues = {
      name: nameField.value.trim(),
      email: emailField.value.trim(),
      project_type: checkedType ? checkedType.value : "",
      budget: budgetField.value,
      description: descriptionField.value.trim(),
    };
    const errors = check(values);

    const errorBox = form.querySelector<HTMLElement>(".error-box");
    const errorList = form.querySelector<HTMLElement>(".error-list");
    const alertBox = form.querySelector<HTMLElement>(".form-alert");
    if (!errorBox || !errorList || !alertBox) return;

    form.querySelectorAll<HTMLElement>(".field-error").forEach((element) => {
      element.textContent = "";
    });
    [nameField, emailField, budgetField, descriptionField].forEach((field) => field.removeAttribute("aria-invalid"));
    form.querySelector<HTMLElement>('[data-fieldset="project_type"]')?.removeAttribute("aria-invalid");

    const failed = FIELD_ORDER.filter((field) => errors[field.key]);

    if (failed.length > 0) {
      errorList.innerHTML = "";
      for (const field of failed) {
        const message = errors[field.key] ?? "";
        const link = document.createElement("a");
        link.href = `#${field.id}`;
        link.textContent = message;
        link.addEventListener("click", (clickEvent) => {
          clickEvent.preventDefault();
          if (field.key === "project_type") {
            form.querySelector<HTMLInputElement>('input[name="project_type"]')?.focus();
          } else {
            document.getElementById(field.id)?.focus();
          }
        });
        const item = document.createElement("li");
        item.appendChild(link);
        errorList.appendChild(item);
        const errorSpan = form.querySelector<HTMLElement>(`[data-error-for="${field.key}"]`);
        if (errorSpan) errorSpan.textContent = message;
        if (field.key === "project_type") {
          form.querySelector<HTMLElement>('[data-fieldset="project_type"]')?.setAttribute("aria-invalid", "true");
        } else {
          document.getElementById(field.id)?.setAttribute("aria-invalid", "true");
        }
      }
      errorBox.hidden = false;
      errorBox.focus();
      return;
    }

    errorBox.hidden = true;
    alertBox.hidden = true;

    sendButton.setAttribute("aria-disabled", "true");
    announce("Sending your enquiry.");

    let ok = false;
    let reference = "";
    let briefUrl = "";
    let mail: "sent" | "not_sent" = "sent";
    try {
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: submissionId, ...values }),
      });
      if (response.ok) {
        const body = (await response.json()) as { reference: string; brief_url: string; mail: "sent" | "not_sent" };
        ok = true;
        reference = body.reference;
        briefUrl = body.brief_url;
        mail = body.mail;
      }
    } catch {
      ok = false;
    }

    sendButton.removeAttribute("aria-disabled");

    if (!ok) {
      alertBox.textContent = "We could not send your enquiry. Please try again, or email studio@sollis.example.";
      alertBox.hidden = false;
      const status = document.querySelector<HTMLElement>('[role="status"]');
      if (status) status.textContent = "";
      return;
    }

    const panel = document.createElement("div");
    panel.className = "thank-you";
    panel.innerHTML = `
      ${mail === "not_sent" ? `<div class="form-alert" role="alert">Your enquiry ${escapeText(reference)} is saved, but we could not send the confirmation email. Maren will still reply within two working days.</div>` : ""}
      <h3 class="thank-you-heading" tabindex="-1">Thank you, ${escapeText(firstName(values.name))}.</h3>
      <p>Your enquiry ${escapeText(reference)} is with Maren. She will reply within two working days.</p>
      <dl aria-label="Your enquiry">
        <div><dt>Reference</dt><dd>${escapeText(reference)}</dd></div>
        <div><dt>Name</dt><dd>${escapeText(values.name)}</dd></div>
        <div><dt>Email</dt><dd>${escapeText(values.email)}</dd></div>
        <div><dt>Project type</dt><dd>${escapeText(TYPE_NAMES[values.project_type] ?? "")}</dd></div>
        <div><dt>Budget range</dt><dd>${escapeText(BUDGET_NAMES[values.budget] ?? "")}</dd></div>
        <div><dt>Project description</dt><dd class="pre-wrap">${escapeText(values.description)}</dd></div>
      </dl>
      <p class="thank-you-links">
        <a href="${briefUrl}">Download your brief (PDF)</a>
        <button type="button" class="send-another">Send another enquiry</button>
      </p>
    `;
    container.innerHTML = "";
    container.appendChild(panel);
    panel.querySelector<HTMLElement>(".thank-you-heading")?.focus();
    announce(mail === "sent" ? `Enquiry ${reference} sent.` : `Enquiry ${reference} saved.`);

    panel.querySelector<HTMLButtonElement>(".send-another")?.addEventListener("click", () => {
      submissionId = newSubmissionId();
      container.innerHTML = formTemplate;
      initEnquiryForm();
      container.querySelector<HTMLInputElement>("#name")?.focus();
    });
  });
}
