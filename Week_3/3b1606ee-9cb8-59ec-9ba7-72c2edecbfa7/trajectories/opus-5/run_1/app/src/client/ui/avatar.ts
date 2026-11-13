import type { ProfileBody } from '../../shared/types.js';
import { attachmentUrl } from '../data/attachments.js';
import { el, plainAvatar } from './dom.js';

/** A contact's photo when this device can open it, otherwise the plain avatar. */
export function contactAvatar(profile: ProfileBody | null): HTMLElement {
  const photo = profile?.photo ?? null;
  if (photo === null) return plainAvatar();
  const image = el('img', {
    class: 'avatar plate',
    attrs: { alt: '', width: '48', height: '48' },
  });
  void attachmentUrl(photo)
    .then((url) => {
      image.src = url;
    })
    .catch(() => {
      image.replaceWith(plainAvatar());
    });
  return image;
}
