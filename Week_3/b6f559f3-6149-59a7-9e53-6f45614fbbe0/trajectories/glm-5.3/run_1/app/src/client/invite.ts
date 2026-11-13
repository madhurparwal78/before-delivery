// The invite accept page.
import { el, api } from './dom';
import type { Person } from './types';

interface InviteInfo {
  projectName: string;
  role: string;
  email: string;
  accountExists: boolean;
}

export async function renderInvite(token: string): Promise<void> {
  const root = document.getElementById('app')!;
  const me = await api<{ user: Person }>('/api/me');
  const res = await api<InviteInfo>(`/api/invites/${token}`);
  if (!res.ok) {
    root.append(
      el('main', { class: 'missing-panel' }, res.message ?? 'This invite link has already been used or has expired.'),
    );
    return;
  }
  const info = res.data!;
  const signedInAs = me.data?.user?.email ?? null;
  const samePerson = signedInAs !== null && signedInAs.toLowerCase() === info.email.toLowerCase();

  const panel = el('div', { class: 'panel', style: 'max-width:440px;margin:48px auto;padding:24px' });
  panel.append(el('h2', {}, `Join ${info.projectName} as ${info.role}`));

  const alert = el('div', { role: 'alert', class: 'alert-row', style: 'display:none' });

  const fields: HTMLElement[] = [];
  const nameInput = el('input', {
    type: 'text',
    'aria-label': 'Your name',
    style: 'width:100%;margin:8px 0;padding:10px;background:var(--raised);border:1px solid var(--hairline);border-radius:4px',
  });
  const password1 = el('input', {
    type: 'password',
    'aria-label': 'Choose a password',
    style: 'width:100%;margin:8px 0;padding:10px;background:var(--raised);border:1px solid var(--hairline);border-radius:4px',
  });
  const password2 = el('input', {
    type: 'password',
    'aria-label': 'Password',
    style: 'width:100%;margin:8px 0;padding:10px;background:var(--raised);border:1px solid var(--hairline);border-radius:4px',
  });

  if (samePerson) {
    panel.append(alert);
    panel.append(el('p', { class: 'muted small' }, 'Signed in as ' + info.email));
  } else if (info.accountExists) {
    panel.append(alert);
    panel.append(password2);
    fields.push(password2);
  } else {
    panel.append(alert, nameInput, password1);
    fields.push(nameInput, password1);
  }

  const accept = el('button', { class: 'btn btn-primary', 'aria-label': 'Accept invite', style: 'width:100%' }, 'Accept invite');
  panel.append(accept);
  root.append(panel);

  const go = async (): Promise<void> => {
    accept.textContent = 'Joining…';
    accept.setAttribute('disabled', '');
    let body: Record<string, string> = {};
    if (samePerson) {
      body = {};
    } else if (info.accountExists) {
      body = { password: (password2 as HTMLInputElement).value };
    } else {
      body = {
        name: (nameInput as HTMLInputElement).value,
        password: (password1 as HTMLInputElement).value,
      };
    }
    const res2 = await api<{ projectId: string }>(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res2.ok) {
      window.location.href = `/projects/${res2.data!.projectId}`;
      return;
    }
    accept.textContent = 'Accept invite';
    accept.removeAttribute('disabled');
    alert.textContent = res2.message ?? 'This invite link has already been used or has expired.';
    alert.style.display = 'block';
  };
  accept.addEventListener('click', () => void go());
  for (const f of fields) {
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void go();
    });
  }
  (fields[0] ?? accept).focus();
}
