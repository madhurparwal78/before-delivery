/** The project enquiry form: validation, sending and the sent panel. */

import {
  ENQUIRY_FIELDS,
  FORM_STATUS_NOT_SENT,
  FORM_STATUS_SENDING,
  checkEnquiry,
  failingFields,
  formStatusInvalidText,
  nextEnquiryState,
  sentParagraph,
  type EnquiryField,
  type EnquiryFieldMessages,
  type EnquiryInput,
  type EnquiryState,
} from '../shared/enquiry.js';
import { focusWithRule, need, queryAll } from './dom.js';

const REQUEST_TIMEOUT_MS = 30000;

interface FieldView {
  readonly control: HTMLElement;
  readonly error: HTMLElement;
  readonly radios: HTMLInputElement[];
}

interface InvalidResponse {
  readonly fields?: Record<string, string>;
}

export const setUpForm = (): void => {
  const form = need<HTMLFormElement>('[data-enquiry-form]');
  const status = need<HTMLElement>('[data-form-status]');
  const submit = need<HTMLButtonElement>('[data-submit]');
  const nameField = need<HTMLInputElement>('[data-field="name"]');
  const emailField = need<HTMLInputElement>('[data-field="email"]');
  const typeField = need<HTMLSelectElement>('[data-field="projectType"]');
  const messageField = need<HTMLTextAreaElement>('[data-field="message"]');
  const budgetRadios = queryAll<HTMLInputElement>('input[name="budget"]');
  const budgetGroup = need<HTMLElement>('[data-budget-group]');

  const views: Record<EnquiryField, FieldView> = {
    name: { control: nameField, error: need('#enquiry-name-error'), radios: [] },
    email: { control: emailField, error: need('#enquiry-email-error'), radios: [] },
    projectType: {
      control: typeField,
      error: need('#enquiry-project-type-error'),
      radios: [],
    },
    budget: { control: budgetGroup, error: need('#enquiry-budget-error'), radios: budgetRadios },
    message: { control: messageField, error: need('#enquiry-message-error'), radios: [] },
  };

  let state: EnquiryState = 'editing';
  let checked = false;

  const read = (): EnquiryInput => ({
    name: nameField.value,
    email: emailField.value,
    projectType: typeField.value,
    budget: budgetRadios.find((radio) => radio.checked)?.value ?? '',
    message: messageField.value,
  });

  const paintField = (field: EnquiryField, message: string | undefined): void => {
    const view = views[field];
    if (message === undefined) {
      view.error.hidden = true;
      view.error.textContent = '';
      view.control.removeAttribute('aria-invalid');
      view.control.removeAttribute('aria-describedby');
      for (const radio of view.radios) radio.removeAttribute('aria-invalid');
      return;
    }
    view.error.hidden = false;
    view.error.textContent = message;
    view.control.setAttribute('aria-invalid', 'true');
    view.control.setAttribute('aria-describedby', view.error.id);
    for (const radio of view.radios) radio.setAttribute('aria-invalid', 'true');
  };

  const paintMessages = (messages: EnquiryFieldMessages): void => {
    for (const field of ENQUIRY_FIELDS) paintField(field, messages[field]);
    const failing = failingFields(messages);
    status.textContent = failing.length === 0 ? '' : formStatusInvalidText(failing.length);
    status.dataset.tone = failing.length === 0 ? 'none' : 'error';
  };

  const setDisabled = (disabled: boolean): void => {
    for (const control of [nameField, emailField, typeField, messageField, ...budgetRadios]) {
      control.disabled = disabled;
    }
    submit.disabled = disabled;
  };

  const showSentPanel = (name: string): void => {
    const panel = document.createElement('div');
    panel.className = 'sent-panel';
    panel.dataset.sentPanel = 'true';
    const heading = document.createElement('h3');
    heading.textContent = 'Message received.';
    heading.tabIndex = -1;
    const paragraph = document.createElement('p');
    paragraph.textContent = sentParagraph(name);
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = 'Send another message';
    again.addEventListener('click', () => {
      state = nextEnquiryState(state, { type: 'reset' });
      checked = false;
      panel.remove();
      form.hidden = false;
      form.reset();
      paintMessages({});
      status.textContent = '';
      focusWithRule(nameField);
    });
    panel.append(heading, paragraph, again);
    form.hidden = true;
    form.after(panel);
    focusWithRule(heading);
  };

  const send = async (enquiry: EnquiryInput): Promise<void> => {
    status.textContent = FORM_STATUS_SENDING;
    status.dataset.tone = 'none';
    form.setAttribute('aria-busy', 'true');
    submit.textContent = 'Sending\u2026';
    setDisabled(true);
    try {
      const response = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(enquiry),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 201) {
        state = nextEnquiryState(state, { type: 'accepted' });
        form.removeAttribute('aria-busy');
        setDisabled(false);
        submit.textContent = 'Send message';
        showSentPanel(enquiry.name);
        return;
      }
      if (response.status === 422) {
        const body = (await response.json()) as InvalidResponse;
        const messages = (body.fields ?? {}) as EnquiryFieldMessages;
        // The server checks the same rules, so its messages land on their fields.
        state = 'invalid';
        form.removeAttribute('aria-busy');
        setDisabled(false);
        submit.textContent = 'Send message';
        paintMessages(messages);
        const first = failingFields(messages)[0];
        if (first !== undefined) focusWithRule(firstControl(first));
        return;
      }
      throw new Error(`Unexpected answer: ${response.status}`);
    } catch {
      state = nextEnquiryState(state, { type: 'rejected' });
      form.removeAttribute('aria-busy');
      setDisabled(false);
      submit.textContent = 'Send message';
      status.textContent = FORM_STATUS_NOT_SENT;
      status.dataset.tone = 'error';
      focusWithRule(submit);
    }
  };

  const firstControl = (field: EnquiryField): HTMLElement => {
    const view = views[field];
    return view.radios[0] ?? view.control;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state === 'sending') return;
    const enquiry = read();
    const messages = checkEnquiry(enquiry);
    const failing = failingFields(messages);
    checked = true;
    state = nextEnquiryState(state, { type: 'press', valid: failing.length === 0 });
    if (failing.length > 0) {
      paintMessages(messages);
      const first = failing[0];
      if (first !== undefined) focusWithRule(firstControl(first));
      return;
    }
    paintMessages({});
    void send(enquiry);
  });

  const recheck = (): void => {
    if (!checked || state === 'sending' || state === 'sent') return;
    const messages = checkEnquiry(read());
    paintMessages(messages);
    if (failingFields(messages).length === 0) state = nextEnquiryState(state, { type: 'correct' });
    else state = 'invalid';
  };

  form.addEventListener('input', recheck);
  form.addEventListener('change', recheck);
};
