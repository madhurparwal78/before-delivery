import { useCallback, useState } from 'react';

interface StatusProps {
  /** the region's accessible name, as the brief names it */
  name: string;
  text: string;
  /** a full-width mid-pink bar, for errors and outages */
  banner?: boolean;
  /** a confirmation: a ground-tinted pill with a check, instead of the mid-pink bar of an error */
  ok?: boolean;
}

/** A polite live region. It stays in the tree when empty, so a later change is announced. Copy is ASCII only. */
export function Status({ name, text, banner = false, ok = false }: StatusProps) {
  const tone = banner ? 'status status-banner' : ok ? 'status status-ok' : 'status';
  return (
    <div role="status" aria-live="polite" aria-label={name} className={tone}>
      {text}
    </div>
  );
}

/** The text a page's `Status` shows and the function that replaces it. */
export function useAnnouncer(): [string, (text: string) => void] {
  const [text, setText] = useState('');
  const announce = useCallback((next: string) => setText(next), []);
  return [text, announce];
}
