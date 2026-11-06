import { api } from '../api';
import { clear, el } from '../dom';
import { frame } from '../frame';
import { Screen } from '../router';
import { DeviceSessionDto } from '../types';
import { homeZone, setHomeZone, setTheme, theme, workspace } from '../state';
import { shortStamp } from '../../shared/homeclock';
import { openDialog } from '../components/dialog';
import { onLive } from '../live';
import { COPY, deviceSignedOutCopy, homeClockSavedCopy, themeSavedCopy } from '../../shared/copy';
import { ThemeName, themeLabel } from '../../shared/tokens';

function timeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported === 'function') return supported('timeZone');
  return ['Europe/London', 'Europe/Paris', 'UTC', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney'];
}

export function settingsScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let sessions: DeviceSessionDto[] = [];
  let openConfirmation: { sessionId: string; close: () => void } | null = null;
  const sessionList = el('ul', { className: 'device-sessions', attrs: { 'aria-label': 'Device sessions' } });
  const sessionsHeading = el('h2', { text: 'Device sessions', attrs: { tabindex: '-1' } });

  function sessionText(session: DeviceSessionDto): string {
    return `${session.label}, signed in ${shortStamp(new Date(session.created_at), homeZone())}`;
  }

  function renderSessions(): void {
    const focused = document.activeElement as HTMLElement | null;
    const focusedId = focused?.getAttribute('data-session-button');
    clear(sessionList);
    sessions.forEach((session, index) => {
      const item = el('li', { className: 'device-session' });
      item.append(el('span', { text: sessionText(session) }));
      if (session.current) {
        item.append(el('span', { className: 'this-device', text: 'This device' }));
      } else {
        const button = el('button', {
          className: 'sign-out-device',
          text: 'Sign out',
          attrs: {
            type: 'button',
            'aria-label': `Sign out ${sessionText(session)}`,
            'data-session-button': session.id,
          },
        });
        button.addEventListener('click', () => openSignOutDialog(session, button, index));
        item.append(button);
      }
      sessionList.append(item);
    });
    if (focusedId !== null && focusedId !== undefined) {
      const again = sessionList.querySelector<HTMLElement>(`[data-session-button="${focusedId}"]`);
      if (again !== null) again.focus();
      else moveFocusAfter(focusedId);
    }
  }

  function moveFocusAfter(goneSessionId: string): void {
    const buttons = [...sessionList.querySelectorAll<HTMLElement>('[data-session-button]')];
    const next = buttons.find((button) => button.getAttribute('data-session-button') !== goneSessionId);
    if (next !== undefined) next.focus();
    else sessionsHeading.focus();
  }

  function openSignOutDialog(session: DeviceSessionDto, opener: HTMLElement, _index: number): void {
    const handle = openDialog({
      label: 'Sign out this device?',
      role: 'alertdialog',
      opener,
      content: (dialog) => {
        const confirm = el('button', { text: 'Sign out device', attrs: { type: 'button' } });
        const cancel = el('button', { text: 'Cancel', attrs: { type: 'button' } });
        confirm.addEventListener('click', () => {
          void (async () => {
            const result = await api.del(`/api/sessions/${session.id}`);
            dialog.close();
            openConfirmation = null;
            if (result.status === 404) {
              frame().showAlert(COPY.deviceAlreadySignedOut);
              await loadSessions();
              moveFocusAfter(session.id);
              return;
            }
            if (result.ok) {
              frame().announce(deviceSignedOutCopy(session.label));
              await loadSessions();
              moveFocusAfter(session.id);
            }
          })();
        });
        cancel.addEventListener('click', () => {
          openConfirmation = null;
          dialog.close();
        });
        return [confirm, cancel];
      },
      onClose: () => {
        openConfirmation = null;
      },
    });
    openConfirmation = { sessionId: session.id, close: handle.close };
  }

  async function loadSessions(): Promise<void> {
    const result = await api.get<{ sessions: DeviceSessionDto[] }>('/api/sessions');
    if (!result.ok) return;
    sessions = result.data.sessions;
    renderSessions();
  }

  return {
    async mount(): Promise<void> {
      const main = frame().main;
      clear(main);
      clear(frame().margin);
      frame().setTopTitle('Settings');
      main.append(el('h1', { text: 'Settings', attrs: { tabindex: '-1' } }));

      const zoneSelect = el('select', { attrs: { 'aria-label': 'Home clock' } });
      for (const zone of timeZones()) zoneSelect.append(el('option', { text: zone, attrs: { value: zone } }));
      zoneSelect.value = homeZone();
      const zoneError = el('div', { className: 'field-error' });
      const saveZone = el('button', { text: 'Save home clock', attrs: { type: 'button' } });
      saveZone.addEventListener('click', () => {
        void (async () => {
          const result = await api.put<{ home_time_zone: string }>('/api/settings', {
            home_time_zone: zoneSelect.value,
          });
          if (!result.ok) {
            zoneError.textContent = result.errors?.['home_time_zone'] ?? '';
            return;
          }
          zoneError.textContent = '';
          setHomeZone(result.data.home_time_zone);
          frame().announce(homeClockSavedCopy(result.data.home_time_zone));
          renderSessions();
        })();
      });

      const themeSelect = el('select', { attrs: { 'aria-label': 'Theme' } });
      themeSelect.append(
        el('option', { text: 'Paper', attrs: { value: 'paper' } }),
        el('option', { text: 'Lamplight', attrs: { value: 'lamplight' } }),
      );
      themeSelect.value = theme();
      themeSelect.addEventListener('change', () => {
        void (async () => {
          const next = themeSelect.value as ThemeName;
          const result = await api.put<{ theme: ThemeName }>('/api/settings', { theme: next });
          if (!result.ok) return;
          setTheme(result.data.theme);
          frame().announce(themeSavedCopy(themeLabel(result.data.theme)));
        })();
      });

      const currentPassword = el('input', {
        attrs: { type: 'password', 'aria-label': 'Current password', autocomplete: 'current-password' },
      });
      const newPassword = el('input', {
        attrs: { type: 'password', 'aria-label': 'New password', autocomplete: 'new-password' },
      });
      const passwordError = el('div', { className: 'field-error' });
      const changePassword = el('button', { text: 'Change password', attrs: { type: 'button' } });
      changePassword.addEventListener('click', () => {
        void (async () => {
          const result = await api.post<{ csrf_token: string }>('/api/account/password', {
            current_password: currentPassword.value,
            new_password: newPassword.value,
          });
          if (!result.ok) {
            passwordError.textContent =
              result.errors?.['current_password'] ?? result.errors?.['new_password'] ?? '';
            return;
          }
          passwordError.textContent = '';
          const { setCsrfToken } = await import('../api');
          setCsrfToken(result.data.csrf_token);
          frame().announce(COPY.passwordChanged);
          currentPassword.value = '';
          newPassword.value = '';
          await loadSessions();
        })();
      });

      const signOut = el('button', { className: 'sign-out', text: 'Sign out', attrs: { type: 'button' } });
      signOut.addEventListener('click', () => {
        void (async () => {
          await api.post('/api/auth/sign-out');
          window.location.assign('/sign-in');
        })();
      });

      main.append(
        el('div', { className: 'settings-row', children: [el('label', { text: 'Home clock' }), zoneSelect, zoneError, saveZone] }),
        el('div', { className: 'settings-row', children: [el('label', { text: 'Theme' }), themeSelect] }),
        sessionsHeading,
        sessionList,
        el('div', {
          className: 'settings-row',
          children: [
            el('label', { text: 'Current password' }),
            currentPassword,
            el('label', { text: 'New password' }),
            newPassword,
            passwordError,
            changePassword,
          ],
        }),
        signOut,
      );
      await loadSessions();
      stopLive = onLive((type) => {
        if (type !== 'sessions.changed') return;
        void (async () => {
          await loadSessions();
          if (openConfirmation !== null) {
            const stillThere = sessions.some((session) => session.id === openConfirmation?.sessionId);
            if (!stillThere) return;
          }
        })();
      });
      void workspace();
    },
    unmount(): void {
      if (stopLive !== null) stopLive();
    },
  };
}
