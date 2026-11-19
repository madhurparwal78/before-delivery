import { useCallback, useEffect, useRef, useState } from 'react';
import { LAYOUT_UPDATED, NOT_SAVED_TEXT, NO_CHANGES, SAVED_TEXT, SAVING_TEXT, UNREACHABLE_MESSAGE, fromAuthor, restoreNotice } from '../../shared/messages.js';
import type { Change, ChangeReply, ConflictBody, LayoutObject, LiveMessage } from '../../shared/types.js';
import { Unreachable, request, type ApiResult, type ErrorBody } from './api.js';
import { navigate, signInPath } from './router.js';

type Source = { mode: 'edit'; id: string } | { mode: 'view'; token: string };
type Load = 'loading' | 'ready' | 'unavailable';
type SaveState = 'saved' | 'saving' | 'offline';

export interface Message {
  id: number;
  text: string;
}

export type Outcome = { ok: true } | { ok: false; message: string };

/** Builds the change from the layout as it stands when its turn comes; null sends nothing. */
type Build = (layout: LayoutObject) => Change | null;

const randomId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');

export function useWorkspace(source: Source) {
  const sourceKey = source.mode === 'edit' ? `edit:${source.id}` : `view:${source.token}`;
  const [layout, setLayoutState] = useState<LayoutObject | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [designers, setDesigners] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState<Message>({ id: 0, text: '' });
  const [notice, setNotice] = useState<Message | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [editProblem, setEditProblem] = useState('');
  const layoutRef = useRef<LayoutObject | null>(null);
  const editorId = useRef(randomId());
  const counter = useRef(0);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const setLayout = useCallback((next: LayoutObject): void => {
    if (layoutRef.current && next.revision < layoutRef.current.revision) return;
    layoutRef.current = next;
    setLayoutState(next);
  }, []);

  const announce = useCallback((text: string): void => setAnnouncement({ id: ++counter.current, text }), []);
  const raise = useCallback((text: string): void => setNotice({ id: ++counter.current, text }), []);

  const readPath = source.mode === 'edit' ? `/api/layouts/${source.id}` : `/api/view/${source.token}`;
  const livePath = source.mode === 'edit' ? `/api/layouts/${source.id}/live` : `/api/view/${source.token}/live`;
  const here = window.location.pathname;

  const fetchLayout = useCallback(async (): Promise<Load> => {
    try {
      const { status, body } = await request<LayoutObject>('GET', readPath);
      if (status === 401) {
        navigate(signInPath(here), true);
        return 'loading';
      }
      if (status !== 200) return 'unavailable';
      setLayout(body);
      return 'ready';
    } catch {
      return 'unavailable';
    }
  }, [readPath, here, setLayout]);

  useEffect(() => {
    layoutRef.current = null;
    setLayoutState(null);
    setLoad('loading');
    let alive = true;
    void fetchLayout().then((state) => alive && setLoad(state));
    return () => {
      alive = false;
    };
  }, [sourceKey, fetchLayout]);

  const ready = load === 'ready';
  useEffect(() => {
    if (!ready) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let stopped = false;
    let opened = false;
    const open = (): void => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${window.location.host}${livePath}?editor=${editorId.current}`);
      socket.addEventListener('open', () => {
        if (opened) void fetchLayout();
        opened = true;
      });
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as LiveMessage;
        if (message.type === 'presence') {
          setDesigners(message.designers);
          return;
        }
        const current = layoutRef.current;
        if (!current || message.revision <= current.revision) return;
        setLayout({ ...current, ...message.layout });
        if (source.mode === 'view') announce(LAYOUT_UPDATED);
        else {
          announce(fromAuthor(message.author, message.announcement));
          if (message.restored !== null) raise(restoreNotice(message.author, message.restored));
        }
      });
      socket.addEventListener('close', () => {
        if (!stopped) retry = window.setTimeout(open, 2000);
      });
    };
    open();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [ready, livePath]);

  /** One request that counts as "saving": Save state follows it, and an unreachable server is reported. */
  const call = useCallback(
    async <T,>(work: () => Promise<ApiResult<T>>): Promise<ApiResult<T> | null> => {
      pending.current += 1;
      setSaveState('saving');
      setEditProblem('');
      try {
        const result = await work();
        if (result.status === 401) navigate(signInPath(here), true);
        pending.current -= 1;
        if (pending.current === 0) setSaveState('saved');
        return result;
      } catch (error) {
        pending.current -= 1;
        if (!(error instanceof Unreachable)) throw error;
        setSaveState('offline');
        setEditProblem(UNREACHABLE_MESSAGE);
        return null;
      }
    },
    [here],
  );

  /** Send one change, in turn, based on the layout as it stands. Refusals go to "Edit problem" unless the caller shows them. */
  const submit = useCallback(
    (build: Build, inDialog = false): Promise<Outcome> => {
      const run = async (): Promise<Outcome> => {
        const current = layoutRef.current;
        const change = current && build(current);
        if (!current || !change) return { ok: true };
        const result = await call(() =>
          request<ChangeReply | { unchanged: true } | ConflictBody | ErrorBody>('POST', `/api/layouts/${current.id}/changes`, { base_revision: current.revision, change }, { 'X-Editor-Id': editorId.current }),
        );
        if (!result) return { ok: false, message: UNREACHABLE_MESSAGE };
        if (result.status === 200) {
          if ('unchanged' in result.body) announce(NO_CHANGES);
          else {
            const applied = result.body as ChangeReply;
            setLayout(applied.layout);
            announce(applied.announcement);
          }
          return { ok: true };
        }
        if (result.status === 409) {
          const conflict = result.body as ConflictBody;
          setLayout(conflict.layout);
          raise(conflict.message);
          return { ok: true };
        }
        const message = (result.body as ErrorBody).message ?? '';
        if (!inDialog) setEditProblem(message);
        return { ok: false, message };
      };
      const turn = queue.current.then(run, run);
      queue.current = turn;
      return turn;
    },
    [call, announce, raise, setLayout],
  );

  return { layout, load, designers, announcement, notice, saveState, editProblem, setEditProblem, announce, submit, call, setLayout };
}

export const saveText = (state: SaveState): string => (state === 'saving' ? SAVING_TEXT : state === 'offline' ? NOT_SAVED_TEXT : SAVED_TEXT);
