import { api, copy, announce, wireCore } from './app-core.js';

interface StageEntry {
  name: 'validate' | 'transcode' | 'preview' | 'index' | 'publish';
  status: 'pending' | 'running' | 'confirmed' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
}

interface UploadStatus {
  upload: string;
  model: string;
  status: 'in_progress' | 'completed' | 'failed';
  stages: StageEntry[];
}

/** The queue page refreshes at least once a second and announces every stage change. */
function wireQueue(): void {
  const page = document.querySelector<HTMLElement>('.queue-page');
  if (page === null) return;
  const uploadRef = page.dataset['upload'] ?? '';
  const progress = document.getElementById('queue-progress');
  if (uploadRef === '') return;
  let previous: Record<string, string> = {};
  const stageLabel = (name: string): string => copy(`stage.${name}`);
  const statusLabel = (status: string): string => copy(`stage_status.${status}`);
  const poll = (): void => {
    void api<UploadStatus>(`/api/studio/uploads/${uploadRef}`).catch(() => null).then(status => {
      if (status === null) return;
      const stages = page.querySelectorAll<HTMLElement>('.queue-stages li');
      stages.forEach(stage => {
        const name = stage.dataset['stage'] ?? '';
        const entry = status.stages.find(candidate => candidate.name === name);
        if (entry === undefined) return;
        const statusEl = stage.querySelector<HTMLElement>('[data-role="status"]');
        const attemptsEl = stage.querySelector<HTMLElement>('[data-role="attempts"]');
        const retryEl = stage.querySelector<HTMLElement>('[data-role="retry"]');
        if (statusEl !== null) statusEl.textContent = statusLabel(entry.status);
        if (attemptsEl !== null) attemptsEl.textContent = String(entry.attempts);
        if (retryEl !== null) {
          retryEl.textContent =
            entry.status === 'pending' && entry.next_attempt_at !== null
              ? new Date(entry.next_attempt_at).toLocaleTimeString()
              : copy('queue.no_retry');
        }
        stage.dataset['status'] = entry.status;
      });
      for (const entry of status.stages) {
        const key = `${entry.name}:${entry.status}:${entry.attempts}`;
        if (previous[entry.name] === undefined) {
          previous[entry.name] = key;
          continue;
        }
        if (previous[entry.name] === key) continue;
        previous[entry.name] = key;
        if (entry.status === 'confirmed') {
          announce(progress, copy('queue.stage.confirmed', { stage: stageLabel(entry.name) }));
        } else if (entry.status === 'failed') {
          announce(progress, copy('queue.stage.out_of_retries', { stage: stageLabel(entry.name) }));
        } else if (entry.status === 'pending' && entry.next_attempt_at !== null) {
          const seconds = Math.max(1, Math.round((new Date(entry.next_attempt_at).getTime() - Date.now()) / 1000));
          announce(progress, copy('queue.stage.retry', { stage: stageLabel(entry.name), k: entry.attempts, n: 4, seconds }));
        }
      }
      const requeue = document.getElementById('requeue-button') as HTMLButtonElement | null;
      if (requeue !== null) {
        requeue.disabled = status.status !== 'failed';
      }
      if (status.stages.every(stage => stage.status === 'confirmed')) {
        announce(progress, copy('queue.all_confirmed'));
      }
    });
  };
  announce(progress, copy('upload.received'));
  window.setInterval(poll, 1000);
  poll();
  document.getElementById('requeue-button')?.addEventListener('click', () => {
    void api(`/api/studio/uploads/${uploadRef}/requeue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => {
        previous = {};
        announce(progress, copy('queue.requeued'));
        poll();
      })
      .catch(() => undefined);
  });
  document.getElementById('submit-review')?.addEventListener('click', () => {
    const slug = window.location.pathname.split('/').pop() ?? '';
    void api(`/api/contrib/models/${slug}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => {
        announce(progress, copy('studio.moved', { state: copy('state.in_review') }));
        const button = document.getElementById('submit-review') as HTMLButtonElement | null;
        if (button !== null) button.disabled = true;
      })
      .catch(() => undefined);
  });
}

wireCore();
wireQueue();
