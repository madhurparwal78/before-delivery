import { useEffect } from 'react';
import { Landing } from './screens/Landing';
import { SignIn, SignedOut } from './screens/SignIn';
import { SignUp } from './screens/SignUp';
import { Workspace } from './screens/Workspace';
import { navigate, parseRoute } from './store/router';
import { bootApp } from './store/runtime';
import { setState, useStore } from './store/state';
import { Chrome } from './ui/Chrome';

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

export function App() {
  const auth = useStore((state) => state.auth);
  const path = useStore((state) => state.route);
  const route = parseRoute(path);

  useEffect(() => {
    bootApp().catch(() => setState({ auth: 'anonymous' }));
  }, []);

  let screen;
  if (auth === 'loading') screen = <div className="boot" aria-hidden="true" />;
  else if (auth === 'signed_in') screen = route.name === 'landing' || route.name === 'signup' || route.name === 'signin' ? <Redirect to="/letters" /> : <Workspace route={route} />;
  else if (auth === 'revoked') screen = route.name === 'signin' ? <SignIn /> : <SignedOut />;
  else if (route.name === 'landing') screen = <Landing />;
  else if (route.name === 'signup') screen = <SignUp />;
  else if (route.name === 'signin') screen = <SignIn />;
  else screen = <Redirect to="/" />;

  return (
    <div className={`app${auth === 'signed_in' ? ' app--work' : ''}`}>
      <Chrome />
      {screen}
    </div>
  );
}
