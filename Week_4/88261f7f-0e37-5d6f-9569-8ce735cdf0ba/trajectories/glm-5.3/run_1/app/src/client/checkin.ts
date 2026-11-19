import { ApiRequest, errorText } from './api.js';
import { el, status } from './ui.js';

interface CheckinInfo {
  hotelName: string; arrival: string; departure: string; roomType: string; photo: 'none' | 'received';
}

export function renderCheckinPage(root: HTMLElement, token: string): void {
  const checkinStatus = status('');
  checkinStatus.setAttribute('role', 'status');
  checkinStatus.id = 'checkin-status';

  const content = el('div', { class: 'sign-in' });
  root.replaceChildren(content);

  void (async () => {
    const res = await ApiRequest.get(`/api/checkin/${token}`);
    if (res.status !== 200) {
      content.replaceChildren(el('h1', { text: 'Check in' }), el('p', { text: 'This check-in link is no longer valid.' }));
      return;
    }
    const info = res.data as CheckinInfo;
    const fullName = el('input', { type: 'text', 'aria-label': 'Full name' }) as HTMLInputElement;
    const phone = el('input', { type: 'text', 'aria-label': 'Phone' }) as HTMLInputElement;
    const fileInput = el('input', { type: 'file', 'aria-label': 'ID photo', accept: 'image/jpeg,image/png' }) as HTMLInputElement;
    const uploadBtn = el('button', { text: 'Upload photo' }) as HTMLButtonElement;
    const completeBtn = el('button', { text: 'Complete check-in', class: 'primary' }) as HTMLButtonElement;

    uploadBtn.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        checkinStatus.textContent = 'Please upload a JPEG or PNG photo.';
        return;
      }
      checkinStatus.textContent = 'Uploading photo…';
      const form = new FormData();
      form.append('photo', file);
      const res2 = await fetch(`/api/checkin/${token}/photo`, { method: 'POST', body: form });
      if (res2.ok) {
        checkinStatus.textContent = 'Received';
      } else {
        try {
          const body = JSON.parse(await res2.text());
          checkinStatus.textContent = body.error ?? 'Your photo could not be saved. Please try again.';
        } catch {
          checkinStatus.textContent = 'Your photo could not be saved. Please try again.';
        }
      }
    });

    completeBtn.addEventListener('click', async () => {
      checkinStatus.textContent = 'Completing check-in…';
      const res3 = await ApiRequest.post(`/api/checkin/${token}/complete`, { fullName: fullName.value, phone: phone.value });
      if (res3.status === 200) {
        checkinStatus.textContent = `Check-in complete. See you on ${info.arrival}.`;
      } else {
        const text = errorText(res3.data);
        if (res3.status === 409) {
          checkinStatus.textContent = text ?? 'Please upload your ID photo first.';
        } else if (res3.status === 422 && res3.data?.errors?.fullName) {
          checkinStatus.textContent = res3.data.errors.fullName;
        } else if (res3.status === 404) {
          content.replaceChildren(el('h1', { text: 'Check in' }), el('p', { text: 'This check-in link is no longer valid.' }));
        } else {
          checkinStatus.textContent = text ?? 'Check-in failed.';
        }
      }
    });

    content.replaceChildren(
      el('h1', { text: 'Check in' }),
      el('p', {}, el('b', { text: info.hotelName })),
      el('p', { text: `${info.arrival} to ${info.departure} · ${info.roomType}` }),
      el('div', { class: 'form-row' }, el('label', { text: 'Full name' }), fullName),
      el('div', { class: 'form-row' }, el('label', { text: 'Phone' }), phone),
      el('div', { class: 'form-row' }, el('label', { text: 'ID photo' }), fileInput),
      el('div', {}, uploadBtn, completeBtn),
      checkinStatus
    );
    if (info.photo === 'received') checkinStatus.textContent = 'Received';
  })();
}
