import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from '../ui/icons';
import { mss, utcStamp } from '../../shared/format';
import type { EmailStatus, Session } from '../../shared/types';
import { Dialog } from '../ui/Dialog';
import { useCountdown } from '../ui/countdown';
import { canMove, isOpen, isRunning } from '../../shared/playtest';
import { controlsSession, inviteTester, loadSessions, moveSession, resendInvite, revokeInvite, schedulePlaytest, sendHint } from './play';
import { closeDialog, useEditor } from './state';

const EMAIL_WORD: Record<EmailStatus, string> = { sent: 'Sent', queued: 'Queued', failed: 'Failed' };
const STATE_WORD: Record<Session['state'], string> = { scheduled: 'Scheduled', lobby: 'Lobby', running: 'Running', ended: 'Ended', cancelled: 'Cancelled' };

function Cooldown({ session }: { session: Session }) {
  const left = useCountdown(session.hintCooldownSeconds, session);
  return <span className="cooldown tabular">{left > 0 ? `Next hint in ${mss(left)}` : 'Hint ready'}</span>;
}

function RunningClock({ session }: { session: Session }) {
  return <span className="session-clock mono tabular">{mss(useCountdown(session.remainingSeconds, session))} left</span>;
}

function SessionCard({ session }: { session: Session }) {
  const [email, setEmail] = useState('');
  const [hint, setHint] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const allowed = controlsSession(session);
  const live = isOpen(session.state);
  const act = (action: 'open' | 'start' | 'end' | 'cancel') => () => void moveSession(session.id, action);

  return (
    <li className="session-card" data-state={session.state}>
      <div className="session-head">
        <b>{STATE_WORD[session.state]}</b>
        <span className="tabular">{utcStamp(session.startsAt)} UTC</span>
        {isRunning(session.state) ? <RunningClock session={session} /> : null}
        <span className="session-kind">{session.kind === 'walk_in' ? 'Walk-in' : 'Remote'}</span>
      </div>
      {allowed ? (
        <div className="session-actions">
          {canMove(session.state, 'open') ? <button type="button" className="btn" onClick={act('open')}>Open lobby</button> : null}
          {canMove(session.state, 'start') ? <button type="button" className="btn primary" onClick={act('start')}>Start</button> : null}
          {canMove(session.state, 'end') ? <button type="button" className="btn" onClick={act('end')}>End</button> : null}
          {canMove(session.state, 'cancel') ? <button type="button" className="btn" onClick={act('cancel')}>Cancel playtest</button> : null}
        </div>
      ) : null}
      {live && allowed ? (
        <form
          className="inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const sent = email;
            const result = await inviteTester(session.id, sent.trim());
            setErrors(result);
            if (Object.keys(result).length === 0) setEmail((current) => (current === sent ? '' : current));
          }}
        >
          <label className="field">
            <span>Tester email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            {errors.email ? <span className="field-error">{errors.email}</span> : null}
          </label>
          <button type="submit" className="btn" disabled={!email.trim()}>
            Send invite
          </button>
        </form>
      ) : null}
      {isRunning(session.state) && allowed ? (
        <form
          className="inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const sent = hint;
            const result = await sendHint(session.id, sent);
            setErrors(result);
            if (Object.keys(result).length === 0) setHint((current) => (current === sent ? '' : current));
          }}
        >
          <label className="field">
            <span>Hint</span>
            <input type="text" value={hint} onChange={(event) => setHint(event.target.value)} />
            {errors.text ? <span className="field-error">{errors.text}</span> : null}
          </label>
          <button type="submit" className="btn">
            Send hint
          </button>
          <Cooldown session={session} />
        </form>
      ) : null}
      {session.testers.length > 0 ? (
        <table aria-label="Roster" className="roster">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Name</th>
              <th scope="col">Joined</th>
              <th scope="col">Invite</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {session.testers.map((t) => (
              <tr key={t.inviteId}>
                <td>{t.email}</td>
                <td>{t.displayName ?? '—'}</td>
                <td>{t.joined ? 'Joined' : 'Not yet'}</td>
                <td>{EMAIL_WORD[t.emailStatus]}</td>
                <td className="row-actions">
                  {allowed && live ? (
                    <>
                      <button type="button" className="btn" aria-label={`Resend ${t.email}`} onClick={() => void resendInvite(session.id, t.inviteId, t.email)}>
                        Resend
                      </button>
                      <button type="button" className="btn" aria-label={`Revoke ${t.email}`} onClick={() => void revokeInvite(session.id, t.inviteId)}>
                        Revoke
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </li>
  );
}

/** The Playtests sheet: schedule a playtest, invite testers, open the lobby, start, watch the clock and the roster. */
export default function Playtests() {
  const open = useEditor((s) => s.dialogs.playtests === true);
  const sessions = useEditor((s) => s.sessions);
  const me = useEditor((s) => s.me);
  const [startsAt, setStartsAt] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const poll = useRef<number>(0);
  const queued = useMemo(() => sessions.some((s) => s.testers.some((t) => t.emailStatus === 'queued')), [sessions]);

  useEffect(() => {
    if (open) void loadSessions().catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open || !queued) return;
    poll.current = window.setInterval(() => void loadSessions().catch(() => undefined), 3000);
    return () => window.clearInterval(poll.current);
  }, [open, queued]);

  return (
    <Dialog name="Playtests" open={open} onClose={() => closeDialog('playtests')} className="centered wide" initialFocus={(root) => root.querySelector<HTMLElement>('input, button:not([aria-label="Close"])')}>
      <div className="dialog-head">
        <h2>Playtests</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => closeDialog('playtests')}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">
        {me?.role === 'owner' ? (
          <form
            className="inline-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await schedulePlaytest(new Date(startsAt).toISOString());
              setErrors(result);
              if (Object.keys(result).length === 0) setStartsAt('');
            }}
          >
            <label className="field">
              <span>Start time</span>
              <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
              {errors.startsAt ? <span className="field-error">{errors.startsAt}</span> : null}
            </label>
            <button type="submit" className="btn primary" disabled={!startsAt}>
              Schedule playtest
            </button>
          </form>
        ) : null}
        <ul className="session-list" aria-label="Sessions">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </ul>
        {sessions.length === 0 ? <p className="muted">No playtests yet.</p> : null}
      </div>
    </Dialog>
  );
}
