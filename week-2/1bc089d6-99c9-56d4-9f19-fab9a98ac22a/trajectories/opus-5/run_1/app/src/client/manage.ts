import { call } from './modules/api.js';
import { COPY, signInLimitCopy } from './modules/copy.js';
import { el } from './modules/dom.js';
import {
  browserZone,
  buildRitualRows,
  checkDraft,
  clearFieldErrors,
  fillBedtimes,
  fillZones,
  planRitualList,
  readDraft,
  refreshSummary,
  showFieldErrors,
  syncRitualRows,
  type PlanDraft,
  type PlanFieldRefs,
} from './modules/planFields.js';
import { chosenRituals, loadRituals, subscribe } from './modules/store.js';
import { isValidEmail, FIELD_MESSAGES } from '../shared/planRules.js';
import type { Plan } from '../shared/plan.js';

const signedOutPanel = el('signed-out-panel');
const signedInPanel = el('signed-in-panel');
const editor = el('editor');
const draftOnly = el('draft-only');
const signedInAs = el('signed-in-as');
const manageStatus = el('manage-status');
const signInStatus = el('signin-status');
const heading = el('manage-heading');

const fields: PlanFieldRefs = {
  form: el<HTMLFormElement>('manage-form'),
  alertHost: el('manage-alert'),
  bedtime: el<HTMLSelectElement>('manage-bedtime'),
  zone: el<HTMLSelectElement>('manage-zone'),
  note: el<HTMLTextAreaElement>('manage-note'),
  noteCounter: el('manage-note-counter'),
  ritualHost: el('manage-rituals'),
  errors: {
    bedtime: el('manage-bedtime-error'),
    time_zone: el('manage-zone-error'),
    rituals: el('manage-rituals-error'),
    note: el('manage-note-error'),
  },
  summaryHour: el('manage-summary-hour'),
  summaryTotal: el('manage-summary-total'),
  headingLevel: 'h2',
};

fillBedtimes(fields.bedtime, '23:00');
fillZones(fields.zone, browserZone());
const ritualRows = buildRitualRows(fields.ritualHost, 'manage');
subscribe(() => {
  syncRitualRows(ritualRows);
  refreshSummary(fields);
});
for (const node of [fields.bedtime, fields.zone, fields.note]) {
  node.addEventListener('input', () => refreshSummary(fields));
  node.addEventListener('change', () => refreshSummary(fields));
}

let loaded: Plan | null = null;

const remindersSwitch = el<HTMLButtonElement>('reminders-switch');
const nextReminder = el('next-reminder');
const shareUrl = el<HTMLInputElement>('share-url');
const createShare = el<HTMLButtonElement>('create-share');

/** The next reminder's day and time in the hour's own time zone. */
function nextReminderText(plan: Plan): string {
  if (plan.reminders === 'paused' || !plan.next_reminder_at) return COPY.remindersPaused;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: plan.time_zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(plan.next_reminder_at));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `Next reminder: ${read('weekday')} ${read('day')} ${read('month')} at ${read('hour')}:${read('minute')} (${plan.time_zone})`;
}

function showPlan(plan: Plan): void {
  loaded = plan;
  signedOutPanel.hidden = true;
  signedInPanel.hidden = false;
  draftOnly.hidden = true;
  editor.hidden = false;
  signedInAs.textContent = `Signed in as ${plan.email}`;
  fields.bedtime.value = plan.bedtime;
  if (![...fields.zone.options].some((option) => option.value === plan.time_zone)) {
    fillZones(fields.zone, plan.time_zone);
  }
  fields.zone.value = plan.time_zone;
  fields.note.value = plan.note;
  loadRituals(planRitualList(plan.rituals));
  syncRitualRows(ritualRows);
  refreshSummary(fields);
  remindersSwitch.setAttribute('aria-checked', String(plan.reminders === 'on'));
  nextReminder.textContent = nextReminderText(plan);
  shareUrl.value = plan.share_url ? new URL(plan.share_url, window.location.origin).toString() : '';
  createShare.textContent = plan.share_url ? 'Make a new share link' : 'Create a share link';
}

function showSignedOut(message: string): void {
  loaded = null;
  signedInPanel.hidden = true;
  editor.hidden = true;
  signedOutPanel.hidden = false;
  manageStatus.textContent = message;
}

function showDraftOnly(): void {
  signedOutPanel.hidden = true;
  signedInPanel.hidden = false;
  editor.hidden = true;
  draftOnly.hidden = false;
  signedInAs.textContent = '';
}

async function loadPlan(): Promise<void> {
  const answer = await call<{ plan: Plan }>('GET', '/api/me/plan');
  if (answer.status === 200 && answer.data) {
    showPlan(answer.data.plan);
    return;
  }
  if (answer.status === 401) {
    showSignedOut('');
    return;
  }
  if (answer.status === 404) {
    showDraftOnly();
    return;
  }
  if (answer.status === 503) manageStatus.textContent = COPY.unavailable;
}

/** One place for every answer to an edit, share or delete. */
function handleFailure(answer: { status: number; error?: { code?: string; current?: Plan; fields?: Record<string, string> } }): void {
  if (answer.status === 401) {
    showSignedOut(COPY.signedOutPrompt);
    return;
  }
  if (answer.status === 409 && answer.error?.current) {
    showPlan(answer.error.current);
    manageStatus.textContent = COPY.manageConflict;
    return;
  }
  if (answer.status === 422 && answer.error?.fields) {
    manageStatus.textContent = COPY.plannerFields;
    showFieldErrors(fields, answer.error.fields);
    return;
  }
  if (answer.status === 503) {
    manageStatus.textContent = COPY.unavailable;
    return;
  }
  manageStatus.textContent = COPY.plannerFailed;
}

