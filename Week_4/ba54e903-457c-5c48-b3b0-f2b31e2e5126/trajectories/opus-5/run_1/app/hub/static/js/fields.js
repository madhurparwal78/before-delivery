// The account field rules as the sign-up page applies them. The server stays the judge.

export const MESSAGES = {
  email: 'Enter a valid email address.',
  email_taken: 'That email is already registered.',
  display_name: 'Display name must be 1 to 32 characters, with no line breaks or control characters.',
  username: 'Username must be 2 to 32 lowercase letters, digits, underscores or periods.',
  username_taken: 'That username is taken.',
  password: 'Password must be 8 to 128 characters.',
  date_of_birth: 'You must be at least 13 years old.',
  category: 'Choose a category.',
  subject: 'Subject must be 3 to 120 characters.',
  body: 'Description must be 10 to 5000 characters.',
};

function codePoints(text) {
  return Array.from(text).length;
}

function hasControl(text) {
  return Array.from(text).some((character) => {
    const code = character.codePointAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export function validEmail(raw) {
  if (typeof raw !== 'string' || !raw || codePoints(raw) > 254) return false;
  if (hasControl(raw) || /\s/.test(raw)) return false;
  const parts = raw.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const labels = parts[1].split('.');
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

export function normaliseDisplayName(raw) {
  return (raw || '').trim().normalize('NFC');
}

export function validDisplayName(raw) {
  const value = normaliseDisplayName(raw);
  return value.length > 0 && codePoints(value) <= 32 && !hasControl(value);
}

export function validUsername(raw) {
  return typeof raw === 'string' && /^[a-z0-9_.]{2,32}$/.test(raw) &&
    codePoints(raw) >= 2 && codePoints(raw) <= 32;
}

export function validPassword(raw) {
  const length = codePoints(raw || '');
  return length >= 8 && length <= 128;
}

// Thirteen by the current UTC date, with 29 February counted as 1 March.
export function validDateOfBirth(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw || '')) return false;
  const [year, month, day] = raw.split('-').map(Number);
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 ||
      born.getUTCDate() !== day) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (born.getTime() >= today) return false;
  const target = new Date(Date.UTC(year + 13, month - 1, day));
  if (target.getUTCMonth() !== month - 1) target.setTime(Date.UTC(year + 13, 2, 1));
  return target.getTime() <= today;
}

export function markField(form, name, message) {
  const field = form.querySelector('#' + name);
  const error = form.querySelector('#' + name + '-error');
  if (!field || !error) return;
  if (message) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', name + '-error');
    error.textContent = message;
  } else {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
    error.textContent = '';
  }
}

export function fillSummary(alertBox, form, problems) {
  alertBox.replaceChildren();
  if (!problems.length) return;
  const line = document.createElement('p');
  line.textContent = problems.length === 1
    ? 'Fix 1 field to continue.'
    : `Fix ${problems.length} fields to continue.`;
  const list = document.createElement('ul');
  for (const [name, message] of problems) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = '#' + name;
    link.textContent = message;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const field = form.querySelector('#' + name);
      if (field) field.focus();
    });
    item.appendChild(link);
    list.appendChild(item);
  }
  alertBox.appendChild(line);
  alertBox.appendChild(list);
}
