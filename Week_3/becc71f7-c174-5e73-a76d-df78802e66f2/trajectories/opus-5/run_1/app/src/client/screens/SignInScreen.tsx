import { useState } from 'preact/hooks';
import { ApiError, post } from '../lib/api.js';
import { go } from '../lib/router.js';
import { takeRemembered } from '../lib/resume.js';
import type { Session } from '../lib/types.js';
import { fieldCopy } from '../../shared/copy.js';
import { ActionButton, Field } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { PublicTopBar } from '../components/chrome.js';
import { BottomBar } from '../components/layout.js';
import { isValidEmailish } from '../lib/validate.js';

interface SignInScreenProps {
  onSignedIn: (session: Session) => void;
}

export function SignInScreen({ onSignedIn }: SignInScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);

  const signIn = async (): Promise<void> => {
    if (!isValidEmailish(email)) {
      setProblems(problemsOf({ email: fieldCopy.email }));
      return;
    }
    setPending(true);
    try {
      const session = await post<Session>('/api/session', { email: email.trim(), password });
      onSignedIn(session);
      const remembered = takeRemembered();
      go(remembered === null || remembered.href === '/sign-in' ? session.homeRoute : remembered.href);
    } catch (error) {
      if (error instanceof ApiError) setProblems(problemsOf({}, error.failure.message));
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="screen">
      <PublicTopBar />
      <main class="screen__main screen__main--narrow">
        <h1 class="heading heading--1">Sign in</h1>
        <form
          class="card"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <ProblemsSummary
            problems={problems}
            controlIds={{ email: 'sign-in-email', password: 'sign-in-password' }}
            labels={{}}
          />
          <Field
            id="sign-in-email"
            label="Email"
            type="email"
            value={email}
            onInput={setEmail}
            autoComplete="username"
            problem={problems.fields['email']}
          />
          <Field
            id="sign-in-password"
            label="Password"
            type="password"
            value={password}
            onInput={setPassword}
            autoComplete="current-password"
            problem={problems.fields['password']}
          />
          <BottomBar>
            <ActionButton label="Sign in" pending={pending} onPress={() => void signIn()} />
          </BottomBar>
        </form>
      </main>
    </div>
  );
}
