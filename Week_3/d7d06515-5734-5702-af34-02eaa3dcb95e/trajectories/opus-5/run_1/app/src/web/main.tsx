import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MeResponse } from '../shared/api';
import { copy } from '../shared/copy';
import { ApiFailure, request, setLinkToken } from './api';
import { Announcements, AppLink, LoadingStrokes, navigate, useLocation, Wordmark } from './shell';
import { LandingPage } from './pages/Landing';
import {
  CheckInboxPage,
  OpenLinkPage,
  SigninPage,
  SignupPage,
  VerifyPage,
} from './pages/Account';
import { DashboardPage } from './pages/Dashboard';
import { EditorPage } from './editor/Editor';

function useMe(): { me: MeResponse | null; loading: boolean } {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    request<MeResponse>('GET', '/api/me')
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);
  return { me, loading };
}

function LinkStatusPage(props: { heading: string }): JSX.Element {
  return (
    <div className="auth-page">
      <Announcements />
      <div className="auth-card">
        <AppLink to="/">
          <Wordmark />
        </AppLink>
        <h1>{props.heading}</h1>
        <AppLink to="/open" className="btn btn-outline">
          Open a shared drawing
        </AppLink>
      </div>
    </div>
  );
}

interface LinkInfo {
  drawing: { id: string; name: string };
  access: string;
  expiry_label: string;
}

function SharedDrawingPage(props: { token: string }): JSX.Element {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; info: LinkInfo } | { kind: 'dead'; heading: string }
  >({ kind: 'loading' });

  useEffect(() => {
    setLinkToken(props.token);
    request<LinkInfo>('GET', `/api/links/${props.token}`)
      .then((info) => setState({ kind: 'ready', info }))
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure) {
          setState({
            kind: 'dead',
            heading:
              failure.code === 'link_expired'
                ? copy.access.expiredHeading
                : failure.code === 'link_revoked'
                  ? copy.access.revokedHeading
                  : copy.access.unknownHeading,
          });
        }
      });
    return () => setLinkToken(null);
  }, [props.token]);

  if (state.kind === 'loading') {
    return (
      <div className="auth-page">
        <LoadingStrokes />
      </div>
    );
  }
  if (state.kind === 'dead') return <LinkStatusPage heading={state.heading} />;
  return (
    <EditorPage
      drawingId={state.info.drawing.id}
      linkToken={props.token}
      me={null}
      linkExpiryLabel={state.info.expiry_label}
      onLinkDead={(status) =>
        setState({
          kind: 'dead',
          heading: status === 'expired' ? copy.access.expiredHeading : copy.access.revokedHeading,
        })
      }
    />
  );
}

function SignedInRoute(props: { children: (me: MeResponse) => JSX.Element }): JSX.Element {
  const { me, loading } = useMe();
  useEffect(() => {
    if (!loading && me === null) navigate('/signin', true);
  }, [loading, me]);
  if (loading) {
    return (
      <div className="auth-page">
        <LoadingStrokes />
      </div>
    );
  }
  if (me === null) return <div className="auth-page" />;
  return props.children(me);
}

function App(): JSX.Element {
  const location = useLocation();
  const [path, query] = location.split('?');
  const params = new URLSearchParams(query ?? '');
  const segments = (path ?? '/').split('/').filter((part) => part.length > 0);

  useEffect(() => {
    setLinkToken(segments[0] === 's' ? (segments[1] ?? null) : null);
  }, [location]);

  if (segments.length === 0) return <LandingPage />;
  if (segments[0] === 'signup') return <SignupPage />;
  if (segments[0] === 'check-inbox') return <CheckInboxPage />;
  if (segments[0] === 'signin') return <SigninPage />;
  if (segments[0] === 'open') return <OpenLinkPage />;
  if (segments[0] === 'verify' && segments[1] !== undefined) return <VerifyPage token={segments[1]} />;
  if (segments[0] === 's' && segments[1] !== undefined) return <SharedDrawingPage token={segments[1]} />;
  if (segments[0] === 'drawings') {
    return (
      <SignedInRoute>
        {(me) => <DashboardPage me={me} view={params.get('view')} folder={params.get('folder')} />}
      </SignedInRoute>
    );
  }
  if (segments[0] === 'd' && segments[1] !== undefined) {
    const drawingId = segments[1];
    return (
      <SignedInRoute>
        {(me) => (
          <EditorPage
            drawingId={drawingId}
            linkToken={null}
            me={me}
            linkExpiryLabel={null}
            onLinkDead={() => navigate('/drawings')}
          />
        )}
      </SignedInRoute>
    );
  }
  return <LandingPage />;
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
