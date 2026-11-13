/** The three screens reached from a link: email verification, invites and add-a-friend. */
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiFailure, type Friends } from '../api';
import { openSheet } from '../auth-sheet';
import { navigate } from '../router';
import type { Store } from '../store';
import { HeadingScreen } from '../ui';

export function Verify({ store }: { store: Store }): ReactNode {
  const [heading, setHeading] = useState('');
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('token') ?? '';
    void api('POST', '/api/auth/verify', { token })
      .then(() => setHeading('Email verified'))
      .catch((error: ApiFailure) => setHeading(error.message));
  }, []);
  return <HeadingScreen store={store} heading={heading} />;
}

export function Invite({ store, token }: { store: Store; token: string }): ReactNode {
  const [refusal, setRefusal] = useState('');
  const { auth } = store;
  useEffect(() => {
    if (auth === 'loading') return;
    const accept = async (): Promise<void> => {
      try {
        const { tableUrl } = await api<{ tableUrl: string }>('POST', `/api/invites/${token}/accept`);
        navigate(tableUrl, true);
      } catch (error) {
        setRefusal((error as ApiFailure).message);
      }
    };
    void api('GET', `/api/invites/${token}`).then(() => {
      if (auth === 'player') void accept();
      else openSheet({ opener: null, then: () => void accept(), note: 'Sign up to join the table' });
    }).catch((error: ApiFailure) => setRefusal(error.message));
  }, [auth, token]);
  if (refusal !== '') return <HeadingScreen store={store} heading={refusal} />;
  return <HeadingScreen store={store} heading="Private table">{auth === 'guest' && <p>Sign up to join the table</p>}</HeadingScreen>;
}

export function AddFriend({ store, code }: { store: Store; code: string }): ReactNode {
  const [result, setResult] = useState('');
  useEffect(() => {
    const send = async (): Promise<void> => {
      try {
        const { requestId } = await api<{ requestId: string }>('POST', '/api/friends/requests', { code });
        const { outgoing } = await api<Friends>('GET', '/api/friends');
        setResult(`Request sent to ${outgoing.find((item) => item.requestId === requestId)?.displayName}.`);
      } catch (error) {
        setResult((error as ApiFailure).message);
      }
    };
    void send();
  }, [code]);
  return <HeadingScreen store={store} heading="Add friend"><p role="status" aria-label="Friends notice">{result}</p></HeadingScreen>;
}
