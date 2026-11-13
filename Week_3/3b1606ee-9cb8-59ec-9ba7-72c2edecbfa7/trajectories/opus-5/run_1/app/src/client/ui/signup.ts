import type { ProfileBody } from '../../shared/types.js';
import { copy, say } from '../copy.js';
import { createIdentity } from '../crypto/identity.js';
import { newProfileKey } from '../crypto/seal.js';
import { newRecoveryCode, recoveryGroups, recoveryMaterial } from '../crypto/recovery.js';
import { api, ApiFailure } from '../data/api.js';
import { saveIdentity } from '../data/keys.js';
import { preparePhoto, WrongPhotoType, type PreparedPhoto } from '../data/photos.js';
import { saveMyProfile } from '../data/profiles.js';
import { state } from '../data/store.js';
import { uploadProfilePhoto } from '../data/uploads.js';
import { attachSlip, button, el, field, sheet, withBusy } from './dom.js';
import { navigate } from './router.js';
import { availabilityChip } from './username.js';

interface SignUpState {
  username: string;
  code: string;
  checkPositions: number[];
  photo: PreparedPhoto | null;
}

export function signUpScreen(onSignedIn: () => Promise<void>): HTMLElement {
  const { outer, inner } = sheet({ class: 'form-sheet' });
  const panel = el('div', { class: 'form-panel' });
  inner.append(panel);

  const draft: SignUpState = { username: '', code: '', checkPositions: [], photo: null };
  const skipCheck =
    state.config.grading && new URLSearchParams(location.search).get('skip_recovery_check') === '1';

  function renderUsernameStep(): void {
    const input = el('input', {
      attrs: { type: 'text', 'aria-label': 'Username', autocomplete: 'off', spellcheck: 'false' },
    });
    const chip = availabilityChip();
    const errors = el('div', { class: 'slip-holder' });
    const submit = button('Continue', () => void run(), { class: 'ink-button' });

    input.addEventListener('input', () => chip.check(input.value.trim()));

    async function run(): Promise<void> {
      await withBusy(submit, async () => {
        const value = input.value.trim();
        const record = await api.availability(value);
        if (!record.available) {
          attachSlip(
            input,
            errors,
            record.reason === 'taken' ? copy.availability.taken : chipReason(record.reason),
          );
          input.focus();
          return;
        }
        attachSlip(input, errors, null);
        draft.username = record.username;
        renderCodeStep();
      });
    }

    const form = el('form', { class: 'step', on: { submit: (event) => {
      event.preventDefault();
      void run();
    } } }, [
      el('h1', { class: 'step-heading', text: 'Choose a username' }),
      field('Username', input),
      chip.element,
      errors,
      submit,
    ]);
    panel.replaceChildren(form);
    input.focus();
  }

  function chipReason(reason: string | null): string {
    switch (reason) {
      case 'length':
        return copy.availability.length;
      case 'characters':
        return copy.availability.characters;
      case 'first_character':
        return copy.availability.first_character;
      default:
        return copy.availability.last_character;
    }
  }

  function renderCodeStep(): void {
    draft.code = newRecoveryCode();
    const group = el('div', {
      class: 'recovery',
      attrs: { role: 'group', 'aria-label': 'Your recovery code' },
    }, [el('p', { class: 'recovery-code', testid: 'recovery-code', text: draft.code })]);
    const errors = el('div', { class: 'slip-holder' });
    const next = button("I've written it down", () => void run(), { class: 'ink-button' });

    async function run(): Promise<void> {
      if (skipCheck) {
        await withBusy(next, async () => {
          await createAccount(errors, next);
        });
        return;
      }
      renderCheckStep();
    }

    panel.replaceChildren(
      el('form', { class: 'step', on: { submit: (event) => {
        event.preventDefault();
        void run();
      } } }, [
        el('h1', { class: 'step-heading', text: 'Your recovery code' }),
        el('p', {
          class: 'step-note',
          text:
            'Write this down now. It is the only way back into this account, and it is never ' +
            'stored at the exchange.',
        }),
        group,
        errors,
        next,
      ]),
    );
    next.focus();
  }

  function renderCheckStep(): void {
    const groups = recoveryGroups(draft.code);
    draft.checkPositions = pickPositions(groups.length);
    const inputs = draft.checkPositions.map((position) => {
      const input = el('input', {
        attrs: {
          type: 'text',
          'aria-label': say.group(position),
          autocomplete: 'off',
          spellcheck: 'false',
          maxlength: '4',
        },
      });
      return { position, input };
    });
    const errors = inputs.map(() => el('div', { class: 'slip-holder' }));
    const check = button('Check', () => void run(), { class: 'ink-button' });

    async function run(): Promise<void> {
      let firstWrong: HTMLInputElement | null = null;
      inputs.forEach((entry, index) => {
        const expected = groups[entry.position - 1] as string;
        const typed = entry.input.value.trim().toUpperCase();
        const holder = errors[index] as HTMLElement;
        if (typed === expected) {
          attachSlip(entry.input, holder, null);
          return;
        }
        attachSlip(entry.input, holder, copy.recoveryWrongGroup);
        firstWrong ??= entry.input;
      });
      if (firstWrong !== null) {
        (firstWrong as HTMLInputElement).focus();
        return;
      }
      await withBusy(check, async () => {
        await createAccount(errors[0] as HTMLElement, check);
      });
    }

    panel.replaceChildren(
      el('form', { class: 'step', on: { submit: (event) => {
        event.preventDefault();
        void run();
      } } }, [
        el('h1', { class: 'step-heading', text: 'Check your recovery code' }),
        ...inputs.flatMap((entry, index) => [
          field(say.group(entry.position), entry.input),
          errors[index] as HTMLElement,
        ]),
        check,
      ]),
    );
    inputs[0]?.input.focus();
  }

  async function createAccount(errors: HTMLElement, control: HTMLButtonElement): Promise<void> {
    const material = await recoveryMaterial(draft.code);
    const identity = await createIdentity(material.backupKey);
    try {
      const account = await api.createAccount({
        username: draft.username,
        public_key: identity.publicKey,
        recovery_verifier: material.verifier,
        key_backup: identity.keyBackup,
      });
      await saveIdentity(account.id, account.key_id, identity.privateKey, newProfileKey());
      state.me = account;
      await onSignedIn();
      renderProfileStep();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'username_taken') {
        renderUsernameStep();
        return;
      }
      const message = el('p', { class: 'slip', text: copy.somethingWrong });
      errors.replaceChildren(message);
      control.focus();
    }
  }

  function renderProfileStep(): void {
    const nameInput = el('input', {
      attrs: { type: 'text', 'aria-label': 'Display name', autocomplete: 'off', maxlength: '40' },
    });
    const nameErrors = el('div', { class: 'slip-holder' });
    const photoInput = el('input', {
      class: 'file-input',
      attrs: {
        type: 'file',
        'aria-label': 'Photo',
        accept: 'image/jpeg,image/png,image/webp',
        tabindex: '-1',
      },
    });
    const photoErrors = el('div', { class: 'slip-holder' });
    const photoButton = button('Add a photo', () => photoInput.click());
    const finish = button('Finish', () => void run(), { class: 'ink-button' });

    photoInput.addEventListener('change', () => {
      const file = photoInput.files?.[0];
      if (file === undefined) return;
      void preparePhoto(file)
        .then((prepared) => {
          draft.photo = prepared;
          photoErrors.replaceChildren(el('p', { class: 'pinned', text: file.name }));
        })
        .catch((error: unknown) => {
          draft.photo = null;
          photoErrors.replaceChildren(
            el('p', {
              class: 'slip',
              text: error instanceof WrongPhotoType ? copy.wrongPhotoType : copy.somethingWrong,
            }),
          );
        });
    });

    async function run(): Promise<void> {
      const displayName = nameInput.value.trim();
      if (displayName === '') {
        attachSlip(nameInput, nameErrors, copy.displayNameEmpty);
        nameInput.focus();
        return;
      }
      attachSlip(nameInput, nameErrors, null);
      await withBusy(finish, async () => {
        const profile: ProfileBody = { v: 1, display_name: displayName, photo: null };
        if (draft.photo !== null) {
          try {
            profile.photo = await uploadProfilePhoto(draft.photo);
          } catch {
            photoErrors.replaceChildren(el('p', { class: 'slip', text: copy.photoNotStored }));
          }
        }
        await saveMyProfile(profile);
        navigate('/letters');
      });
    }

    panel.replaceChildren(
      el('form', { class: 'step', on: { submit: (event) => {
        event.preventDefault();
        void run();
      } } }, [
        el('h1', { class: 'step-heading', text: 'Your profile' }),
        field('Display name', nameInput),
        nameErrors,
        photoButton,
        photoInput,
        photoErrors,
        finish,
      ]),
    );
    nameInput.focus();
  }

  renderUsernameStep();
  return el('div', { class: 'form-screen' }, [outer]);
}

function pickPositions(total: number): number[] {
  const positions = new Set<number>();
  while (positions.size < 3) {
    positions.add(Math.floor(Math.random() * total) + 1);
  }
  return [...positions].sort((a, b) => a - b);
}
