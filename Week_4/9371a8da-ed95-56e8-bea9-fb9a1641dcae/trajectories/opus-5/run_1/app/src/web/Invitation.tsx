import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from './api.js';
import { copy } from './copy.js';
import { replace } from './navigation.js';
import { User } from './types.js';

interface InviteDetails {
  projectTitle: string;
  role: string;
  inviterName: string;
  email: string;
  expiresAt: string;
}

interface Props {
  token: string;
  onSignedIn: (user: User) => void;
}

export function Invitation(props: Props): JSX.Element {
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [dead, setDead] = useState(false);
  const [member, setMember] = useState<{ projectId: string; title: string } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const answer = await api<{ invite: InviteDetails }>(`/api/invites/${props.token}`);
        setInvite(answer.invite);
      } catch (failure) {
        if (failure instanceof ApiFailure && (failure.status === 410 || failure.status === 404)) {
          setDead(true);
        }
      }
    })();
  }, [props.token]);

  const accept = async (): Promise<void> => {
    setPending(true);
    setNameError(null);
    setPasswordError(null);
    try {
      const answer = await api<{ user: User; projectId: string; role: string }>(
        `/api/invites/${props.token}/accept`,
        { method: 'POST', body: { displayName, password } },
      );
      props.onSignedIn(answer.user);
      replace(`/p/${answer.projectId}?file=main.tex`);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) {
        setPasswordError(copy.somethingWrong);
        return;
      }
      if (failure.status === 401) {
        setPasswordError(copy.fields.passwordMismatch);
        passwordRef.current?.focus();
        return;
      }
      if (failure.status === 410) {
        setDead(true);
        return;
      }
      if (failure.status === 409 && typeof failure.body.projectId === 'string') {
        setMember({
          projectId: failure.body.projectId,
          title: invite === null ? '' : invite.projectTitle,
        });
        return;
      }
      if (failure.field('displayName') !== null) setNameError(copy.fields.displayName);
      if (failure.field('password') !== null) setPasswordError(copy.fields.passwordNew);
    } finally {
      setPending(false);
    }
  };

  if (dead) {
    return (
      <main className="centred-column">
        <h1>{copy.invitationInvalid}</h1>
      </main>
    );
  }
  if (invite === null) return <main className="centred-column" />;

  return (
    <main className="centred-column">
      <h1>Join {invite.projectTitle}</h1>
      {member === null ? (
        <>
          <p>{copy.invitationSentence(invite.inviterName, invite.role)}</p>
          <label>
            <span className="field-label">Display name</span>
            <input
              value={displayName}
              aria-describedby={nameError === null ? undefined : 'name-error'}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          {nameError === null ? null : (
            <p className="field-error" id="name-error">
              {nameError}
            </p>
          )}
          <label>
            <span className="field-label">Password</span>
            <input
              ref={passwordRef}
              type="password"
              value={password}
              aria-describedby={passwordError === null ? undefined : 'password-error'}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {passwordError === null ? null : (
            <p className="field-error" id="password-error">
              {passwordError}
            </p>
          )}
          <p className="hint">{copy.invitationHint}</p>
          <button
            type="button"
            onClick={() => void accept()}
            disabled={pending}
            aria-busy={pending ? true : undefined}
          >
            Accept invitation
          </button>
        </>
      ) : (
        <>
          <p>{copy.invitationAlreadyMember(invite.projectTitle)}</p>
          <a href={`/p/${member.projectId}?file=main.tex`}>Open {invite.projectTitle}</a>
        </>
      )}
    </main>
  );
}
