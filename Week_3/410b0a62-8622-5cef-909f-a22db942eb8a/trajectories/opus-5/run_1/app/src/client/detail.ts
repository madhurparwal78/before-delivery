import { api, ApiCallError } from './api.js';
import { app, navigate, notice, type ChangeEvent, type Screen } from './app.js';
import { el, keepFocus, openDialog } from './dom.js';
import {
  complianceLabel,
  dataNumber,
  formatDay,
  formatDuration,
  formatIf,
  formatPace,
  formatTss,
  formatWatts,
} from './format.js';
import { notFoundView } from './notFound.js';
import { paceFromSpeed } from '../domain/stress.js';
import { isIntervalStep, targetPaceSecondsPerKm, targetWatts } from '../domain/steps.js';
import type { Comment, Item, Step, Workout } from '../domain/types.js';

function sessionNumbers(workout: Workout): HTMLElement {
  const lines: HTMLElement[] = [];
  if (workout.np_w !== null) {
    lines.push(el('p', { text: `Normalised power ${formatWatts(workout.np_w)} W` }));
  } else if (workout.ns_mps !== null) {
    lines.push(
      el('p', { text: `Normalised pace ${formatPace(paceFromSpeed(workout.ns_mps))} /km` }),
    );
  }
  const intensity = workout.if ?? workout.planned_if;
  const stress = workout.tss ?? workout.planned_tss;
  if (intensity !== null) lines.push(el('p', { text: `IF ${formatIf(intensity)}` }));
  if (stress !== null) lines.push(el('p', { text: `${formatTss(stress)} TSS` }));
  lines.push(el('p', { text: `Duration ${formatDuration(workout.duration_s)}` }));
  return el('div', {
    class: 'numbers-group',
    attrs: {
      role: 'group',
      'aria-label': 'Session numbers',
      'data-np':
        workout.np_w !== null
          ? dataNumber(workout.np_w, 0)
          : workout.ns_mps !== null
            ? dataNumber(paceFromSpeed(workout.ns_mps), 0)
            : null,
      'data-if': intensity !== null ? dataNumber(intensity, 2) : null,
      'data-tss': stress !== null ? dataNumber(stress, 1) : null,
      'data-duration-s': String(workout.duration_s),
    },
    children: lines,
  });
}

function stepLine(step: Step, sport: 'bike' | 'run', threshold: number | null): string {
  const target = (percent: number): string => {
    if (threshold === null) return `${percent}%`;
    return sport === 'bike'
      ? `${percent}% · ${formatWatts(targetWatts(threshold, percent))} W`
      : `${percent}% · ${formatPace(targetPaceSecondsPerKm(threshold, percent))} /km`;
  };
  if (isIntervalStep(step)) {
    return `${step.repeat} × (${formatDuration(step.work.duration_s)} at ${target(
      step.work.target_pct,
    )} / ${formatDuration(step.recovery.duration_s)} at ${target(step.recovery.target_pct)})`;
  }
  return `${formatDuration(step.duration_s)} at ${target(step.target_pct)}`;
}

