import type { AttachmentDescriptor } from '../../shared/types.js';
import { copy, say } from '../copy.js';
import { CorruptedAttachment, attachmentUrl, downloadToDisk } from '../data/attachments.js';
import type { LocalLetter } from '../data/store.js';
import { button, el, openDialog } from './dom.js';

/** Photo and file letters, with the digest check the recipient makes on every download. */

function thumbUrl(thumb: string): string {
  return `data:image/jpeg;base64,${thumb.replace(/-/g, '+').replace(/_/g, '/')}`;
}

function photoAlt(letter: LocalLetter, name: string): string {
  return letter.direction === 'received' ? say.photoAlt(name) : say.ownPhotoAlt();
}

export function photoLetter(
  letter: LocalLetter,
  attachment: AttachmentDescriptor,
  name: string,
): HTMLElement {
  const holder = el('div', { class: 'photo-letter' });
  const preview = el('span', {
    class: 'photo-preview',
    testid: 'photo-preview',
    attrs: { 'aria-hidden': 'true' },
  });
  if (attachment.thumb !== undefined) {
    const blurred = el('img', { attrs: { alt: '', src: thumbUrl(attachment.thumb) } });
    preview.append(blurred);
  }
  const image = el('img', { class: 'photo', attrs: { alt: photoAlt(letter, name) } });
  const open = button('Open photo', () => openViewer(open, image.src, photoAlt(letter, name)), {
    class: 'photo-button',
  });
  open.replaceChildren(preview, image);
  open.setAttribute('aria-label', 'Open photo');
  holder.append(open);

  void attachmentUrl(attachment)
    .then((url) => {
      image.src = url;
      holder.classList.add('ready');
    })
    .catch((error: unknown) => {
      holder.replaceChildren(
        el('p', {
          class: 'attachment-notice',
          text:
            error instanceof CorruptedAttachment
              ? copy.attachmentCorrupted
              : copy.attachmentUnavailable,
        }),
      );
    });
  return holder;
}

function openViewer(opener: HTMLButtonElement, source: string, alt: string): void {
  openDialog({
    label: 'Photo viewer',
    className: 'photo-viewer',
    opener,
    build: (dialog) => [
      el('img', { class: 'photo-full', attrs: { alt, src: source } }),
      button('Close photo', () => dialog.close(), { class: 'ink-button' }),
    ],
  });
}

export function fileLetter(attachment: AttachmentDescriptor): HTMLElement {
  const holder = el('div', { class: 'file-letter' });
  const download = button(say.download(attachment.name), () => {
    void downloadToDisk(attachment, attachment.name).catch((error: unknown) => {
      holder.replaceChildren(
        el('p', {
          class: 'attachment-notice',
          text:
            error instanceof CorruptedAttachment
              ? copy.attachmentCorrupted
              : copy.attachmentUnavailable,
        }),
      );
    });
  });
  holder.append(download);
  return holder;
}
