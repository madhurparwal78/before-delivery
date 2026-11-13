import type { BlockRecord, PreviewSetting, ProfileBody } from '../../shared/types.js';
import { availabilityCopy, copy, say } from '../copy.js';
import { api, ApiFailure } from '../data/api.js';
import { preparePhoto, WrongPhotoType, type PreparedPhoto } from '../data/photos.js';
import { saveMyProfile } from '../data/profiles.js';
import { emit, state } from '../data/store.js';
import { uploadProfilePhoto } from '../data/uploads.js';
import { formatDate } from '../format.js';
import { attachSlip, button, el, field, sheet, withBusy } from './dom.js';
import { announce } from './live.js';
import { availabilityChip } from './username.js';

function panel(children: (Node | string)[]): HTMLElement {
  const { outer, inner } = sheet({ class: 'form-sheet' });
  inner.append(el('div', { class: 'form-panel' }, children));
  return outer;
}

export function settingsScreen(): HTMLElement {
  const pane = el('div', { class: 'list-screen settings' });
  pane.append(profilePanel(), usernamePanel(), preferencesPanel(), blockedPanel());
  return pane;
}

function profilePanel(): HTMLElement {
  const nameInput = el('input', {
    attrs: { type: 'text', 'aria-label': 'Display name', autocomplete: 'off', maxlength: '40' },
  });
  nameInput.value = state.profile?.display_name ?? '';
  const errors = el('div', { class: 'slip-holder' });
  const photoInput = el('input', {
    class: 'file-input',
    attrs: {
        type: 'file',
        'aria-label': 'Photo',
        accept: 'image/jpeg,image/png,image/webp',
        tabindex: '-1',
      },
  });
  let chosen: PreparedPhoto | null = null;
  const pinned = el('div', { class: 'pinned-holder' });

  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (file === undefined) return;
    void preparePhoto(file)
      .then((prepared) => {
        chosen = prepared;
        pinned.replaceChildren(el('p', { class: 'pinned', text: file.name }));
      })
      .catch((error: unknown) => {
        pinned.replaceChildren(
          el('p', {
            class: 'slip',
            text: error instanceof WrongPhotoType ? copy.wrongPhotoType : copy.somethingWrong,
          }),
        );
      });
  });

  const save = button('Save profile', () => {
    void withBusy(save, async () => {
      const displayName = nameInput.value.trim();
      if (displayName === '') {
        attachSlip(nameInput, errors, copy.displayNameEmpty);
        nameInput.focus();
        return;
      }
      attachSlip(nameInput, errors, null);
      const profile: ProfileBody = {
        v: 1,
        display_name: displayName,
        photo: state.profile?.photo ?? null,
      };
      if (chosen !== null) {
        try {
          profile.photo = await uploadProfilePhoto(chosen);
        } catch {
          pinned.replaceChildren(el('p', { class: 'slip', text: copy.photoNotStored }));
        }
      }
      try {
        await saveMyProfile(profile);
      } catch {
        errors.replaceChildren(el('p', { class: 'slip', text: copy.somethingWrong }));
      }
    });
  }, { class: 'ink-button' });

  return panel([
    el('h2', { text: 'Your profile' }),
    field('Display name', nameInput),
    errors,
    button('Add a photo', () => photoInput.click()),
    photoInput,
    pinned,
    save,
  ]);
}

function usernamePanel(): HTMLElement {
  const input = el('input', {
    attrs: { type: 'text', 'aria-label': 'New username', autocomplete: 'off', spellcheck: 'false' },
  });
  const chip = availabilityChip();
  const errors = el('div', { class: 'slip-holder' });
  input.addEventListener('input', () => chip.check(input.value.trim()));

  const change = button('Change username', () => {
    void withBusy(change, async () => {
      try {
        const account = await api.changeUsername(input.value.trim().toLowerCase());
        state.me = account;
        emit('me');
        attachSlip(input, errors, null);
        announce(say.usernameChanged(account.username));
        input.value = '';
        chip.check('');
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        attachSlip(input, errors, usernameError(error));
      }
    });
  }, { class: 'ink-button' });

  return panel([
    el('h2', { text: 'Your username' }),
    el('p', { class: 'current-username', text: state.me?.username ?? '' }),
    field('New username', input),
    chip.element,
    errors,
    change,
  ]);
}

