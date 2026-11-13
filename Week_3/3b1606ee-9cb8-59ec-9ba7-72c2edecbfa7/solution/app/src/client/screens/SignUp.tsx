import { useEffect, useRef, useState, type FormEvent } from 'react';
import { canonicalGroup, newIdentity, newRecoveryCode, recoveryKeys, RECOVERY_GROUPS, type NewIdentity, type RecoveryKeys } from '../crypto/identity';
import { saveProfile } from '../store/actions';
import { ApiFailure } from '../store/api';
import { navigate } from '../store/router';
import { createAccount, enterApp } from '../store/runtime';
import type { Account } from '../../shared/types';
import { getState } from '../store/state';
import { Chip, Slip, useAvailability } from '../ui/Field';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';

type Step = 'username' | 'code' | 'check' | 'profile';
const GENERIC = 'Something went wrong. Try again.';
const STEP_NUMBER: Record<Step, number> = { username: 1, code: 2, check: 3, profile: 4 };
const HEADINGS: Record<Step, string> = {
  username: 'Choose a username',
  code: 'Keep your recovery code',
  check: 'Check your recovery code',
  profile: 'Your profile',
};
const MISMATCH = "That group doesn't match your recovery code.";

/** Three distinct group positions out of eight, in order. */
function pickGroups(): number[] {
  const picked = new Set<number>();
  const random = crypto.getRandomValues(new Uint32Array(16));
  for (const value of random) {
    picked.add((value % RECOVERY_GROUPS) + 1);
    if (picked.size === 3) break;
  }
  return [...picked].sort((a, b) => a - b);
}

interface Keys {
  code: string;
  recovery: RecoveryKeys;
  identity: NewIdentity;
}

export function SignUp() {
  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [keys, setKeys] = useState<Keys | null>(null);
  const [asked, setAsked] = useState<number[]>([]);
  const [groups, setGroups] = useState<Record<number, string>>({});
  const [wrong, setWrong] = useState<number[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const availability = useAvailability(username);
  const first = useRef<HTMLElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const skipCheck = getState().config!.grading && new URLSearchParams(location.search).get('skip_recovery_check') === '1';

  useEffect(() => {
    first.current?.focus();
  }, [step]);

  async function chooseUsername(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      if (!(await availability.check())) {
        setBusy(false);
        return;
      }
      const code = newRecoveryCode();
      const recovery = await recoveryKeys(code);
      setKeys({ code, recovery, identity: await newIdentity(recovery.backupKey) });
      setStep('code');
    } catch {
      setProblem(GENERIC);
    }
    setBusy(false);
  }

  async function create(): Promise<void> {
    setBusy(true);
    try {
      setAccount(await createAccount(username.toLowerCase(), keys!.recovery, keys!.identity));
      setStep('profile');
      setProblem(null);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'username_taken') {
        setStep('username');
        setKeys(null);
        void availability.check();
      } else setProblem(GENERIC);
    }
    setBusy(false);
  }

  async function writtenDown(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (skipCheck) {
      await create();
      return;
    }
    setAsked(pickGroups());
    setGroups({});
    setWrong([]);
    setStep('check');
  }

  async function check(event: FormEvent): Promise<void> {
    event.preventDefault();
    const expected = keys!.code.split('-');
    const bad = asked.filter((position) => canonicalGroup(groups[position] ?? '') !== expected[position - 1]);
    setWrong(bad);
    if (bad.length > 0) {
      document.getElementById(`group-${bad[0]}`)?.focus();
      return;
    }
    await create();
  }

  async function finish(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (saved) {
      await enterApp(account!);
      navigate('/letters', true);
      return;
    }
    if (displayName.trim() === '') {
      setProblem('Enter a display name.');
      first.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await saveProfile(displayName.trim(), photo);
      setSaved(true);
      if (!result.photoSaved) {
        setProblem("Your photo couldn't be saved. You can add it in Settings later.");
        setBusy(false);
        return;
      }
      await enterApp(account!);
      navigate('/letters', true);
    } catch {
      setProblem(GENERIC);
    }
    setBusy(false);
  }

  return (
    <main className="auth">
      <Sheet className="sheet--auth">
        <header className="auth__head">
          <Link to="/" className="monogram" aria-label="Hp, Halfpenny Post Co.">
            Hp
          </Link>
          <p className="auth__step">Step {STEP_NUMBER[step]} of 4</p>
          <h1>{HEADINGS[step]}</h1>
        </header>
        {step === 'username' && (
          <form className="panel" onSubmit={(event) => void chooseUsername(event)}>
            <label className="field" htmlFor="username">
              Username
            </label>
            <div className="well">
              <input
                ref={first as React.RefObject<HTMLInputElement>}
                id="username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <Chip text={availability.chip} />
            {problem && <Slip id="signup-problem">{problem}</Slip>}
            <button type="submit" className="button button--ink" aria-busy={busy || undefined} disabled={busy}>
              Continue
            </button>
          </form>
        )}
        {step === 'code' && keys && (
          <form className="panel" onSubmit={(event) => void writtenDown(event)}>
            <div ref={first as React.RefObject<HTMLDivElement>} role="group" aria-label="Your recovery code" tabIndex={-1} className="recovery">
              <p className="recovery__note">This is the only way back into your account. It is shown once. Write it down and keep it safe.</p>
              <p className="recovery__code" data-testid="recovery-code">
                {keys.code}
              </p>
            </div>
            {problem && <Slip id="signup-problem">{problem}</Slip>}
            <button type="submit" className="button button--ink" aria-busy={busy || undefined} disabled={busy}>
              I&apos;ve written it down
            </button>
          </form>
        )}
        {step === 'check' && (
          <form className="panel" onSubmit={(event) => void check(event)}>
            <p className="panel__note">Type back three groups of your recovery code.</p>
            {asked.map((position, index) => (
              <div key={position}>
                <label className="field" htmlFor={`group-${position}`}>
                  Group {position}
                </label>
                <div className="well">
                  <input
                    ref={index === 0 ? (first as React.RefObject<HTMLInputElement>) : undefined}
                    id={`group-${position}`}
                    type="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    value={groups[position] ?? ''}
                    aria-describedby={wrong.includes(position) ? `group-slip-${position}` : undefined}
                    onChange={(event) => setGroups({ ...groups, [position]: event.target.value })}
                  />
                </div>
                {wrong.includes(position) && <Slip id={`group-slip-${position}`}>{MISMATCH}</Slip>}
              </div>
            ))}
            {problem && <Slip id="signup-problem">{problem}</Slip>}
            <button type="submit" className="button button--ink" aria-busy={busy || undefined} disabled={busy}>
              Check
            </button>
          </form>
        )}
        {step === 'profile' && (
          <form className="panel" onSubmit={(event) => void finish(event)}>
            <label className="field" htmlFor="display-name">
              Display name
            </label>
            <div className="well">
              <input
                ref={first as React.RefObject<HTMLInputElement>}
                id="display-name"
                type="text"
                value={displayName}
                maxLength={40}
                aria-describedby={problem ? 'signup-problem' : undefined}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            {problem && <Slip id="signup-problem">{problem}</Slip>}
            <div className="panel__buttons">
              <button type="button" className="button button--quiet" onClick={() => picker.current?.click()}>
                Add a photo
              </button>
              {photo && <span className="panel__file">{photo.name}</span>}
            </div>
            <button type="submit" className="button button--ink" aria-busy={busy || undefined} disabled={busy}>
              Finish
            </button>
            <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo" hidden onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
          </form>
        )}
      </Sheet>
    </main>
  );
}
