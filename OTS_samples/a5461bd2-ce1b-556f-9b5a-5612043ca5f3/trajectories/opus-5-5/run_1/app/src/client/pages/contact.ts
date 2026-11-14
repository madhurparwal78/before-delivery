import { moveFocus } from "../focus.js";
import type { MountedPage, PageContext } from "../router.js";
import {
  counterText,
  emptyAnswers,
  esc,
  renderEnquiryForm,
  renderEnquirySent,
  type EnquiryAnswers,
  type EnquiryStep,
} from "../../shared/render.js";
import { parseContactQuery } from "../../shared/routes.js";
import { validateEnquiry, type EnquiryErrors, type EnquiryField } from "../../shared/rules.js";

const DRAFT_KEY = "vellum-orbit:enquiry";

const stepFields: Record<EnquiryStep, EnquiryField[]> = {
  1: ["name", "email", "business_name"],
  2: ["service", "description", "item"],
  3: ["budget"],
  4: [],
};

const fieldIds: Partial<Record<EnquiryField, string>> = {
  name: "f-name",
  email: "f-email",
  business_name: "f-business",
  service: "f-service",
  description: "f-description",
  budget: "f-budget",
};

interface Draft {
  answers: EnquiryAnswers;
  step: EnquiryStep;
  submissionId: string | null;
}

function newSubmissionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadDraft(): Draft {
  const stored = sessionStorage.getItem(DRAFT_KEY);
  if (stored === null) return { answers: emptyAnswers(), step: 1, submissionId: null };
  return JSON.parse(stored) as Draft;
}

const INTAKE_FAILURE =
  "We could not hand your enquiry to the studio's intake service. Your answers are kept. Try again in a moment.";

