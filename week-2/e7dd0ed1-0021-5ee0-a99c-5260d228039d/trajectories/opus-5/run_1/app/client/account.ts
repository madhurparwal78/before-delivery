import { formatCount, formatTime } from '../src/format';
import { ApiFailure, api } from './api';
import { button, el, field, openDialog, replace, setStatus, statusRegion, textbox } from './dom';
import { passwordStatus, sessionsStatus, twoStepStatus } from './copy';

interface TwoStepState {
  enabled: boolean;
  enabled_at: string | null;
  recovery_codes_left: number;
}

interface SessionRow {
  id: string;
  device: string;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export async function mountAccount(root: HTMLElement): Promise<void> {
  const twoStepBody = el('div');
  const twoStepStatusRegion = statusRegion('Two-step status');
  const twoStepRegion = el('section', { role: 'region', 'aria-label': 'Two-step sign-in' }, [
    el('h2', { text: 'Two-step sign-in' }),
    twoStepBody,
    twoStepStatusRegion,
  ]);

  const sessionBody = el('tbody');
  const sessionsStatusRegion = statusRegion('Sessions status');
  const signOutOthers = button('Sign out other sessions', { focusKey: 'sign-out-others' });
  const sessionsRegion = el('section', { role: 'region', 'aria-label': 'Sessions' }, [
    el('h2', { text: 'Sessions' }),
    el('table', { class: 'data', 'aria-label': 'Sessions' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Device' }),
          el('th', { scope: 'col', text: 'Signed in (UTC)' }),
          el('th', { scope: 'col', text: 'Last seen (UTC)' }),
          el('th', { scope: 'col', text: '' }),
        ]),
      ]),
      sessionBody,
    ]),
    signOutOthers,
    sessionsStatusRegion,
  ]);

  const currentPassword = textbox('Current password', { type: 'password' });
  const newPassword = textbox('New password', { type: 'password' });
  const changePassword = button('Change password', { className: 'primary', focusKey: 'change-password' });
  const passwordStatusRegion = statusRegion('Password status');
  const passwordField = field('New password', newPassword);
  const passwordRegion = el('section', { role: 'region', 'aria-label': 'Password' }, [
    el('h2', { text: 'Password' }),
    field('Current password', currentPassword),
    passwordField,
    changePassword,
    passwordStatusRegion,
  ]);

  replace(root, [
    el('div', { class: 'account' }, [
      el('h1', { text: 'Account' }),
      el('a', { href: '/console', text: 'Back to the console' }),
      twoStepRegion,
      sessionsRegion,
      passwordRegion,
    ]),
  ]);

  async function loadTwoStep(): Promise<void> {
    const state = (await api.get<TwoStepState>('/api/me/two-step')).body;
    if (state.enabled) {
      const turnOff = button('Turn off two-step sign-in', { focusKey: 'turn-off-two-step' });
      turnOff.addEventListener('click', () => {
        openDialog({
          name: 'Turn off two-step sign-in',
          opener: turnOff,
          build: (dialog) => {
            const code = textbox('Authenticator code');
            const confirm = button('Turn off', { className: 'primary' });
            confirm.addEventListener('click', async () => {
              setStatus(twoStepStatusRegion, twoStepStatus.pending);
              try {
                await api.delete('/api/me/two-step', { code: code.value.trim() });
                setStatus(twoStepStatusRegion, twoStepStatus.turnedOff);
                dialog.close();
                await loadTwoStep();
              } catch (error) {
                if (error instanceof ApiFailure) {
                  const message = error.errors.code ?? error.errors.recovery_code ?? error.message;
                  dialog.setStatus(message);
                  setStatus(twoStepStatusRegion, message);
                }
              }
            });
            dialog.body.append(
              el('h2', { text: 'Turn off two-step sign-in' }),
              field('Authenticator code', code),
              el('div', { class: 'dialog-actions' }, [confirm, button('Cancel', { onClick: () => dialog.close() })]),
            );
          },
        });
      });
      replace(twoStepBody, [
        el('p', {
          text: `On since ${formatTime(state.enabled_at ?? new Date().toISOString())}. ${formatCount(
            state.recovery_codes_left,
          )} recovery codes left.`,
        }),
        turnOff,
      ]);
      return;
    }
    const turnOn = button('Turn on two-step sign-in', { className: 'primary', focusKey: 'turn-on-two-step' });
    turnOn.addEventListener('click', async () => {
      const setup = await api.post<{ secret: string; otpauth_uri: string }>('/api/me/two-step/setup');
      setStatus(twoStepStatusRegion, twoStepStatus.setupStarted);
      const secret = textbox('Setup key', { readOnly: true, value: setup.body.secret });
      const code = textbox('Authenticator code');
      const verify = button('Verify and turn on', { className: 'primary' });
      const codes = el('ul', { 'aria-label': 'Recovery codes' });
      verify.addEventListener('click', async () => {
        setStatus(twoStepStatusRegion, twoStepStatus.pending);
        try {
          const enabled = await api.post<{ recovery_codes: string[] }>('/api/me/two-step/enable', { code: code.value.trim() });
          replace(
            codes,
            enabled.body.recovery_codes.map((entry) => el('li', { class: 'mono', text: entry })),
          );
          setStatus(twoStepStatusRegion, twoStepStatus.turnedOn);
          verify.disabled = true;
        } catch (error) {
          if (error instanceof ApiFailure) setStatus(twoStepStatusRegion, error.errors.code ?? error.message);
        }
      });
      replace(twoStepBody, [
        field('Setup key', secret),
        el('p', { class: 'mono', text: setup.body.otpauth_uri }),
        field('Authenticator code', code),
        verify,
        codes,
      ]);
      code.focus();
    });
    replace(twoStepBody, [turnOn]);
  }

  async function loadSessions(): Promise<void> {
    const sessions = (await api.get<{ sessions: SessionRow[] }>('/api/me/sessions')).body.sessions;
    replace(
      sessionBody,
      sessions.map((session) => {
        const actions = el('td');
        if (!session.current) {
          const end = button(`Sign out session from ${formatTime(session.created_at)}`, {
            focusKey: `sign-out:${session.id}`,
          });
          end.addEventListener('click', async () => {
            await api.delete(`/api/me/sessions/${session.id}`);
            setStatus(sessionsStatusRegion, sessionsStatus.oneEnded);
            await loadSessions();
          });
          actions.append(end);
        }
        return el('tr', {}, [
          el('td', { text: `${session.device}${session.current ? ' \u00b7 This session' : ''}` }),
          el('td', { class: 'mono', text: formatTime(session.created_at) }),
          el('td', { class: 'mono', text: formatTime(session.last_seen_at) }),
          actions,
        ]);
      }),
    );
  }

  signOutOthers.addEventListener('click', async () => {
    const ended = await api.post<{ ended: number }>('/api/me/sessions/sign-out-others');
    setStatus(sessionsStatusRegion, sessionsStatus.othersEnded(ended.body.ended));
    await loadSessions();
  });

  changePassword.addEventListener('click', async () => {
    setStatus(passwordStatusRegion, passwordStatus.pending);
    try {
      const changed = await api.put<{ ended_sessions: number }>('/api/me/password', {
        current_password: currentPassword.value,
        new_password: newPassword.value,
      });
      currentPassword.value = '';
      newPassword.value = '';
      setStatus(passwordStatusRegion, passwordStatus.success(changed.body.ended_sessions));
      await loadSessions();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      const message =
        error.code === 'invalid_credentials'
          ? passwordStatus.wrongCurrent
          : error.code === 'rate_limited'
            ? `Too many sign-in attempts. Try again in ${error.retryAfterSeconds} seconds.`
            : (error.errors.new_password ?? error.message);
      setStatus(passwordStatusRegion, message);
      const target = passwordField.querySelector('.field-error');
      if (target) target.textContent = error.errors.new_password ?? '';
    }
  });

  await loadTwoStep();
  await loadSessions();
}
