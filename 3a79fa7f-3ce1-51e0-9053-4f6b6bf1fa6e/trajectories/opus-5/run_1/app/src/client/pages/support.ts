import { errorBody, post } from '../api.js';
import { capitalise, clear, el, formatLongDateTime } from '../dom.js';
import { announce, applyFieldErrors, field, type FieldHandle } from '../ui.js';

interface Tracking {
  number: string;
  status: string;
  events: { status: string; at: string }[];
  lines: string[];
}

export function renderTrack(main: HTMLElement): void {
  const orderNumber = field('Order number', 'text');
  const orderEmail = field('Order email', 'text', { type: 'email' });
  const trackButton = el('button', { class: 'btn', type: 'button' }, 'Track order');
  const orderAlert = el('div', { class: 'alert-region', role: 'alert' });
  const orderResult = el('div', { class: 'stack' });

  const caseReference = field('Case reference', 'text');
  const caseEmail = field('Case email', 'text', { type: 'email' });
  const caseButton = el('button', { class: 'btn', type: 'button' }, 'Find case');
  const caseAlert = el('div', { class: 'alert-region', role: 'alert' });
  const caseResult = el('div', { class: 'stack' });

  trackButton.addEventListener('click', async () => {
    orderAlert.textContent = '';
    clear(orderResult);
    trackButton.disabled = true;
    trackButton.textContent = 'Searching...';
    const result = await post<Tracking>('/api/track', {
      order_number: orderNumber.control.value,
      email: orderEmail.control.value,
    });
    trackButton.disabled = false;
    trackButton.textContent = 'Track order';
    if (!result.ok) {
      orderAlert.textContent = errorBody(result).message;
      return;
    }
    orderResult.append(
      el('h3', {}, `Order ${result.body.number}: ${capitalise(result.body.status)}`),
      el(
        'ol',
        { class: 'stack', style: 'list-style:none;padding:0' },
        result.body.events.map((event) => el('li', {}, `${capitalise(event.status)} — ${formatLongDateTime(event.at)}`)),
      ),
      el('ul', { class: 'stack', style: 'padding-left:1.25rem' }, result.body.lines.map((line) => el('li', {}, line))),
    );
  });

  caseButton.addEventListener('click', async () => {
    caseAlert.textContent = '';
    clear(caseResult);
    caseButton.disabled = true;
    caseButton.textContent = 'Searching...';
    const result = await post<{ reference: string; status: string; subject: string; opened_at: string }>(
      '/api/cases/lookup',
      { reference: caseReference.control.value, email: caseEmail.control.value },
    );
    caseButton.disabled = false;
    caseButton.textContent = 'Find case';
    if (!result.ok) {
      caseAlert.textContent = errorBody(result).message;
      return;
    }
    caseResult.append(
      el('h3', {}, `Case ${result.body.reference}: ${capitalise(result.body.status)}`),
      el('p', {}, result.body.subject),
    );
  });

  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'Track an order or a case'),
      el('div', { class: 'grid grid-2' }, [
        el('form', { novalidate: true, class: 'card' }, [
          el('h2', { style: 'font-size:1.2rem' }, 'Order status'),
          orderAlert,
          orderNumber.wrapper,
          orderEmail.wrapper,
          trackButton,
          orderResult,
        ]),
        el('form', { novalidate: true, class: 'card' }, [
          el('h2', { style: 'font-size:1.2rem' }, 'Case status'),
          caseAlert,
          caseReference.wrapper,
          caseEmail.wrapper,
          caseButton,
          caseResult,
        ]),
      ]),
    ]),
  );
}

function caseForm(heading: string, intro: string, fixedSubject: string | null): HTMLElement {
  const email = field('Email', 'text', { type: 'email', autocomplete: 'email' });
  const orderNumber = field('Order number (optional)', 'text');
  const subject = fixedSubject === null ? field('Subject', 'text') : null;
  const message = field('Message', 'textarea');
  const submit = el('button', { class: 'btn', type: 'button' }, 'Open case');
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const done = el('p', { role: 'status' });

  const handles: Record<string, FieldHandle> = { email, order_number: orderNumber, message };
  if (subject) handles.subject = subject;

  const form = el('form', { novalidate: true }, [
    alert,
    email.wrapper,
    orderNumber.wrapper,
    subject?.wrapper,
    message.wrapper,
    submit,
    done,
  ]);

  submit.addEventListener('click', async () => {
    alert.textContent = '';
    done.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Opening...';
    const result = await post<{ reference: string }>('/api/cases', {
      email: email.control.value,
      order_number: orderNumber.control.value,
      subject: fixedSubject ?? subject?.control.value ?? '',
      message: message.control.value,
    });
    submit.disabled = false;
    submit.textContent = 'Open case';
    if (!result.ok) {
      const body = errorBody(result);
      applyFieldErrors(handles, body.fields);
      if (!body.fields) alert.textContent = body.message;
      return;
    }
    done.textContent = `Case ${result.body.reference} opened.`;
    announce(`Case ${result.body.reference} opened.`);
  });

  return el('section', { class: 'band wrap stack narrow' }, [el('h1', {}, heading), el('p', {}, intro), form]);
}

export function renderSupport(main: HTMLElement): void {
  main.replaceChildren(
    caseForm('Open a support case', 'Tell us what happened and we will come back to you with a reference.', null),
  );
}

export function renderContact(main: HTMLElement): void {
  main.replaceChildren(
    caseForm('Write to the workshop', 'A note reaches the family workshop directly.', 'Contact form'),
  );
}
