import { useEffect, useState } from 'react';
import { fetchAttachment, type Fetched, type OpenableAttachment } from '../lib/attachments';

/** The unsealed attachment for a letter, or `loading` until it has been downloaded and checked. */
export function useFetched(attachment: OpenableAttachment | null, skip: boolean): Fetched | 'loading' {
  const [state, setState] = useState<Fetched | 'loading'>('loading');
  const blobId = attachment?.blob_id;
  useEffect(() => {
    if (!attachment || skip) return;
    let live = true;
    setState('loading');
    void fetchAttachment(attachment).then((result) => live && setState(result));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobId, skip]);
  return state;
}
