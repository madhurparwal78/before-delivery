import { all, one, readState, setText } from './dom.js';
import { call } from './api.js';
import { notify, notifyThenRefresh, showFailure } from './forms.js';
import { wireUploadForm } from './upload.js';
import type { Locale } from '../shared/locale.js';
import { localeFromLang } from '../shared/locale.js';
import { s } from '../shared/strings.js';
import { movedToState } from '../shared/strings.js';
import { stateLabel } from '../shared/labels.js';
import type { ModelState, Mover } from '../domain/states.js';
import { allowedTargets, isModelState } from '../domain/states.js';
import type { Camera, Hotspot } from '../shared/viewer.js';

interface ViewerBridge {
  camera(): Camera;
  hotspots(): Hotspot[];
  beginPlacing(): void;
  labelLast(label: string): void;
}

interface PageState {
  slug: string;
  locale: Locale;
  lang: string | null;
  mover: Mover;
}

const state = readState<PageState>('model-state');
if (state !== null) wire(state);

function bridge(): ViewerBridge | null {
  return (window as unknown as { turnstoneViewer?: ViewerBridge }).turnstoneViewer ?? null;
}

function numberOrNull(value: string): number | null {
  return value.trim() === '' ? null : Number.parseInt(value, 10);
}

function wire(state: PageState): void {
  const locale: Locale = state.locale ?? localeFromLang(state.lang);
  const form = one<HTMLFormElement>('[data-model-form]');
  const alertNode = one('[data-model-alert]');
  const base = `/api/studio/models/${state.slug}`;

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      notify(s('noticeSaving', locale));
      const value = (name: string): string =>
        one<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`, form)?.value ?? '';
      const password = value('password');
      try {
        await call(base, {
          method: 'PATCH',
          locale,
          body: {
            title: value('title'),
            description: value('description'),
            category: value('category'),
            visibility: value('visibility'),
            ...(password === '' ? {} : { password }),
            prices: {
              personal_cents: Number.parseInt(value('personal_cents'), 10),
              commercial_cents: numberOrNull(value('commercial_cents')),
              studio_cents: numberOrNull(value('studio_cents')),
            },
            discount_percent: Number.parseInt(value('discount_percent') || '0', 10),
            edition_total: numberOrNull(value('edition_total')),
            edition_price_cents: numberOrNull(value('edition_price_cents')),
          },
        });
        if (alertNode !== null) alertNode.textContent = '';
        notify(s('noticeSaved', locale));
      } catch (error) {
        notify('');
        showFailure(alertNode, error, locale, form);
      }
    })();
  });

  /** State controls are enabled exactly when their move is legal from the state. */
  function showState(current: ModelState): void {
    const allowed = new Set(allowedTargets(current, state.mover));
    for (const button of all<HTMLButtonElement>('[data-transition]')) {
      const target = button.dataset.transition ?? '';
      button.disabled = !isModelState(target) || !allowed.has(target);
    }
    setText(one('[data-model-state]'), stateLabel(current, locale));
  }

  for (const button of all<HTMLButtonElement>('[data-transition]')) {
    button.addEventListener('click', () => {
      void (async () => {
        const to = button.dataset.transition ?? '';
        try {
          const moved = await call<{ state: ModelState }>(`${base}/transitions`, {
            method: 'POST',
            locale,
            body: { to },
          });
          showState(moved.state);
          notify(movedToState(stateLabel(moved.state, locale), locale));
        } catch (error) {
          showFailure(alertNode, error, locale, form);
        }
      })();
    });
  }

  one<HTMLButtonElement>('[data-new-share-link]')?.addEventListener('click', () => {
    void (async () => {
      try {
        const reply = await call<{ share_url: string }>(`${base}/share-link`, {
          method: 'POST',
          locale,
          body: {},
        });
        const node = one('[data-share-url]');
        if (node !== null) node.textContent = reply.share_url;
        notify(s('noticeShareLink', locale));
      } catch (error) {
        showFailure(alertNode, error, locale, form);
      }
    })();
  });

  one<HTMLButtonElement>('[data-create-embed]')?.addEventListener('click', () => {
    void (async () => {
      try {
        await call(`${base}/embeds`, { method: 'POST', locale, body: {} });
        notifyThenRefresh(s('noticeEmbedCreated', locale));
      } catch (error) {
        showFailure(alertNode, error, locale, form);
      }
    })();
  });

  for (const button of all<HTMLButtonElement>('[data-remove-embed]')) {
    button.addEventListener('click', () => {
      void (async () => {
        await call(`/api/studio/embeds/${button.dataset.removeEmbed ?? ''}`, {
          method: 'DELETE',
          locale,
        });
        notifyThenRefresh(s('noticeEmbedRemoved', locale));
      })();
    });
  }

  const replaceForm = one<HTMLFormElement>('[data-replace-form]');
  if (replaceForm !== null) {
    wireUploadForm(replaceForm, '/api/studio/uploads', alertNode, { model: state.slug });
  }

  async function saveView(): Promise<void> {
    const viewer = bridge();
    if (viewer === null) return;
    try {
      await call(`${base}/view`, {
        method: 'PUT',
        locale,
        body: { default_camera: viewer.camera(), hotspots: viewer.hotspots() },
      });
      notify(s('noticeSaved', locale));
    } catch (error) {
      showFailure(alertNode, error, locale, form);
    }
  }

  one<HTMLButtonElement>('[data-save-view]')?.addEventListener('click', () => void saveView());
  one<HTMLButtonElement>('[data-save-hotspots]')?.addEventListener('click', () => {
    const label = one<HTMLInputElement>('[data-hotspot-label]')?.value ?? '';
    if (label !== '') bridge()?.labelLast(label);
    void saveView();
  });
  one<HTMLButtonElement>('[data-add-hotspot]')?.addEventListener('click', () => {
    bridge()?.beginPlacing();
  });
}