async function sendEdit(body: Record<string, unknown>, success: string): Promise<void> {
  if (!loaded) return;
  manageStatus.textContent = COPY.managePending;
  const answer = await call<{ plan: Plan }>('PATCH', '/api/me/plan', {
    body,
    headers: { 'If-Match': String(loaded.version) },
  });
  if (answer.status === 200 && answer.data) {
    showPlan(answer.data.plan);
    await loadPlan();
    manageStatus.textContent = success;
    return;
  }
  handleFailure(answer);
}

fields.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!loaded) return;
  const draft = readDraft(fields);
  const changed: Record<string, unknown> = {};
  const keys: (keyof PlanDraft)[] = [];
  if (draft.bedtime !== loaded.bedtime) {
    changed['bedtime'] = draft.bedtime;
    keys.push('bedtime');
  }
  if (draft.time_zone !== loaded.time_zone) {
    changed['time_zone'] = draft.time_zone;
    keys.push('time_zone');
  }
  if (draft.note !== loaded.note) {
    changed['note'] = draft.note;
    keys.push('note');
  }
  const rituals = chosenRituals();
  if (JSON.stringify(rituals) !== JSON.stringify(planRitualList(loaded.rituals))) {
    changed['rituals'] = rituals;
    keys.push('rituals');
  }
  if (keys.length === 0) {
    manageStatus.textContent = COPY.manageSaved;
    return;
  }
  const problems = checkDraft(draft, keys);
  if (Object.keys(problems).length > 0) {
    manageStatus.textContent = COPY.plannerFields;
    showFieldErrors(fields, problems);
    return;
  }
  clearFieldErrors(fields);
  void sendEdit(changed, COPY.manageSaved);
});

remindersSwitch.addEventListener('click', () => {
  const next = remindersSwitch.getAttribute('aria-checked') !== 'true';
  void sendEdit({ reminders: next ? 'on' : 'paused' }, next ? COPY.remindersOn : COPY.remindersPaused);
});

el<HTMLFormElement>('signin-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void requestLink();
});

async function requestLink(): Promise<void> {
  const input = el<HTMLInputElement>('signin-email');
  const error = el('signin-email-error');
  const email = input.value.trim();
  if (!isValidEmail(email)) {
    error.textContent = FIELD_MESSAGES.email;
    input.setAttribute('aria-invalid', 'true');
    signInStatus.textContent = FIELD_MESSAGES.email;
    input.focus();
    return;
  }
  error.textContent = '';
  input.removeAttribute('aria-invalid');
  signInStatus.textContent = COPY.signInPending;
  const answer = await call<{ status: string }>('POST', '/api/session/request', { body: { email } });
  if (answer.status === 202) signInStatus.textContent = COPY.signInSent;
  else if (answer.status === 429) signInStatus.textContent = signInLimitCopy(answer.retryAfterMinutes ?? 60);
  else if (answer.status === 503) signInStatus.textContent = COPY.unavailable;
  else if (answer.status === 422) signInStatus.textContent = FIELD_MESSAGES.email;
  else signInStatus.textContent = COPY.plannerFailed;
}

createShare.addEventListener('click', () => {
  void (async () => {
    const answer = await call<{ share: { url: string } }>('POST', '/api/me/share');
    if (answer.status === 201 && answer.data) {
      shareUrl.value = new URL(answer.data.share.url, window.location.origin).toString();
      createShare.textContent = 'Make a new share link';
      manageStatus.textContent = COPY.shareReady;
      await loadPlan();
      return;
    }
    handleFailure(answer);
  })();
});

el<HTMLButtonElement>('copy-share').addEventListener('click', () => {
  void (async () => {
    shareUrl.select();
    try {
      await navigator.clipboard.writeText(shareUrl.value);
    } catch {
      document.execCommand('copy');
    }
    manageStatus.textContent = COPY.shareCopied;
  })();
});

el<HTMLButtonElement>('stop-share').addEventListener('click', () => {
  void (async () => {
    const answer = await call('DELETE', '/api/me/share');
    if (answer.status === 204) {
      shareUrl.value = '';
      createShare.textContent = 'Create a share link';
      manageStatus.textContent = COPY.shareOff;
      await loadPlan();
      return;
    }
    handleFailure(answer);
  })();
});

el<HTMLButtonElement>('sign-out').addEventListener('click', () => {
  void (async () => {
    await call('POST', '/api/session/end');
    showSignedOut(COPY.signedOut);
  })();
});

const deleteDialog = el<HTMLDialogElement>('delete-dialog');
const deleteButton = el<HTMLButtonElement>('delete-everything');
const deleteConfirm = el<HTMLInputElement>('delete-confirm');
const deleteGo = el<HTMLButtonElement>('delete-go');

deleteButton.addEventListener('click', () => {
  deleteConfirm.value = '';
  deleteGo.disabled = true;
  deleteDialog.showModal();
  deleteConfirm.focus();
});

deleteConfirm.addEventListener('input', () => {
  deleteGo.disabled = deleteConfirm.value !== 'DELETE';
});

const closeDeleteDialog = (): void => {
  deleteDialog.close();
  deleteButton.focus();
};

el<HTMLButtonElement>('delete-cancel').addEventListener('click', closeDeleteDialog);
deleteDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeDeleteDialog();
});

deleteGo.addEventListener('click', () => {
  void (async () => {
    const answer = await call('DELETE', '/api/me');
    if (answer.status !== 204) {
      handleFailure(answer);
      return;
    }
    deleteDialog.close();
    showSignedOut(COPY.deleted);
    heading.focus();
  })();
});

void loadPlan();
