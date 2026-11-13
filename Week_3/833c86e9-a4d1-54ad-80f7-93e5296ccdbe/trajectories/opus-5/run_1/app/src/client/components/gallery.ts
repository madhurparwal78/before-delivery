import { el, openDialog } from '../dom';
import { isRtl, m, t } from '../i18n';
import { gallerySlide } from '../motion';

/** `dialog "Pictures"`: arrows and swipe move one picture. */
export function openGallery(pictures: string[], opener: HTMLElement): void {
  let index = 0;
  openDialog({ name: t('ui.pictures'), opener, className: 'gallery' }, (body, handle) => {
    handle.root.setAttribute('data-index', '1');
    const image = el('img', {
      src: pictures[0] ?? '',
      alt: t('ui.picture_i', { i: 1, n: pictures.length }),
      class: 'gallery-image',
      draggable: 'false',
    });
    const outage = el('div', { role: 'alert', class: 'outage-band', hidden: true }, [m('storage.pictures')]);
    image.addEventListener('error', () => {
      image.hidden = true;
      outage.hidden = false;
    });
    const previous = el('button', { type: 'button' }, [t('ui.prev_picture')]);
    const next = el('button', { type: 'button' }, [t('ui.next_picture')]);

    const show = (target: number, forward: boolean): void => {
      if (pictures.length === 0) return;
      index = Math.min(pictures.length - 1, Math.max(0, target));
      image.src = pictures[index];
      image.alt = t('ui.picture_i', { i: index + 1, n: pictures.length });
      handle.root.setAttribute('data-index', String(index + 1));
      gallerySlide(image, forward);
    };

    previous.addEventListener('click', () => show(index - 1, false));
    next.addEventListener('click', () => show(index + 1, true));

    handle.root.addEventListener('keydown', (event) => {
      const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
      const back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
      if (event.key === forward) {
        event.preventDefault();
        show(index + 1, true);
      } else if (event.key === back) {
        event.preventDefault();
        show(index - 1, false);
      }
    });

    let startX: number | null = null;
    const endDrag = (clientX: number): void => {
      if (startX === null) return;
      const delta = clientX - startX;
      startX = null;
      if (Math.abs(delta) < 60) return;
      const towardsNext = isRtl() ? delta > 0 : delta < 0;
      show(towardsNext ? index + 1 : index - 1, towardsNext);
    };
    image.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      image.setPointerCapture(event.pointerId);
    });
    image.addEventListener('pointerup', (event) => endDrag(event.clientX));
    image.addEventListener('pointercancel', () => {
      startX = null;
    });
    image.addEventListener('touchstart', (event) => {
      startX = event.touches[0]?.clientX ?? null;
    });
    image.addEventListener('touchend', (event) => endDrag(event.changedTouches[0]?.clientX ?? 0));

    body.append(el('div', { class: 'gallery-stage' }, [image, outage]), el('div', { class: 'gallery-nav' }, [previous, next]));
  });
}
