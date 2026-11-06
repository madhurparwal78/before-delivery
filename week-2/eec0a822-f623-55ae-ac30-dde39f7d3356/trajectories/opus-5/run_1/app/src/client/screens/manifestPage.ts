import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { publicPage } from '../lib/chrome.js';
import { createMessageBox, FieldSet, withPending } from '../lib/forms.js';
import type { RouteContext } from '../lib/router.js';
import { button, quietButton, textbox } from '../lib/views.js';
import { COUNTRIES } from '../../shared/countries.js';
import { MESSAGES } from '../../shared/copy.js';
import { formatDate } from '../../shared/format.js';
import { endedScreen, notFoundScreen } from './feedbackPages.js';
import type { ManifestGuest } from '../lib/types.js';

interface ManifestBody {
  readonly yachtName: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly maxGuests: number;
  readonly status: 'live';
  readonly endsAt: string;
  readonly guests: readonly ManifestGuest[];
}

export async function manifestPageScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const token = context.params.token;
  const first = await api.get<ManifestBody>(`/api/manifest/${token}`);
  if (first.status === 410) {
    await endedScreen(host);
    return;
  }
  if (!first.ok) {
    await notFoundScreen(host);
    return;
  }
  const manifest = first.data;
  const page = publicPage(host, `Guest manifest for ${manifest.yachtName}`);
  const messages = createMessageBox();
  const fields = new FieldSet();
  const guestHost = el('div', { class: 'guest-list' });
  const addGuest = button('Add guest');
  const saveManifest = button('Save manifest');
  let guests: ManifestGuest[] = [...manifest.guests];

  const controls = new Map<
    string,
    {
      fullName: HTMLInputElement;
      nationality: HTMLSelectElement;
      dateOfBirth: HTMLInputElement;
      passportNumber: HTMLInputElement;
    }
  >();

  const paint = (): void => {
    guestHost.replaceChildren();
    controls.clear();
    for (const [index, guest] of guests.entries()) {
      const fullName = textbox('Full name', guest.fullName);
      const nationality = el('select', { class: 'combobox', 'aria-label': 'Nationality' }) as HTMLSelectElement;
      nationality.appendChild(el('option', { value: '' }, 'Choose a country'));
      for (const country of COUNTRIES) {
        nationality.appendChild(el('option', { value: country.code }, country.name));
      }
      nationality.value = guest.nationality ?? '';
      const dateOfBirth = textbox('Date of birth');
      const passportNumber = textbox('Passport number');
      controls.set(guest.id, { fullName, nationality, dateOfBirth, passportNumber });

      const photoInput = el('input', {
        type: 'file',
        class: 'file-input',
        'aria-label': `Passport photo for ${guest.fullName}`,
      }) as HTMLInputElement;
      const photoButton = button(`Add passport photo for ${guest.fullName}`);
      photoButton.addEventListener('click', () => photoInput.click());
      photoInput.addEventListener('change', () => {
        const chosen = photoInput.files?.[0];
        if (chosen === undefined) return;
        void withPending(photoButton, 'Uploading photo', async () => {
          const form = new FormData();
          form.append('photo', chosen, chosen.name);
          const result = await api.post(
            `/api/manifest/${token}/guests/${guest.id}/photo`,
            form,
          );
          if (result.ok) {
            messages.show(MESSAGES.photoSaved(guest.fullName));
            await reload();
            return;
          }
          const body = failure(result);
          if (result.status === 413) messages.show(MESSAGES.photoTooLarge, 'problem');
          else if (body.error === 'storage_unavailable') {
            messages.show(MESSAGES.storageUnavailable, 'problem');
          } else if (body.errors !== undefined) {
            messages.show(Object.values(body.errors)[0], 'problem');
          } else messages.show(MESSAGES.unexpected, 'problem');
        });
      });

      const group = el(
        'fieldset',
        { class: 'guest-group', role: 'group', 'aria-label': `Guest ${index + 1}` },
        el('legend', {}, `Guest ${index + 1}`),
        fields.field(`guests.${index}.fullName`, 'Full name', fullName),
        fields.field(`guests.${index}.nationality`, 'Nationality', nationality),
        fields.field(`guests.${index}.dateOfBirth`, 'Date of birth', dateOfBirth),
        fields.field(`guests.${index}.passportNumber`, 'Passport number', passportNumber),
        guest.passportOnFile === true && guest.dateOfBirthOnFile === true
          ? el('p', { class: 'on-file' }, 'Passport details on file')
          : null,
        guest.photoOnFile === true ? el('p', { class: 'on-file' }, 'Photo on file') : null,
        photoButton,
        photoInput,
      );
      guestHost.appendChild(group);
    }
  };

  const reload = async (): Promise<void> => {
    const result = await api.get<ManifestBody>(`/api/manifest/${token}`);
    if (!result.ok) return;
    guests = [...result.data.guests];
    paint();
  };

  addGuest.addEventListener('click', () => {
    openDialog({
      name: 'Add guest',
      kind: 'sheet',
      opener: addGuest,
      build: (handle) => {
        const dialogFields = new FieldSet(true);
        const fullName = textbox('Full name');
        const dialogMessage = createMessageBox();
        const confirm = button('Add guest');
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());
        confirm.addEventListener('click', () => {
          void withPending(confirm, 'Saving manifest', async () => {
            const result = await api.post<{ guest: ManifestGuest }>(
              `/api/manifest/${token}/guests`,
              { fullName: fullName.value },
            );
            if (result.ok) {
              handle.close();
              messages.show(MESSAGES.guestAdded(result.data.guest.fullName));
              await reload();
              return;
            }
            const body = failure(result);
            if (body.error === 'manifest_full') {
              dialogMessage.show(MESSAGES.manifestFull(Number(body.maxGuests)), 'problem');
            } else if (body.errors !== undefined) {
              dialogFields.showErrors(body.errors)?.focus();
              return;
            } else if (result.status === 410) {
              dialogMessage.show(MESSAGES.unexpected, 'problem');
            } else dialogMessage.show(MESSAGES.unexpected, 'problem');
            confirm.focus();
          });
        });
        return {
          body: [
            dialogFields.field('fullName', 'Full name', fullName),
            dialogMessage.node,
            el('div', { class: 'dialog-actions' }, confirm, cancel),
          ],
          first: () => fullName,
        };
      },
    });
  });

  saveManifest.addEventListener('click', () => {
    void withPending(saveManifest, 'Saving manifest', async () => {
      const payload = guests.map((guest) => {
        const control = controls.get(guest.id);
        return {
          id: guest.id,
          fullName: control?.fullName.value ?? guest.fullName,
          nationality: control?.nationality.value ?? '',
          dateOfBirth: control?.dateOfBirth.value ?? '',
          passportNumber: control?.passportNumber.value ?? '',
        };
      });
      const result = await api.put(`/api/manifest/${token}/guests`, { guests: payload });
      if (result.ok) {
        messages.show(MESSAGES.manifestSaved);
        await reload();
        return;
      }
      const body = failure(result);
      if (body.errors !== undefined) {
        fields.showErrors(body.errors)?.focus();
        return;
      }
      messages.show(MESSAGES.unexpected, 'problem');
    });
  });

  page.main.append(
    el(
      'p',
      { class: 'card-figure' },
      `${formatDate(manifest.weekStart)} to ${formatDate(manifest.weekEnd)}`,
    ),
    fields.problems,
    el(
      'form',
      { class: 'manifest-form', novalidate: true, onsubmit: (event: Event) => event.preventDefault() },
      el('div', { class: 'manifest-scroll' }, guestHost, addGuest, messages.node),
      el('div', { class: 'sticky-bar' }, saveManifest),
    ),
  );
  paint();
}
