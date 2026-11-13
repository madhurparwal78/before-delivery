import { useEffect, useState } from 'react';
import { fetchAttachment, type OpenableAttachment } from '../lib/attachments';
import type { PeerProfile } from '../types';

function usePicture(attachment: OpenableAttachment | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const blobId = attachment?.blob_id;
  useEffect(() => {
    if (!attachment) {
      setUrl(null);
      return;
    }
    let live = true;
    void fetchAttachment(attachment).then((result) => {
      if (live && result.status === 'ok') setUrl(result.url);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobId]);
  return url;
}

/** A person's photo as a tipped-in plate, or the plain avatar drawn in code. */
export function Avatar({ profile, size = 48 }: { profile: PeerProfile | null | undefined; size?: number }) {
  const url = usePicture(profile?.photo ?? null);
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" width={size} height={size} />
      ) : (
        <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
          <circle cx="24" cy="18" r="8" />
          <path d="M8 44c0-9 7-15 16-15s16 6 16 15z" />
        </svg>
      )}
    </span>
  );
}
