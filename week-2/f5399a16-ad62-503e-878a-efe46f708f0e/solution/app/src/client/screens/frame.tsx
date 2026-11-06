// The signed-in frame: rail from 1100 px, top bar and Menu sheet below it, and the job navigation.

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { COPY } from '../../shared/copy';
import { announce } from '../announce';
import { ApiError, api } from '../api';
import { useRoute } from '../router';
import { Link, Problems, SessionLine, TextField, WIDE, classOf, useForm, useMedia } from '../ui/kit';
import { Overlay, useDialog, type DialogState } from '../ui/overlay';

function DeskLinks({ onGo }: { onGo?: () => void }) {
  const route = useRoute();
  return (
    <nav aria-label="Desk" className="desk-links">
      {[['/desk/jobs', 'Jobs'], ['/desk/clients', 'Clients'], ['/desk/calls', 'Calls']].map(([href, label]) => (
        <Link key={href} className="nav-link" href={href as string} aria-current={route.path === href ? 'page' : undefined} onClick={onGo}>{label}</Link>
      ))}
    </nav>
  );
}

function ChangePassword({ state }: { state: DialogState }) {
  const form = useForm(null, () => ({ currentPassword: '', newPassword: '' }), { focusMessage: true });
  const save = () =>
    form.submit(async () => {
      try {
        await api('/api/password', { method: 'POST', body: form.values });
      } catch (error) {
        if (error instanceof ApiError && error.message === COPY.passwordRefused) {
          form.refuse(error.message, { currentPassword: error.message });
          return;
        }
        throw error;
      }
      announce(COPY.passwordChanged);
      state.hide();
    });
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Problems form={form} />
      <TextField form={form} name="currentPassword" label="Current password" type="password" autoComplete="current-password" />
      <TextField form={form} name="newPassword" label="New password" type="password" autoComplete="new-password" />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Save'}</button>
    </form>
  );
}

function SignOutButton() {
  return (
    <button
      type="button"
      className="btn btn-plain"
      onClick={() => {
        void api('/api/sign-out', { method: 'POST' }).finally(() => {
          location.assign('/sign-in');
        });
      }}
    >
      Sign out
    </button>
  );
}

function RailControls({ password }: { password: DialogState }) {
  return (
    <div className="desk-controls">
      <button type="button" className="btn btn-plain" onClick={password.show}>Change password</button>
      <SignOutButton />
    </div>
  );
}

export function DeskFrame({ children }: { children: ReactNode }) {
  const wide = useMedia(WIDE);
  const menu = useDialog('menu');
  const password = useDialog('changePassword');
  const route = useRoute();
  useEffect(() => {
    document.documentElement.classList.add('desk');
    return () => document.documentElement.classList.remove('desk');
  }, []);
  return (
    <div className="desk-frame">
      {wide ? (
        <aside className="rail">
          <p className="wordmark">Noor Bakker Boards</p>
          <DeskLinks />
          <RailControls password={password} />
        </aside>
      ) : (
        <div className="top-bar">
          <p className="wordmark">Noor Bakker Boards</p>
          <button type="button" className="btn btn-plain" onClick={menu.show}>Menu</button>
        </div>
      )}
      <main className="desk-main">
        <SessionLine />
        {children}
      </main>
      {!wide ? (
        <Overlay state={menu} title="Menu" sheet>
          <DeskLinks onGo={() => menu.hide('none')} />
          <div className="desk-controls">
            <button
              type="button"
              className="btn btn-plain"
              onClick={() => {
                menu.hide('none');
                password.show();
              }}
            >
              Change password
            </button>
            <SignOutButton />
          </div>
        </Overlay>
      ) : null}
      <Overlay state={password} title="Change password">
        <ChangePassword key={route.path} state={password} />
      </Overlay>
    </div>
  );
}

const JOB_LINKS: [string, string][] = [
  ['', 'Board'], ['/script', 'Script'], ['/reel', 'Reel'], ['/lines', 'Lines'], ['/cues', 'Cues'],
  ['/cuts', 'Cuts'], ['/notes', 'Notes'], ['/delivery', 'Delivery'], ['/letter', 'Fee letter'],
];

export function JobNav({ jobId }: { jobId: string }) {
  const route = useRoute();
  const nav = useRef<HTMLElement>(null);
  const shownPath = route.path.replace(/\/compare$/, '/cuts');
  useLayoutEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>('[aria-current]');
    if (nav.current && current) nav.current.scrollLeft = Math.max(0, current.offsetLeft - 12);
  }, [shownPath]);
  return (
    <nav ref={nav} aria-label="This job" className="job-nav" onFocus={(event) => event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
      {JOB_LINKS.map(([sub, label]) => {
        const href = `/desk/jobs/${jobId}${sub}`;
        return <Link key={label} href={href} className="nav-link" aria-current={shownPath === href ? 'page' : undefined}>{label}</Link>;
      })}
    </nav>
  );
}

