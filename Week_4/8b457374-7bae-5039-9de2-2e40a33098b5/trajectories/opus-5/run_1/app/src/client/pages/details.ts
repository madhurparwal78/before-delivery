import { FIELD_COPY } from '../../shared/copy.js';
import type { CampaignDto, PersonWithKeyDto } from '../../shared/types.js';
import { ApiFailure, confirmKey, post } from '../api.js';
import { el } from '../dom.js';
import { navigate } from '../router.js';
import { heldKey, holdKey } from '../session.js';
import { openDialog } from '../ui/dialog.js';
import { fieldError } from '../ui/parts.js';

const DAY_MS = 86_400_000;

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** A local date and time 30 days out at 20:00, the shape the editor's Deadline field takes. */
function defaultDeadline(): string {
  const target = new Date(Date.now() + 30 * DAY_MS);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T20:00`;
}

export async function createDraftAndOpenEditor(): Promise<void> {
  const campaign = await post<CampaignDto>('/api/campaigns', {
    body: {
      title: 'Untitled campaign',
      story: '',
      goal: 10_000,
      min_run_copies: 100,
      stretch: [],
      ships_from: 'GB',
      time_zone: browserTimeZone(),
      deadline_local: defaultDeadline(),
    },
  });
  navigate(`/studio/campaigns/${campaign.id}`);
}

/**
 * Opens "Your details" when the browser holds no key, otherwise goes straight on to a
 * fresh draft in the editor.
 */
export function openDetailsDialog(opener: HTMLElement): void {
  if (heldKey() !== null) {
    void createDraftAndOpenEditor();
    return;
  }

  const name = el('input', { type: 'text', id: 'details-name', 'aria-label': 'Name' });
  const email = el('input', { type: 'email', id: 'details-email', 'aria-label': 'Email' });
  const keyField = el('input', { type: 'text', id: 'details-key', 'aria-label': 'Key' });
  const nameError = el('div', { class: 'field-errors' });
  const emailError = el('div', { class: 'field-errors' });
  const keyError = el('div', { class: 'field-errors' });
  const continueButton = el('button', { type: 'button', class: 'button' }, 'Continue');
  const useKeyButton = el('button', { type: 'button', class: 'button button--quiet' }, 'Use key');
  const issued = el('div', { class: 'issued-key' });

  const body = el(
    'div',
    { class: 'dialog-body' },
    el('h2', { class: 'dialog-title' }, 'Your details'),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'details-name' }, 'Name'),
      name,
      nameError,
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'details-email' }, 'Email'),
      email,
      emailError,
    ),
    el('div', { class: 'dialog-actions' }, continueButton),
    issued,
    el('hr', { class: 'rule' }),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'details-key' }, 'Key'),
      el('p', { class: 'field-hint' }, 'Already have a Dotgain key? Paste it here.'),
      keyField,
      keyError,
    ),
    el('div', { class: 'dialog-actions' }, useKeyButton),
  );

  const dialog = openDialog({
    name: 'Your details',
    body,
    initialFocus: () => name,
    returnFocus: () => opener,
  });

  continueButton.addEventListener('click', () => {
    void (async () => {
      nameError.replaceChildren();
      emailError.replaceChildren();
      continueButton.disabled = true;
      try {
        const person = await post<PersonWithKeyDto>('/api/people', {
          anonymous: true,
          body: { name: name.value.trim(), email: email.value.trim() },
        });
        holdKey(person.key);
        const done = el('button', { type: 'button', class: 'button' }, 'Done');
        issued.replaceChildren(
          el(
            'p',
            { class: 'issued-key-line' },
            'Your Dotgain key:',
            ' ',
            el('code', { class: 'issued-key-value' }, person.key),
          ),
          el('p', { class: 'field-hint' }, 'Keep it safe. It is shown once.'),
          el('div', { class: 'dialog-actions' }, done),
        );
        done.focus();
        done.addEventListener('click', () => {
          dialog.close();
          void createDraftAndOpenEditor();
        });
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.fields['name'] !== undefined) {
          nameError.replaceChildren(fieldError(error.fields['name']));
        }
        if (error.fields['email'] !== undefined) {
          emailError.replaceChildren(fieldError(error.fields['email']));
        }
        if (Object.keys(error.fields).length === 0) {
          emailError.replaceChildren(fieldError(FIELD_COPY.email));
        }
        (error.fields['name'] !== undefined ? name : email).focus();
      } finally {
        continueButton.disabled = false;
      }
    })();
  });

  useKeyButton.addEventListener('click', () => {
    void (async () => {
      keyError.replaceChildren();
      useKeyButton.disabled = true;
      const candidate = keyField.value.trim();
      if (await confirmKey(candidate)) {
        holdKey(candidate);
        dialog.close();
        void createDraftAndOpenEditor();
        return;
      }
      keyError.replaceChildren(fieldError('That key is not one Dotgain issued.'));
      keyField.focus();
      useKeyButton.disabled = false;
    })();
  });
}
