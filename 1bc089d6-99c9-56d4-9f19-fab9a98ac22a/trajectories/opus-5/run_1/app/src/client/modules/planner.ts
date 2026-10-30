import { call } from './api.js';
import { chime } from './audio.js';
import { COPY, saveLimitCopy } from './copy.js';
import { el } from './dom.js';
import {
  checkDraft,
  clearFieldErrors,
  readDraft,
  refreshSummary,
  showFieldErrors,
  type PlanDraft,
  type PlanFieldRefs,
} from './planFields.js';

const RETRIES = 3;
const RETRY_PAUSE = 2500;

/** A stable key for one exact set of field values, reused for every retry. */
function idempotencyKey(draft: PlanDraft): string {
  const text = JSON.stringify(draft);
  let digest = '';
  for (const seed of [0x811c9dc5, 0x1000193, 0x9e3779b9, 0x85ebca6b]) {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    digest += hash.toString(16).padStart(8, '0');
  }
  return `plan-${digest}`;
}

interface SaveAnswer {
  status: string;
}

const pause = (millis: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, millis));

export function planner(refs: PlanFieldRefs): void {
  const button = el<HTMLButtonElement>('save-hour');
  const status = el('planner-status');

  const watch = (node: HTMLElement): void => {
    node.addEventListener('input', () => refreshSummary(refs));
    node.addEventListener('change', () => refreshSummary(refs));
  };
  if (refs.email) watch(refs.email);
  watch(refs.bedtime);
  watch(refs.zone);
  watch(refs.note);

  refs.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });

  async function save(): Promise<void> {
    const draft = readDraft(refs);
    const fields = checkDraft(draft, ['email', 'bedtime', 'time_zone', 'rituals', 'note']);
    if (Object.keys(fields).length > 0) {
      status.textContent = COPY.plannerFields;
      showFieldErrors(refs, fields);
      return;
    }
    clearFieldErrors(refs);
    button.disabled = true;
    status.textContent = COPY.plannerPending;
    const key = idempotencyKey(draft);

    try {
      for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
        const answer = await call<SaveAnswer>('POST', '/api/plans', {
          body: draft,
          headers: { 'Idempotency-Key': key },
        });
        if (answer.offline && attempt < RETRIES) {
          await pause(RETRY_PAUSE);
          continue;
        }
        if (answer.status === 202 && answer.data) {
          status.textContent = answer.data.status === 'confirmation_sent' ? COPY.plannerSent : COPY.plannerQueued;
          chime('saved');
        } else if (answer.status === 422 && answer.error?.fields) {
          status.textContent = COPY.plannerFields;
          showFieldErrors(refs, answer.error.fields);
        } else if (answer.status === 429) {
          status.textContent = saveLimitCopy(answer.retryAfterMinutes ?? 60);
        } else if (answer.status === 503) {
          status.textContent = COPY.unavailable;
        } else {
          status.textContent = COPY.plannerFailed;
        }
        return;
      }
    } finally {
      button.disabled = false;
    }
  }
}
