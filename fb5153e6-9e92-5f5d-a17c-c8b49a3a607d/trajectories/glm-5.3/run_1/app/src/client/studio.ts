import { api, copy, announce, wireCore, ApiFailure, showError } from './app-core.js';

/** Upload with a progress bar driven by the bytes sent. */
function wireUploadForm(): void {
  const form = document.getElementById('upload-form') as HTMLFormElement | null;
  if (form === null) return;
  const alert = form.querySelector<HTMLElement>('.form-alert');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const fileInput = form.querySelector<HTMLInputElement>('#upload-file');
    const titleInput = form.querySelector<HTMLInputElement>('#upload-title');
    const unitSelect = form.querySelector<HTMLSelectElement>('#upload-unit');
    const categorySelect = form.querySelector<HTMLSelectElement>('#upload-category');
    const file = fileInput?.files?.[0];
    if (file === undefined) {
      showError(alert, new ApiFailure('validation_failed', 'Check the highlighted fields.', { file: copy('field.file_missing') }, 422));
      return;
    }
    const body = new FormData();
    body.append('file', file);
    if (titleInput !== null) body.append('title', titleInput.value);
    if (unitSelect !== null) body.append('source_unit', unitSelect.value);
    if (categorySelect !== null) body.append('category', categorySelect.value);
    const progress = form.querySelector<HTMLElement>('#upload-progress') as HTMLProgressElement | null;
    const label = document.getElementById('upload-progress-label');
    const request = new XMLHttpRequest();
    request.open('POST', '/api/studio/uploads');
    request.upload.addEventListener('progress', event => {
      if (progress === null || !event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      progress.value = percent;
      announce(label, copy('upload.sending', { percent }));
    });
    request.addEventListener('load', () => {
      if (request.status === 202) {
        const result = JSON.parse(request.responseText) as { queue_url: string };
        window.location.href = result.queue_url;
        return;
      }
      const bodyText = request.responseText;
      try {
        const parsed = JSON.parse(bodyText) as { error: string; message: string; fields?: Record<string, string> };
        showError(alert, new ApiFailure(parsed.error, parsed.message, parsed.fields ?? {}, request.status));
      } catch {
        showError(alert, new ApiFailure('not_found', bodyText, {}, request.status));
      }
    });
    request.addEventListener('error', () => {
      showError(alert, new ApiFailure('storage_unavailable', copy('storage_unavailable'), {}, 503));
    });
    request.send(body);
  });
}

function wireStudioNavMenu(): void {
  const toggle = document.getElementById('studio-menu-toggle');
  const nav = document.querySelector<HTMLElement>('.studio-nav');
  if (toggle === null || nav === null) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) nav.querySelector('a')?.focus();
  });
}

function wireStateButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-transition]').forEach(button => {
    button.addEventListener('click', () => {
      const slug = button.closest<HTMLElement>('[data-slug]')?.dataset['slug'] ?? window.location.pathname.split('/').pop() ?? '';
      const to = button.dataset['transition'] ?? '';
      announce(document.getElementById('studio-notices'), copy('studio.saving'));
      void api(`/api/studio/models/${slug}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ to }),
      })
        .then(() => {
          announce(document.getElementById('studio-notices'), copy('studio.moved', { state: copy(`state.${to}`) }));
          window.setTimeout(() => window.location.reload(), 2500);
        })
        .catch(err => {
          const failure = err instanceof ApiFailure ? err : null;
          const message =
            failure !== null
              ? failure.code === 'illegal_transition'
                ? copy('illegal_transition', { from: copy('state.unknown'), to: copy(`state.${to}`) })
                : copy(failure.code) === failure.code
                  ? failure.message
                  : copy(failure.code)
              : copy('not_found');
          announce(document.getElementById('studio-notices'), message);
        });
    });
  });
}

function wireCollections(): void {
  const form = document.getElementById('collection-form') as HTMLFormElement | null;
  if (form !== null) {
    const alert = form.querySelector<HTMLElement>('.form-alert');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const name = (form.querySelector('#collection-name') as HTMLInputElement).value;
      void api('/api/studio/collections', { method: 'POST', body: JSON.stringify({ name }) })
        .then(() => {
          announce(document.getElementById('studio-notices'), copy('studio.collection_deleted').replace(copy('studio.collection_deleted'), copy('studio.saved')));
          window.location.reload();
        })
        .catch(err => {
          const failure = err instanceof ApiFailure ? err : null;
          if (failure !== null && failure.fields['name'] !== undefined) {
            showError(alert, failure);
          }
        });
    });
  }
  document.querySelectorAll<HTMLButtonElement>('.delete-collection').forEach(button => {
    button.addEventListener('click', () => {
      const slug = button.dataset['slug'] ?? '';
      void api(`/api/studio/collections/${slug}`, { method: 'DELETE' }).then(() => {
        announce(document.getElementById('studio-notices'), copy('studio.collection_deleted'));
        window.location.reload();
      });
    });
  });
  document.querySelectorAll<HTMLFormElement>('.collection-add').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const slug = form.dataset['slug'] ?? '';
      const model = (form.querySelector('select') as HTMLSelectElement).value;
      void api(`/api/studio/collections/${slug}/items`, { method: 'POST', body: JSON.stringify({ model }) })
        .then(result => {
          const collection = result as { name: string };
          announce(document.getElementById('studio-notices'), copy('studio.added_to', { collection: collection.name }));
          window.location.reload();
        })
        .catch(err => {
          const failure = err instanceof ApiFailure ? err : null;
          if (failure?.code === 'already_in_collection') {
            announce(document.getElementById('studio-notices'), copy('already_in_collection'));
          }
        });
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.remove-button').forEach(button => {
    button.addEventListener('click', () => {
      const collectionSlug = button.closest<HTMLElement>('.collection-region')?.dataset['slug'] ?? '';
      const item = button.closest<HTMLElement>('li');
      const modelSlug = item?.dataset['slug'] ?? '';
      void api(`/api/studio/collections/${collectionSlug}/items/${modelSlug}`, { method: 'DELETE' }).then(() => {
        announce(document.getElementById('studio-notices'), copy('studio.removed_from', { collection: collectionSlug }));
        window.location.reload();
      });
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.move-button').forEach(button => {
    button.addEventListener('click', () => {
      const region = button.closest<HTMLElement>('.collection-region');
      const collectionSlug = region?.dataset['slug'] ?? '';
      const item = button.closest<HTMLElement>('li');
      const modelSlug = item?.dataset['slug'] ?? '';
      const target = region?.querySelector<HTMLSelectElement>('select[data-move-to]')?.value ?? '';
      if (target === '') return;
      void api(`/api/studio/collections/${collectionSlug}/items/${modelSlug}/move`, {
        method: 'POST',
        body: JSON.stringify({ to: target }),
      })
        .then(result => {
          const move = result as { to: { name: string } };
          announce(document.getElementById('studio-notices'), copy('studio.moved_to', { collection: move.to.name }));
          window.location.reload();
        })
        .catch(err => {
          const failure = err instanceof ApiFailure ? err : null;
          if (failure?.code === 'already_in_collection') {
            announce(document.getElementById('studio-notices'), copy('already_in_collection'));
          }
        });
    });
  });
}

function wirePlanChange(): void {
  document.querySelectorAll<HTMLButtonElement>('.switch-plan').forEach(button => {
    button.addEventListener('click', () => {
      const plan = button.dataset['plan'] ?? '';
      const dialog = document.createElement('div');
      dialog.className = 'dialog-underlay';
      dialog.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title">
  <h2 id="plan-dialog-title">${copy('plan.dialog')}</h2>
  <p>${copy('plan.switch_to', { plan: copy(`plan.${plan}`) })}</p>
  <button type="button" id="confirm-plan">${copy('plan.confirm')}</button>
  <button type="button" id="cancel-plan">${copy('checkout.cancel')}</button>
</div>`;
      document.body.appendChild(dialog);
      document.body.classList.add('modal-open');
      (dialog.querySelector('#confirm-plan') as HTMLButtonElement).focus();
      const close = (): void => {
        dialog.remove();
        document.body.classList.remove('modal-open');
      };
      (dialog.querySelector('#cancel-plan') as HTMLButtonElement).addEventListener('click', close);
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      });
      (dialog.querySelector('#confirm-plan') as HTMLButtonElement).addEventListener('click', () => {
        announce(document.getElementById('studio-notices'), copy('studio.plan_pending'));
        const idemKey = `ui-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
        void api<{ status: number; plan: string; pending: { plan: string; effective_date: string } | null; charged_cents: number | null }>(
          '/api/studio/plan',
          { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify({ plan }) },
        )
          .then(result => {
            if (result.pending !== null) {
              announce(
                document.getElementById('studio-notices'),
                copy('studio.downgrade_accepted', { plan: copy(`plan.${result.pending.plan}`), date: result.pending.effective_date }),
              );
            } else {
              announce(
                document.getElementById('studio-notices'),
                copy('studio.upgrade_done', { plan: copy(`plan.${result.plan}`), amount: amountOf(result.charged_cents ?? 0) }),
              );
            }
            close();
            window.setTimeout(() => window.location.reload(), 2500);
          })
          .catch(err => {
            const failure = err instanceof ApiFailure ? err : null;
            const message =
              failure !== null
                ? copy(failure.code) === failure.code
                  ? failure.message
                  : copy(failure.code)
                : copy('billing_unavailable');
            announce(document.getElementById('studio-notices'), message);
            close();
          });
      });
    });
  });
}

function amountOf(cents: number): string {
  const l = document.documentElement.lang === 'de' ? 'de' : 'en';
  const whole = Math.floor(cents / 100).toLocaleString(l === 'en' ? 'en-US' : 'de-DE');
  const part = String(cents % 100).padStart(2, '0');
  return l === 'en' ? `€${whole}.${part}` : `${whole},${part} €`;
}

function wireApiKeys(): void {
  const form = document.getElementById('api-key-form') as HTMLFormElement | null;
  if (form === null) return;
  const alert = form.querySelector<HTMLElement>('.form-alert');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = (form.querySelector('#key-name') as HTMLInputElement).value;
    void api<{ ref: string; name: string; key: string }>('/api/studio/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
      .then(result => {
        announce(document.getElementById('studio-notices'), copy('studio.key_created'));
        if (alert !== null) {
          alert.textContent = `${copy('api_keys.your_key')}: ${result.key}`;
          alert.hidden = false;
        }
        window.setTimeout(() => window.location.reload(), 4000);
      })
      .catch(err => {
        const failure = err instanceof ApiFailure ? err : null;
        if (failure !== null && failure.fields['name'] !== undefined) {
          showError(alert, failure);
        } else if (failure !== null) {
          announce(document.getElementById('studio-notices'), copy(failure.code) === failure.code ? failure.message : copy(failure.code));
        }
      });
  });
  document.querySelectorAll<HTMLButtonElement>('.revoke-key').forEach(button => {
    button.addEventListener('click', () => {
      const ref = button.dataset['ref'] ?? '';
      void api(`/api/studio/api-keys/${ref}`, { method: 'DELETE' }).then(() => {
        announce(document.getElementById('studio-notices'), copy('studio.key_revoked'));
        window.location.reload();
      });
    });
  });
}

function wireModelSettings(): void {
  const form = document.getElementById('model-settings') as HTMLFormElement | null;
  if (form === null) return;
  const alert = form.querySelector<HTMLElement>('.form-alert');
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (form.dataset['readOnly'] === 'true') return;
    const slug = form.dataset['slug'] ?? '';
    const value = (input: string): string => (form.querySelector(input) as HTMLInputElement).value;
    const body: Record<string, unknown> = {
      title: value('#set-title'),
      description: (form.querySelector('#set-description') as HTMLTextAreaElement).value,
      category: (form.querySelector('#set-category') as HTMLSelectElement).value,
      visibility: (form.querySelector('#set-visibility') as HTMLSelectElement).value,
      prices: {
        personal_cents: eurosToCents(value('#set-personal')),
        commercial_cents: eurosToCents(value('#set-commercial')),
        studio_cents: eurosToCents(value('#set-studio')),
      },
      discount_percent: Number(value('#set-discount') || '0'),
    };
    if (body['visibility'] === 'password') {
      const password = value('#set-password');
      if (password !== '') body['password'] = password;
    }
    const editionTotal = value('#set-edition-total');
    const editionPrice = value('#set-edition-price');
    if (editionTotal === '') body['edition_total'] = null;
    else body['edition_total'] = Number(editionTotal);
    if (editionPrice !== '') body['edition_price_cents'] = eurosToCents(editionPrice);
    announce(document.getElementById('studio-notices'), copy('studio.saving'));
    void api(`/api/studio/models/${slug}`, { method: 'PATCH', body: JSON.stringify(body) })
      .then(() => {
        announce(document.getElementById('studio-notices'), copy('studio.saved'));
      })
      .catch(err => {
        const failure = err instanceof ApiFailure ? err : null;
        if (failure !== null && Object.keys(failure.fields).length > 0) {
          showError(alert, failure);
        } else if (failure !== null) {
          announce(document.getElementById('studio-notices'), copy(failure.code) === failure.code ? failure.message : copy(failure.code));
        }
      });
  });
  const newShareLink = document.getElementById('new-share-link');
  newShareLink?.addEventListener('click', () => {
    const slug = window.location.pathname.split('/').pop() ?? '';
    void api<{ share_url: string }>(`/api/studio/models/${slug}/share-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then(() => {
      announce(document.getElementById('studio-notices'), copy('studio.share_link'));
      window.location.reload();
    });
  });
  const createEmbed = document.getElementById('create-embed');
  createEmbed?.addEventListener('click', () => {
    const slug = window.location.pathname.split('/').pop() ?? '';
    void api(`/api/studio/models/${slug}/embeds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => {
        announce(document.getElementById('studio-notices'), copy('studio.embed_created'));
        window.location.reload();
      })
      .catch(err => {
        const failure = err instanceof ApiFailure ? err : null;
        if (failure !== null) {
          announce(document.getElementById('studio-notices'), copy(failure.code) === failure.code ? failure.message : copy(failure.code));
        }
      });
  });
  document.querySelectorAll<HTMLButtonElement>('.remove-embed').forEach(button => {
    button.addEventListener('click', () => {
      const token = button.dataset['token'] ?? '';
      void api(`/api/studio/embeds/${token}`, { method: 'DELETE' }).then(() => {
        announce(document.getElementById('studio-notices'), copy('studio.embed_removed'));
        window.location.reload();
      });
    });
  });
  const replaceForm = document.getElementById('replace-form') as HTMLFormElement | null;
  if (replaceForm !== null) {
    replaceForm.addEventListener('submit', event => {
      event.preventDefault();
      const slug = replaceForm.dataset['slug'] ?? '';
      const file = replaceForm.querySelector<HTMLInputElement>('#replace-file')?.files?.[0];
      if (file === undefined) return;
      const unit = (replaceForm.querySelector('#replace-unit') as HTMLSelectElement).value;
      const body = new FormData();
      body.append('file', file);
      body.append('model', slug);
      body.append('source_unit', unit);
      const request = new XMLHttpRequest();
      request.open('POST', '/api/studio/uploads');
      request.addEventListener('load', () => {
        if (request.status === 202) {
          const result = JSON.parse(request.responseText) as { queue_url: string };
          window.location.href = result.queue_url;
        }
      });
      request.send(body);
    });
  }
}

function wireTextureSets(): void {
  const form = document.getElementById('texture-form') as HTMLFormElement | null;
  if (form === null) return;
  const alert = form.querySelector<HTMLElement>('.form-alert');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const model = (form.querySelector('#texture-model') as HTMLSelectElement).value;
    const name = (form.querySelector('#texture-name') as HTMLInputElement).value;
    const file = form.querySelector<HTMLInputElement>('#texture-file')?.files?.[0];
    if (file === undefined || model === '') {
      showError(alert, new ApiFailure('validation_failed', 'Check the highlighted fields.', { file: copy('field.file_missing') }, 422));
      return;
    }
    const body = new FormData();
    body.append('model', model);
    body.append('name', name);
    body.append('file', file);
    const request = new XMLHttpRequest();
    request.open('POST', '/api/contrib/texture-sets');
    request.addEventListener('load', () => {
      if (request.status === 201) {
        announce(document.getElementById('studio-notices'), copy('studio.texture_set'));
        form.reset();
        return;
      }
      try {
        const parsed = JSON.parse(request.responseText) as { error: string; message: string; fields?: Record<string, string> };
        showError(alert, new ApiFailure(parsed.error, parsed.message, parsed.fields ?? {}, request.status));
      } catch {
        showError(alert, new ApiFailure('not_found', request.responseText, {}, request.status));
      }
    });
    request.send(body);
  });
}

function eurosToCents(text: string): number | null {
  if (text === '') return null;
  const match = /^\\s*(\\d{1,6})(?:[.,](\\d{1,2}))?\\s*$/.exec(text);
  if (match === null) return null;
  const whole = match[1] ?? '0';
  const part = (match[2] ?? '').padEnd(2, '0');
  return Number(whole) * 100 + Number(part === '' ? '0' : part);
}

wireCore();
wireUploadForm();
wireStudioNavMenu();
wireStateButtons();
wireCollections();
wirePlanChange();
wireApiKeys();
wireModelSettings();
wireTextureSets();
