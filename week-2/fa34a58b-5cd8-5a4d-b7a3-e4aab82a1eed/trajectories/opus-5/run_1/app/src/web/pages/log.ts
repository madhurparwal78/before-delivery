import { api } from '../api';
import { el, find, must, pulse } from '../dom';
import { addDays, hhmm, hhmmss, longDate } from '../format';
import { clipStateCopy, onSocket, status } from '../live';
import { notifyClipSheets, openClipSheet } from '../sheets/clip';
import type { Clip, Run, Schedule, Scene, StatusBody } from '../../shared/types';

export async function startLogPage(initial: {
  status: StatusBody;
  scenes: Scene[];
}): Promise<void> {
  const dayInput = must<HTMLInputElement>('[data-log-day]');
  const heading = must<HTMLElement>('[data-log-heading]');
  const runsList = must<HTMLElement>('[data-runs-list]');
  const clipsList = must<HTMLElement>('[data-clips-list]');
  const schedules = (await api.get<{ schedules: Schedule[] }>('/api/schedules')).schedules;

  let day = initial.status.day;
  let runs: Run[] = [];
  let clips: Clip[] = [];

  const sceneName = (id: string): string =>
    initial.scenes.find((scene) => scene.id === id)?.name ?? id;
  const scheduleName = (id: string): string =>
    schedules.find((schedule) => schedule.id === id)?.name ?? id;

  function paintHeading(): void {
    const today = status()?.day ?? initial.status.day;
    heading.textContent = day === today ? 'Today' : longDate(day);
    if (dayInput.value !== day) dayInput.value = day;
  }

  function paintRuns(): void {
    runsList.replaceChildren(
      ...runs.map((run) =>
        el('li', { class: 'run-row num' }, [
          `${hhmm(run.ran_at)} ${sceneName(run.scene_id)} · ${run.room_ids.length} rooms · ${scheduleName(
            run.schedule_id,
          )}`,
        ]),
      ),
    );
  }

  function clipRow(clip: Clip): HTMLElement {
    const button = el(
      'button',
      {
        type: 'button',
        class: 'control clip-button',
        'aria-label': `${clip.camera_name} ${hhmmss(clip.recorded_at)}`,
      },
      [
        el('span', { class: 'clip-name' }, [clip.camera_name]),
        el('span', { class: 'clip-time num' }, [hhmmss(clip.recorded_at)]),
        el('span', { class: 'clip-state' }, [clipStateCopy(clip)]),
      ],
    );
    button.addEventListener('click', () => openClipSheet(clip, button));
    return el('li', { class: 'clip-row', 'data-clip-row': clip.id }, [button]);
  }

  function paintClips(): void {
    clipsList.replaceChildren(...clips.map((clip) => clipRow(clip)));
  }

  async function reload(): Promise<void> {
    const [runsBody, clipsBody] = await Promise.all([
      api.get<{ day: string; runs: Run[] }>(`/api/runs?day=${encodeURIComponent(day)}`),
      api.get<{ day: string; clips: Clip[] }>(`/api/clips?day=${encodeURIComponent(day)}`),
    ]);
    runs = runsBody.runs;
    clips = clipsBody.clips;
    paintHeading();
    paintRuns();
    paintClips();
  }

  must<HTMLButtonElement>('[data-prev-log-day]').addEventListener('click', () => {
    day = addDays(day, -1);
    void reload();
  });
  must<HTMLButtonElement>('[data-next-log-day]').addEventListener('click', () => {
    day = addDays(day, 1);
    void reload();
  });
  dayInput.addEventListener('change', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayInput.value)) {
      day = dayInput.value;
      void reload();
    }
  });

  await reload();

  onSocket((message) => {
    if (message.type === 'clip') {
      notifyClipSheets(message.clip);
      if (message.clip.day !== day) return;
      const index = clips.findIndex((candidate) => candidate.id === message.clip.id);
      if (index === -1) {
        clips = [...clips, message.clip].sort((a, b) =>
          a.recorded_at.localeCompare(b.recorded_at),
        );
        paintClips();
        return;
      }
      clips[index] = message.clip;
      const row = find<HTMLElement>(`[data-clip-row="${message.clip.id}"]`);
      const replacement = clipRow(message.clip);
      if (row) {
        row.replaceWith(replacement);
        pulse(replacement);
      }
    }
    if (message.type === 'status') {
      const previous = status();
      paintHeading();
      const sceneChanged = previous?.rooms.some((room) => {
        const next = message.rooms.find((candidate) => candidate.room_id === room.room_id);
        return next !== undefined && next.scene_id !== room.scene_id;
      });
      if (sceneChanged === true) {
        void api
          .get<{ runs: Run[] }>(`/api/runs?day=${encodeURIComponent(day)}`)
          .then((body) => {
            runs = body.runs;
            paintRuns();
          });
      }
    }
  });
}