function usernameError(error: ApiFailure): string {
  if (error.code === 'username_cooldown') {
    return say.usernameCooldown(formatDate(String(error.extra['retry_at'])));
  }
  if (error.code === 'username_taken') return copy.availability.taken;
  const reason = error.fields['username'];
  if (reason === 'same') return copy.usernameSame;
  if (reason !== undefined) return availabilityCopy(reason, false);
  return copy.somethingWrong;
}

function preferencesPanel(): HTMLElement {
  const receipts = state.me?.settings.read_receipts ?? true;
  const toggle = el('button', {
    class: 'switch',
    attrs: { role: 'switch', 'aria-label': 'Read receipts', 'aria-checked': String(receipts) },
    text: receipts ? 'On' : 'Off',
  });
  toggle.type = 'button';
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-checked') !== 'true';
    void withBusy(toggle, async () => {
      const account = await api.saveSettings({ read_receipts: next });
      state.me = account;
      emit('me');
      toggle.setAttribute('aria-checked', String(account.settings.read_receipts));
      toggle.textContent = account.settings.read_receipts ? 'On' : 'Off';
    });
  });

  const options: { label: string; value: PreviewSetting }[] = [
    { label: 'Name and letter', value: 'name_and_letter' },
    { label: 'Name only', value: 'name_only' },
    { label: 'No name or letter', value: 'none' },
  ];
  const radios = options.map((option) => {
    const input = el('input', {
      attrs: {
        type: 'radio',
        name: 'preview',
        value: option.value,
        'aria-label': option.label,
      },
    });
    input.checked = state.me?.settings.preview === option.value;
    input.addEventListener('change', () => {
      void api.saveSettings({ preview: option.value }).then((account) => {
        state.me = account;
        emit('me');
      });
    });
    return el('label', { class: 'radio' }, [input, el('span', { text: option.label })]);
  });

  return panel([
    el('h2', { text: 'Letters' }),
    el('div', { class: 'switch-row' }, [el('span', { text: 'Read receipts' }), toggle]),
    el(
      'fieldset',
      { class: 'radiogroup', attrs: { role: 'radiogroup', 'aria-label': 'Notification preview' } },
      radios,
    ),
    el('a', {
      class: 'blocked-link',
      text: 'Blocked contacts',
      attrs: { href: '#blocked-contacts' },
    }),
  ]);
}

function blockedPanel(): HTMLElement {
  const list = el('ul', {
    class: 'rows blocked',
    attrs: { role: 'list', 'aria-label': 'Blocked contacts' },
  });
  const holder = el('div', { class: 'blocked-holder' }, [list]);

  function paint(blocks: BlockRecord[]): void {
    state.blocks = blocks;
    list.replaceChildren();
    holder.querySelector('[data-testid="empty-state"]')?.remove();
    if (blocks.length === 0) {
      holder.append(
        el('p', { class: 'empty-copy', testid: 'empty-state', text: copy.empty.blocked }),
      );
      return;
    }
    for (const block of blocks) {
      const unblock = button(say.unblockButton(block.username), () => {
        void withBusy(unblock, async () => {
          await api.unblock(block.account_id);
          paint((await api.blocks()).blocks);
        });
      });
      list.append(el('li', { class: 'row' }, [el('span', { text: block.username }), unblock]));
    }
  }

  void api.blocks().then((result) => paint(result.blocks));

  return panel([
    el('h2', { text: 'Blocked contacts', attrs: { id: 'blocked-contacts' } }),
    holder,
  ]);
}
