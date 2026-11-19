/**
 * The bench week: a grid with a roving Tab stop, Alt+arrow moves that keep
 * focus on the card, a drag at 1280 and `Move <job> to…` as the way at 375.
 */
import { EMPTY, F } from '../../shared/feedback.ts';
import { BENCH_OPTIONS } from '../../shared/deskLinks.ts';
import { api, ApiError } from '../ui/api.ts';
import { DURATION, animate } from '../ui/motion.ts';
import { all, el, find, need, setAttr, setHidden, setText } from '../ui/dom.ts';
import { announce, showProblems, withPending } from '../ui/shell.ts';
import { field, openModal } from '../ui/dialog.ts';
import { body, setRefresher, wireMainAction } from './deskShell.ts';
import { setQuery } from '../router.ts';

interface Job {
  id: string;
  pieceId: string;
  pieceTitle: string;
  bench: 'frame' | 'cover';
  day: string;
  dayLabel: string;
  glue: { laidAt: string; curesAt: string; state: string; label: string } | null;
}

interface Piece {
  id: string;
  title: string;
  state: string;
}

const BENCHES = ['frame', 'cover'] as const;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export async function startBench(): Promise<void> {
  const screen = body();

  const grid = el('div', { class: 'bench-grid', role: 'grid', 'aria-label': 'Bench week' });
  const gridTile = el('div', { class: 'tile tile-large' }, [grid]);
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Jobs this week' }),
    el('p', { class: 'figure', id: 'week-count', text: '0' }),
  ]);
  const empty = el('p', { class: 'tile tile-empty', id: 'bench-empty', text: EMPTY.jobs, hidden: true });
  const earlier = el('a', { href: '#', text: 'Earlier week', id: 'earlier-week' });
  const later = el('a', { href: '#', text: 'Later week', id: 'later-week' });
  const addJob = el('button', { type: 'button', class: 'button-primary', text: 'Add job', id: 'add-job' });

  screen.textContent = '';
  screen.append(
    mint,
    el('p', { class: 'week-nav' }, [earlier, later]),
    gridTile,
    empty,
    el('p', { class: 'screen-action' }, [addJob]),
  );

  let week = new URL(window.location.href).searchParams.get('week');
  let jobs: Job[] = [];
  let roving = 0;
  let focusJob: string | null = null;

  const cells = (): HTMLElement[] => all<HTMLElement>('[role="gridcell"]', grid);

  const applyRoving = (): void => {
    cells().forEach((cell, index) => setAttr(cell, 'tabindex', index === roving ? '0' : '-1'));
  };

  const move = async (job: Job, bench: 'frame' | 'cover', day: string): Promise<void> => {
    const card = find<HTMLElement>(`[data-job="${job.id}"]`, grid);
    const from = card?.getBoundingClientRect();
    try {
      const answer = (await api.patch(`/api/bench-jobs/${job.id}`, { bench, day })) as {
        job: Job;
        message: string;
      };
      focusJob = job.id;
      await load();
      announce(answer.message);
      const moved = find<HTMLElement>(`[data-job="${job.id}"]`, grid);
      if (moved && from) {
        const to = moved.getBoundingClientRect();
        animate(
          moved,
          [
            { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
            { transform: 'none' },
          ],
          DURATION.quick,
        );
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      announce(error.failure.message);
    }
  };

  const moveDialog = (job: Job, opener: HTMLElement): void => {
    openModal({
      name: `Move ${job.pieceTitle} to\u2026`,
      opener,
      build(dialogBody, handle) {
        const day = el('input', { type: 'text', name: 'day', value: job.day, inputmode: 'numeric' });
        const bench = el('select', { name: 'bench' });
        for (const option of BENCH_OPTIONS) {
          bench.append(el('option', { value: option.value, text: option.label, selected: option.value === job.bench }));
        }
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Move' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          field('move-day', 'Day', day),
          field('move-bench', 'Bench', bench),
          el('p', { class: 'dialog-actions' }, [run, close]),
        );
        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            try {
              const answer = (await api.patch(`/api/bench-jobs/${job.id}`, {
                bench: bench.value,
                day: day.value,
              })) as { message: string };
              handle.close();
              focusJob = job.id;
              await load();
              announce(answer.message);
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              // The dialog stays open as typed with its own message.
              const problems = Object.entries(error.failure.fields).map(([name, message]) => ({
                field: name,
                message,
              }));
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'day', message: error.failure.message }],
                (name) => (name === 'bench' ? bench : day),
                'Problems',
              );
              announce(error.failure.message);
            }
          });
        });
      },
    });
  };

  const glueDialog = (job: Job, opener: HTMLElement): void => {
    openModal({
      name: 'Glue laid',
      opener,
      build(dialogBody, handle) {
        const date = el('input', { type: 'text', name: 'date', value: job.day, inputmode: 'numeric' });
        const time = el('input', { type: 'text', name: 'time', value: '09:00', inputmode: 'numeric' });
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Save glue time' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          field('glue-date', 'Date', date),
          field('glue-time', 'Time', time),
          el('p', { class: 'dialog-actions' }, [run, close]),
        );
        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            try {
              const answer = (await api.post(`/api/bench-jobs/${job.id}/glue`, {
                date: date.value,
                time: time.value,
              })) as { message: string };
              handle.close();
              focusJob = job.id;
              await load();
              announce(answer.message);
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              const problems = Object.entries(error.failure.fields).map(([name, message]) => ({
                field: name,
                message,
              }));
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'date', message: error.failure.message }],
                (name) => (name === 'time' ? time : date),
                'Problems',
              );
              announce(error.failure.message);
            }
          });
        });
      },
    });
  };

  const openAdd = (): void => {
    openModal({
      name: 'Add job',
      opener: addJob,
      async build(dialogBody, handle) {
        const pieceSelect = el('select', { name: 'pieceId' });
        const bench = el('select', { name: 'bench' });
        for (const option of BENCH_OPTIONS) {
          bench.append(el('option', { value: option.value, text: option.label }));
        }
        const day = el('input', { type: 'text', name: 'day', value: week ?? '', inputmode: 'numeric' });
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Save job' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          field('job-piece', 'Piece', pieceSelect),
          field('job-bench', 'Bench', bench),
          field('job-day', 'Day', day),
          el('p', { class: 'dialog-actions' }, [run, close]),
        );
        const pieces = ((await api.get('/api/pieces')) as { pieces: Piece[] }).pieces.filter(
          (piece) => piece.state !== 'archived',
        );
        for (const piece of pieces) {
          pieceSelect.append(el('option', { value: piece.id, text: piece.title }));
        }
        close.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            try {
              const answer = (await api.post('/api/bench-jobs', {
                pieceId: pieceSelect.value,
                bench: bench.value,
                day: day.value,
              })) as { message: string };
              handle.close();
              await load();
              announce(answer.message);
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              const problems = Object.entries(error.failure.fields).map(([name, message]) => ({
                field: name,
                message,
              }));
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'day', message: error.failure.message }],
                (name) => (name === 'bench' ? bench : name === 'pieceId' ? pieceSelect : day),
                'Problems',
              );
              announce(error.failure.message);
            }
          });
        });
      },
    });
  };

  addJob.addEventListener('click', openAdd);
  wireMainAction(openAdd);

  grid.addEventListener('keydown', (event) => {
    const list = cells();
    const cell = (event.target as Element).closest<HTMLElement>('[role="gridcell"]');
    const card = (event.target as Element).closest<HTMLElement>('[data-part="job-card"]');

    if (event.altKey && card) {
      const job = jobs.find((item) => item.id === card.dataset.job);
      if (!job) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const monday = week!;
        const at = Math.round(
          (Date.parse(`${job.day}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / 86_400_000,
        );
        const next = at + step;
        if (next < 0 || next > 4) {
          announce(F.weekEnd);
          return;
        }
        void move(job, job.bench, addDays(monday, next));
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        void move(job, job.bench === 'frame' ? 'cover' : 'frame', job.day);
      }
      return;
    }

    if (!cell || card) return;
    const at = list.indexOf(cell);
    let next = at;
    if (event.key === 'ArrowRight') next = Math.min(list.length - 1, at + 1);
    else if (event.key === 'ArrowLeft') next = Math.max(0, at - 1);
    else if (event.key === 'ArrowDown') next = Math.min(list.length - 1, at + WEEKDAYS.length);
    else if (event.key === 'ArrowUp') next = Math.max(0, at - WEEKDAYS.length);
    else return;
    event.preventDefault();
    roving = next;
    applyRoving();
    list[next]?.focus();
  });

  earlier.addEventListener('click', (event) => {
    event.preventDefault();
    week = addDays(week!, -7);
    setQuery({ week });
    void load();
  });
  later.addEventListener('click', (event) => {
    event.preventDefault();
    week = addDays(week!, 7);
    setQuery({ week });
    void load();
  });

  async function load(): Promise<void> {
    const answer = (await api.get(`/api/bench-jobs${week === null ? '' : `?week=${week}`}`)) as {
      week: string;
      jobs: Job[];
    };
    week = answer.week;
    jobs = answer.jobs;

    grid.textContent = '';
    const header = el('div', { class: 'bench-row bench-head', role: 'row' });
    header.append(el('span', { class: 'bench-corner', role: 'columnheader' }));
    for (const [index, name] of WEEKDAYS.entries()) {
      header.append(el('span', { role: 'columnheader', text: `${name} ${addDays(week, index).slice(5)}` }));
    }
    grid.append(header);

    for (const bench of BENCHES) {
      const row = el('div', { class: 'bench-row', role: 'row' });
      row.append(
        el('span', {
          class: 'bench-name',
          role: 'rowheader',
          text: bench === 'frame' ? 'Frame bench' : 'Cover bench',
        }),
      );
      for (let day = 0; day < WEEKDAYS.length; day += 1) {
        const date = addDays(week, day);
        const cell = el('div', { class: 'bench-cell', role: 'gridcell', tabindex: '-1', 'data-day': date, 'data-bench': bench });
        const job = jobs.find((item) => item.bench === bench && item.day === date);
        if (job) {
          const card = el('div', { class: 'job-card', 'data-part': 'job-card', 'data-job': job.id, tabindex: '0' });
          card.append(el('span', { class: 'job-title', text: job.pieceTitle }));
          if (job.glue) card.append(el('span', { class: 'job-glue', text: job.glue.label }));
          const moveButton = el('button', { type: 'button', text: 'Move', 'aria-label': `Move ${job.pieceTitle} to\u2026` });
          moveButton.addEventListener('click', () => moveDialog(job, moveButton));
          card.append(moveButton);
          if (bench === 'frame') {
            const glueButton = el('button', { type: 'button', text: 'Glue laid' });
            glueButton.addEventListener('click', () => glueDialog(job, glueButton));
            card.append(glueButton);
          }
          wireDrag(card, job);
          cell.append(card);
        }
        row.append(cell);
      }
      grid.append(row);
    }

    applyRoving();
    setText(need('#week-count'), String(jobs.length));
    setHidden(need<HTMLElement>('#bench-empty'), jobs.length > 0);

    // Focus stays on the same card through the reply and any refresh.
    if (focusJob) {
      find<HTMLElement>(`[data-job="${focusJob}"]`, grid)?.focus();
      focusJob = null;
    }
  }

  /** A drag at 1280 settles on drop; Escape glides home and changes nothing. */
  function wireDrag(card: HTMLElement, job: Job): void {
    card.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse') return;
      if ((event.target as Element).closest('button')) return;
      const from = card.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      let cancelled = false;
      card.setPointerCapture(event.pointerId);
      card.classList.add('dragging');

      const onMove = (moveEvent: PointerEvent): void => {
        card.style.transform = `translate(${moveEvent.clientX - startX}px, ${moveEvent.clientY - startY}px)`;
      };
      const home = (duration: 160 | 320): void => {
        card.style.transform = '';
        card.classList.remove('dragging');
        const to = card.getBoundingClientRect();
        animate(
          card,
          [
            { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
            { transform: 'none' },
          ],
          duration,
        );
      };
      const onKey = (keyEvent: KeyboardEvent): void => {
        if (keyEvent.key !== 'Escape') return;
        cancelled = true;
        window.removeEventListener('keydown', onKey);
        card.removeEventListener('pointermove', onMove);
        card.removeEventListener('pointerup', onUp);
        home(DURATION.normal);
      };
      const onUp = (upEvent: PointerEvent): void => {
        card.removeEventListener('pointermove', onMove);
        card.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
        if (cancelled) return;
        card.style.transform = '';
        card.classList.remove('dragging');
        const dropped = document
          .elementsFromPoint(upEvent.clientX, upEvent.clientY)
          .find((node) => node instanceof HTMLElement && node.dataset.day !== undefined) as HTMLElement | undefined;
        if (!dropped) {
          home(DURATION.quick);
          return;
        }
        void move(job, dropped.dataset.bench as 'frame' | 'cover', dropped.dataset.day!);
      };
      card.addEventListener('pointermove', onMove);
      card.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey);
      event.preventDefault();
    });
  }

  await load();
  setRefresher(load);
}
