// Manage my hour: the signed-out form and the signed-in editor.
import { qs, el, announce, fetchJson, postJson, pad } from './dom.js';
import { RITUAL_CATALOGUE, countCharacters, normaliseEmail, validNote } from '../shared/plan.js';

export interface Plan {
  id: string;
  email: string;
  bedtime: string;
  time_zone: string;
  rituals: { id: string; title: string; minutes: number }[];
  total_minutes: number;
  note: string;
  reminders: 'on' | 'paused';
  version: number;
  starts_at_local: string;
  next_reminder_at: string | null;
  share_url: string | null;
}

export function bootManage(): void {
  void loadManage();
}

async function loadManage(): Promise<void> {
  const signedOut = qs<HTMLElement>('#manage-signed-out');
  const editor = qs<HTMLElement>('#manage-editor');
  const res = await fetchJson<{ plan: Plan }>('/api/me/plan').catch(() => null);
  if (res === null || res.status === 401 || res.status === 503) {
    wireSignedOut();
    return;
  }
  if (res.status === 404) {
    // signed in with only a draft waiting for its confirmation email
    signedOut.hidden = true;
    editor.hidden = false;
    editor.append(el('p', { class: 'draft-note' }, 'Your hour is waiting for confirmation. Open the link in your confirmation email.'));
    return;
  }
  if (res.status !== 200 || !res.body) {
    wireSignedOut();
    return;
  }
  signedOut.hidden = true;
  editor.hidden = false;
  wireEditor(res.body.plan);
}

function wireSignedOut(): void {
  const form = qs<HTMLFormElement>('#signin-form');
  const email = qs<HTMLInputElement>('#signin-email');
  const status = qs<HTMLElement>('#manage-status');
  const error = qs<HTMLElement>('#signin-email-error');
  const button = qs<HTMLButtonElement>('#send-link');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    email.removeAttribute('aria-invalid');
    const address = normaliseEmail(email.value);
    if (address === null) {
      email.setAttribute('aria-invalid', 'true');
      error.textContent = 'Enter an email address, like name@example.com.';
      error.hidden = false;
      announce(status, 'Enter an email address, like name@example.com.');
      return;
    }
    button.disabled = true;
    announce(status, 'Sending your link…');
    const res = await postJson<{ status: string }>('/api/session/request', { email: address }).catch(() => null);
    button.disabled = false;
    if (res === null || res.status === 503) {
      announce(status, 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.');
      return;
    }
    if (res.status === 422) {
      email.setAttribute('aria-invalid', 'true');
      error.textContent = 'Enter an email address, like name@example.com.';
      error.hidden = false;
      announce(status, 'Enter an email address, like name@example.com.');
      return;
    }
    if (res.status === 429) {
      const minutes = Math.max(1, Math.ceil(Number(res.headers.get('retry-after') ?? '60') / 60));
      announce(status, `That address has asked for five links in the last hour. Try again in ${minutes} minutes.`);
      return;
    }
    announce(status, 'If that address has a Stillhour, a sign-in link is on its way. It works once, for 15 minutes.');
  });
}

