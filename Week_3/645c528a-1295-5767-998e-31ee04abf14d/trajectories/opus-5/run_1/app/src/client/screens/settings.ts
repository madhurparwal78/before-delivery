import { api } from '../api.js';
import { clear, el, labelledButton, openDialog, statusRegion, sliderInput } from '../dom.js';
import { navigate, type Screen } from '../navigate.js';
import { applySettings, refreshMe, state, type Settings } from '../state.js';

const THEMES = [
  ['Light', 'light'],
  ['Dark', 'dark'],
  ['System', 'system'],
] as const;

export function settingsScreen(): Screen {
  const notice = statusRegion('Settings notice', 'notice');
  const blocked = el('ul', { className: 'blocked-list', attrs: { role: 'list', 'aria-label': 'Blocked users' } });

  function currentSettings(): Settings {
    return (
      state.me?.settings ?? {
        sound: true,
        music: true,
        aimSensitivity: 5,
        leftHanded: false,
        reducedMotion: false,
        theme: 'dark',
      }
    );
  }

  async function patch(partial: Partial<Settings>): Promise<void> {
    const result = await api<Settings>('PATCH', '/api/me/settings', partial);
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    applySettings(result.data);
    await refreshMe();
  }

  function toggle(name: string, key: keyof Settings): HTMLElement {
    const value = Boolean(currentSettings()[key]);
    const button = el('button', {
      className: 'switch',
      text: name,
      attrs: { type: 'button', role: 'switch', 'aria-label': name, 'aria-checked': value ? 'true' : 'false' },
    });
    button.addEventListener('click', () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', next ? 'true' : 'false');
      void patch({ [key]: next } as Partial<Settings>);
    });
    return button;
  }

  const sound = toggle('Sound', 'sound');
  const music = toggle('Music', 'music');
  const leftHanded = toggle('Left-handed mode', 'leftHanded');
  const reducedMotion = toggle('Reduced motion', 'reducedMotion');
  const sensitivity = sliderInput({
    name: 'Aim sensitivity',
    min: 1,
    max: 10,
    step: 1,
    value: currentSettings().aimSensitivity,
    onInput: (value) => void patch({ aimSensitivity: value }),
  });

  const themeGroup = el('div', { className: 'theme-group', attrs: { role: 'radiogroup', 'aria-label': 'Theme' } });
  for (const [label, value] of THEMES) {
    const input = el('input', { attrs: { type: 'radio', name: 'theme', value } });
    if (currentSettings().theme === value) input.checked = true;
    input.addEventListener('change', () => void patch({ theme: value }));
    themeGroup.append(el('label', { className: 'theme-option', children: [input, label] }));
  }

  async function loadBlocked(): Promise<void> {
    const result = await api<{ blocked: { id: string; displayName: string }[] }>('GET', '/api/friends');
    if (!result.ok) return;
    clear(blocked);
    for (const entry of result.data.blocked) {
      blocked.append(
        el('li', {
          attrs: { role: 'listitem' },
          children: [
            el('span', { text: entry.displayName }),
            labelledButton(
              `Unblock ${entry.displayName}`,
              () => {
                void api('DELETE', `/api/friends/${entry.id}/block`).then(() => loadBlocked());
              },
              { className: 'button quiet' },
            ),
          ],
        }),
      );
    }
  }

  const deleteButton = labelledButton(
    'Delete account',
    () => {
      openDialog({
        name: 'Delete account',
        alert: true,
        opener: deleteButton,
        build: (handle) => {
          const password = el('input', { className: 'text-input', id: 'delete-password', attrs: { type: 'password' } });
          const message = el('p', { className: 'notice' });
          return [
            el('h2', { text: 'Delete account' }),
            el('div', {
              className: 'field-row',
              children: [el('label', { text: 'Password', attrs: { for: 'delete-password' } }), password],
            }),
            message,
            labelledButton(
              'Delete my account',
              () => {
                void api('DELETE', '/api/me', { password: password.value }).then(async (result) => {
                  if (!result.ok) {
                    message.textContent = result.failure.message;
                    return;
                  }
                  handle.close();
                  await refreshMe();
                  navigate('/home');
                });
              },
              { className: 'button primary' },
            ),
            labelledButton('Keep my account', () => handle.close(), { className: 'button quiet' }),
          ];
        },
      });
    },
    { className: 'button quiet' },
  );

  void loadBlocked();

  return {
    element: el('div', {
      className: 'settings',
      children: [
        el('h1', { className: 'screen-heading', text: 'Settings', attrs: { tabindex: '-1' } }),
        notice,
        el('div', { className: 'switch-row', children: [sound, music, leftHanded, reducedMotion] }),
        el('div', { className: 'slider-row', children: [el('span', { className: 'control-label', text: 'Aim sensitivity' }), sensitivity] }),
        themeGroup,
        blocked,
        deleteButton,
      ],
    }),
  };
}
