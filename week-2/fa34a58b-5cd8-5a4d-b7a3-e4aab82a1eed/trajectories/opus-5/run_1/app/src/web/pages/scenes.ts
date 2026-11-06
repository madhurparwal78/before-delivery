import { api } from '../api';
import { el, must, svgIcon } from '../dom';
import { onSocket } from '../live';
import { openSceneSheet } from '../sheets/scene';
import type { Scene } from '../../shared/types';

export async function startScenesPage(): Promise<void> {
  const list = must<HTMLElement>('[data-scene-list]');
  const newButton = must<HTMLButtonElement>('[data-new-scene]');
  let scenes: Scene[] = [];

  function paint(): void {
    list.replaceChildren(
      ...scenes.map((scene) => {
        const edit = el(
          'button',
          { type: 'button', class: 'control icon-button', 'aria-label': `Edit ${scene.name}` },
          [svgIcon('square-pen')],
        );
        edit.addEventListener('click', () => {
          openSceneSheet({ scene, opener: edit, onSaved: () => void reload() });
        });
        return el('li', { class: 'scene-row' }, [
          el('span', { class: `swatch tint-${scene.tint}` }),
          el('span', { class: 'scene-name' }, [scene.name]),
          el('span', { class: 'scene-brightness num' }, [`${scene.brightness}%`]),
          el('span', { class: 'scene-setpoint num' }, [
            scene.setpoint_f === null ? 'No setpoint' : `${scene.setpoint_f}°F`,
          ]),
          edit,
        ]);
      }),
    );
  }

  async function reload(): Promise<void> {
    scenes = (await api.get<{ scenes: Scene[] }>('/api/scenes')).scenes;
    paint();
  }

  newButton.addEventListener('click', () => {
    openSceneSheet({ scene: null, opener: newButton, onSaved: () => void reload() });
  });

  await reload();
  onSocket((message) => {
    if (message.type === 'scene') void reload();
  });
}
