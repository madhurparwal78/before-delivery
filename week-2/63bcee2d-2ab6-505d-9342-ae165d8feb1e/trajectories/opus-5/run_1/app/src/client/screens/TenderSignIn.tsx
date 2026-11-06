import { useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal } from '../lib/copy.js';
import { setPageTitle, useRouter } from '../lib/router.jsx';
import { useWorkspace, type SignedInMember } from '../lib/workspace.jsx';
import { ActionButton } from '../components/Buttons.jsx';

/**
 * The page itself never uses the link. Only "Continue to tender" does, so a
 * single-use link survives a reload of this page.
 */
export function TenderSignIn({ token }: { token: string }): JSX.Element {
  const { startPending, say, problem } = useAnnouncer();
  const { setMember, refresh } = useWorkspace();
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);

  setPageTitle('Tender sign-in · Marrow Hall Interiors');

  const tenderTitle =
    document
      .querySelector<HTMLMetaElement>('meta[name="plumbline:tender-title"]')
      ?.content ?? '';

  const consume = async (): Promise<void> => {
    setBusy(true);
    startPending(pending.continueToTender);
    try {
      const result = await request<{ tenderId: string }>('/api/tender-links/consume', {
        body: { token },
      });
      const session = await request<{ member: SignedInMember }>('/api/session');
      setMember(session.member);
      refresh();
      navigate(`/office/tenders/${result.tenderId}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'not_found') {
        problem(refusal.tenderLinkSpent);
      } else {
        problem(refusal.networkFailure);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel form-card">
      <h1>{tenderTitle === '' ? 'Tender sign-in' : tenderTitle}</h1>
      <p>
        This link signs you in once so you can read the tender and place or amend your bid.
      </p>
      <ActionButton
        className="primary"
        busy={busy}
        pendingLabel={pending.continueToTender}
        onPress={() => void consume()}
      >
        Continue to tender
      </ActionButton>
    </section>
  );
}
