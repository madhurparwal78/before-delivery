import { CONTACT_TOPICS, CONTACT_TOPIC_LABELS } from '../../shared/catalog.js';
import { contactSuccess, UI } from '../../shared/copy.js';
import { api, ApiFailure } from '../api.js';
import { announce, clearRegion, regionText } from '../live.js';
import { bind, bindText, el, labelled, refresh, say } from '../ui.js';
import { FieldSet, textField } from './forms.js';

export function renderContact(main: HTMLElement): void {
  const heading = el('h1', { class: 'page-heading' });
  const fields = new FieldSet();
  const name = fields.add('name', UI.name, textField(UI.name, { autocomplete: 'name' }));
  const email = fields.add('email', UI.email, textField(UI.email, { type: 'email', autocomplete: 'email' }));

  const topicSelect = el('select', { class: 'input select' });
  const placeholder = el('option', { value: '' });
  bindText(placeholder, () => say(UI.topicPlaceholder));
  topicSelect.append(placeholder);
  for (const topic of CONTACT_TOPICS) {
    const option = el('option', { value: topic });
    bindText(option, () => say(CONTACT_TOPIC_LABELS[topic]));
    topicSelect.append(option);
  }
  topicSelect.value = '';
  const topicError = el('p', { class: 'field-error', hidden: true });
  const topicWrapper = labelled(UI.topic, topicSelect);
  topicWrapper.append(topicError);

  const message = el('textarea', { class: 'input textarea', rows: 6 });
  message.id = 'contact-message';
  const messageError = el('p', { class: 'field-error', id: 'contact-message-error', hidden: true });
  const messageWrapper = labelled(UI.message, message);
  messageWrapper.append(messageError);

  const submit = el('button', { type: 'submit', class: 'button primary' });
  const region = el('p', { role: 'status', class: 'live-region' });
  let sending = false;

  const form = el('form', { class: 'contact-form', novalidate: true }, [
    fields.summary,
    name.wrapper,
    email.wrapper,
    topicWrapper,
    messageWrapper,
    submit,
    region,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (sending) return;
    sending = true;
    refresh();
    void (async () => {
      try {
        const result = await api.post<{ reference: string }>('/api/contact', {
          name: name.input.value.trim(),
          email: email.input.value.trim(),
          topic: topicSelect.value,
          message: message.value,
        });
        fields.clear();
        topicError.hidden = true;
        messageError.hidden = true;
        announce('contact', contactSuccess(result.reference));
        form.reset();
        topicSelect.value = '';
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.status === 422) {
          fields.show(error.fields);
          const topicMessage = error.fields['topic'];
          topicError.hidden = topicMessage === undefined;
          topicError.textContent = topicMessage ?? '';
          topicSelect.setAttribute('aria-invalid', topicMessage === undefined ? 'false' : 'true');
          const messageMessage = error.fields['message'];
          messageError.hidden = messageMessage === undefined;
          messageError.textContent = messageMessage ?? '';
          message.setAttribute('aria-invalid', messageMessage === undefined ? 'false' : 'true');
        }
      } finally {
        sending = false;
        refresh();
      }
    })();
  });

  bind(() => {
    heading.textContent = say(UI.contactHeading);
    submit.textContent = sending ? say(UI.sendingPending) : say(UI.sendMessage);
    submit.disabled = sending;
    submit.setAttribute('aria-busy', sending ? 'true' : 'false');
    region.setAttribute('aria-label', say(UI.contactStatus));
    region.textContent = sending ? say(UI.sendingPending) : regionText('contact');
  });

  main.append(heading, form);
  clearRegion('contact');
}
