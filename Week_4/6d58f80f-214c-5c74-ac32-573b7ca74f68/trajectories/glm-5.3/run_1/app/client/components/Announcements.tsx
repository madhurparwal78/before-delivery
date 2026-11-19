import { useEffect, useRef, useState } from 'preact/hooks';

let announceFn: ((text: string) => void) | null = null;

export function announce(text: string): void {
  announceFn?.(text);
}

export function Announcements(): preact.JSX.Element {
  const [text, setText] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    announceFn = (t: string) => {
      seq.current++;
      setText(`${seq.current}\u2003${t}`);
    };
    return () => { announceFn = null; };
  }, []);

  return (
    <div role="status" aria-live="polite" class="sr-only" id="announcements">
      {text}
    </div>
  );
}
