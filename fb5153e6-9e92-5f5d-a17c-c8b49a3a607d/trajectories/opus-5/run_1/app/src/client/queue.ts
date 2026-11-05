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

  function announceChanges(reply: UploadReply): void {
    for (const stage of reply.stages) {
      const previous = seen.get(stage.name);
      if (previous === stage.status) continue;
      const label = stageLabel(stage.name, locale);
      if (stage.status === 'confirmed') {
        announce(statusNode, stageConfirmed(label, locale));
      } else if (stage.status === 'failed') {
        announce(
          statusNode,
          stage.name === 'validate'
            ? s('queueValidateFailed', locale)
            : stageOutOfRetries(label, locale),
        );
      } else if (stage.status === 'pending' && stage.attempts > 0 && stage.next_attempt_at !== null) {
        const seconds = Math.max(
          0,
          Math.round((Date.parse(stage.next_attempt_at) - Date.now()) / 1000),
        );
        announce(statusNode, stageWillRetry(label, stage.attempts, RETRY_TOTAL, seconds, locale));
      }
    }
    seen = new Map(reply.stages.map((stage) => [stage.name, stage.status]));
    if (reply.status === 'completed' && !announcedDone) {
      announcedDone = true;
      announce(statusNode, s('queueAllConfirmed', locale));
    }
    if (reply.status !== 'completed') announcedDone = false;
  }

  async function poll(): Promise<void> {
    if (uploadRef === null) return;
    const reply = await call<UploadReply>(`${endpoint}/${uploadRef}`, { locale }).catch(() => null);
    if (reply === null) return;
    render(reply);
    announceChanges(reply);
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
