import { useCallback, useRef, useState } from "preact/hooks";

// A polite live region's text. Each call announces once: the region is emptied first, so the same
// message twice in a row is still two announcements.
interface Announcement {
  text: string;
  error: boolean;
}

export function useAnnouncer(): [Announcement, (text: string, error?: boolean) => void] {
  const [value, setValue] = useState<Announcement>({ text: "", error: false });
  const last = useRef("");
  const announce = useCallback((text: string, error = false) => {
    if (last.current === text) {
      setValue({ text: "", error });
      queueMicrotask(() => setValue({ text, error }));
    } else {
      setValue({ text, error });
    }
    last.current = text;
  }, []);
  return [value, announce];
}
