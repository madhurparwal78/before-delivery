import { useEffect, useState } from 'react';
import { UNREACHABLE_PAGE_MESSAGE } from '../../shared/messages.js';
import { request } from '../lib/api.js';
import { navigate, signInPath } from '../lib/router.js';
import { NotAvailable } from './NotAvailable.js';

/** The join page has no content of its own: it joins and moves on to the editor, or shows the not-available page. */
export function JoinPage({ token }: { token: string }) {
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    request<{ layout_id: string }>('POST', `/api/join/${token}`)
      .then(({ status, body }) => {
        if (status === 401) navigate(signInPath(`/join/${token}`), true);
        else if (status === 200) navigate(`/layouts/${body.layout_id}`, true);
        else setMissing(true);
      })
      .catch(() => setFailed(true));
  }, [token]);
  if (failed) return <p className="problem">{UNREACHABLE_PAGE_MESSAGE}</p>;
  return missing ? <NotAvailable signedIn /> : null;
}
