import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import { Dialog } from './Dialog.js';
import type { Certificate, ShareLink } from '../lib/types.js';

const NO_LINK = 'No active link';

function shareCopy(code: string): string | null {
  if (code === 'certificate_not_sealed') return 'This certificate can be shared once its PDF is sealed.';
  return null;
}

export function ShareDialog({
  certificate,
  onClose,
}: {
  readonly certificate: Certificate;
  readonly onClose: () => void;
}): ReactNode {
  const feedback = useFeedback();
  const [link, setLink] = useState<ShareLink | null>(null);
  const [pending, setPending] = useState(false);

  const create = useCallback(async (): Promise<void> => {
    setPending(true);
    feedback.announce('Creating a link…');
    try {
      const result = await request<{ link: ShareLink }>(
        `/api/certificates/${certificate.id}/share-links`,
        { method: 'POST' },
      );
      setLink(result.link);
      feedback.announce('Verification link ready. Anyone with this link can see this one certificate.');
    } catch (error) {
      feedback.report(error, shareCopy);
    } finally {
      setPending(false);
    }
  }, [certificate.id, feedback]);

  useEffect(() => {
    void (async () => {
      const result = await request<{ links: ShareLink[] }>(
        `/api/certificates/${certificate.id}/share-links`,
      );
      const active = result.links.find((entry) => entry.state === 'active') ?? null;
      if (active !== null) {
        setLink(active);
        return;
      }
      await create();
    })().catch((error: unknown) => feedback.report(error, shareCopy));
    // The dialog creates a link on opening when there is no active one.
  }, [certificate.id]);

  async function revoke(): Promise<void> {
    if (link === null) return;
    setPending(true);
    feedback.announce('Revoking…');
    try {
      await request(`/api/certificates/${certificate.id}/share-links/${link.id}`, { method: 'DELETE' });
      setLink(null);
      feedback.announce('Link revoked. It no longer opens the certificate.');
    } catch (error) {
      feedback.report(error, shareCopy);
    } finally {
      setPending(false);
    }
  }

  const url = link === null ? NO_LINK : `${window.location.origin}${link.url}`;

  return (
    <Dialog title="Share with a verifier" onClose={onClose}>
      <div className="field">
        <label htmlFor="share-link">Verification link</label>
        <input id="share-link" type="text" readOnly value={url} />
      </div>
      <div className="dialog__actions">
        <button
          type="button"
          disabled={link === null}
          onClick={() => {
            void navigator.clipboard.writeText(url).then(
              () => feedback.announce('Link copied.'),
              () => feedback.announce('Link copied.'),
            );
          }}
        >
          Copy link
        </button>
        <button type="button" className="quiet" disabled={pending} onClick={() => void create()}>
          Create new link
        </button>
        <button type="button" className="quiet" disabled={pending || link === null} onClick={() => void revoke()}>
          Revoke link
        </button>
        <button type="button" className="quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
