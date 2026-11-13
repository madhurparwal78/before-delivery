import { h } from '../lib/els.js';
import { store } from '../lib/store.js';
import { api, ApiFail, upload } from '../lib/api.js';
import { announce } from '../lib/announce.js';
import { live } from '../lib/live.js';
import type { Member } from '../lib/types.js';

export async function profilePage(): Promise<HTMLElement> {
  const root = h('div');
  const me = store.me;
  if (!me) {
    root.append(h('h1', null, 'Profile'), h('p', null, h('a', { href: '/sign-in' }, 'Sign in to see your profile.')));
    return root;
  }

  let idState: Member['id_state'] = me.id_state;
  let idReason: string | null = null;
  try {
    const res = await api<{ id_state: Member['id_state']; reason: string | null }>('GET', '/api/me/id-document');
    idState = res.id_state;
    idReason = res.reason;
  } catch { /* keep member state */ }

  const statusLine = h('p', null, '');
  const statusText = (): string => `ID status: ${idState === 'none' ? 'not uploaded' : idState === 'pending' ? 'waiting for review' : idState === 'verified' ? 'verified' : 'please upload again'}`;
  statusLine.textContent = statusText();

  const photoInput = h('input', { type: 'file', accept: 'image/png,image/jpeg', id: 'photo-input', class: 'visually-hidden' }) as HTMLInputElement;
  const photoLabel = h('label', { for: 'photo-input', class: 'field file-label' }, 'Profile photo');
  const photoBtn = h('button', { type: 'button', class: 'btn', onClick: () => photoInput.click() }, 'Upload photo');

  const idInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,application/pdf', id: 'id-input', class: 'visually-hidden' }) as HTMLInputElement;
  const idLabel = h('label', { for: 'id-input', class: 'field file-label' }, 'ID document');
  const idBtn = h('button', { type: 'button', class: 'btn', onClick: () => idInput.click() }, 'Upload ID document');

  let pendingPhoto: File | null = null;
  let pendingId: File | null = null;
  const tryAgainWrap = h('div');

  const sendPhoto = async (file: File): Promise<void> => {
    photoBtn.textContent = 'Working';
    try {
      await upload('/api/me/photo', file);
      announce('Profile photo saved.');
      photoBtn.textContent = 'Upload photo';
      tryAgainWrap.replaceChildren();
      await store.refreshMe();
    } catch (e) {
      if (e instanceof ApiFail) {
        if (e.code === 'storage_unavailable') {
          pendingPhoto = file;
          tryAgainWrap.append(h('button', { type: 'button', class: 'btn', onClick: () => void sendPhoto(file) }, 'Try again'));
        }
        announce(e.body.message);
      }
      photoBtn.textContent = 'Upload photo';
    }
  };

  const sendId = async (file: File): Promise<void> => {
    idBtn.textContent = 'Working';
    try {
      await upload('/api/me/id-document', file);
      announce('ID document received. It is waiting for review.');
      idState = 'pending';
      statusLine.textContent = statusText();
      idBtn.textContent = 'Upload ID document';
      tryAgainWrap.replaceChildren();
    } catch (e) {
      if (e instanceof ApiFail) {
        if (e.code === 'storage_unavailable') {
          pendingId = file;
          tryAgainWrap.append(h('button', { type: 'button', class: 'btn', onClick: () => void sendId(file) }, 'Try again'));
        }
        announce(e.body.message);
      }
      idBtn.textContent = 'Upload ID document';
    }
  };

  photoInput.addEventListener('change', () => { if (photoInput.files?.[0]) void sendPhoto(photoInput.files[0]); });
  idInput.addEventListener('change', () => { if (idInput.files?.[0]) void sendId(idInput.files[0]); });

  live.setHandlers({
    onIdReview: (p: { id_state: string; reason: string | null }): void => {
      idState = p.id_state as Member['id_state'];
      idReason = p.reason;
      statusLine.textContent = statusText();
      if (p.id_state === 'verified') announce('Your ID is verified.');
      if (p.id_state === 'rejected') announce(`Please upload your ID again: ${p.reason}.`);
    },
    onHello: (): void => { /* refetch handled by live */ },
  });
  live.subscribe(null, null);

  const photoUrl = me.photo_url;
  root.append(
    h('h1', null, 'Profile'),
    photoUrl ? h('img', { src: photoUrl, alt: '', class: 'driver-photo', style: { width: '96px', height: '96px', objectFit: 'cover' } }) : h('p', { class: 'muted' }, 'No photo yet.'),
    h('p', null, photoLabel, photoBtn),
    h('p', null, idLabel, idBtn),
    statusLine,
    idState === 'rejected' && idReason ? h('p', { class: 'muted' }, idReason) : h('span'),
    tryAgainWrap,
    photoInput,
    idInput,
  );
  void pendingPhoto; void pendingId;
  return root;
}
