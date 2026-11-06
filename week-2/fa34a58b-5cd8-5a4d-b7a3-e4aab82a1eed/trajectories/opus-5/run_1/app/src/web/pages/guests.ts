import { api, ApiFailure, HubUnreachable, HUB_UNREACHABLE_COPY } from '../api';
import { el, find, must, svgIcon } from '../dom';
import { dayOf, hhmm, longDate } from '../format';
import { onSocket, setRegion } from '../live';
import { openGuestSheet } from '../sheets/guest';
import type { GuestScene, GuestSceneState, Room, Scene } from '../../shared/types';

const STATE_LABELS: Record<GuestSceneState, string> = {
  scheduled: 'Scheduled',
  active: 'Active',
  ended: 'Ended',
  cancelled: 'Cancelled',
};

export async function startGuestsPage(initial: { rooms: Room[]; scenes: Scene[] }): Promise<void> {
  const list = must<HTMLElement>('[data-guest-list]');
  const newButton = must<HTMLButtonElement>('[data-new-guest]');
  let guestScenes: GuestScene[] = [];

  const roomName = (id: string): string =>
    initial.rooms.find((room) => room.id === id)?.name ?? id;
  const sceneName = (id: string): string =>
    initial.scenes.find((scene) => scene.id === id)?.name ?? id;

  function paint(): void {
    list.replaceChildren(
      ...guestScenes.map((guest) => {
        const children: (Node | string)[] = [
          el('span', { class: 'guest-line' }, [
            `${roomName(guest.room_id)} · ${sceneName(guest.scene_id)} · ${
              STATE_LABELS[guest.state]
            } · until ${hhmm(guest.ends_at)} ${longDate(dayOf(guest.ends_at))}`,
          ]),
        ];
        if (guest.state === 'scheduled' || guest.state === 'active') {
          const cancel = el(
            'button',
            {
              type: 'button',
              class: 'control',
              'aria-label': `Cancel guest scene for ${roomName(guest.room_id)}`,
            },
            [svgIcon('x'), el('span', {}, ['Cancel'])],
          );
          cancel.addEventListener('click', () => {
            setRegion('guest-scene', 'Cancelling…');
            void api
              .post(`/api/guest-scenes/${guest.id}/cancel`, {})
              .then(() => {
                setRegion(
                  'guest-scene',
                  `Guest scene cancelled for ${roomName(guest.room_id)}.`,
                );
                void reload();
              })
              .catch((error: unknown) => {
                setRegion('guest-scene', '');
                const message =
                  error instanceof HubUnreachable
                    ? HUB_UNREACHABLE_COPY
                    : error instanceof ApiFailure
                      ? error.message
                      : null;
                if (message === null) throw error;
                const slot = find<HTMLElement>('[data-guest-alert]');
                const alert = el('p', { class: 'alert', role: 'alert', 'data-guest-alert': '' }, [
                  message,
                ]);
                if (slot) slot.replaceWith(alert);
                else list.before(alert);
              });
          });
          children.push(cancel);
        }
        return el('li', { class: 'guest-row' }, children);
      }),
    );
  }

  async function reload(): Promise<void> {
    guestScenes = (await api.get<{ guest_scenes: GuestScene[] }>('/api/guest-scenes')).guest_scenes;
    paint();
  }

  newButton.addEventListener('click', () => {
    openGuestSheet({
      rooms: initial.rooms,
      scenes: initial.scenes,
      opener: newButton,
      onCreated: () => void reload(),
    });
  });

  await reload();
  onSocket((message) => {
    if (message.type === 'guest_scene') void reload();
  });
}
