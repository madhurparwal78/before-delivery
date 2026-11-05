import { announce, one, readState } from './dom.js';
import { call } from './api.js';
import type { Locale } from '../shared/locale.js';
import { formatNumber, localeFromLang } from '../shared/locale.js';
import {
  s,
  stageConfirmed,
  stageOutOfRetries,
  stageWillRetry,
} from '../shared/strings.js';
import { stageLabel, stageStatusLabel } from '../shared/labels.js';

interface Stage {
  name: 'validate' | 'transcode' | 'preview' | 'index' | 'publish';
  status: 'pending' | 'running' | 'confirmed' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
}

interface UploadReply {
  upload: string;
  status: 'in_progress' | 'completed' | 'failed';
  stages: Stage[];
}

interface QueueState {
  slug: string;
  upload: string | null;
  contributor: boolean;
  locale: Locale;
  lang: string | null;
}

const state = readState<QueueState>('queue-state');
if (state !== null) wire(state);

/** A stage that fails and waits again keeps its status, so the attempt count tells the polls apart. */
function progressKey(stage: Stage): string {
  return `${stage.status}:${stage.attempts}`;
}

function wire(state: QueueState): void {
  const locale: Locale = state.locale ?? localeFromLang(state.lang);
  const statusNode = one('[data-queue-progress]');
  const container = one('[data-stage-container]');
  const requeue = one<HTMLButtonElement>('[data-requeue]');
  const submit = one<HTMLButtonElement>('[data-submit-draft]');
  const endpoint = state.contributor ? '/api/contrib/uploads' : '/api/studio/uploads';
  let uploadRef = state.upload;
  let seen = new Map<string, string>();
  let announcedDone = false;

  function render(reply: UploadReply): void {
    if (container === null) return;
    const list = document.createElement('ul');
    list.className = 'stage-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', s('queueStages', locale));
    list.dataset.stageList = 'true';
    for (const stage of reply.stages) {
      const item = document.createElement('li');
      item.className = 'stage-item';
      item.dataset.stage = stage.name;
      item.dataset.status = stage.status;
      const left = document.createElement('span');
      const mark = document.createElement('span');
      mark.className = 'stage-mark';
      left.append(
        mark,
        document.createTextNode(
          `${stageLabel(stage.name, locale)} — ${stageStatusLabel(stage.status, locale)}`,
        ),
      );
      const right = document.createElement('span');
      right.className = 'mono';
      right.textContent = `${s('attempts', locale)} ${formatNumber(stage.attempts, locale)}${
        stage.next_attempt_at === null ? '' : ` · ${s('nextRetry', locale)} ${stage.next_attempt_at}`
      }`;
      item.append(left, right);
      list.append(item);
    }
    container.replaceChildren(list);
    if (requeue !== null) requeue.disabled = reply.status !== 'failed';
  }

  const RETRY_TOTAL = 3;

  async function announceChanges(reply: UploadReply): Promise<void> {
    const messages: string[] = [];
    for (const stage of reply.stages) {
      if (seen.get(stage.name) === progressKey(stage)) continue;
      const label = stageLabel(stage.name, locale);
      if (stage.status === 'confirmed') {
        messages.push(stageConfirmed(label, locale));
      } else if (stage.status === 'failed') {
        messages.push(
          stage.name === 'validate'
            ? s('queueValidateFailed', locale)
            : stageOutOfRetries(label, locale),
        );
      } else if (stage.status === 'pending' && stage.attempts > 0 && stage.next_attempt_at !== null) {
        const seconds = Math.max(
          0,
          Math.round((Date.parse(stage.next_attempt_at) - Date.now()) / 1000),
        );
        messages.push(stageWillRetry(label, stage.attempts, RETRY_TOTAL, seconds, locale));
      }
    }
    seen = new Map(reply.stages.map((stage) => [stage.name, progressKey(stage)]));
    if (reply.status === 'completed' && !announcedDone) {
      announcedDone = true;
      messages.push(s('queueAllConfirmed', locale));
    }
    if (reply.status !== 'completed') announcedDone = false;
    // Yield between announcements: replacing the region's text in one task leaves
    // a reader only the last message when several stages confirm between polls.
    for (const message of messages) {
      announce(statusNode, message);
      await Promise.resolve();
    }
  }

  async function poll(): Promise<void> {
    if (uploadRef === null) return;
    const reply = await call<UploadReply>(`${endpoint}/${uploadRef}`, { locale }).catch(() => null);
    if (reply === null) return;
    render(reply);
    await announceChanges(reply);
  }

  requeue?.addEventListener('click', () => {
    void (async () => {
      if (uploadRef === null) return;
      const reply = await call<UploadReply>(`/api/studio/uploads/${uploadRef}/requeue`, {
        method: 'POST',
        locale,
        body: {},
      });
      uploadRef = reply.upload;
      seen = new Map();
      announce(statusNode, s('queueRequeued', locale));
      render(reply);
    })();
  });

  submit?.addEventListener('click', () => {
    void (async () => {
      await call<void>(`/api/contrib/models/${state.slug}/submit`, {
        method: 'POST',
        locale,
        body: {},
      });
      window.location.reload();
    })();
  });

  void poll();
  window.setInterval(() => void poll(), 1000);
}
