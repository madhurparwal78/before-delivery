import { announce, setAlert, withPending } from '../announce.js';
import { api } from '../api.js';
import { copy, idStatusWords } from '../copy.js';
import { clear, focus, h } from '../dom.js';
import { connectLive } from '../live.js';
import { navigate, onLeave, type RouteContext } from '../router.js';
import { mainRegion, renderBanner } from '../shell.js';
import { currentMember, loadMember } from '../state.js';

interface Upload {
  label: 'Profile photo' | 'ID document';
  path: string;
  buttonText: 'Upload photo' | 'Upload ID document';
  done: (fileId: string) => void;
}

export function renderProfile(_ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);
  if (!currentMember()) {
    navigate('/sign-in?next=%2Fprofile');
    return;
  }
  const heading = h('h1', { text: 'Profile' });
  const photoBox = h('div', { class: 'photo-box' });
  const statusLine = h('p', { class: 'id-status' });

  const paintPhoto = () => {
    clear(photoBox);
    const url = currentMember()?.photo_url;
    if (url) {
      photoBox.appendChild(
        h('img', { src: url, alt: 'Your profile photo', class: 'profile-photo' }),
      );
    }
  };

  const paintStatus = () => {
    const member = currentMember();
    statusLine.textContent = copy.idStatus(member?.id_state ?? 'none');
  };

  const uploadRow = (upload: Upload): HTMLElement => {
    const input = h('input', { type: 'file', 'aria-label': upload.label, class: 'file' });
    const slot = h('div', { class: 'alert-slot' });
    const retry = h('button', {
      type: 'button',
      class: 'secondary',
      text: 'Try again',
      hidden: true,
    });
    const button = h('button', { type: 'button', class: 'secondary', text: upload.buttonText });

    const send = async (control: HTMLElement) => {
      const file = input.files?.[0];
      if (!file) {
        setAlert(slot, 'Choose a file to upload.');
        return;
      }
      const form = new FormData();
      form.append('file', file);
      const result = await withPending(control, () =>
        api<{ file_id: string }>('POST', upload.path, { form }),
      );
      if (!result) return;
      if (!result.ok) {
        setAlert(slot, result.failure.message);
        retry.hidden = result.failure.status !== 503;
        return;
      }
      setAlert(slot, null);
      retry.hidden = true;
      upload.done(result.data.file_id);
    };

    button.addEventListener('click', () => void send(button));
    retry.addEventListener('click', () => void send(retry));
    return h(
      'div',
      { class: 'field-box' },
      h('span', { class: 'label', text: upload.label }),
      input,
      button,
      retry,
      slot,
    );
  };

  const photoRow = uploadRow({
    label: 'Profile photo',
    path: '/api/me/photo',
    buttonText: 'Upload photo',
    done: () => {
      void (async () => {
        await loadMember();
        paintPhoto();
        renderBanner();
        announce(copy.photoSaved);
      })();
    },
  });

  const idRow = uploadRow({
    label: 'ID document',
    path: '/api/me/id-document',
    buttonText: 'Upload ID document',
    done: () => {
      void (async () => {
        await loadMember();
        paintStatus();
        announce(copy.idReceived);
      })();
    },
  });

  main.append(heading, photoBox, statusLine, photoRow, idRow);
  paintPhoto();
  paintStatus();
  focus(heading);

  const connection = connectLive({
    onHello: () => undefined,
    onEvent: (type, data) => {
      if (type !== 'id_review') return;
      const payload = data as { id_state: string; reason: string | null };
      void (async () => {
        await loadMember();
        paintStatus();
      })();
      if (payload.id_state === 'verified') announce(copy.idVerifiedLive);
      else if (payload.id_state === 'rejected') {
        announce(copy.idRejectedLive(payload.reason ?? idStatusWords('rejected')));
      }
    },
  });
  onLeave(() => connection.close());
}
