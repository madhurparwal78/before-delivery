import {
  ENQUIRY_FIELDS, NOT_SENT_STATUS, SENDING_LABEL, SENDING_STATUS, SEND_TIMEOUT_MS, checkEnquiry, invalidStatus,
  isCorrecting, isSending, nextEnquiryState, normaliseEnquiry, sentParagraph, type Enquiry, type EnquiryField, type EnquiryFieldMessages, type EnquiryState,
} from "../shared/enquiry.js";
import { all, must } from "./dom.js";

/** The enquiry form. Validation runs when `Send message` is pressed and, after that first press, on every input. The
 * form speaks only through `Form status` and the messages under its fields. */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;

interface EnquiryFieldsRejected {
  readonly fields: EnquiryFieldMessages;
}

function isRejection(body: unknown): body is EnquiryFieldsRejected {
  return typeof body === "object" && body !== null && "fields" in body;
}

export interface EnquiryForm {
  readonly setProjectType: (value: string) => void;
  readonly focusName: () => void;
}

export function initEnquiryForm(): EnquiryForm {
  const form = must<HTMLFormElement>(document, "[data-enquiry]");
  const status = must<HTMLElement>(form, "[data-form-status]");
  const send = must<HTMLButtonElement>(form, "[data-send]");
  const panel = must<HTMLElement>(document, "[data-sent-panel]");
  const name = must<HTMLInputElement>(form, "#enquiry-name");
  const email = must<HTMLInputElement>(form, "#enquiry-email");
  const projectType = must<HTMLSelectElement>(form, "#enquiry-projectType");
  const message = must<HTMLTextAreaElement>(form, "#enquiry-message");
  const budgetGroup = must<HTMLElement>(form, "#enquiry-budget");
  const radios = all<HTMLInputElement>(form, "input[name='budget']");
  const controls = (): Control[] => all<Control>(form, "input, select, textarea, button");

  let state: EnquiryState = "editing";
  let checking = false;

  const fieldElement = (field: EnquiryField): HTMLElement => ({ name, email, projectType, budget: budgetGroup, message })[field];
  const focusTarget = (field: EnquiryField): HTMLElement => (field === "budget" ? (radios[0] ?? budgetGroup) : fieldElement(field));
  const messageElement = (field: EnquiryField): HTMLElement => must<HTMLElement>(form, `[data-message="${field}"]`);

  const readEnquiry = (): Enquiry =>
    normaliseEnquiry({
      name: name.value,
      email: email.value,
      projectType: projectType.value,
      budget: radios.find((radio) => radio.checked)?.value ?? "",
      message: message.value,
    });

  const setStatus = (text: string, danger: boolean): void => {
    status.textContent = text;
    if (danger) status.dataset["tone"] = "danger";
    else delete status.dataset["tone"];
  };

  const showMessages = (messages: EnquiryFieldMessages): number => {
    let failing = 0;
    for (const field of ENQUIRY_FIELDS) {
      const text = messages[field];
      messageElement(field).textContent = text ?? "";
      if (text === undefined) fieldElement(field).removeAttribute("aria-invalid");
      else {
        fieldElement(field).setAttribute("aria-invalid", "true");
        failing += 1;
      }
    }
    return failing;
  };

  const focusFirstFailing = (messages: EnquiryFieldMessages): void => {
    const first = ENQUIRY_FIELDS.find((field) => messages[field] !== undefined);
    if (first !== undefined) focusTarget(first).focus();
  };

  const setBusy = (busy: boolean): void => {
    form.setAttribute("aria-busy", String(busy));
    for (const control of controls()) control.disabled = busy;
    send.textContent = busy ? SENDING_LABEL : "Send message";
  };

  const reject = (messages: EnquiryFieldMessages): void => {
    const failing = showMessages(messages);
    setStatus(invalidStatus(failing), true);
    focusFirstFailing(messages);
  };

  const submit = async (enquiry: Enquiry): Promise<void> => {
    state = nextEnquiryState(state, "press-valid");
    setBusy(true);
    setStatus(SENDING_STATUS, false);
    try {
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(enquiry),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (response.status === 201) {
        state = nextEnquiryState(state, "created");
        must<HTMLElement>(panel, "[data-sent-copy]").textContent = sentParagraph(enquiry.name);
        form.hidden = true;
        panel.hidden = false;
        setBusy(false);
        setStatus("", false);
        must<HTMLElement>(panel, "[data-sent-title]").focus();
        return;
      }
      if (response.status === 422) {
        const body: unknown = await response.json();
        if (isRejection(body)) {
          state = nextEnquiryState(state, "rejected");
          setBusy(false);
          reject(body.fields);
          return;
        }
      }
    } catch {
      // A network failure or the 30-second limit is a failed send, handled below with every other refusal.
    }
    state = nextEnquiryState(state, "refused");
    setBusy(false);
    setStatus(NOT_SENT_STATUS, true);
    send.focus();
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isSending(state)) return;
    const enquiry = readEnquiry();
    const messages = checkEnquiry(enquiry);
    checking = true;
    if (Object.keys(messages).length > 0) {
      state = nextEnquiryState(state, "press-invalid");
      reject(messages);
      return;
    }
    showMessages({});
    void submit(enquiry);
  });

  const recheck = (): void => {
    if (!checking || isSending(state)) return;
    const messages = checkEnquiry(readEnquiry());
    const failing = showMessages(messages);
    if (!isCorrecting(state)) return;
    state = nextEnquiryState(state, failing === 0 ? "fields-corrected" : "fields-broken");
    setStatus(failing === 0 ? "" : invalidStatus(failing), failing > 0);
  };
  form.addEventListener("input", recheck);
  form.addEventListener("change", recheck);

  must<HTMLElement>(panel, "[data-send-another]").addEventListener("click", () => {
    state = nextEnquiryState(state, "send-another");
    checking = false;
    name.value = "";
    email.value = "";
    projectType.value = "";
    message.value = "";
    radios.forEach((radio) => {
      radio.checked = false;
    });
    showMessages({});
    setStatus("", false);
    panel.hidden = true;
    form.hidden = false;
    name.focus();
  });

  return {
    setProjectType: (value) => {
      projectType.value = value;
    },
    focusName: () => name.focus({ preventScroll: true }),
  };
}
