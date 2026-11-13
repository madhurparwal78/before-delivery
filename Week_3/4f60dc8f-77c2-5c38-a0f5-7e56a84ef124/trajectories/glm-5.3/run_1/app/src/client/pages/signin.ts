import { api, el, isApiError, mountErrorSummary } from '../shell';

export function mountSignIn(): void {
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next') ?? '';
  const section = el('section', 'page-section');
  const heading = el('h1', 'display-2');
  heading.textContent = 'Sign in';
  section.appendChild(heading);
  const card = el('div', 'form-card');
  const form = el('form');
  form.setAttribute('aria-label', 'Sign in');
  form.noValidate = true;

  const emailWrap = el('div', 'field');
  emailWrap.setAttribute('data-for', 'email');
  const emailLabel = el('label');
  emailLabel.htmlFor = 'email';
  emailLabel.textContent = 'Email';
  const emailInput = el('input');
  emailInput.type = 'email';
  emailInput.id = 'email';
  emailInput.value = params.get('email') ?? '';
  emailInput.setAttribute('data-field', 'email');
  const emailError = el('p', 'field-error');
  emailWrap.append(emailLabel, emailInput, emailError);

  const codeWrap = el('div', 'field');
  codeWrap.setAttribute('data-for', 'code');
  codeWrap.hidden = true;
  const codeLabel = el('label');
  codeLabel.htmlFor = 'code';
  codeLabel.textContent = 'Code';
  const codeInput = el('input');
  codeInput.type = 'text';
  codeInput.inputMode = 'numeric';
  codeInput.id = 'code';
  codeInput.setAttribute('data-field', 'code');
  const codeError = el('p', 'field-error');
  codeWrap.append(codeLabel, codeInput, codeError);

  const sendButton = el('button', 'button');
  sendButton.type = 'button';
  sendButton.textContent = 'Send code';
  sendButton.dataset.pendingLabel = 'Sending';
  const signInButton = el('button', 'button');
  signInButton.type = 'submit';
  signInButton.textContent = 'Sign in';
  signInButton.hidden = true;

  const note = el('p', 'lede');
  note.setAttribute('role', 'status');
  note.id = 'signin-note';

  form.append(emailWrap, codeWrap, sendButton, signInButton, note);
  card.appendChild(form);
  section.appendChild(card);
  main.appendChild(section);
  const summary = mountErrorSummary(form);

  let sentFor = '';
  sendButton.addEventListener('click', async () => {
    summary.hide();
    const email = emailInput.value.trim();
    sendButton.setAttribute('aria-busy', 'true');
    sendButton.textContent = sendButton.dataset.pendingLabel ?? 'Sending';
    const { status, json } = await api<Record<string, string>>('POST', '/api/session/code', { email });
    sendButton.removeAttribute('aria-busy');
    sendButton.textContent = 'Send code';
    if (isApiError(json)) {
      if (json.fields && Object.keys(json.fields).length > 0) {
        summary.show(json.fields);
      } else {
        summary.show({ email: json.message });
      }
      return;
    }
    void status;
    note.textContent = 'If that email belongs to a Gloamwork client, a sign-in code is on its way.';
    sentFor = email;
    codeWrap.hidden = false;
    signInButton.hidden = false;
    codeInput.focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    summary.hide();
    const email = emailInput.value.trim();
    const code = codeInput.value.trim();
    if (!codeWrap.hidden) {
      signInButton.setAttribute('aria-busy', 'true');
      const { status, json } = await api<{ landing: string }>('POST', '/api/session', { email, code, next });
      signInButton.removeAttribute('aria-busy');
      if (status === 200 && !isApiError(json)) {
        window.location.href = (json as { landing: string }).landing;
        return;
      }
      if (isApiError(json)) {
        summary.show({ code: json.message });
      }
      return;
    }
    void email;
    void sentFor;
    sendButton.click();
  });
}