export async function createWorkoutScreen(workoutId: string): Promise<Screen> {
  const element = el('main', { class: 'detail' });

  async function load(): Promise<{
    workout: Workout;
    item: Item;
    comments: Comment[];
    threshold: number | null;
  }> {
    const detail = await api.workout(workoutId);
    const athlete = await api.athlete(detail.workout.athlete_id);
    const kind = detail.workout.sport === 'bike' ? 'ftp' : 'pace';
    const inForce = athlete.thresholds
      .filter(
        (threshold) =>
          threshold.kind === kind && threshold.effective_from <= detail.workout.date,
      )
      .sort((left, right) => (left.effective_from < right.effective_from ? -1 : 1))
      .pop();
    return { ...detail, threshold: inForce?.value ?? null };
  }

  function commentsList(comments: Comment[]): HTMLElement {
    return el('ul', {
      class: 'comments',
      attrs: { 'aria-label': 'Comments' },
      children: comments.map((comment) =>
        el('li', {
          class: 'comment',
          children: [
            el('p', { class: 'comment-author', text: comment.author_name }),
            el('p', { class: 'comment-body', text: comment.body }),
          ],
        }),
      ),
    });
  }

  function render(data: {
    workout: Workout;
    item: Item;
    comments: Comment[];
    threshold: number | null;
  }): void {
    const workout = data.workout;
    const commentInput = el('textarea', {
      class: 'field',
      attrs: { 'aria-label': 'Comment', rows: '3', id: 'comment-body' },
    });
    const post = el('button', {
      class: 'pill pill-accent',
      text: 'Post comment',
      attrs: { type: 'button' },
    });
    const commentStatus = el('p', { class: 'status-line', attrs: { role: 'status', 'aria-live': 'polite' } });
    post.addEventListener('click', async () => {
      post.disabled = true;
      post.textContent = 'Posting…';
      commentStatus.textContent = 'Posting…';
      try {
        await api.postComment(workoutId, commentInput.value);
        commentInput.value = '';
        commentStatus.textContent = '';
        await refresh();
      } catch (error) {
        if (error instanceof ApiCallError) {
          commentStatus.textContent =
            error.failure.errors?.body ?? error.failure.message ?? 'That comment was refused.';
        }
      } finally {
        post.disabled = false;
        post.textContent = 'Post comment';
        keepFocus(post);
      }
    });

    const deleteButton = el('button', {
      class: 'pill pill-ink',
      text: 'Delete workout',
      attrs: { type: 'button' },
    });
    deleteButton.addEventListener('click', () => {
      openDialog({
        label: 'Delete workout?',
        opener: deleteButton,
        content: (handle) => {
          const status = el('p', { class: 'status-line', attrs: { role: 'status', 'aria-live': 'polite' } });
          const confirm = el('button', {
            class: 'pill pill-accent',
            text: 'Delete',
            attrs: { type: 'button' },
          });
          confirm.addEventListener('click', async () => {
            confirm.disabled = true;
            confirm.textContent = 'Deleting…';
            status.textContent = 'Deleting…';
            try {
              await api.deleteWorkout(workoutId);
              handle.close();
              notice(`Deleted ${workout.title}.`);
              navigate(`/athletes/${workout.athlete_id}`);
            } catch (error) {
              if (error instanceof ApiCallError) {
                status.replaceChildren(
                  el('p', {
                    class: 'outage-panel',
                    text: error.failure.message ?? 'That delete was refused.',
                  }),
                );
              }
              confirm.disabled = false;
              confirm.textContent = 'Delete';
            }
          });
          return [
            el('h2', { class: 'dialog-title', text: 'Delete workout?' }),
            el('p', { text: `${workout.title} on ${formatDay(workout.date)}` }),
            confirm,
            el('button', {
              class: 'pill pill-quiet',
              text: 'Keep it',
              attrs: { type: 'button' },
              on: { click: () => handle.close() },
            }),
            status,
          ];
        },
      });
    });

    const children: (HTMLElement | null)[] = [
      el('h1', { class: 'page-title', text: workout.title }),
      el('p', {
        class: 'detail-date',
        text:
          workout.start_local === null
            ? formatDay(workout.date)
            : `${formatDay(workout.date)} · ${workout.start_local}`,
      }),
      sessionNumbers(workout),
      workout.steps === null
        ? null
        : el('ul', {
            class: 'planned-steps',
            children: workout.steps.map((step) =>
              el('li', { text: stepLine(step, workout.sport, data.threshold) }),
            ),
          }),
      el('p', {
        class: 'compliance-label',
        text: complianceLabel(data.item.compliance),
        attrs: { 'data-compliance': data.item.compliance },
      }),
      workout.file === null
        ? null
        : el('div', {
            class: 'file-block',
            attrs: { 'data-sha256': workout.file.sha256 },
            children: [
              el('p', { text: `${workout.file.name} · ${workout.file.size} bytes` }),
              el('p', { class: 'sha', text: `SHA-256 ${workout.file.sha256}` }),
              el('a', {
                class: 'pill pill-quiet',
                text: 'Download original',
                attrs: { href: `/api/workouts/${workout.id}/original` },
              }),
            ],
          }),
      el('h2', { class: 'section-heading', text: 'Comments' }),
      commentsList(data.comments),
      el('label', {
        class: 'field-row',
        children: [el('span', { text: 'Comment' }), commentInput],
      }),
      post,
      commentStatus,
      deleteButton,
    ];
    element.replaceChildren(...(children.filter(Boolean) as HTMLElement[]));
  }

  async function refresh(): Promise<void> {
    try {
      render(await load());
    } catch (error) {
      if (error instanceof ApiCallError && error.failure.status === 404) {
        element.replaceChildren(notFoundView());
        return;
      }
      throw error;
    }
  }

  await refresh();

  return {
    element,
    onChange(event: ChangeEvent) {
      if (event.workout_id !== undefined && event.workout_id !== workoutId) {
        if (event.what !== 'links') return;
      }
      if (app.me === null) return;
      void refresh();
    },
  };
}
