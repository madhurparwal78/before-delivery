import { ERROR_COPY, PENDING_COPY } from '../../shared/copy';
import { request, RequestFailed } from '../api';
import { button, element, heading } from '../dom';
import { pendingDraft } from '../draft';
import { Cleanup, navigate } from '../router';
import { problemsSummary, textField } from '../ui/fields';
import { RETURN_ROUTE_KEY } from '../ui/frame';
import { ActionNote, StatusRegion } from '../ui/live';

interface SessionBody {
  member: { id: string; name: string; email: string; role: string };
  workspace: { slug: string; name: string };
  home: string;
}

export async function signInScreen(host: HTMLElement): Promise<Cleanup> {
  const status = new StatusRegion('Desk status');
  const note = new ActionNote(status);
  const problems = problemsSummary();
  const email = textField('Email', 'email');
  email.control.setAttribute('autocomplete', 'username');
  const password = textField('Password', 'password');
  password.control.setAttribute('type', 'password');
  password.control.setAttribute('autocomplete', 'current-password');

  const submit = button('Sign in', () => void send(), { className: 'control primary' });

  const send = async (): Promise<void> => {
    problems.clear();
    note.say(PENDING_COPY.signIn, 'pending');
    try {
      const body = await request<SessionBody>('POST', '/api/session', {
        email: email.control.value,
        password: password.control.value,
      });
      const draft = pendingDraft();
      const stored = window.sessionStorage.getItem(RETURN_ROUTE_KEY);
      window.sessionStorage.removeItem(RETURN_ROUTE_KEY);
      if (draft !== null) {
        navigate(draft.route);
        return;
      }
      navigate(stored ?? body.home);
    } catch (error) {
      if (error instanceof RequestFailed) {
        note.say(error.failure.message, 'refused');
        problems.showOne(error.failure.message);
        return;
      }
      note.say(ERROR_COPY.not_found, 'refused');
    }
  };

  const form = element('form', {
    className: 'sign-in-form panel',
    children: [problems.node, email.node, password.node, note.node, submit],
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });

  host.append(
    element('div', {
      className: 'sign-in-page',
      children: [
        status.node,
        element('main', {
          className: 'sign-in-main',
          children: [heading(1, 'Sign in to Lanternline', 'sign-in-title'), form],
        }),
      ],
    }),
  );
  email.control.focus();
  return () => undefined;
}
