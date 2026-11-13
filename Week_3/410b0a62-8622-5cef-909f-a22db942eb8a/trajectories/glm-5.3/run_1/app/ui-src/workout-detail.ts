import { api, type CommentJson, type WorkoutJson } from './api.js';
import type { AppCtx } from './shell.js';
import { h, clear } from './dom.js';
import { fmtDuration, fmtIf, fmtPace, fmtTss, dayLabel } from './format.js';
import { onLiveChange } from './main.js';
import { STEP_LABELS, type Step } from './domain.js';

export async function renderWorkout(main: HTMLElement, ctx: AppCtx, workoutId: string): Promise<void> {
  let data: { workout: WorkoutJson; comments: CommentJson[] };
  try {
    data = await api.get<{ workout: WorkoutJson; comments: CommentJson[] }>(`/workouts/${workoutId}`);
  } catch {
    main.append(notFound());
    return;
  }

  const container = h('div', { class: 'page workout-page' });
  main.append(container);
  draw(container, ctx, data.workout, data.comments);

  onLiveChange((msg) => {
    if (msg.what !== 'comments' && msg.what !== 'workouts') return;
    if (msg.what === 'comments' && msg.workout_id !== workoutId) return;
    void api
      .get<{ workout: WorkoutJson; comments: CommentJson[] }>(`/workouts/${workoutId}`)
      .then((fresh) => {
        clear(container);
        draw(container, ctx, fresh.workout, fresh.comments);
      })
      .catch(() => {
        clear(container);
        container.append(notFound());
      });
  });
}

function notFound(): HTMLElement {
  return h(
    'section',
    { class: 'notfound' },
    h('h1', { class: 'display' }, 'Not found'),
    h('p', {}, "This page isn't available to you."),
    h('a', { class: 'pill pill-primary', href: '/' }, 'Back to home')
  );
}

function draw(container: HTMLElement, ctx: AppCtx, workout: WorkoutJson, comments: CommentJson[]): void {
  clear(container);
  const numbers = h('div', { class: 'session-numbers', role: 'group', 'aria-label': 'Session numbers' });
  if (workout.sport === 'bike' && workout.np_w !== null) {
    numbers.append(h('p', { 'data-np': String(workout.np_w) }, `Normalised power ${Math.round(workout.np_w)} W`));
  } else if (workout.sport === 'run' && workout.ns_mps !== null) {
    const pace = 1000 / workout.ns_mps;
    numbers.append(h('p', { 'data-np': String(workout.ns_mps) }, `Normalised pace ${fmtPace(pace)}`));
  }
  if (workout.if !== null) numbers.append(h('p', { 'data-if': workout.if.toFixed(2) }, `IF ${fmtIf(workout.if)}`));
  if (workout.tss !== null) numbers.append(h('p', { 'data-tss': workout.tss.toFixed(1) }, `${fmtTss(workout.tss)} TSS`));
  numbers.append(h('p', { 'data-duration-s': String(workout.duration_s) }, `Duration ${fmtDuration(workout.duration_s)}`));

  const stepsList = h('ul', { class: 'detail-steps' });
  for (const step of (workout.steps ?? []) as Step[]) {
    if (step.kind === 'interval') {
      stepsList.append(
        h(
          'li',
          { class: 'detail-step' },
          `${step.repeat} × ${fmtDuration(step.work.duration_s)} at ${step.work.target_pct}% / ${fmtDuration(step.recovery.duration_s)} at ${step.recovery.target_pct}%`
        )
      );
    } else {
      stepsList.append(
        h('li', { class: 'detail-step' }, `${STEP_LABELS[step.kind]} · ${fmtDuration(step.duration_s)} at ${step.target_pct}%`)
      );
    }
  }

  const fileBlock: Node | null = workout.file
    ? h(
        'div',
        { class: 'file-block' },
        h('p', { class: 'file-line' }, `Original file: ${workout.file.name} · ${workout.file.size} bytes`),
        h('p', { class: 'file-line', 'data-sha256': workout.file.sha256 }, `SHA-256 ${workout.file.sha256}`),
        h('a', { class: 'pill pill-secondary', href: `/api/workouts/${workout.id}/original` }, 'Download original')
      )
    : null;

  const commentsList = h('ul', { class: 'comments', role: 'list', 'aria-label': 'Comments' });
  for (const comment of comments) {
    commentsList.append(h('li', { class: 'comment' }, h('p', { class: 'comment-author' }, comment.author_name), h('p', { class: 'comment-body' }, comment.body)));
  }

  const commentBox = h('input', { class: 'field', type: 'text', id: 'comment-body', 'aria-label': 'Comment' }) as HTMLInputElement;
  const postButton = h('button', { class: 'pill pill-primary', id: 'post-comment' }, 'Post comment');

  const deleteConfirm = h('button', { class: 'pill pill-danger', id: 'delete-workout' }, 'Delete workout');
  const status = h('div', { class: 'dialog-status', role: 'status', id: 'workout-status' });

  const dialog = h(
    'div',
    { class: 'dialog hidden', id: 'delete-dialog', role: 'dialog', 'aria-label': 'Delete workout?' },
    h('h2', { class: 'dialog-title' }, 'Delete workout?'),
    h('div', { class: 'dialog-actions' },
      h('button', {
        class: 'pill pill-danger',
        id: 'confirm-delete',
        onclick: async () => {
          const confirmBtn = document.getElementById('confirm-delete') as HTMLButtonElement | null;
          if (!confirmBtn) return;
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Deleting…';
          try {
            await api.del(`/workouts/${workout.id}`);
            const notices = document.getElementById('notices');
            if (notices) notices.textContent = `Deleted ${workout.title}.`;
            window.location.href = `/athletes/${workout.athlete_id}`;
          } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete';
            status.textContent = (err as Error).message;
          }
        },
      }, 'Delete'),
      h('button', { class: 'pill pill-ghost', onclick: () => dialog.classList.add('hidden') }, 'Keep it')
    )
  );

  deleteConfirm.addEventListener('click', () => {
    dialog.classList.remove('hidden');
    dialog.querySelector<HTMLElement>('#confirm-delete')?.focus();
  });

  document.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape' && !dialog.classList.contains('hidden')) {
      dialog.classList.add('hidden');
      deleteConfirm.focus();
    }
  });

  postButton.addEventListener('click', async () => {
    postButton.disabled = true;
    postButton.textContent = 'Posting…';
    try {
      const res = await api.post<{ comment: CommentJson }>(`/workouts/${workout.id}/comments`, { body: commentBox.value });
      commentBox.value = '';
      if (!commentsList.textContent?.includes(res.comment.body)) {
        commentsList.append(
          h('li', { class: 'comment' }, h('p', { class: 'comment-author' }, res.comment.author_name), h('p', { class: 'comment-body' }, res.comment.body))
        );
      }
      status.textContent = '';
    } catch (err) {
      status.textContent = (err as Error).message;
    } finally {
      postButton.disabled = false;
      postButton.textContent = 'Post comment';
    }
  });

  container.append(
    h('h1', { class: 'screen-title' }, workout.title),
    h('p', { class: 'workout-meta' }, `${dayLabel(workout.date, true)}${workout.start_local ? ` · ${workout.start_local}` : ''}`),
    numbers,
    h('h2', { class: 'section-title' }, 'Planned steps'),
    stepsList,
    ...(fileBlock === null ? [] : [fileBlock]),
    h('h2', { class: 'section-title' }, 'Comments'),
    commentsList,
    h('div', { class: 'comment-form' }, commentBox, postButton),
    deleteConfirm,
    dialog,
    status
  );
  void ctx;
}
