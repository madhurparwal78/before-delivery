// Sign-up and sign-in forms with the error summary pattern.
interface FieldSpec { name: string; label: string }

function fieldsFor(kind: string): FieldSpec[] {
  return kind === 'signup'
    ? [{ name: 'name', label: 'Name' }, { name: 'email', label: 'Email' }, { name: 'password', label: 'Password' }]
    : [{ name: 'email', label: 'Email' }, { name: 'password', label: 'Password' }];
}

function validationMessage(kind: string, field: string, value: string): string | null {
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (field === 'name' && value.trim().length === 0) return 'Enter a name.';
  if (field === 'email' && !emailRe.test(value.trim())) return 'Enter an email address like name@example.org.';
  if (field === 'password' && kind === 'signup' && value.length < 10) return 'Use 10 or more characters.';
  if (field === 'password' && kind === 'signin' && value.length === 0) return 'Enter your password.';
  return null;
}

async function accountMain(): Promise<void> {
  const form = document.getElementById('account-form') as HTMLFormElement;
  if (!form) return;
  const kind = form.dataset.kind ?? 'signin';
  const next = form.dataset.next || '/';
  const summary = document.getElementById('error-summary') as HTMLElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errors: { field: string; message: string }[] = [];
    for (const spec of fieldsFor(kind)) {
      const input = form.querySelector<HTMLInputElement>(`[name="${spec.name}"]`)!;
      const msg = validationMessage(kind, spec.name, input.value);
      if (msg) errors.push({ field: spec.name, message: msg });
    }
    if (errors.length > 0) {
      renderErrors(form, summary, errors);
      return;
    }
    const body: Record<string, string> = {};
    for (const spec of fieldsFor(kind)) {
      const input = form.querySelector<HTMLInputElement>(`[name="${spec.name}"]`)!;
      body[spec.name] = input.value.trim();
    }
    const res = await fetch(`/api/auth/${kind === 'signup' ? 'signup' : 'signin'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      location.href = next;
      return;
    }
    const data = await res.json() as { error?: { code?: string; message?: string } };
    if (data.error?.code === 'email_taken') {
      renderErrors(form, summary, [{ field: 'email', message: 'An account with this email already exists.' }]);
    } else if (data.error?.code === 'invalid_credentials') {
      renderErrors(form, summary, [
        { field: 'email', message: 'Email or password is wrong.' },
        { field: 'password', message: 'Email or password is wrong.' },
      ]);
    } else {
      renderErrors(form, summary, []);
      alert('Something went wrong. Please try again.');
    }
  });
}

function renderErrors(form: HTMLFormElement, summary: HTMLElement, errors: { field: string; message: string }[]): void {
  // clear field errors
  for (const p of [...form.querySelectorAll('.field-error')]) p.remove();
  if (errors.length === 0) {
    summary.hidden = true;
    summary.innerHTML = '';
    return;
  }
  summary.hidden = false;
  summary.setAttribute('role', 'alert');
  summary.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'There is a problem';
  summary.appendChild(heading);
  const list = document.createElement('ul');
  for (const err of errors) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#f-${err.field}`;
    a.textContent = err.message;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      form.querySelector<HTMLInputElement>(`[name="${err.field}"]`)?.focus();
    });
    li.appendChild(a);
    summary.appendChild(li);
    const input = form.querySelector<HTMLElement>(`[name="${err.field}"]`);
    const msg = document.createElement('p');
    msg.className = 'field-error';
    msg.textContent = err.message;
    msg.id = `err-${err.field}`;
    input?.setAttribute('aria-describedby', `err-${err.field}`);
    input?.insertAdjacentElement('afterend', msg);
  }
  summary.appendChild(list);
  const firstLink = summary.querySelector<HTMLElement>('a');
  firstLink?.focus();
}

void accountMain();
