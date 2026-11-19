import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { configSignal } from '../config';

export type DraftStatus = '' | 'Saving…' | 'Saved' | 'A newer version exists';

export interface Draft {
  text: string;
  status: DraftStatus;
  newer: { text: string; version: number } | null;
  edit: (text: string) => void;
  loadNewer: () => void;
  reset: () => Promise<void>;
}

/** A private draft saved after the configured pause in typing; saving over a newer version is refused. */
export function useDraft(key: string): Draft {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<DraftStatus>('');
  const [newer, setNewer] = useState<Draft['newer']>(null);
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef('');

  const load = async (): Promise<void> => {
    const result = await api<{ text: string; version: number }>('GET', `/api/drafts/${key}`);
    if (!result.ok) return;
    version.current = result.body.version;
    latest.current = result.body.text;
    setText(result.body.text);
  };
  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key]);

  const save = async (): Promise<void> => {
    setStatus('Saving…');
    const result = await api<{ version: number; current?: { text: string; version: number } }>('PUT', `/api/drafts/${key}`, { text: latest.current, version: version.current });
    if (result.ok) {
      version.current = result.body.version;
      setStatus('Saved');
    } else if (result.status === 409 && result.body.current) {
      setNewer(result.body.current);
      setStatus('A newer version exists');
    } else setStatus('');
  };

  return {
    text,
    status,
    newer,
    edit: (next) => {
      latest.current = next;
      setText(next);
      setNewer(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), configSignal.get()?.autosave_ms ?? 1000);
    },
    loadNewer: () => {
      if (!newer) return;
      version.current = newer.version;
      latest.current = newer.text;
      setText(newer.text);
      setNewer(null);
      setStatus('');
    },
    reset: async () => {
      if (timer.current) clearTimeout(timer.current);
      setStatus('');
      await load();
    },
  };
}
