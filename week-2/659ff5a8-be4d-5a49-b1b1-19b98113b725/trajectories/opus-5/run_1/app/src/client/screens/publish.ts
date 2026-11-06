import type { PublicationDto } from '../../shared/api';
import { api } from '../api';
import { copy } from '../copy';
import { el, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import { button, formatInZone, liveRegion } from '../ui';
import { createEventShell } from './eventShell';

export function renderPublish(ctx: ScreenContext): ScreenHandle {
  const shell = createEventShell(ctx, 'publish');
  const progress = liveRegion('Publish progress');
  const banner = el('div', { class: 'form-alert', attrs: { role: 'alert' }, text: '' });
  const result = el('div', { class: 'publish-result' });
  const publishButton = button('Publish final results', {
    variant: 'primary',
    onClick: () => void publish(),
  });

  replace(
    shell.content,
    el(
      'div',
      { class: 'publish' },
      el('h1', { class: 'page-heading', text: 'Publish final results' }),
      banner,
      progress,
      el('div', { class: 'panel__actions' }, publishButton),
      result,
    ),
  );

  let publication: PublicationDto | null = null;

  function paint(): void {
    const event = shell.current();
    const timeZone = event?.timeZone ?? 'UTC';
    if (!publication) return;
    const rendererDown = publication.renderer === 'unavailable';
    banner.textContent = rendererDown ? copy.publish.renderer : '';
    publishButton.disabled = rendererDown || publication.status !== 'final';

    if (publication.publishedAt && publication.checksum) {
      const stamp = formatInZone(publication.publishedAt, timeZone);
      replace(
        result,
        el('p', { class: 'publish-result__time', text: `Published at ${stamp.date} ${stamp.time}` }),
        el('p', { class: 'publish-result__checksum mono', text: `Checksum ${publication.checksum}` }),
        el('a', {
          class: 'app-link',
          text: 'Download results PDF',
          attrs: { href: `/api/events/${shell.eventId}/results.pdf` },
        }),
        el('p', {
          class: 'meta',
          text: `Results emails accepted ${publication.emailsAccepted} of ${publication.emailsTotal}`,
        }),
      );
      return;
    }
    replace(
      result,
      el('p', {
        class: 'meta',
        text: `Checked-in drivers to email: ${publication.emailsTotal}`,
      }),
    );
  }

  async function reload(): Promise<void> {
    await shell.refreshEvent();
    publication = await api.events.publication(shell.eventId);
    paint();
  }

  async function publish(): Promise<void> {
    publishButton.disabled = true;
    publishButton.classList.add('is-pending');
    progress.textContent = copy.publish.pending;
    try {
      await api.events.publish(shell.eventId);
      progress.textContent = copy.publish.success;
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      if (failure.code === 'renderer_unavailable') progress.textContent = copy.publish.renderer;
      else if (failure.code === 'storage_unavailable') progress.textContent = copy.publish.storage;
      else if (failure.code === 'mail_unavailable') progress.textContent = copy.publish.mail;
      else progress.textContent = failure.message ?? 'Publishing failed.';
    } finally {
      publishButton.classList.remove('is-pending');
      await reload();
    }
  }

  const timer = window.setInterval(() => {
    void reload();
  }, 10_000);
  const onFocus = (): void => {
    void reload();
  };
  window.addEventListener('focus', onFocus);
  void reload();

  return {
    element: shell.element,
    destroy: () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      shell.destroy();
    },
  };
}
