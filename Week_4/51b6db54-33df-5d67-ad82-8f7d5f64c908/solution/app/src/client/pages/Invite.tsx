import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { navigate } from '../router';
import { useMe } from '../session';
import { notify, raise } from '../ui';
import { Shell } from './Shell';

interface InviteData {
  project: string;
  role: string;
  state: string;
}

export function Invite({ token }: { token: string }): JSX.Element {
  const me = useMe();
  const [invite, setInvite] = useState<InviteData | null | undefined>(undefined);
  useEffect(() => {
    void api<InviteData>('GET', `/api/invites/${token}`).then((result) => setInvite(result.ok ? result.body : null));
  }, [token]);

  const accept = async (): Promise<void> => {
    const result = await api<{ project: number }>('POST', `/api/invites/${token}/accept`);
    if (!result.ok) return raise(refusal(result).message);
    notify(`You joined ${invite?.project ?? ''}`);
    navigate(`/projects/${result.body.project}`);
  };

  const next = encodeURIComponent(`/invites/${token}`);
  return (
    <Shell>
      <main class="narrow">
        <section class="card">
          {invite === undefined ? (
            <p class="loading-outline" aria-busy="true">
              Loading invite
            </p>
          ) : invite === null ? (
            <h1 class="page-title">This invite does not exist</h1>
          ) : (
            <>
              <h1 class="page-title">Join {invite.project}</h1>
              <p>
                You are invited as {invite.role}. This invite is {invite.state}.
              </p>
              {me ? (
                <button class="pill" type="button" onClick={() => void accept()}>
                  Accept invite
                </button>
              ) : (
                <div class="row">
                  <a class="pill" href={`/signin?next=${next}`} data-route>
                    Sign in
                  </a>
                  <a class="pill" href={`/signup?next=${next}`} data-route>
                    Create account
                  </a>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </Shell>
  );
}