export function mountContact({ bootstrap, main, url }: PageContext): MountedPage {
  const { content, settings } = bootstrap;
  const body = main.querySelector<HTMLElement>(".enquiry-body");
  const status = main.querySelector<HTMLElement>(".enquiry-status");
  if (body === null || status === null) throw new Error("Enquiry markup missing");

  const draft = loadDraft();
  const prefill = parseContactQuery(url.searchParams, content);
  if (prefill.service !== null) {
    if (prefill.service !== draft.answers.service || prefill.item !== null) draft.answers.item = prefill.item;
    draft.answers.service = prefill.service;
  }
  if (draft.step === 4) draft.submissionId ??= newSubmissionId();
  let sending = false;

  const save = (): void => sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

  const render = (errors: EnquiryErrors): void => {
    body.innerHTML = renderEnquiryForm(content, draft.step, draft.answers, errors);
    save();
  };

  const heading = (): HTMLElement | null => body.querySelector<HTMLElement>(".step-heading, .enquiry-sent h2");

  const goTo = (step: EnquiryStep): void => {
    if (step === 4 && draft.step !== 4) draft.submissionId = newSubmissionId();
    if (step !== 4) draft.submissionId = null;
    draft.step = step;
    render({});
    moveFocus(heading());
  };

  const fieldElement = (field: EnquiryField): HTMLElement | null => {
    const id = fieldIds[field];
    if (id === undefined) return null;
    const el = body.querySelector<HTMLElement>(`#${id}`);
    if (el?.getAttribute("role") === "radiogroup") return el.querySelector<HTMLElement>('input[type="radio"]');
    return el;
  };

  const showErrors = (step: EnquiryStep, errors: EnquiryErrors): void => {
    draft.step = step;
    render(errors);
    const first = stepFields[step].find((field) => errors[field] !== undefined);
    moveFocus(first === undefined ? heading() : fieldElement(first));
  };

  const clearErrorIfValid = (field: EnquiryField): void => {
    const id = fieldIds[field];
    if (id === undefined) return;
    const el = body.querySelector<HTMLElement>(`#${id}`);
    if (el === null || el.getAttribute("aria-invalid") !== "true") return;
    if (validateEnquiry(draft.answers as unknown as Record<string, unknown>, content, [field])[field] !== undefined) return;
    el.removeAttribute("aria-invalid");
    body.querySelector(`#${id}-error`)?.remove();
    const describedBy = (el.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((token) => token !== "" && token !== `${id}-error`);
    if (describedBy.length > 0) el.setAttribute("aria-describedby", describedBy.join(" "));
    else el.removeAttribute("aria-describedby");
  };

  const feedback = (): HTMLElement | null => body.querySelector<HTMLElement>(".send-feedback");
  const sendButton = (): HTMLButtonElement | null => body.querySelector<HTMLButtonElement>(".send-enquiry");

  const setPending = (pending: boolean): void => {
    sending = pending;
    const button = sendButton();
    if (button !== null) {
      button.disabled = pending;
      button.textContent = pending ? "Sending…" : "Send enquiry";
    }
    const retry = body.querySelector<HTMLButtonElement>(".try-again");
    if (retry !== null) retry.disabled = pending;
    status.textContent = pending ? "Sending your enquiry…" : "";
  };

  const showAlert = (text: string, withRetry: boolean): void => {
    const region = feedback();
    if (region === null) return;
    region.innerHTML = `<div role="alert" class="alert" tabindex="-1">${esc(text)}</div>${
      withRetry ? `<button type="button" class="button primary try-again">Try again</button>` : ""
    }`;
    moveFocus(region.querySelector<HTMLElement>(withRetry ? ".try-again" : ".alert"));
  };

  const send = async (): Promise<void> => {
    if (sending || draft.submissionId === null) return;
    setPending(true);
    let response: Response | null = null;
    let payload: Record<string, unknown> = {};
    try {
      response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft.answers, submission_id: draft.submissionId }),
      });
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      response = null;
    }
    setPending(false);
    if (response?.status === 201) {
      sessionStorage.removeItem(DRAFT_KEY);
      body.innerHTML = renderEnquirySent(draft.answers.name, String(payload.reference), String(payload.intake_reference));
      moveFocus(heading());
    } else if (response?.status === 429) {
      const minutes = Math.ceil(Number(payload.retry_after_seconds) / 60);
      showAlert(
        `You have sent ${settings.enquiryLimit} enquiries from this email address in the last ${
          settings.enquiryWindowSeconds / 60
        } minutes. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
        false,
      );
    } else if (response?.status === 422) {
      const errors = (payload.errors ?? {}) as EnquiryErrors;
      const step = ([1, 2, 3] as const).find((s) => stepFields[s].some((field) => errors[field] !== undefined)) ?? 4;
      showErrors(step, errors);
    } else {
      showAlert(INTAKE_FAILURE, true);
    }
  };

  const next = (): void => {
    const step = draft.step;
    if (step === 4) {
      void send();
      return;
    }
    const errors = validateEnquiry(draft.answers as unknown as Record<string, unknown>, content, stepFields[step]);
    if (Object.keys(errors).length > 0) showErrors(step, errors);
    else goTo((step + 1) as EnquiryStep);
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  body.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      next();
    },
    { signal },
  );
  body.addEventListener(
    "input",
    (event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || field.type === "radio") return;
      const name = field.name as "name" | "email" | "business_name" | "description";
      draft.answers[name] = field.value;
      if (name === "description") {
        const counter = body.querySelector("#f-description-counter");
        if (counter !== null) counter.textContent = counterText(field.value);
      }
      clearErrorIfValid(name);
      save();
    },
    { signal },
  );
  body.addEventListener(
    "change",
    (event) => {
      const radio = event.target;
      if (!(radio instanceof HTMLInputElement) || radio.type !== "radio") return;
      if (radio.name === "service") {
        if (radio.value !== draft.answers.service) {
          draft.answers.item = null;
          body.querySelector(".attached-item")?.remove();
        }
        draft.answers.service = radio.value;
        clearErrorIfValid("service");
      } else {
        draft.answers.budget = radio.value;
        clearErrorIfValid("budget");
      }
      save();
    },
    { signal },
  );
  body.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("button");
      if (button === null) return;
      if (button.classList.contains("step-back")) goTo((draft.step - 1) as EnquiryStep);
      else if (button.classList.contains("edit-step")) goTo(Number(button.dataset.step) as EnquiryStep);
      else if (button.classList.contains("try-again")) void send();
      else if (button.classList.contains("remove-item")) {
        draft.answers.item = null;
        if (draft.step === 4) {
          render({});
          moveFocus(heading());
        } else {
          button.closest(".attached-item")?.remove();
          save();
          moveFocus(body.querySelector<HTMLElement>('input[name="service"]:checked'));
        }
      } else if (button.classList.contains("start-another")) {
        draft.answers = emptyAnswers();
        draft.submissionId = null;
        goTo(1);
      }
    },
    { signal },
  );

  render({});
  return { unmount: () => listeners.abort() };
}