function wireEditor(plan: Plan): void {
  const editor = qs<HTMLElement>('#manage-editor');
  const status = qs<HTMLElement>('#manage-status');

  const heading = qs<HTMLElement>('#manage-heading');
  const asText = el('p', { class: 'signed-in-as' }, `Signed in as ${plan.email}`);
  editor.append(asText);

  const grid = el('div', { class: 'manage-grid' });

  // ---- left: hour fields ----
  const left = el('div', { class: 'manage-block' });
  const form = el('form', { id: 'editor-form', novalidate: true }) as HTMLFormElement;
  const alertBox = el('div', { id: 'editor-alert', class: 'alert', role: 'alert', hidden: true });
  form.append(alertBox);

  const bedtime = el('select', { id: 'editor-bedtime', 'aria-label': 'Bedtime' }) as HTMLSelectElement;
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const v = `${pad(h)}:${pad(m)}`;
      const o = el('option', { value: v }, v);
      if (v === plan.bedtime) o.setAttribute('selected', 'true');
      bedtime.append(o);
    }
  }
  const bedtimeLabel = el('label', { for: 'editor-bedtime' }, 'Bedtime');
  const bedtimeField = el('div', { class: 'field' }, bedtimeLabel, bedtime);
  form.append(bedtimeField);

  const zone = el('select', { id: 'editor-zone', 'aria-label': 'Time zone' }) as HTMLSelectElement;
  const zones = [...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC'), 'UTC'];
  for (const z of zones) {
    const o = el('option', { value: z }, z.replace(/_/g, ' '));
    if (z === plan.time_zone) o.setAttribute('selected', 'true');
    zone.append(o);
  }
  const zoneLabel = el('label', { for: 'editor-zone' }, 'Time zone');
  form.append(el('div', { class: 'field' }, zoneLabel, zone));

  const ritualsField = el('fieldset');
  ritualsField.append(el('legend', {}, 'Rituals'));
  const ritualInputs = new Map<string, { check: HTMLInputElement; minutes: HTMLInputElement }>();
  for (const ritual of RITUAL_CATALOGUE) {
    const chosenOne = plan.rituals.find((r) => r.id === ritual.id);
    const check = el('input', { type: 'checkbox' }) as HTMLInputElement;
    check.checked = chosenOne !== undefined;
    const label = el('label', { class: 'check' }, check, el('span', {}, ritual.title));
    const minutes = el('input', {
      type: 'number', min: '5', max: '30', step: '5', value: String(chosenOne?.minutes ?? ritual.minutes),
      'aria-label': `${ritual.title} minutes`,
    }) as HTMLInputElement;
    minutes.disabled = !check.checked;
    check.addEventListener('change', () => {
      minutes.disabled = !check.checked;
    });
    const row = el('div', { class: 'planner-ritual' }, label, el('label', { class: 'minutes' }, minutes));
    ritualsField.append(row);
    ritualInputs.set(ritual.id, { check, minutes });
  }
  form.append(ritualsField);

  const note = el('textarea', { id: 'editor-note', rows: '3', 'aria-label': 'A note for tonight' }) as HTMLTextAreaElement;
  note.value = plan.note;
  const noteLabel = el('label', { for: 'editor-note' }, 'A note for tonight');
  const noteCount = el('p', { class: 'char-count' }, `${countCharacters(plan.note)} of 280 characters`);
  note.addEventListener('input', () => {
    noteCount.textContent = `${countCharacters(note.value)} of 280 characters`;
  });
  const noteError = el('p', { class: 'field-error', id: 'editor-note-error', hidden: true });
  form.append(el('div', { class: 'field' }, noteLabel, note, noteCount, noteError));

  const saveButton = el('button', { type: 'submit', class: 'btn', id: 'save-changes' }, 'Save changes');
  form.append(saveButton);
  left.append(form);
  grid.append(left);

  // ---- right: reminders, sharing, delete, sign out ----
  const right = el('div', { class: 'manage-block' });
  const nextReminder = el('p', { class: 'next-reminder' });
  const setNextReminder = (p: Plan) => {
    nextReminder.textContent = p.reminders !== 'on' || p.next_reminder_at === null
      ? 'Reminders are paused.'
      : `Next reminder: ${formatNext(p.next_reminder_at, p.time_zone)}`;
  };
  setNextReminder(plan);
  right.append(nextReminder);

  const remindersSwitch = el('button', {
    type: 'button', class: 'btn ghost', id: 'reminders-switch', role: 'switch',
    'aria-checked': plan.reminders === 'on' ? 'true' : 'false',
  }, 'Reminders');
  remindersSwitch.addEventListener('click', () => {
    const on = remindersSwitch.getAttribute('aria-checked') !== 'true';
    void patchPlan(plan, { reminders: on ? 'on' : 'paused' }, (next) => {
      remindersSwitch.setAttribute('aria-checked', next.reminders === 'on' ? 'true' : 'false');
      setNextReminder(next);
      announce(status, next.reminders === 'on' ? 'Reminders are on.' : 'Reminders are paused.');
    });
  });
  right.append(remindersSwitch);

  const shareRow = el('div', { class: 'share-row' });
  const shareInput = el('input', { type: 'text', readonly: true, 'aria-label': 'Share link', id: 'share-link' }) as HTMLInputElement;
  shareInput.value = plan.share_url ? `${window.location.origin}${plan.share_url}` : '';
  const createShare = el('button', { type: 'button', class: 'btn', id: 'create-share' }, plan.share_url ? 'Make a new share link' : 'Create a share link');
  const copyShare = el('button', { type: 'button', class: 'btn ghost', id: 'copy-share' }, 'Copy link');
  const offShare = el('button', { type: 'button', class: 'btn ghost', id: 'off-share' }, 'Turn off sharing');
  createShare.addEventListener('click', async () => {
    const res = await fetchJson<{ share: { url: string } }>('/api/me/share', { method: 'POST' }).catch(() => null);
    if (res === null || res.status === 503) {
      announce(status, 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.');
      return;
    }
    if (res.status === 201 && res.body) {
      shareInput.value = `${window.location.origin}${res.body.share.url}`;
      createShare.textContent = 'Make a new share link';
      announce(status, 'Your share link is ready.');
    }
  });
  copyShare.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareInput.value);
      announce(status, 'Link copied.');
    } catch {
      shareInput.select();
      announce(status, 'Link copied.');
    }
  });
  offShare.addEventListener('click', async () => {
    const res = await fetchJson('/api/me/share', { method: 'DELETE' }).catch(() => null);
    if (res === null || res.status === 503) {
      announce(status, 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.');
      return;
    }
    shareInput.value = '';
    createShare.textContent = 'Create a share link';
    announce(status, 'Sharing is off. The old link no longer works.');
  });
  shareRow.append(shareInput, createShare, copyShare, offShare);
  right.append(shareRow);

  const danger = el('div', { class: 'danger-zone' });
  const signOut = el('button', { type: 'button', class: 'btn ghost', id: 'sign-out' }, 'Sign out');
  signOut.addEventListener('click', async () => {
    await postJson('/api/session/end', {}).catch(() => undefined);
    announce(status, 'You are signed out.');
    editor.hidden = true;
    qs<HTMLElement>('#manage-signed-out').hidden = false;
    wireSignedOut();
  });
  const deleteButton = el('button', { type: 'button', class: 'btn danger', id: 'delete-everything' }, 'Delete everything');
  danger.append(deleteButton, signOut);
  right.append(danger);
  grid.append(right);
  editor.append(grid);

  // ---- delete dialog ----
  const deleteDialog = el('div', { class: 'delete-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Delete everything', hidden: true });
  const deleteCard = el('div', { class: 'delete-card' });
  const deleteIntro = el('p', {}, 'This removes your hour, your reminders and any share link. It cannot be undone.');
  const typeBox = el('input', { type: 'text', 'aria-label': 'Type DELETE to confirm', id: 'type-delete' }) as HTMLInputElement;
  const cancelDelete = el('button', { type: 'button', class: 'btn ghost' }, 'Cancel');
  const confirmDelete = el('button', { type: 'button', class: 'btn danger', disabled: 'true' }, 'Delete my hour for good');
  typeBox.addEventListener('input', () => {
    confirmDelete.disabled = typeBox.value !== 'DELETE';
  });
  const closeDelete = () => {
    deleteDialog.hidden = true;
    deleteButton.focus();
  };
  cancelDelete.addEventListener('click', closeDelete);
  deleteDialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDelete();
    if (e.key === 'Tab') {
      const items = [typeBox, cancelDelete, confirmDelete];
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  deleteButton.addEventListener('click', () => {
    deleteDialog.hidden = false;
    typeBox.focus();
  });
  confirmDelete.addEventListener('click', async () => {
    const res = await fetchJson('/api/me', { method: 'DELETE' }).catch(() => null);
    if (res === null || res.status === 503) {
      announce(status, 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.');
      return;
    }
    deleteDialog.hidden = true;
    editor.innerHTML = '';
    editor.hidden = true;
    const signedOut = qs<HTMLElement>('#manage-signed-out');
    signedOut.hidden = false;
    wireSignedOut();
    announce(status, 'Everything is deleted. You will not get another reminder.');
    heading.focus();
  });
  deleteCard.append(deleteIntro, typeBox, el('div', { class: 'delete-actions' }, cancelDelete, confirmDelete));
  deleteDialog.append(deleteCard);
  document.body.append(deleteDialog);

  // ---- saving changes ----
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    alertBox.innerHTML = '';
    const changes: Record<string, unknown> = {};
    if (bedtime.value !== plan.bedtime) changes.bedtime = bedtime.value;
    if (zone.value !== plan.time_zone) changes.time_zone = zone.value;
    const rituals = plan.rituals;
    const current: { id: string; minutes: number }[] = [];
    for (const [id, inputs] of ritualInputs) {
      if (inputs.check.checked) {
        current.push({ id, minutes: Number(inputs.minutes.value) });
      }
    }
    const same = current.length === rituals.length && current.every((r, i) => r.id === rituals[i]!.id && r.minutes === rituals[i]!.minutes);
    if (!same) changes.rituals = current;
    if (note.value !== plan.note) changes.note = note.value;

    const invalid = new Map<string, string>();
    for (const r of current) {
      if (r.minutes < 5 || r.minutes > 30 || r.minutes % 5 !== 0) {
        invalid.set('rituals', 'Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total.');
      }
    }
    const total = current.reduce((n, r) => n + r.minutes, 0);
    if (current.length < 1 || current.length > 6 || total > 60) {
      invalid.set('rituals', 'Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total.');
    }
    if ('note' in changes && !validNote(changes.note)) {
      invalid.set('note', 'Keep your note to 280 characters.');
    }
    if (invalid.size > 0) {
      const headingEl = el('h4', {}, 'Check your hour');
      const list = el('ul');
      const names: Record<string, string> = { rituals: 'Rituals', note: 'A note for tonight' };
      for (const [field, message] of invalid) {
        const link = el('a', { href: '#' }, names[field] ?? field);
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          const target = field === 'rituals' ? ritualInputs.get('breathe')!.check : note;
          target.focus();
        });
        list.append(el('li', {}, link, ` — ${message}`));
      }
      alertBox.append(headingEl, list);
      alertBox.hidden = false;
      alertBox.setAttribute('tabindex', '-1');
      alertBox.focus();
      announce(status, 'Some details need another look.');
      return;
    }

    if (Object.keys(changes).length === 0) {
      announce(status, 'Your hour is saved.');
      return;
    }
    announce(status, 'Saving your hour…');
    void patchPlan(plan, changes, (next) => {
      announce(status, 'Your hour is saved.');
      bedtime.value = next.bedtime;
      zone.value = next.time_zone;
      note.value = next.note;
      noteCount.textContent = `${countCharacters(next.note)} of 280 characters`;
      setNextReminder(next);
      for (const [id, inputs] of ritualInputs) {
        const one = next.rituals.find((r) => r.id === id);
        inputs.check.checked = one !== undefined;
        inputs.minutes.disabled = one === undefined;
        if (one) inputs.minutes.value = String(one.minutes);
      }
    });
  });

  async function patchPlan(current: Plan, changes: Record<string, unknown>, onSaved: (next: Plan) => void): Promise<void> {
    const res = await fetchJson<{ plan?: Plan; error?: { current?: Plan; fields?: Record<string, string> } }>('/api/me/plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(current.version) },
      body: JSON.stringify(changes),
    }).catch(() => null);
    if (res === null || res.status === 503) {
      announce(status, 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.');
      return;
    }
    if (res.status === 401) {
      announce(status, 'Sign in to manage your hour.');
      editor.hidden = true;
      qs<HTMLElement>('#manage-signed-out').hidden = false;
      wireSignedOut();
      return;
    }
    if (res.status === 409 || res.status === 428) {
      const latest = res.body?.error?.current;
      if (latest) {
        announce(status, 'This plan changed somewhere else. Here is the latest version; your edits were not saved.');
        fillEditor(latest);
      } else {
        announce(status, 'This plan changed somewhere else. Here is the latest version; your edits were not saved.');
        void loadManage();
      }
      return;
    }
    if (res.status === 422 && res.body?.error?.fields) {
      const fields = res.body.error.fields;
      const headingEl = el('h4', {}, 'Check your hour');
      const list = el('ul');
      for (const [field, message] of Object.entries(fields)) {
        const link = el('a', { href: '#' }, field === 'time_zone' ? 'Time zone' : field === 'bedtime' ? 'Bedtime' : field);
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (field === 'bedtime') bedtime.focus();
          else if (field === 'time_zone') zone.focus();
          else if (field === 'note') note.focus();
          else ritualInputs.get('breathe')!.check.focus();
        });
        list.append(el('li', {}, link, ` — ${message}`));
      }
      alertBox.innerHTML = '';
      alertBox.append(headingEl, list);
      alertBox.hidden = false;
      alertBox.setAttribute('tabindex', '-1');
      alertBox.focus();
      announce(status, 'Some details need another look.');
      return;
    }
    if (res.status === 200 && res.body?.plan) {
      fillEditor(res.body.plan);
      onSaved(res.body.plan);
    }
  }

  function fillEditor(next: Plan): void {
    bedtime.value = next.bedtime;
    zone.value = next.time_zone;
    note.value = next.note;
    noteCount.textContent = `${countCharacters(next.note)} of 280 characters`;
    setNextReminder(next);
    for (const [id, inputs] of ritualInputs) {
      const one = next.rituals.find((r) => r.id === id);
      inputs.check.checked = one !== undefined;
      inputs.minutes.disabled = one === undefined;
      if (one) inputs.minutes.value = String(one.minutes);
    }
    plan.version = next.version;
    plan.bedtime = next.bedtime;
    plan.time_zone = next.time_zone;
    plan.note = next.note;
    plan.rituals = next.rituals;
    plan.reminders = next.reminders;
    remindersSwitch.setAttribute('aria-checked', next.reminders === 'on' ? 'true' : 'false');
  }
}

function formatNext(iso: string, zone: string): string {
  const date = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} at ${get('hour')}:${get('minute')} (${zone})`;
}

