import { api } from '../api';
import { clear, el } from '../dom';
import { frame } from '../frame';
import { Screen, ScreenParams, navigate } from '../router';
import { ObjectDto, ShareLinkDto } from '../types';
import { openDialog } from '../components/dialog';
import { onLive } from '../live';
import { COPY, linkCreatedCopy } from '../../shared/copy';

type CollectionPayload = { id: string; name: string; objects: ObjectDto[] };

const SHARE_REFRESH_MS = 5000;

export function collectionScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let timer = 0;
  let collectionId = '';
  const linkList = el('ul', { className: 'share-links', attrs: { 'aria-label': 'Share links' } });

  async function loadLinks(): Promise<void> {
    const result = await api.get<{ share_links: ShareLinkDto[] }>(
      `/api/collections/${collectionId}/share-links`,
    );
    if (!result.ok) return;
    clear(linkList);
    for (const link of result.data.share_links) {
      const item = el('li', { className: 'share-link' });
      const status = link.status === 'active' ? 'Active' : link.status === 'expired' ? 'Expired' : 'Revoked';
      item.append(
        el('span', { className: 'share-status', text: status }),
        el('span', { className: 'share-expires', text: `Expires ${link.expires_at_display}` }),
        el('span', { className: 'share-url', text: `${window.location.origin}${link.url}` }),
      );
      if (link.status === 'active') {
        const copy = el('button', { text: 'Copy link', attrs: { type: 'button' } });
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(`${window.location.origin}${link.url}`);
        });
        const revoke = el('button', { text: 'Revoke link', attrs: { type: 'button' } });
        revoke.addEventListener('click', () => openRevokeDialog(link, revoke));
        const regenerate = el('button', { text: 'Regenerate link', attrs: { type: 'button' } });
        regenerate.addEventListener('click', () => {
          void (async () => {
            const answer = await api.post<ShareLinkDto>(`/api/share-links/${link.id}/regenerate`);
            if (answer.ok) frame().announce(COPY.linkRegenerated);
            await loadLinks();
          })();
        });
        item.append(copy, revoke, regenerate);
      }
      linkList.append(item);
    }
  }

  function openRevokeDialog(link: ShareLinkDto, opener: HTMLElement): void {
    openDialog({
      label: 'Revoke this link?',
      role: 'alertdialog',
      opener,
      content: (handle) => {
        const confirm = el('button', { text: 'Revoke', attrs: { type: 'button' } });
        const cancel = el('button', { text: 'Cancel', attrs: { type: 'button' } });
        confirm.addEventListener('click', () => {
          void (async () => {
            const answer = await api.post<ShareLinkDto>(`/api/share-links/${link.id}/revoke`);
            handle.close();
            if (answer.ok) frame().announce(COPY.linkRevoked);
            await loadLinks();
          })();
        });
        cancel.addEventListener('click', () => handle.close());
        return [confirm, cancel];
      },
    });
  }

  function openShareDialog(opener: HTMLElement): void {
    openDialog({
      label: 'Share collection',
      opener,
      content: (handle) => {
        const field = el('input', {
          attrs: { type: 'datetime-local', 'aria-label': 'Link expires (home clock)', id: 'share-expiry' },
        });
        const error = el('div', { className: 'field-error' });
        const create = el('button', { text: 'Create link', attrs: { type: 'button' } });
        create.addEventListener('click', () => {
          void (async () => {
            const result = await api.post<ShareLinkDto>(`/api/collections/${collectionId}/share-links`, {
              expires_at: field.value.slice(0, 16),
            });
            if (!result.ok) {
              error.textContent = result.errors?.['expires_at'] ?? '';
              field.focus();
              return;
            }
            handle.close();
            frame().announce(linkCreatedCopy(result.data.expires_at_display));
            await loadLinks();
          })();
        });
        return [
          el('label', { text: 'Link expires (home clock)', attrs: { for: 'share-expiry' } }),
          field,
          error,
          create,
        ];
      },
    });
  }

  return {
    async mount(params: ScreenParams): Promise<void> {
      collectionId = params.params['id'];
      const main = frame().main;
      clear(main);
      clear(frame().margin);
      const result = await api.get<CollectionPayload>(`/api/collections/${collectionId}`);
      if (!result.ok) {
        main.append(el('h1', { text: COPY.notFound }));
        return;
      }
      frame().setTopTitle(result.data.name);
      main.append(el('h1', { text: result.data.name, attrs: { tabindex: '-1' } }));
      const list = el('ul', { className: 'collection-objects' });
      for (const object of result.data.objects) {
        const link = el('a', { text: object.title, attrs: { href: `/o/${object.id}` } });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          navigate(`/o/${object.id}`);
        });
        const item = el('li', { children: [link] });
        if (object.share_visibility === 'never') {
          item.append(el('span', { className: 'never-shared', text: 'Never shared' }));
        }
        list.append(item);
      }
      const board = el('button', { className: 'open-board', text: 'Board', attrs: { type: 'button' } });
      board.addEventListener('click', () => navigate(`/collections/${collectionId}/board`));
      const share = el('button', {
        className: 'share-collection',
        text: 'Share collection',
        attrs: { type: 'button' },
      });
      share.addEventListener('click', () => openShareDialog(share));
      main.append(list, board, share, linkList);
      await loadLinks();
      timer = window.setInterval(() => void loadLinks(), SHARE_REFRESH_MS);
      stopLive = onLive((type) => {
        if (type === 'share_link.changed') void loadLinks();
      });
    },
    unmount(): void {
      if (stopLive !== null) stopLive();
      if (timer !== 0) window.clearInterval(timer);
    },
  };
}
