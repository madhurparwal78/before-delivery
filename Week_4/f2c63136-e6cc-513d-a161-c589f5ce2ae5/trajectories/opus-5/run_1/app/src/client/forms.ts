import { act, announce, announcement, call, clearFieldErrors, fieldError } from './api.js';

function value(form: HTMLFormElement, name: string): string {
  const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
  return field ? field.value : '';
}

function checked(form: HTMLFormElement, name: string): boolean {
  const field = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
  return field ? field.checked : false;
}

function fieldOf(form: HTMLFormElement, name: string): HTMLElement | null {
  return form.querySelector<HTMLElement>(`[name="${name}"]`);
}

function showFieldErrors(form: HTMLFormElement, errors: Record<string, string>): void {
  clearFieldErrors(form);
  for (const [name, message] of Object.entries(errors)) {
    fieldError(fieldOf(form, name), message);
  }
}

function repoOf(element: HTMLElement): string {
  const holder = element.closest<HTMLElement>('[data-repo]');
  return holder?.dataset.repo ?? '';
}

async function submitForm(form: HTMLFormElement, submitter: HTMLElement | null): Promise<void> {
  const kind = form.dataset.form;
  clearFieldErrors(form);

  if (kind === 'signup') {
    await act(
      submitter,
      'Working...',
      async () => {
        await call('POST', '/api/signup', {
          email: value(form, 'email'),
          username: value(form, 'username'),
          name: value(form, 'name'),
          password: value(form, 'password'),
        });
        return 'Your account is created. The confirmation email is on its way.';
      },
      (failure) => {
        if (failure.errors) {
          showFieldErrors(form, failure.errors);
          return true;
        }
        return false;
      },
    );
    return;
  }

  if (kind === 'login') {
    await act(
      submitter,
      'Working...',
      async () => {
        await call('POST', '/api/login', { email: value(form, 'email'), password: value(form, 'password') });
        window.location.href = '/inbox';
      },
      (failure) => {
        const message = failure.error ?? '';
        const notice = document.createElement('p');
        notice.className = 'fielderror';
        notice.setAttribute('role', 'alert');
        notice.textContent = message;
        form.insertAdjacentElement('beforebegin', notice);
        return true;
      },
    );
    return;
  }

  if (kind === 'confirm') {
    await act(
      submitter,
      'Working...',
      async () => {
        await call('POST', '/api/confirm', { token: form.dataset.token });
        const link = document.createElement('a');
        link.href = '/login';
        link.textContent = 'Log in';
        form.insertAdjacentElement('afterend', link);
        return 'Your email is confirmed.';
      },
      (failure) => {
        if (failure.status === 404) {
          window.location.href = '/confirm-not-found';
          return true;
        }
        return false;
      },
    );
    return;
  }

  if (kind === 'org') {
    await act(
      submitter,
      'Working...',
      async () => {
        const slug = value(form, 'slug');
        await call('POST', '/api/orgs', { slug, name: value(form, 'name') });
        window.location.href = `/${slug}`;
        return 'Created.';
      },
      (failure) => {
        if (failure.errors) {
          showFieldErrors(form, failure.errors);
          return true;
        }
        return false;
      },
    );
    return;
  }

  if (kind === 'repo') {
    await act(
      submitter,
      'Working...',
      async () => {
        const org = value(form, 'org');
        const name = value(form, 'name');
        await call('POST', `/api/orgs/${org}/repos`, { name, visibility: value(form, 'visibility') });
        window.location.href = `/${org}/${name}`;
        return 'Created.';
      },
      (failure) => {
        if (failure.errors) {
          showFieldErrors(form, failure.errors);
          return true;
        }
        return false;
      },
    );
    return;
  }

  if (kind === 'team') {
    const org = window.location.pathname.split('/')[1];
    await act(
      submitter,
      'Working...',
      async () => {
        await call('POST', `/api/orgs/${org}/teams`, { name: value(form, 'name') });
        window.location.reload();
        return 'Created.';
      },
      (failure) => {
        if (failure.errors) {
          showFieldErrors(form, failure.errors);
          return true;
        }
        return false;
      },
    );
    return;
  }

  if (kind === 'team-member') {
    const org = window.location.pathname.split('/')[1];
    await act(submitter, 'Working...', async () => {
      await call('PUT', `/api/orgs/${org}/teams/${form.dataset.team}/members/${value(form, 'username')}`);
      window.location.reload();
      return 'Created.';
    });
    return;
  }

  if (kind === 'change') {
    const repo = repoOf(form);
    await act(
      submitter,
      'Working...',
      async () => {
        const change = await call<{ number: number }>('POST', `/api/repos/${repo}/changes`, {
          title: value(form, 'title'),
          description: value(form, 'description'),
          head: value(form, 'head'),
          base: value(form, 'base'),
          draft: checked(form, 'draft'),
        });
        window.location.href = `/${repo}/changes/${change.number}`;
        return `Change #${change.number} created.`;
      },
      (failure) => {
        if (failure.errors) {
          showFieldErrors(form, failure.errors);
          return true;
        }
        return false;
      },
    );
    return;
  }

  if (kind === 'rules') {
    const repo = repoOf(form);
    await act(
      submitter,
      'Saving...',
      async () => {
        const names = value(form, 'required_checks')
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name !== '');
        await call('PUT', `/api/repos/${repo}/settings`, {
          required_approvals: Number(value(form, 'required_approvals')),
          required_checks: names,
          queue: checked(form, 'queue'),
        });
        return 'Rules saved.';
      },
      (failure) => {
        if (failure.errors) {
          showFieldErrors(form, failure.errors);
          return true;
        }
        return false;
      },
    );
    return;
  }

  if (kind === 'token') {
    const repo = repoOf(form);
    await act(
      submitter,
      'Working...',
      async () => {
        const token = await call<{ token: string }>('POST', `/api/repos/${repo}/tokens`, {
          name: value(form, 'name'),
          access: value(form, 'access'),
        });
        const slot = document.querySelector<HTMLElement>('[data-token-slot]');
        if (slot) {
          slot.innerHTML = '';
          const region = document.createElement('section');
          region.setAttribute('role', 'region');
          region.setAttribute('aria-label', 'New token');
          const field = document.createElement('label');
          field.className = 'field';
          const caption = document.createElement('span');
          caption.textContent = 'Token value';
          const input = document.createElement('input');
          input.type = 'text';
          input.readOnly = true;
          input.setAttribute('aria-label', 'Token value');
          input.value = token.token;
          field.append(caption, input);
          const note = document.createElement('p');
          note.textContent = 'Copy this token now. It is not shown again.';
          region.append(field, note);
          slot.append(region);
        }
        return 'Token created.';
      },
      (failure) => {
        if (failure.errors) {
          showFieldErrors(form, failure.errors);
          return true;
        }
        return false;
      },
    );
    return;
  }

  if (kind === 'role') {
    const repo = repoOf(form);
    const raw = value(form, 'subject').trim();
    const subject = raw.startsWith('@') && raw.includes('/') ? `team:${raw.slice(1)}` : `user:${raw.replace(/^@/, '')}`;
    await act(
      submitter,
      'Working...',
      async () => {
        await call('PUT', `/api/repos/${repo}/roles`, { subject, role: value(form, 'role') });
        window.location.reload();
        return 'Role granted.';
      },
      (failure) => {
        if (failure.errors) {
          showFieldErrors(form, failure.errors);
          return true;
        }
        if (failure.status === 404) {
          fieldError(fieldOf(form, 'subject'), `${raw} was not found`);
          return true;
        }
        return false;
      },
    );
    return;
  }
}

