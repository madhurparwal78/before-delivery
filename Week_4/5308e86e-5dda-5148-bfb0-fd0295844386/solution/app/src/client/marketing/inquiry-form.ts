/** The contact page's inquiry form: live counter, field-by-field messages and one request per send. */
import { announce } from "../shared/announce";
import { INQUIRY_MESSAGE_MAX } from "../../shared/rules";
import { requireElement } from "./dom";
import {
  BODY_TOO_LARGE_COPY,
  codePointCount,
  fieldProblem,
  INQUIRY_FIELDS,
  RATE_LIMITED_COPY,
  refusedCopy,
  SERVER_ERROR_COPY,
  THANKS_COPY,
  UNREACHABLE_COPY,
  type InquiryField,
} from "./inquiry-rules";

const ENDPOINT = "/api/inquiries";
const PENDING_COPY = "Sending…";

type Controls = Record<InquiryField, HTMLInputElement | HTMLTextAreaElement>;

interface ValidationBody {
  error?: string;
  fields?: Record<string, string>;
}

export function initInquiryForm(): void {
  const form = document.querySelector<HTMLFormElement>("[data-inquiry-form]");
  if (!form) return;

  const controls = Object.fromEntries(
    INQUIRY_FIELDS.map((field) => [field, requireElement<HTMLInputElement | HTMLTextAreaElement>(form, `[name="${field}"]`)]),
  ) as Controls;
  const errorSlots = Object.fromEntries(
    INQUIRY_FIELDS.map((field) => [field, requireElement<HTMLElement>(form, `[data-error-for="${field}"]`)]),
  ) as Record<InquiryField, HTMLElement>;
  const honeypot = requireElement<HTMLInputElement>(form, '[name="website"]');
  const counter = requireElement<HTMLElement>(form, "[data-inquiry-count]");
  const formMessage = requireElement<HTMLElement>(form, "[data-form-message]");
  const submit = requireElement<HTMLButtonElement>(form, "[data-inquiry-submit]");
  const sendLabel = submit.textContent ?? "";
  let pending = false;

  const showFieldError = (field: InquiryField, message: string): void => {
    const control = controls[field];
    const slot = errorSlots[field];
    slot.textContent = message;
    slot.hidden = false;
    control.setAttribute("aria-invalid", "true");
    const describedBy = field === "message" ? `${counter.id} ${slot.id}` : slot.id;
    control.setAttribute("aria-describedby", describedBy);
  };

  const clearFieldErrors = (): void => {
    for (const field of INQUIRY_FIELDS) {
      errorSlots[field].hidden = true;
      errorSlots[field].textContent = "";
      controls[field].removeAttribute("aria-invalid");
      if (field === "message") controls[field].setAttribute("aria-describedby", counter.id);
      else controls[field].removeAttribute("aria-describedby");
    }
  };

  const showFormMessage = (message: string, tone: "thanks" | "problem"): void => {
    formMessage.textContent = message;
    formMessage.dataset.tone = tone;
    formMessage.hidden = false;
  };

  const setPending = (value: boolean): void => {
    pending = value;
    submit.disabled = value;
    submit.textContent = value ? PENDING_COPY : sendLabel;
    if (value) submit.insertAdjacentHTML("afterbegin", '<span class="spinner" aria-hidden="true"></span>');
  };

  const refuse = (messages: Partial<Record<InquiryField, string>>): void => {
    const fields = INQUIRY_FIELDS.filter((field) => messages[field]);
    for (const field of fields) showFieldError(field, messages[field] ?? "");
    controls[fields[0] ?? "email"].focus();
    announce(fields.map((field) => messages[field]).join(". "));
  };

  const refuseWholeForm = (message: string): void => {
    showFormMessage(message, "problem");
    announce(message);
  };

  const updateCounter = (): void => {
    counter.textContent = `${codePointCount(controls.message.value)} / ${INQUIRY_MESSAGE_MAX}`;
  };
  controls.message.addEventListener("input", updateCounter);

  const send = async (): Promise<void> => {
    const body = {
      ...Object.fromEntries(INQUIRY_FIELDS.map((field) => [field, controls[field].value])),
      source: "contact",
      website: honeypot.value,
    };
    let response: Response;
    try {
      response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      refuseWholeForm(UNREACHABLE_COPY);
      return;
    }
    if (response.status === 201) {
      controls.message.value = "";
      updateCounter();
      showFormMessage(THANKS_COPY, "thanks");
      announce(THANKS_COPY);
    } else if (response.status === 429) {
      refuseWholeForm(RATE_LIMITED_COPY);
    } else if (response.status === 413) {
      refuseWholeForm(BODY_TOO_LARGE_COPY);
    } else if (response.status === 503) {
      refuseWholeForm(UNREACHABLE_COPY);
    } else {
      await refuseFromAnswer(response);
    }
  };

  /** A validation answer names the failing fields; anything else is a server error. */
  const refuseFromAnswer = async (response: Response): Promise<void> => {
    const refused = (await response.json().catch(() => ({}))) as ValidationBody;
    const messages: Partial<Record<InquiryField, string>> = {};
    if (refused.error === "validation") {
      for (const field of INQUIRY_FIELDS) {
        if (refused.fields && field in refused.fields) messages[field] = refusedCopy(field, controls[field].value);
      }
    }
    if (Object.keys(messages).length > 0) refuse(messages);
    else refuseWholeForm(SERVER_ERROR_COPY);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pending) return;
    clearFieldErrors();
    formMessage.hidden = true;
    const messages: Partial<Record<InquiryField, string>> = {};
    for (const field of INQUIRY_FIELDS) {
      const problem = fieldProblem(field, controls[field].value);
      if (problem) messages[field] = problem;
    }
    if (Object.keys(messages).length > 0) {
      refuse(messages);
      return;
    }
    setPending(true);
    void send().finally(() => setPending(false));
  });
}
