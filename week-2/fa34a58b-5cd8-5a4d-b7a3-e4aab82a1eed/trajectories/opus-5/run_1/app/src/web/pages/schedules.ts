import { api } from '../api';
import { el, must, svgIcon } from '../dom';
import { longDate } from '../format';
import { onSocket } from '../live';
import { openScheduleEditor } from '../sheets/schedule';
import type { Room, Scene, Schedule, StatusBody } from '../../shared/types';

export async function startSchedulesPage(initial: {
  status: StatusBody;
  scenes: Scene[];
  rooms: Room[];
}): Promise<void> {
  const tabs = must<HTMLElement>('[data-schedule-tabs]');
  const panels = must<HTMLElement>('[data-schedule-panels]');
  let schedules: Schedule[] = [];
  let active = 0;

  function paint(): void {
    tabs.replaceChildren(
      ...schedules.map((schedule, index) => {
        const tab = el(
          'button',
          {
            type: 'button',
            class: 'control tab',
            role: 'tab',
            id: `tab-${schedule.id}`,
            'aria-controls': `panel-${schedule.id}`,
            'aria-selected': String(index === active),
            tabindex: index === active ? '0' : '-1',
          },
          [schedule.name],
        );
        tab.addEventListener('click', () => {
          active = index;
          paint();
        });
        tab.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          event.preventDefault();
          active =
            (index + (event.key === 'ArrowRight' ? 1 : schedules.length - 1)) % schedules.length;
          paint();
          must<HTMLElement>(`#tab-${schedules[active]?.id ?? ''}`).focus();
        });
        return tab;
      }),
    );

    panels.replaceChildren(
      ...schedules.map((schedule, index) => {
        const edit = el(
          'button',
          { type: 'button', class: 'control', 'aria-label': `Edit ${schedule.name} schedule` },
          [svgIcon('square-pen'), el('span', {}, [`Edit ${schedule.name} schedule`])],
        );
        edit.addEventListener('click', () => {
          openScheduleEditor({
            schedule,
            today: initial.status.day,
            rooms: initial.rooms,
            scenes: initial.scenes,
            opener: edit,
            onSaved: () => {
              void reload();
            },
          });
        });

        const versions = schedule.versions.map((version) =>
          el('section', { class: 'version' }, [
            el('h3', { class: 'version-heading' }, [`From ${longDate(version.from)}`]),
            el(
              'ul',
              { class: 'slot-list' },
              version.slots.map((slot) =>
                el('li', { class: 'slot-line num' }, [
                  `${slot.time} ${
                    initial.scenes.find((scene) => scene.id === slot.scene_id)?.name ??
                    slot.scene_id
                  } — ${slot.room_ids
                    .map(
                      (roomId) =>
                        initial.rooms.find((room) => room.id === roomId)?.name ?? roomId,
                    )
                    .join(', ')}`,
                ]),
              ),
            ),
          ]),
        );

        const panel = el(
          'div',
          {
            class: 'tabpanel',
            role: 'tabpanel',
            id: `panel-${schedule.id}`,
            'aria-labelledby': `tab-${schedule.id}`,
            tabindex: '0',
          },
          [edit, ...versions],
        );
        if (index !== active) panel.hidden = true;
        return panel;
      }),
    );
  }

  async function reload(): Promise<void> {
    schedules = (await api.get<{ schedules: Schedule[] }>('/api/schedules')).schedules;
    initial.scenes = (await api.get<{ scenes: Scene[] }>('/api/scenes')).scenes;
    paint();
  }

  await reload();
  onSocket((message) => {
    if (message.type === 'schedule' || message.type === 'scene') void reload();
  });
}
