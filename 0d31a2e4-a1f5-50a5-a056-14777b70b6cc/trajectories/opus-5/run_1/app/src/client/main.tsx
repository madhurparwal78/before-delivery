import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { navigate, useLocation } from './lib/router.js';
import { store, useApp } from './lib/store.js';
import { voice } from './lib/voice.js';
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  SignInPage,
  SignUpPage,
  VerifyPage,
} from './pages/Account.js';
import { AppShell } from './pages/App.js';
import './styles.css';

const ACCOUNT_ROUTES = new Set([
  '/signup',
  '/signin',
  '/forgot-password',
  '/reset-password',
  '/verify',
]);

function Routes() {
  const { pathname } = useLocation();
  const { me, loaded } = useApp();

  useEffect(() => {
    if (!loaded || ACCOUNT_ROUTES.has(pathname)) return;
    if (me === null) navigate('/signin');
  }, [loaded, me, pathname]);

  if (pathname === '/signup') return <SignUpPage />;
  if (pathname === '/signin') return <SignInPage />;
  if (pathname === '/forgot-password') return <ForgotPasswordPage />;
  if (pathname === '/reset-password') return <ResetPasswordPage />;
  if (pathname === '/verify') return <VerifyPage />;
  if (!loaded) return <div className="booting">Loading Pratfall Cup…</div>;
  return <AppShell />;
}

store.onVoiceSignal((from, data) => {
  void voice.onSignal(from, data);
});
store.onVoiceMember((userId, inVoice) => {
  void voice.onMemberState(userId, inVoice);
});

window.addEventListener('resize', () => store.setLayout(window.innerWidth));
store.setLayout(window.innerWidth);
void store.load();

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Routes />
    </StrictMode>,
  );
}
