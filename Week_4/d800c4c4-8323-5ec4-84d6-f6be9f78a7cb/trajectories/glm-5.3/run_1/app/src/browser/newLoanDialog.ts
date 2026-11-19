// The New loan dialog: member combobox, tag entry, photo, check out. Keyboard-only.

import { el, clear } from './dom';
import { apiJson, apiForm, ApiFailure } from './apiClient';
import type { App } from './app';
import type { Board, Item, Loan, MemberSummary } from './types';
import { setPending, clearPending, renderProblems } from './ui';

export interface NewLoanOptions {
  app: App;
  members: MemberSummary[];
  board: Board | null;
  announce: HTMLElement;
  presetItem: Item | null;
  opener: HTMLButtonElement | null;
  onReserved: (loan: Loan) => void;
}

export function renderNewLoanDialog(options: NewLoanOptions): () => void {
  const { app, members, board, announce, presetItem, opener, onReserved } = options;
  const dialog = el('dialog', { 'aria-label': 'New loan' }) as HTMLDialogElement;
  const problems = el('div');

  const memberHolder = el('div', { class: 'field' });
  const memberInput = el('input', { type: 'text', id: 'new-loan-member', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'members-list', autocomplete: 'off' }) as HTMLInputElement;
  memberInput.setAttribute('aria-label', 'Member');
  const membersList = el('ul', { class: 'members-listbox', role: 'listbox', id: 'members-list', 'aria-label': 'Members' });
  memberHolder.append(el('label', { for: 'new-loan-member', text: 'Member' }), memberInput);

  const tagHolder = el('div', { class: 'field' });
  const tagInput = el('input', { type: 'text', id: 'new-loan-tag', autocomplete: 'off' }) as HTMLInputElement;
  tagInput.setAttribute('aria-label', 'Add tool by tag');
  tagHolder.append(el('label', { for: 'new-loan-tag', text: 'Add tool by tag' }), tagInput);

  const toolsList = el('ul', { role: 'list', 'aria-label': 'Tools on this loan' });
  const photoButton = el('button', { text: 'Take or choose photo' }) as HTMLButtonElement;
  const photoInput = el('input', { type: 'file', accept: 'image/*', id: 'new-loan-photo' }) as HTMLInputElement;
  photoButton.setAttribute('aria-controls', photoInput.id);
  photoInput.style.display = 'none';
  const checkout = el('button', { class: 'primary', text: 'Check out' }) as HTMLButtonElement;
  const discard = el('button', { text: 'Discard' }) as HTMLButtonElement;

  let pickedMember: MemberSummary | null = null;
  let toolIds: number[] = [];
  let pickedPhoto: File | null = null;
  let activeOption = -1;
  let matching: MemberSummary[] = [];
  let checkedOutTimeHolder: HTMLElement | null = null;
  let checkedOutTimeInput: HTMLInputElement | null = null;

  if (presetItem !== null) {
    toolIds = [presetItem.id];
    addToolRow(presetItem.tag, presetItem.id);
  }

  const dialogBody = el('div', { class: 'dialog-scroll' });
  dialogBody.append(
    problems,
    el('h2', { text: 'New loan' }),
    memberHolder,
    membersList,
    tagHolder,
    el('div', { class: 'field' }, toolsList),
    el('div', { class: 'row' }, photoButton),
    photoInput,
    checkout,
    el('div', { class: 'row' }, discard),
  );
  dialog.append(dialogBody);
  document.body.append(dialog);
  dialog.showModal();
  memberInput.focus();

  // --- member combobox ---
  memberInput.addEventListener('input', () => {
    const text = memberInput.value.trim().toLowerCase();
    if (pickedMember !== null && memberInput.value.trim() !== `${pickedMember.name} (${pickedMember.email})`) {
      pickedMember = null;
    }
    matching = members.filter(
      (member) => member.name.toLowerCase().includes(text) || member.email.toLowerCase().includes(text),
    );
    renderMatches();
  });

  memberInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (membersList.hidden) renderMatches();
      if (matching.length === 0) return;
      activeOption = (activeOption + 1) % matching.length;
      markActive();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (matching.length === 0) return;
      activeOption = (activeOption - 1 + matching.length) % matching.length;
      markActive();
    } else if (event.key === 'Enter') {
      if (membersList.hidden) return;
      event.preventDefault();
      if (activeOption >= 0 && matching[activeOption] !== undefined) {
        pickMember(matching[activeOption]!);
      } else if (matching.length > 0) {
        pickMember(matching[0]!);
      }
    } else if (event.key === 'Escape') {
      if (!membersList.hidden) {
        event.preventDefault();
        event.stopPropagation();
        membersList.hidden = true;
        memberInput.setAttribute('aria-expanded', 'false');
      }
    }
  });

  function renderMatches(): void {
    clear(membersList);
    if (matching.length === 0) {
      membersList.hidden = true;
      memberInput.setAttribute('aria-expanded', 'false');
      return;
    }
    membersList.hidden = false;
    memberInput.setAttribute('aria-expanded', 'true');
    for (const member of matching) {
      const option = el('li', { role: 'option', text: `${member.name} (${member.email})` });
      option.setAttribute('aria-selected', 'false');
      option.addEventListener('click', () => pickMember(member));
      membersList.append(option);
    }
    activeOption = -1;
  }

  function markActive(): void {
    for (const [index, option] of [...membersList.children].entries()) {
      option.setAttribute('aria-selected', String(index === activeOption));
    }
    memberInput.setAttribute('aria-activedescendant', `member-option-${activeOption}`);
    const active = membersList.children[activeOption];
    if (active !== undefined) active.id = `member-option-${activeOption}`;
  }

  function pickMember(member: MemberSummary): void {
    pickedMember = member;
    memberInput.value = member.name;
    membersList.hidden = true;
    memberInput.setAttribute('aria-expanded', 'false');
    tagInput.focus();
  }

  // --- tag entry ---
  tagInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const text = tagInput.value.trim().toUpperCase();
    if (text === '') return;
    const item = board?.items.find((i) => i.tag.toUpperCase() === text);
    if (item === undefined) {
      showTagMessage(`No tool has tag ${text}.`);
      return;
    }
    if (toolIds.includes(item.id)) {
      showTagMessage(`${text} is already on this loan.`);
      return;
    }
    clearTagMessage();
    tagInput.value = '';
    toolIds.push(item.id);
    addToolRow(item.tag, item.id);
  });

  function showTagMessage(text: string): void {
    clearTagMessage();
    tagHolder.append(el('p', { class: 'field-error', text }));
  }

  function clearTagMessage(): void {
    const existing = tagHolder.querySelector('.field-error');
    if (existing !== null) existing.remove();
  }

  tagInput.addEventListener('input', clearTagMessage);

  function addToolRow(tag: string, itemId: number): void {
    const remove = el('button', { text: `Remove ${tag}`, class: 'tag-card-btn' }) as HTMLButtonElement;
    remove.setAttribute('aria-label', `Remove ${tag}`);
    remove.style.minHeight = '44px';
    remove.addEventListener('click', () => {
      toolIds = toolIds.filter((id) => id !== itemId);
      remove.parentElement?.remove();
    });
    toolsList.append(el('li', {}, el('span', { class: 'mono', text: tag }), remove));
  }

  // --- photo ---
  photoButton.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', () => {
    pickedPhoto = photoInput.files?.[0] ?? null;
    const existing = dialogBody.querySelector('.picked-thumb');
    if (existing !== null) existing.remove();
    if (pickedPhoto !== null) {
      const img = el('img', { src: URL.createObjectURL(pickedPhoto), alt: 'Picked photo', class: 'picked-thumb' }) as HTMLImageElement;
      img.style.maxWidth = '160px';
      img.style.display = 'block';
      photoButton.after(img);
    }
  });

  // --- entries and leaving ---
  function hasEntries(): boolean {
    return pickedMember !== null || toolIds.length > 0 || pickedPhoto !== null;
  }

  function closeDialog(): void {
    dialog.close();
    dialog.remove();
    if (opener !== null) opener.focus();
    else {
      const scan = document.querySelector('input[aria-label="Scan or find a loan"]');
      if (scan instanceof HTMLElement) scan.focus();
    }
  }

  function maybePromptDiscard(after: () => void): void {
    if (!hasEntries()) {
      after();
      return;
    }
    const prompt = el('dialog', { class: 'alert-prompt', 'aria-label': 'Discard this loan?' }) as HTMLDialogElement;
    prompt.setAttribute('role', 'alertdialog');
    const keep = el('button', { text: 'Keep editing' }) as HTMLButtonElement;
    const discardLoan = el('button', { text: 'Discard loan' }) as HTMLButtonElement;
    prompt.append(
      el('h2', { text: 'Discard this loan?' }),
      el('p', { text: 'Discard this loan? The member, tools and photo you entered will be cleared.' }),
      el('div', { class: 'row' }, keep),
      el('div', { class: 'row' }, discardLoan),
    );
    dialog.append(prompt);
    prompt.showModal();
    keep.focus();
    const closePrompt = () => {
      prompt.close();
      prompt.remove();
      memberInput.focus();
    };
    keep.addEventListener('click', closePrompt);
    prompt.addEventListener('cancel', (event) => {
      event.preventDefault();
      closePrompt();
    });
    discardLoan.addEventListener('click', () => {
      prompt.close();
      prompt.remove();
      closeDialog();
    });
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    maybePromptDiscard(closeDialog);
  });
  discard.addEventListener('click', () => maybePromptDiscard(closeDialog));

  // Tab wrapping inside the dialog.
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = [...dialog.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter(
      (node) => !node.hidden && node.offsetParent !== null && !(node instanceof HTMLInputElement && node.type === 'file'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // --- check out ---
  checkout.addEventListener('click', () => void doReserveAndCheckout());

  if (app.role() === 'coordinator') {
    checkedOutTimeInput = el('input', { type: 'text', id: 'checked-out-at', placeholder: 'YYYY-MM-DD HH:MM' }) as HTMLInputElement;
    checkedOutTimeHolder = el('div', { class: 'field' });
    checkedOutTimeHolder.append(el('label', { for: 'checked-out-at', text: 'Checked out at' }), checkedOutTimeInput);
    toolsList.parentElement?.after(checkedOutTimeHolder);
  }

  async function doReserveAndCheckout(): Promise<void> {
    if (pickedMember === null || toolIds.length === 0 || pickedPhoto === null) {
      renderProblems(problems, {
        ...(pickedMember === null ? { member: 'Pick a member.' } : {}),
        ...(toolIds.length === 0 ? { tools: 'Add a tool by tag.' } : {}),
        ...(pickedPhoto === null ? { photo: 'Choose a photo.' } : {}),
      }, (field) => (field === 'member' ? memberInput : field === 'tools' ? tagInput : photoButton));
      problems.setAttribute('tabindex', '-1');
      problems.focus();
      return;
    }
    setPending(checkout, 'Reserving...');
    const body: Record<string, unknown> = { member_id: pickedMember.id, item_ids: toolIds };
    if (checkedOutTimeInput !== null && checkedOutTimeInput.value.trim() !== '') {
      body['checked_out_at'] = isoForCheckedOut(checkedOutTimeInput.value.trim());
    }
    let reserved: Loan;
    try {
      const result = await apiJson<{ loan: Loan }>('POST', '/api/loans', body);
      reserved = result.loan;
    } catch (err) {
      clearPending(checkout);
      if (err instanceof ApiFailure) {
        if (err.status === 409 || err.status === 503) {
          announce.textContent = err.error;
          memberInput.focus();
        } else if (err.status === 422) {
          renderProblems(problems, err.fields ?? {}, (field) => (field === 'member_id' ? memberInput : field === 'item_ids' ? tagInput : checkedOutTimeInput));
          problems.setAttribute('tabindex', '-1');
          problems.focus();
        } else {
          announce.textContent = err.error;
        }
      }
      return;
    }
    clearPending(checkout);
    setPending(checkout, 'Checking out...');
    const form = new FormData();
    form.append('photo', pickedPhoto);
    form.append('captured_at', new Date().toISOString());
    try {
      const result = await apiForm<{ loan: Loan }>('POST', `/api/loans/${reserved.id}/checkout`, form);
      announce.textContent = `Loan ${result.loan.ref} is out. Due ${result.loan.due_date} by ${result.loan.due_by}.`;
      dialog.close();
      dialog.remove();
      onReserved(result.loan);
      const scan = document.querySelector('input[aria-label="Scan or find a loan"]');
      if (scan instanceof HTMLElement) scan.focus();
    } catch (err) {
      clearPending(checkout);
      if (err instanceof ApiFailure) {
        if (err.status === 503) {
          announce.textContent = err.error;
          dialog.close();
          dialog.remove();
          onReserved(reserved);
          const scan = document.querySelector('input[aria-label="Scan or find a loan"]');
          if (scan instanceof HTMLElement) scan.focus();
          return;
        }
        announce.textContent = err.error;
        dialog.close();
        dialog.remove();
        onReserved(reserved);
        const button = document.querySelector(`button[aria-label="Check out ${reserved.ref}"]`);
        if (button instanceof HTMLElement) button.focus();
        else {
          const scan = document.querySelector('input[aria-label="Scan or find a loan"]');
          if (scan instanceof HTMLElement) scan.focus();
        }
      }
    }
  }

  function isoForCheckedOut(text: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text);
    if (match === null) return text;
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00`;
  }

  return () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
}