async function saveFile(editor: HTMLElement, control: HTMLElement): Promise<void> {
  const repo = editor.dataset.repo ?? '';
  const branch = editor.dataset.branch ?? '';
  const path = editor.dataset.path ?? '';
  const content = editor.querySelector<HTMLTextAreaElement>('[data-editor-content]')!;
  const message = editor.querySelector<HTMLInputElement>('[data-editor-message]')!;

  await act(
    control,
    'Saving...',
    async () => {
      const result = await call<{ revision: string }>('POST', `/api/repos/${repo}/push`, {
        branch,
        expected_head: editor.dataset.expectedHead,
        message: message.value === '' ? `Edit ${path}` : message.value,
        files: [{ path, content: content.value }],
      });
      editor.dataset.expectedHead = result.revision;
      return `Saved as revision ${result.revision}.`;
    },
    (failure) => {
      if (failure.status === 409) {
        const strip = announce(`This file changed on ${branch} since you opened it. Your edit was not saved.`);
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'flat';
        load.textContent = 'Load latest';
        load.dataset.loadLatest = 'true';
        strip.append(load);
        return true;
      }
      return false;
    },
  );
}

async function loadLatest(control: HTMLElement): Promise<void> {
  const editor = document.querySelector<HTMLElement>('.editor');
  if (!editor) return;
  const repo = editor.dataset.repo ?? '';
  const branch = editor.dataset.branch ?? '';
  const path = editor.dataset.path ?? '';
  await act(control, 'Working...', async () => {
    const head = await call<{ revision: string }>('GET', `/api/repos/${repo}/branches/${branch}`);
    const response = await fetch(`/api/repos/${repo}/revisions/${head.revision}/files/${path}`);
    const latest = response.ok ? await response.text() : '';
    editor.dataset.expectedHead = head.revision;
    let region = editor.querySelector<HTMLElement>('[data-latest-version]');
    if (!region) {
      region = document.createElement('pre');
      region.className = 'mono filecontent';
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Latest version');
      region.dataset.latestVersion = 'true';
      editor.querySelector('[data-editor-notice]')?.append(region);
    }
    region.textContent = latest;
    control.remove();
    announcement().textContent = '';
    announcement().remove();
  });
}

