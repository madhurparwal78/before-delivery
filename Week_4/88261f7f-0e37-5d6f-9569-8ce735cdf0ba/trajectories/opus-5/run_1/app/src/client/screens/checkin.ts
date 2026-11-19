import { deadLinkText, notices, pendingTexts } from '../../shared/notices';
import { call, upload } from '../api';
import { button, el, labelled, textbox } from '../dom';
import { regionNames, setMessage, statusRegion } from '../regions';
import { CheckinPage } from '../types';

export async function checkinScreen(token: string): Promise<HTMLElement> {
  const result = await call<CheckinPage>(`/api/checkin/${encodeURIComponent(token)}`);
  if (!result.data) {
    return el('main', { class: 'guestpage' }, [el('p', { text: result.error ?? deadLinkText })]);
  }
  const page = result.data;

  const fullName = textbox('Full name');
  const phone = textbox('Phone');
  const photo = el('input', { type: 'file', accept: 'image/jpeg,image/png' });
  const photoField = labelled('ID photo', photo);

  const uploadButton = button('Upload photo', (event) => {
    const trigger = event.currentTarget as HTMLButtonElement;
    if (trigger.getAttribute('aria-busy') === 'true') return;
    const file = photo.files && photo.files.length > 0 ? photo.files[0] : null;
    if (!file) return;
    trigger.setAttribute('aria-busy', 'true');
    setMessage(regionNames.checkInStatus, pendingTexts.uploadPhoto);
    const form = new FormData();
    form.append('photo', file, file.name);
    void upload<{ photo: string }>(`/api/checkin/${encodeURIComponent(token)}/photo`, form).then(
      (reply) => {
        trigger.removeAttribute('aria-busy');
        setMessage(
          regionNames.checkInStatus,
          reply.ok ? notices.photoReceived : reply.error ?? deadLinkText,
        );
      },
    );
  });

  const completeButton = button('Complete check-in', (event) => {
    const trigger = event.currentTarget as HTMLButtonElement;
    if (trigger.getAttribute('aria-busy') === 'true') return;
    trigger.setAttribute('aria-busy', 'true');
    setMessage(regionNames.checkInStatus, pendingTexts.completeCheckIn);
    void call<{ completed: boolean }>(`/api/checkin/${encodeURIComponent(token)}/complete`, {
      method: 'POST',
      body: { fullName: fullName.value.trim(), phone: phone.value.trim() },
    }).then((reply) => {
      trigger.removeAttribute('aria-busy');
      setMessage(
        regionNames.checkInStatus,
        reply.data
          ? notices.checkInComplete(page.arrival)
          : reply.error ?? Object.values(reply.fieldErrors ?? {})[0] ?? deadLinkText,
      );
    });
  });

  if (page.photo === 'received') setMessage(regionNames.checkInStatus, notices.photoReceived);

  return el('main', { class: 'guestpage' }, [
    el('h1', { text: page.hotelName }),
    el('p', { text: `${page.arrival} to ${page.departure}` }),
    el('p', { text: page.roomType }),
    el('h2', { text: 'Check in' }),
    labelled('Full name', fullName),
    labelled('Phone', phone),
    photoField,
    uploadButton,
    completeButton,
    statusRegion(regionNames.checkInStatus),
  ]);
}
