import { useState } from 'preact/hooks';
import { copy } from '../../shared/copy';
import type { BootOf } from '../../shared/types';
import { announce, setBusy } from '../shared/dom';
import { api } from './api';
import { FieldError, fieldProps } from './ui';

/** How long the confirmation stays up before the new member is taken to the editor. */
const REDIRECT_AFTER_JOIN_MS = 800;

export function SignIn({ next }: { next: string | null }) {
  const [error, setError] = useState<string | undefined>();
  return (
    <main class="centered">
      <form
        class="card-form"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget as HTMLFormElement);
          const button = (event.currentTarget as HTMLFormElement).querySelector('button') as HTMLElement;
          setBusy(button, true);
          const result = await api<{ redirectTo: string }>('POST', '/api/session', { email: form.get('email'), password: form.get('password'), next });
          setBusy(button, false);
          if (result.ok) {
            location.assign(result.data.redirectTo);
          } else {
            setError(result.failure.message);
            announce(result.failure.message);
          }
        }}
      >
        <p class="running-head">Sorts &amp; Quoins</p>
        <h1>Galley</h1>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="username" autofocus />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" {...fieldProps('password', error)} />
          <FieldError id="password" message={error} />
        </div>
        <button type="submit" class="button primary">
          Sign in
        </button>
      </form>
    </main>
  );
}

export function Invite({ invite }: { invite: BootOf<'invite'>['invite'] }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [joined, setJoined] = useState(false);
  if (joined) {
    return (
      <main class="centered">
        <div class="card-form">
          <h1>{`You've joined ${invite.teamName}.`}</h1>
          <p>Taking you to the editor.</p>
          <a class="button primary" href="/app">
            Open the editor
          </a>
        </div>
      </main>
    );
  }
  if (!invite.valid) {
    return (
      <main class="centered">
        <div class="card-form">
          <h1>{copy.inviteInvalid}</h1>
        </div>
      </main>
    );
  }
  return (
    <main class="centered">
      <form
        class="card-form"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget as HTMLFormElement);
          const button = (event.currentTarget as HTMLFormElement).querySelector('button') as HTMLElement;
          setBusy(button, true);
          const result = await api('POST', `/api/invites/${invite.token}/accept`, { name: form.get('name'), password: form.get('password') });
          setBusy(button, false);
          if (result.ok) {
            setJoined(true);
            announce(`You've joined ${invite.teamName}.`);
            window.setTimeout(() => location.assign('/app'), REDIRECT_AFTER_JOIN_MS);
          } else {
            setErrors(result.failure.fields ?? { name: result.failure.message });
            announce(result.failure.message);
          }
        }}
      >
        <h1>{copy.inviteHeading(invite.teamName)}</h1>
        <div class="field">
          <label for="name">Name</label>
          <input id="name" name="name" type="text" autocomplete="name" autofocus {...fieldProps('name', errors.name)} />
          <FieldError id="name" message={errors.name} />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="new-password" {...fieldProps('password', errors.password)} />
          <FieldError id="password" message={errors.password} />
        </div>
        <button type="submit" class="button primary">
          Join team
        </button>
      </form>
    </main>
  );
}