function queueMove(control: HTMLElement, direction: -1 | 1): void {
  const entry = control.closest<HTMLElement>('.queueentry')!;
  const repo = repoOf(entry);
  const id = entry.dataset.queueEntryId;
  const position = Number(entry.dataset.position) + direction;
  void act(control, 'Working...', async () => {
    await call('PUT', `/api/repos/${repo}/queue/${id}/position`, { position });
  });
}

export function initForms(): void {
  document.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter as HTMLElement | null;
    void submitForm(form, submitter ?? form.querySelector('button'));
  });

  document.addEventListener('change', (event) => {
    const picker = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-form="branch-pick"] select');
    if (picker) {
      const url = new URL(window.location.href);
      url.searchParams.set('branch', picker.value);
      window.location.href = url.toString();
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const logout = target.closest<HTMLElement>('[data-action="logout"]');
    if (logout) {
      void act(logout, 'Working...', async () => {
        await call('POST', '/api/logout');
        window.location.href = '/';
      });
      return;
    }

    const save = target.closest<HTMLElement>('[data-editor-save]');
    if (save) {
      void saveFile(save.closest<HTMLElement>('.editor')!, save);
      return;
    }

    const load = target.closest<HTMLElement>('[data-load-latest]');
    if (load) {
      void loadLatest(load);
      return;
    }

    const exportArchive = target.closest<HTMLElement>('[data-export-archive]');
    if (exportArchive) {
      const parts = window.location.pathname.split('/');
      const repo = `${parts[1]}/${parts[2]}`;
      const revision = parts[4];
      void act(exportArchive, 'Exporting...', async () => {
        const result = await call<{ key: string }>('POST', `/api/repos/${repo}/revisions/${revision}/archive`);
        return `Archive saved to ${result.key}`;
      });
      return;
    }

    const revoke = target.closest<HTMLElement>('[data-revoke-token]');
    if (revoke) {
      const repo = repoOf(revoke) || window.location.pathname.split('/').slice(1, 3).join('/');
      void act(revoke, 'Working...', async () => {
        await call('DELETE', `/api/repos/${repo}/tokens/${revoke.dataset.revokeToken}`);
        window.location.reload();
      });
      return;
    }

    const remove = target.closest<HTMLElement>('[data-remove-role]');
    if (remove) {
      const repo = window.location.pathname.split('/').slice(1, 3).join('/');
      void act(remove, 'Working...', async () => {
        await call('DELETE', `/api/repos/${repo}/roles/${encodeURIComponent(remove.dataset.removeRole ?? '')}`);
        window.location.reload();
        return 'Role removed.';
      });
      return;
    }

    const move = target.closest<HTMLElement>('[data-queue-move]');
    if (move) {
      queueMove(move, move.dataset.queueMove === 'up' ? -1 : 1);
      return;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!event.altKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const entry = (event.target as HTMLElement).closest<HTMLElement>('.queueentry');
    if (!entry) return;
    const control = entry.querySelector<HTMLElement>(`[data-queue-move="${event.key === 'ArrowUp' ? 'up' : 'down'}"]`);
    if (!control) return;
    event.preventDefault();
    queueMove(control, event.key === 'ArrowUp' ? -1 : 1);
  });
}
