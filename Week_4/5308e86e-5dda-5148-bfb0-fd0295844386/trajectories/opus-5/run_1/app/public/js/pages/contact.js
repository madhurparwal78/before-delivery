import { el } from '../dom.js';
import * as api from '../api.js';
import { announce } from '../status.js';
import { serverCount } from '../format.js';
import { marketingPage, hero, section } from './layout.js';

const MESSAGE_LIMIT = 5000;

const FIELDS = [
  ['email', 'Email (Required)', 'email'],
  ['first_name', 'First name (Required)', 'text'],
  ['last_name', 'Last name (Required)', 'text'],
  ['company', 'Company (Required)', 'text'],
];

const RATE_MESSAGE = "You've sent several inquiries recently. Please try again in a few minutes.";
const CAP_MESSAGE = 'Your message is too long to send.';

export const contact = {
  title: 'Contact sales — Tallwind',
  render() {
    const inputs = new Map();
    const errors = new Map();

    function field(key, label, type) {
      const id = `contact-${key}`;
      const errorId = `${id}-error`;
      const input = el(type === 'textarea' ? 'textarea' : 'input', {
        id,
        name: key,
        type: type === 'textarea' ? null : type,
      });
      const error = el('span', { class: 'field-error', id: errorId });
      inputs.set(key, input);
      errors.set(key, error);
      return el('div', { class: 'field' }, [el('label', { for: id, text: label }), input, error]);
    }

    const counter = el('p', { class: 'hint', text: `0 / ${MESSAGE_LIMIT}` });
    const messageField = field('message', 'Message (Required)', 'textarea');
    const message = inputs.get('message');
    message.addEventListener('input', () => {
      counter.textContent = `${serverCount(message.value)} / ${MESSAGE_LIMIT}`;
    });

    const submit = el('button', { class: 'pill', type: 'submit', text: 'Send inquiry' });
    const thanks = el('p', { hidden: true, class: 'snap-label' });

    function showErrors(fields) {
      let first = null;
      for (const [key, input] of inputs) {
        const error = errors.get(key);
        const problem = fields[key];
        if (problem) {
          error.textContent = problem;
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', error.id);
          if (!first) first = input;
        } else {
          error.textContent = '';
          input.removeAttribute('aria-invalid');
          input.removeAttribute('aria-describedby');
        }
      }
      if (first) first.focus();
    }

    const form = el('form', { novalidate: true }, [
      ...FIELDS.map(([key, label, type]) => field(key, label, type)),
      messageField,
      counter,
      el('div', { class: 'hero-actions' }, [submit]),
      thanks,
    ]);

    // The honeypot: a field no visitor fills.
    const honeypot = el('input', { type: 'text', name: 'website', tabindex: '-1', 'aria-hidden': 'true', autocomplete: 'off', style: 'position:absolute;left:-9999px;width:1px;height:1px' });
    form.append(honeypot);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      const label = submit.textContent;
      submit.textContent = 'Sending…';
      announce('Sending…');

      const body = { source: 'contact', website: honeypot.value };
      for (const [key, input] of inputs) body[key] = input.value;

      const answer = await api.post('/api/inquiries', body, { authenticated: false });
      submit.disabled = false;
      submit.textContent = label;

      if (answer.status === 201) {
        showErrors({});
        thanks.hidden = false;
        thanks.textContent = 'Thanks for reaching out, our team will get back to you shortly.';
        announce('Thanks for reaching out, our team will get back to you shortly.');
        form.reset();
        counter.textContent = `0 / ${MESSAGE_LIMIT}`;
        return;
      }
      if (answer.status === 429) {
        announce(RATE_MESSAGE);
        return;
      }
      if (answer.status === 413) {
        showErrors({ message: CAP_MESSAGE });
        announce(CAP_MESSAGE);
        return;
      }
      const fields = api.fieldErrors(answer);
      if (fields) {
        const copy = {};
        for (const [key, text] of Object.entries(fields)) copy[key] = text;
        showErrors(copy);
        announce(Object.values(copy)[0]);
        return;
      }
      if (api.isOutage(answer)) announce(api.OUTAGE_MESSAGE);
      else announce(api.SERVER_ERROR_MESSAGE);
    });

    return marketingPage(
      [
        hero({
          title: 'Contact sales',
          lede: 'Tell us about your company and we will come back to you quickly.',
          email: false,
          legal: false,
        }),
        section(null, [form]),
      ],
      { status: true }
    );
  },
};
