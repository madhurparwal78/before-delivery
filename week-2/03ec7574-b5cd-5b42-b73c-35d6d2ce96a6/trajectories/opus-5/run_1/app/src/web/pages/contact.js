import { MONTHLY_VOLUMES } from '../../api/auth.js';
import { displayHeading, h, icon } from '../html.js';
import { publicPage } from '../layout.js';

export const THANKS_LINE = 'Thanks. Our team will reply within one business day.';

function fieldError(errors, field) {
  const found = errors.find((entry) => entry.field === field);
  return found ? found.message : '';
}

function textField({ id, label, name, value, errors, type = 'text', autocomplete }) {
  const message = fieldError(errors, name);
  return `
    <div class="field">
      <label for="${h(id)}">${h(label)}</label>
      <input type="${h(type)}" id="${h(id)}" name="${h(name)}" value="${h(value)}"
        ${autocomplete ? `autocomplete="${h(autocomplete)}"` : ''}
        ${message ? `aria-invalid="true" aria-describedby="${h(id)}-error"` : ''}>
      <p class="field-error" id="${h(id)}-error" data-error-for="${h(name)}">${h(message)}</p>
    </div>`;
}

export function renderContact({ values = {}, errors = [], sent = false } = {}) {
  const volumeError = fieldError(errors, 'monthly_volume');
  const messageError = fieldError(errors, 'message');
  const form = `
    <form class="form-card" method="post" action="/contact" data-contact-form novalidate>
      ${textField({ id: 'full-name', label: 'Full name', name: 'full_name', value: values.full_name || '', errors, autocomplete: 'name' })}
      ${textField({ id: 'work-email', label: 'Work email', name: 'work_email', value: values.work_email || '', errors, type: 'email', autocomplete: 'email' })}
      ${textField({ id: 'company', label: 'Company', name: 'company', value: values.company || '', errors, autocomplete: 'organization' })}
      <div class="field">
        <label for="monthly-volume">Monthly volume</label>
        <select id="monthly-volume" name="monthly_volume" ${volumeError ? 'aria-invalid="true" aria-describedby="monthly-volume-error"' : ''}>
          <option value="">Choose a monthly volume</option>
          ${MONTHLY_VOLUMES.map((option) => `<option value="${h(option)}"${values.monthly_volume === option ? ' selected' : ''}>${h(option)}</option>`).join('')}
        </select>
        <p class="field-error" id="monthly-volume-error" data-error-for="monthly_volume">${h(volumeError)}</p>
      </div>
      <div class="field">
        <label for="message">How can we help?</label>
        <textarea id="message" name="message" ${messageError ? 'aria-invalid="true" aria-describedby="message-error"' : ''}>${h(values.message || '')}</textarea>
        <p class="field-error" id="message-error" data-error-for="message">${h(messageError)}</p>
      </div>
      <button type="submit" class="capsule capsule-dark">Send message${icon('arrow')}</button>
    </form>`;

  const content = `
  <section>
    <div class="shell card-grid two">
      <div>
        ${displayHeading(1, 'Contact', 'sales')}
        <p class="lead">Talk to our team about building with Corvo</p>
        <p>Tell us how money moves through your business and we will show you the wallets, policies and quorums that fit.</p>
      </div>
      <div data-contact-holder>
        ${sent ? `<p class="result-line" tabindex="-1" autofocus data-thanks>${h(THANKS_LINE)}</p>` : form}
      </div>
    </div>
  </section>`;

  return publicPage({
    title: 'Contact sales — Corvo',
    description: 'Contact the Corvo sales team about wallets, spending policies and approval quorums.',
    content,
    scripts: ['contact.js']
  });
}
